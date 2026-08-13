package migrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	legacyPublicationBackfillKey                  = "legacy-publication-authoring-v1"
	legacyPublicationProtectedScopeKeyPrefix      = "legacy-publication-protected-scope-v1:"
	legacyPublicationBackfillBatchSize            = 64
	legacyPublicationBackfillMaxBatchesPerStartup = 8
	legacyPublicationStaleProcessingAge           = 15 * time.Minute

	legacyPublicationBackfillPhaseJobScopes = "job_scopes"
	legacyPublicationBackfillPhasePosts     = "posts"
	legacyPublicationBackfillPhaseAuth      = "authorizations"
	legacyPublicationBackfillPhaseComplete  = "complete"
)

type legacyPublicationBackfillState struct {
	bun.BaseModel `bun:"table:legacy_publication_authoring_backfill_state"`

	Key            string    `bun:",pk"`
	Phase          string    `bun:",notnull"`
	CursorID       string    `bun:"cursor_id,notnull,default:''"`
	ProcessedCount int64     `bun:"processed_count,notnull,default:0"`
	CompletedAt    time.Time `bun:"completed_at,nullzero"`
	UpdatedAt      time.Time `bun:"updated_at,notnull"`
}

// resumeLegacyPublicationAuthoringBackfill first drains the active-job safety
// work and the one-time protected-failed scope scan so workers and mutations
// cannot create a duplicate external write. Every scan query is a durable
// keyset window; this safety boundary intentionally runs to completion before
// serving. Post translation, ordinary historical scope repair, and historical
// authorization remain capped per startup and resume from their durable cursor.
func resumeLegacyPublicationAuthoringBackfill(ctx context.Context, db *bun.DB) error {
	if err := ensureLegacyPublicationAuthoringBackfillSchema(ctx, db); err != nil {
		return err
	}
	if err := ensureLegacyPublicationActiveScopeInvariant(ctx, db); err != nil {
		return err
	}
	if err := repairPendingLegacyPublicationJobScopes(ctx, db); err != nil {
		return err
	}
	if err := repairProtectedFailedLegacyPublicationJobScopes(ctx, db); err != nil {
		return err
	}
	if err := requeueStaleLegacyPublicationJobs(ctx, db); err != nil {
		return err
	}
	if err := migratePendingLegacyPublishPostJobs(ctx, db); err != nil {
		return err
	}
	if err := authorizePendingLegacyPublicationJobs(ctx, db); err != nil {
		return err
	}
	for range legacyPublicationBackfillMaxBatchesPerStartup {
		done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, legacyPublicationBackfillBatchSize)
		if err != nil || done {
			return err
		}
	}
	return nil
}

// drainLegacyPublicationAuthoringBackfill is the explicit maintenance path. It
// uses the same bounded batches and durable cursor as startup, but continues
// until the current backlog is complete.
func drainLegacyPublicationAuthoringBackfill(ctx context.Context, db *bun.DB) error {
	if err := ensureLegacyPublicationActiveScopeInvariant(ctx, db); err != nil {
		return err
	}
	if err := repairPendingLegacyPublicationJobScopes(ctx, db); err != nil {
		return err
	}
	if err := repairProtectedFailedLegacyPublicationJobScopes(ctx, db); err != nil {
		return err
	}
	if err := requeueStaleLegacyPublicationJobs(ctx, db); err != nil {
		return err
	}
	if err := migratePendingLegacyPublishPostJobs(ctx, db); err != nil {
		return err
	}
	if err := authorizePendingLegacyPublicationJobs(ctx, db); err != nil {
		return err
	}
	for {
		done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, legacyPublicationBackfillBatchSize)
		if err != nil || done {
			return err
		}
	}
}

// restartLegacyPublicationAuthoringBackfill starts a maintenance pass from the
// first key. Translation, scope repair, and authorization are idempotent, so a
// completed installation can safely use this entry point after importing an
// older database or compatibility rows.
func restartLegacyPublicationAuthoringBackfill(ctx context.Context, db *bun.DB) error {
	if err := ensureLegacyPublicationAuthoringBackfillSchema(ctx, db); err != nil {
		return err
	}
	now := time.Now().UTC()
	if _, err := db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", legacyPublicationBackfillPhaseJobScopes).
		Set("cursor_id = ''").
		Set("processed_count = 0").
		Set("completed_at = NULL").
		Set("updated_at = ?", now).
		Where("key = ? OR key LIKE ?", legacyPublicationBackfillKey, legacyPublicationProtectedScopeKeyPrefix+"%").
		Exec(ctx); err != nil {
		return fmt.Errorf("restart legacy publication authoring backfill: %w", err)
	}
	return drainLegacyPublicationAuthoringBackfill(ctx, db)
}

func ensureLegacyPublicationAuthoringBackfillSchema(ctx context.Context, db *bun.DB) error {
	if _, err := db.NewCreateTable().Model((*legacyPublicationBackfillState)(nil)).IfNotExists().Exec(ctx); err != nil {
		return fmt.Errorf("create legacy publication authoring backfill state: %w", err)
	}
	if db.Dialect().Name() == dialect.PG {
		if _, err := db.ExecContext(ctx, `CREATE OR REPLACE FUNCTION openpost_safe_json_text(payload_text text, key_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $openpost$
BEGIN
  RETURN payload_text::jsonb ->> key_text;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$openpost$`); err != nil {
			return fmt.Errorf("create safe legacy job payload reader: %w", err)
		}
	}
	for _, index := range []*bun.CreateIndexQuery{
		db.NewCreateIndex().Index("posts_legacy_thread_parent_idx").Table("posts").Column("workspace_id", "parent_post_id", "id").IfNotExists(),
		db.NewCreateIndex().Index("post_destinations_legacy_authoring_idx").Table("post_destinations").Column("post_id", "id").IfNotExists(),
		db.NewCreateIndex().Index("post_variants_legacy_authoring_idx").Table("post_variants").Column("post_id", "social_account_id", "id").IfNotExists(),
		db.NewCreateIndex().Index("jobs_publication_scope_idx").Table("jobs").Column("type", "scope_id", "status", "run_at", "id").IfNotExists(),
		db.NewCreateIndex().Index("jobs_publication_pending_idx").Table("jobs").Column("type", "status", "id").IfNotExists(),
		db.NewCreateIndex().Index("provider_write_attempts_legacy_scope_scan_idx").Table("provider_write_attempts").Column("status", "id").IfNotExists(),
		db.NewCreateIndex().Index("provider_write_attempts_publication_target_idx").Table("provider_write_attempts").Column("publication_id", "rendition_id", "status", "operation", "id").IfNotExists(),
	} {
		if _, err := index.Exec(ctx); err != nil {
			if isMissingLegacyAuthoringTable(err) {
				continue
			}
			return fmt.Errorf("create legacy publication authoring backfill index: %w", err)
		}
	}
	state := &legacyPublicationBackfillState{
		Key:       legacyPublicationBackfillKey,
		Phase:     legacyPublicationBackfillPhaseJobScopes,
		UpdatedAt: time.Now().UTC(),
	}
	if _, err := db.NewInsert().Model(state).On("CONFLICT (key) DO NOTHING").Exec(ctx); err != nil {
		return fmt.Errorf("initialize legacy publication authoring backfill state: %w", err)
	}
	for _, attemptStatus := range []string{
		providerwrite.StatusSending,
		providerwrite.StatusAmbiguous,
		providerwrite.StatusAccepted,
	} {
		state := &legacyPublicationBackfillState{
			Key:       legacyPublicationProtectedScopeKeyPrefix + attemptStatus,
			Phase:     legacyPublicationBackfillPhaseJobScopes,
			UpdatedAt: time.Now().UTC(),
		}
		if _, err := db.NewInsert().Model(state).On("CONFLICT (key) DO NOTHING").Exec(ctx); err != nil {
			return fmt.Errorf("initialize protected publication scope scan state: %w", err)
		}
	}
	return nil
}

// ensureLegacyPublicationActiveScopeInvariant preserves stop/replace rollback
// compatibility with the previous binary. The database binds scope_id from the
// old payload shape inside the insert/update statement before that job becomes
// visible. Malformed active work fails closed; mixed-version rolling operation
// is not a supported deployment mode.
func ensureLegacyPublicationActiveScopeInvariant(ctx context.Context, db *bun.DB) error {
	const message = "active publication jobs require scope_id"
	switch db.Dialect().Name() {
	case dialect.PG:
		return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(txCtx, "LOCK TABLE jobs IN SHARE ROW EXCLUSIVE MODE"); err != nil {
				return fmt.Errorf("lock jobs for active publication scope trigger: %w", err)
			}
			if _, err := tx.ExecContext(txCtx, `CREATE OR REPLACE FUNCTION openpost_bind_active_publication_job_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $openpost$
BEGIN
  IF NEW.type IN ('publish_post', 'publish_publication')
    AND NEW.status IN ('pending', 'processing')
    AND COALESCE(BTRIM(NEW.scope_id), '') = '' THEN
    IF NEW.type = 'publish_post' THEN
      NEW.scope_id := COALESCE(BTRIM(NEW.payload::jsonb ->> 'post_id'), '');
    ELSE
      NEW.scope_id := COALESCE(BTRIM(NEW.payload::jsonb ->> 'publication_id'), '');
    END IF;
    IF NEW.scope_id = '' THEN
      RAISE EXCEPTION '`+message+`';
    END IF;
  END IF;
  RETURN NEW;
END
$openpost$`); err != nil {
				return fmt.Errorf("create active publication scope binding function: %w", err)
			}
			if _, err := tx.ExecContext(txCtx, `CREATE OR REPLACE TRIGGER jobs_active_publication_scope_bind
BEFORE INSERT OR UPDATE OF type, status, scope_id, payload ON jobs
FOR EACH ROW EXECUTE FUNCTION openpost_bind_active_publication_job_scope()`); err != nil {
				return fmt.Errorf("create active publication scope binding trigger: %w", err)
			}
			if _, err := tx.ExecContext(txCtx, "ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_active_publication_scope_check"); err != nil {
				return fmt.Errorf("remove obsolete active publication scope constraint: %w", err)
			}
			return nil
		})
	case dialect.SQLite:
		return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			statements := []string{
				"DROP TRIGGER IF EXISTS jobs_active_publication_scope_insert",
				"DROP TRIGGER IF EXISTS jobs_active_publication_scope_update",
				`CREATE TRIGGER jobs_active_publication_scope_insert
AFTER INSERT ON jobs
WHEN NEW.type IN ('publish_post', 'publish_publication')
  AND NEW.status IN ('pending', 'processing')
  AND TRIM(COALESCE(NEW.scope_id, '')) = ''
BEGIN
  UPDATE jobs
  SET scope_id = CASE NEW.type
    WHEN 'publish_post' THEN TRIM(COALESCE(json_extract(NEW.payload, '$.post_id'), ''))
    ELSE TRIM(COALESCE(json_extract(NEW.payload, '$.publication_id'), ''))
  END
  WHERE id = NEW.id;
  SELECT CASE WHEN (SELECT scope_id FROM jobs WHERE id = NEW.id) = ''
    THEN RAISE(ABORT, '` + message + `') END;
END`,
				`CREATE TRIGGER jobs_active_publication_scope_update
AFTER UPDATE OF type, status, scope_id, payload ON jobs
WHEN NEW.type IN ('publish_post', 'publish_publication')
  AND NEW.status IN ('pending', 'processing')
  AND TRIM(COALESCE(NEW.scope_id, '')) = ''
BEGIN
  UPDATE jobs
  SET scope_id = CASE NEW.type
    WHEN 'publish_post' THEN TRIM(COALESCE(json_extract(NEW.payload, '$.post_id'), ''))
    ELSE TRIM(COALESCE(json_extract(NEW.payload, '$.publication_id'), ''))
  END
  WHERE id = NEW.id;
  SELECT CASE WHEN (SELECT scope_id FROM jobs WHERE id = NEW.id) = ''
    THEN RAISE(ABORT, '` + message + `') END;
END`,
			}
			for _, statement := range statements {
				if _, err := tx.ExecContext(txCtx, statement); err != nil {
					return fmt.Errorf("create active publication job scope trigger: %w", err)
				}
			}
			return nil
		})
	default:
		return fmt.Errorf("unsupported database dialect for active publication job scope invariant: %s", db.Dialect().Name())
	}
}

func runLegacyPublicationAuthoringBackfillBatch(ctx context.Context, db *bun.DB, batchSize int) (bool, error) {
	if batchSize < 1 {
		return false, errors.New("legacy publication authoring backfill batch size must be positive")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	state, err := loadLegacyPublicationBackfillState(ctx, db)
	if err != nil {
		return false, err
	}
	switch state.Phase {
	case legacyPublicationBackfillPhaseJobScopes:
		return runLegacyJobScopeBackfillBatch(ctx, db, state, batchSize)
	case legacyPublicationBackfillPhasePosts:
		return runLegacyPostBackfillBatch(ctx, db, state, batchSize)
	case legacyPublicationBackfillPhaseAuth:
		return runLegacyAuthorizationBackfillBatch(ctx, db, state, batchSize)
	case legacyPublicationBackfillPhaseComplete:
		return true, nil
	default:
		return false, fmt.Errorf("unknown legacy publication authoring backfill phase %q", state.Phase)
	}
}

func loadLegacyPublicationBackfillState(ctx context.Context, db bun.IDB) (*legacyPublicationBackfillState, error) {
	var state legacyPublicationBackfillState
	if err := db.NewSelect().Model(&state).Where("key = ?", legacyPublicationBackfillKey).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load legacy publication authoring backfill state: %w", err)
	}
	return &state, nil
}

func runLegacyJobScopeBackfillBatch(
	ctx context.Context,
	db *bun.DB,
	state *legacyPublicationBackfillState,
	batchSize int,
) (bool, error) {
	var windowIDs []string
	if err := db.NewSelect().Model((*models.Job)(nil)).Column("id").
		Where("id > ?", state.CursorID).
		Order("id ASC").
		Limit(batchSize).
		Scan(ctx, &windowIDs); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return advanceLegacyPublicationBackfillPhase(ctx, db, state, legacyPublicationBackfillPhasePosts)
		}
		return false, fmt.Errorf("load legacy publication job scope window: %w", err)
	}
	if len(windowIDs) == 0 {
		return advanceLegacyPublicationBackfillPhase(ctx, db, state, legacyPublicationBackfillPhasePosts)
	}
	var jobs []models.Job
	if err := db.NewSelect().Model(&jobs).
		Where("id IN (?)", bun.List(windowIDs)).
		Where("type IN (?)", bun.List([]string{jobregistry.TypePublishPost, jobregistry.TypePublishPublication})).
		Where("scope_id = ''").
		Scan(ctx); err != nil {
		return false, fmt.Errorf("filter legacy publication job scope window: %w", err)
	}
	for index := range jobs {
		if err := repairLegacyPublicationJobScope(ctx, db, &jobs[index]); err != nil {
			return false, err
		}
	}
	return false, updateLegacyPublicationBackfillCursor(ctx, db, state, windowIDs[len(windowIDs)-1], len(windowIDs))
}

// repairPendingLegacyPublicationJobScopes is the startup safety boundary for
// active publication jobs created before scope_id existed. Pending and
// processing scopes must be repaired before a worker or request can observe
// them: otherwise aggregate-scoped translation may create a second external
// write. Protected failed history is handled by the durable attempt scan below.
// The indexed predicate avoids a payload scan of unrelated job history; each
// successful batch removes itself from the result set and is crash-resumable.
func repairPendingLegacyPublicationJobScopes(ctx context.Context, db *bun.DB) error {
	for {
		processed := 0
		if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			var jobs []models.Job
			if err := tx.NewSelect().Model(&jobs).
				Where("type IN (?)", bun.List([]string{jobregistry.TypePublishPost, jobregistry.TypePublishPublication})).
				Where("status IN (?, ?)", "pending", "processing").
				Where("scope_id = ''").
				Order("type ASC", "scope_id ASC", "status ASC", "run_at ASC", "id ASC").
				Limit(legacyPublicationBackfillBatchSize).
				Scan(txCtx); err != nil {
				if isMissingLegacyAuthoringTable(err) {
					return nil
				}
				return fmt.Errorf("load pending legacy publication job scopes: %w", err)
			}
			processed = len(jobs)
			for index := range jobs {
				scopeID := legacyPublicationJobPayloadScope(&jobs[index])
				if scopeID == "" {
					return fmt.Errorf("active legacy publication job %s has no aggregate scope in its payload", jobs[index].ID)
				}
			}
			for index := range jobs {
				if err := repairLegacyPublicationJobScope(txCtx, tx, &jobs[index]); err != nil {
					return err
				}
				if strings.TrimSpace(jobs[index].ScopeID) == "" {
					return fmt.Errorf(
						"active legacy publication job %s has no aggregate scope in its payload",
						jobs[index].ID,
					)
				}
			}
			return nil
		}); err != nil {
			return err
		}
		if processed == 0 {
			return nil
		}
	}
}

// repairProtectedFailedLegacyPublicationJobScopes is an intentional one-time
// exhaustive safety drain. A failed blank-scope job with a sending, ambiguous,
// or accepted attempt is not executable, but it must be visible to mutation
// fences before a new provider operation can be authorized. Each raw attempt
// window is index-keyset bounded and its cursor is committed with the repairs,
// so crashes resume without rescanning completed windows.
func repairProtectedFailedLegacyPublicationJobScopes(ctx context.Context, db *bun.DB) error {
	for _, attemptStatus := range []string{
		providerwrite.StatusSending,
		providerwrite.StatusAmbiguous,
		providerwrite.StatusAccepted,
	} {
		if err := repairProtectedLegacyPublicationStatus(ctx, db, attemptStatus); err != nil {
			return err
		}
	}
	return nil
}

type protectedAttemptCandidate struct {
	ID    string `bun:"id"`
	JobID string `bun:"job_id"`
}

func repairProtectedLegacyPublicationStatus(ctx context.Context, db *bun.DB, attemptStatus string) error {
	for {
		done := false
		err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			var txErr error
			done, txErr = repairProtectedLegacyPublicationWindow(txCtx, tx, attemptStatus)
			return txErr
		})
		if err != nil || done {
			return err
		}
	}
}

func repairProtectedLegacyPublicationWindow(ctx context.Context, tx bun.Tx, attemptStatus string) (bool, error) {
	state, err := lockProtectedLegacyPublicationScopeScanState(ctx, tx, attemptStatus)
	if err != nil {
		return false, err
	}
	if state.Phase == legacyPublicationBackfillPhaseComplete {
		return true, nil
	}
	var attempts []protectedAttemptCandidate
	if err := tx.NewSelect().TableExpr("provider_write_attempts AS protected_attempt").
		ColumnExpr("protected_attempt.id, protected_attempt.job_id").
		Where("protected_attempt.status = ?", attemptStatus).Where("protected_attempt.id > ?", state.CursorID).
		OrderExpr("protected_attempt.id ASC").Limit(legacyPublicationBackfillBatchSize).
		Scan(ctx, &attempts); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return true, nil
		}
		return false, fmt.Errorf("load protected publication attempt scope window: %w", err)
	}
	if len(attempts) == 0 {
		now := time.Now().UTC()
		_, err := tx.NewUpdate().Model(state).Set("phase = ?", legacyPublicationBackfillPhaseComplete).
			Set("completed_at = ?", now).Set("updated_at = ?", now).WherePK().Exec(ctx)
		return true, err
	}
	if err := repairProtectedLegacyPublicationJobs(ctx, tx, attempts); err != nil {
		return false, err
	}
	_, err = tx.NewUpdate().Model(state).Set("cursor_id = ?", attempts[len(attempts)-1].ID).
		Set("processed_count = processed_count + ?", len(attempts)).Set("updated_at = ?", time.Now().UTC()).WherePK().Exec(ctx)
	return false, err
}

func repairProtectedLegacyPublicationJobs(ctx context.Context, tx bun.Tx, attempts []protectedAttemptCandidate) error {
	jobIDs := make([]string, 0, len(attempts))
	for _, attempt := range attempts {
		if jobID := strings.TrimSpace(attempt.JobID); jobID != "" {
			jobIDs = append(jobIDs, jobID)
		}
	}
	if len(jobIDs) == 0 {
		return nil
	}
	var jobs []models.Job
	if err := tx.NewSelect().Model(&jobs).Where("id IN (?)", bun.List(uniqueLegacyPublicationJobIDs(jobIDs))).
		Where("type IN (?)", bun.List([]string{jobregistry.TypePublishPost, jobregistry.TypePublishPublication})).
		Where("status = ?", "failed").Where("scope_id = ''").Scan(ctx); err != nil {
		return fmt.Errorf("filter protected failed publication attempt window: %w", err)
	}
	for index := range jobs {
		if err := repairLegacyPublicationJobScope(ctx, tx, &jobs[index]); err != nil {
			return err
		}
		if strings.TrimSpace(jobs[index].ScopeID) == "" {
			return fmt.Errorf("protected failed legacy publication job %s has no aggregate scope in its payload", jobs[index].ID)
		}
	}
	return nil
}

func lockProtectedLegacyPublicationScopeScanState(
	ctx context.Context,
	tx bun.Tx,
	attemptStatus string,
) (*legacyPublicationBackfillState, error) {
	var state legacyPublicationBackfillState
	query := tx.NewSelect().Model(&state).
		Where("key = ?", legacyPublicationProtectedScopeKeyPrefix+attemptStatus)
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, fmt.Errorf("load protected publication scope scan state: %w", err)
	}
	return &state, nil
}

// requeueStaleLegacyPublicationJobs mirrors the worker's 15-minute recovery
// boundary before active migration runs. Provider attempts are fenced first;
// active migration and request translation then leave protected publish_post
// jobs on their original operation identity. Recent locks remain owned by
// another live instance.
func requeueStaleLegacyPublicationJobs(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "provider_write_attempts")
	if err != nil {
		return fmt.Errorf("check provider write attempt schema: %w", err)
	}
	cutoff := time.Now().UTC().Add(-legacyPublicationStaleProcessingAge)
	if exists {
		if _, err := providerwrite.New(db).MarkStaleJobAttempts(ctx, cutoff); err != nil {
			return fmt.Errorf("fence stale legacy publication provider writes: %w", err)
		}
	}
	var jobIDs []string
	if err := db.NewSelect().Model((*models.Job)(nil)).Column("id").
		Where("type IN (?)", bun.List([]string{jobregistry.TypePublishPost, jobregistry.TypePublishPublication})).
		Where("status = ?", "processing").
		Where("locked_at IS NOT NULL AND locked_at <= ?", cutoff).
		Order("id ASC").
		Scan(ctx, &jobIDs); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return nil
		}
		return fmt.Errorf("load stale legacy publication jobs: %w", err)
	}
	return ReconcileActiveLegacyPublicationJobs(ctx, db, jobIDs)
}

// migratePendingLegacyPublishPostJobs upgrades all active compatibility work
// before a worker can execute the pre-authorization publish_post path. The
// active set is exhaustive and indexed; non-pending post history remains on
// the durable startup-capped backfill.
func migratePendingLegacyPublishPostJobs(ctx context.Context, db *bun.DB) error {
	return processPendingLegacyPublicationJobs(
		ctx,
		db,
		jobregistry.TypePublishPost,
		"load pending legacy publish_post jobs",
		migratePendingLegacyPublishPostJob,
	)
}

func processPendingLegacyPublicationJobs(
	ctx context.Context,
	db *bun.DB,
	jobType string,
	loadError string,
	process func(context.Context, *bun.DB, string) error,
) error {
	cursorID := ""
	for {
		var jobs []models.Job
		if err := db.NewSelect().Model(&jobs).
			Where("type = ? AND status = ?", jobType, "pending").
			Where("id > ?", cursorID).
			Order("id ASC").
			Limit(legacyPublicationBackfillBatchSize).
			Scan(ctx); err != nil {
			if isMissingLegacyAuthoringTable(err) {
				return nil
			}
			return fmt.Errorf("%s: %w", loadError, err)
		}
		if len(jobs) == 0 {
			return nil
		}
		for index := range jobs {
			if err := process(ctx, db, jobs[index].ID); err != nil {
				return err
			}
		}
		cursorID = jobs[len(jobs)-1].ID
	}
}

func migratePendingLegacyPublishPostJob(ctx context.Context, db *bun.DB, jobID string) error {
	var current models.Job
	err := db.NewSelect().Model(&current).
		Where("id = ? AND type = ? AND status = ?", jobID, jobregistry.TypePublishPost, jobregistry.StatusPending).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reload pending legacy publish_post job %s: %w", jobID, err)
	}
	if strings.TrimSpace(current.ScopeID) == "" {
		return fmt.Errorf("pending legacy publish_post job %s has no aggregate scope", current.ID)
	}
	exactProtected, err := legacyPublicationJobHasProtectedAttempt(ctx, db, current.ID)
	if err != nil {
		return fmt.Errorf("check pending legacy publish_post job %s provider attempt: %w", current.ID, err)
	}
	protected, err := legacyPublicationAggregateHasProtectedWrite(ctx, db, current.ScopeID)
	if err != nil {
		return fmt.Errorf("check pending legacy publish_post job %s provider recovery: %w", current.ID, err)
	}
	if protected {
		if exactProtected {
			return nil
		}
		return quarantineConflictingPendingLegacyPublishPostJob(ctx, db, current.ID)
	}
	post, err := loadLegacyAggregateRoot(ctx, db, current.ScopeID)
	if err != nil {
		return fmt.Errorf("load pending legacy publish_post job %s aggregate: %w", current.ID, err)
	}
	if err := MigrateLegacyPublicationAuthoringForActor(ctx, db, post.ID, publicationauth.Actor{
		Origin: publicationauth.OriginLegacy,
		UserID: post.CreatedByID,
	}); err != nil {
		return fmt.Errorf("migrate pending legacy publish_post job %s: %w", current.ID, err)
	}
	remaining, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("id = ? AND type = ? AND status = ?", current.ID, jobregistry.TypePublishPost, jobregistry.StatusPending).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("verify pending legacy publish_post job %s migration: %w", current.ID, err)
	}
	if remaining != 0 {
		return fmt.Errorf("pending legacy publish_post job %s could not be migrated safely", current.ID)
	}
	return nil
}

// authorizePendingLegacyPublicationJobs exhaustively binds every active
// canonical publication job before workers start. The remaining historical
// authorization phase is startup-capped, but active work cannot safely wait:
// publisher preflight must see a receipt-backed batch on its first attempt.
// Candidate selection uses the pending-job index and an invocation-local
// keyset; each exact job bind is transactional and idempotent across restarts.
func authorizePendingLegacyPublicationJobs(ctx context.Context, db *bun.DB) error {
	return processPendingLegacyPublicationJobs(
		ctx,
		db,
		jobregistry.TypePublishPublication,
		"load pending legacy publication authorization jobs",
		authorizePendingLegacyPublicationJob,
	)
}

func authorizePendingLegacyPublicationJob(ctx context.Context, db *bun.DB, jobID string) error {
	if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		exists, err := lockPendingLegacyPublicationAuthorizationJob(txCtx, tx, jobID)
		if err != nil || !exists {
			return err
		}
		protected, err := legacyPublicationJobHasProtectedAttempt(txCtx, tx, jobID)
		if err != nil {
			return err
		}
		if protected {
			matchesAuthorization, err := protectedLegacyPublicationJobUsesCurrentAuthorization(txCtx, tx, jobID)
			if err != nil {
				return err
			}
			if !matchesAuthorization {
				return quarantineProtectedLegacyPublicationJob(txCtx, tx, jobID)
			}
			if err := verifyPendingLegacyPublicationJobAuthorization(txCtx, tx, jobID); err != nil {
				return quarantineProtectedLegacyPublicationJob(txCtx, tx, jobID)
			}
			return resetInterruptedCanonicalPublicationTargets(txCtx, tx, jobID)
		}
		if err := publicationauth.AuthorizeLegacyJobs(txCtx, tx, publicationauth.LegacyJobsInput{
			JobID: jobID,
		}); err != nil {
			return err
		}
		if err := verifyPendingLegacyPublicationJobAuthorization(txCtx, tx, jobID); err != nil {
			return err
		}
		return resetInterruptedCanonicalPublicationTargets(txCtx, tx, jobID)
	}); err != nil {
		return fmt.Errorf("authorize pending legacy publication job %s: %w", jobID, err)
	}
	return nil
}

func lockPendingLegacyPublicationAuthorizationJob(ctx context.Context, tx bun.Tx, jobID string) (bool, error) {
	if tx.Dialect().Name() == dialect.SQLite {
		result, err := tx.NewUpdate().Model((*models.Job)(nil)).
			Set("id = id").
			Where("id = ? AND type = ? AND status = ?", jobID, jobregistry.TypePublishPublication, jobregistry.StatusPending).
			Exec(ctx)
		if err != nil {
			return false, err
		}
		affected, err := result.RowsAffected()
		return affected == 1, err
	}
	var lockedID string
	query := tx.NewSelect().Model((*models.Job)(nil)).Column("id").
		Where("id = ? AND type = ? AND status = ?", jobID, jobregistry.TypePublishPublication, jobregistry.StatusPending)
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx, &lockedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return lockedID != "", nil
}

// ReconcileActiveLegacyPublicationJobs is the worker-recovery handoff for the
// exact stale publication jobs selected while they are still processing. Each
// job remains invisible to polling workers while its scope is repaired, then
// becomes pending in the same transaction that preserves a protected legacy
// operation identity or upgrades and authorizes provably unsent work.
func ReconcileActiveLegacyPublicationJobs(ctx context.Context, db *bun.DB, jobIDs []string) error {
	jobIDs = uniqueLegacyPublicationJobIDs(jobIDs)
	cutoff := time.Now().UTC().Add(-legacyPublicationStaleProcessingAge)
	// Repair every exact scope first so a same-aggregate processing job cannot
	// hide from the transaction that translates its sibling.
	for _, jobID := range jobIDs {
		if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			job, err := lockStaleLegacyPublicationJob(txCtx, tx, jobID, cutoff)
			if err != nil || job == nil {
				return err
			}
			if strings.TrimSpace(job.ScopeID) == "" {
				if err := repairLegacyPublicationJobScope(txCtx, tx, job); err != nil {
					return err
				}
			}
			if strings.TrimSpace(job.ScopeID) == "" {
				return fmt.Errorf("stale legacy publication job %s has no aggregate scope", job.ID)
			}
			return nil
		}); err != nil {
			return fmt.Errorf("repair stale legacy publication job %s: %w", jobID, err)
		}
	}
	for _, jobID := range jobIDs {
		if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			return reconcileStaleLegacyPublicationJobTx(txCtx, tx, jobID, cutoff)
		}); err != nil {
			return fmt.Errorf("reconcile stale legacy publication job %s: %w", jobID, err)
		}
	}
	return nil
}

func uniqueLegacyPublicationJobIDs(jobIDs []string) []string {
	seen := make(map[string]struct{}, len(jobIDs))
	unique := make([]string, 0, len(jobIDs))
	for _, jobID := range jobIDs {
		jobID = strings.TrimSpace(jobID)
		if jobID == "" {
			continue
		}
		if _, duplicate := seen[jobID]; duplicate {
			continue
		}
		seen[jobID] = struct{}{}
		unique = append(unique, jobID)
	}
	return unique
}

func lockStaleLegacyPublicationJob(
	ctx context.Context,
	tx bun.Tx,
	jobID string,
	cutoff time.Time,
) (*models.Job, error) {
	var job models.Job
	query := tx.NewSelect().Model(&job).
		Where("id = ?", jobID).
		Where("type IN (?)", bun.List([]string{jobregistry.TypePublishPost, jobregistry.TypePublishPublication})).
		Where("status = ?", "processing").
		Where("locked_at IS NOT NULL AND locked_at <= ?", cutoff)
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &job, nil
}

func reconcileStaleLegacyPublicationJobTx(
	ctx context.Context,
	tx bun.Tx,
	jobID string,
	cutoff time.Time,
) error {
	var candidate models.Job
	if err := tx.NewSelect().Model(&candidate).Where("id = ?", jobID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if err := lockStaleLegacyPublicationAggregate(ctx, tx, candidate); err != nil {
		return err
	}
	job, err := lockStaleLegacyPublicationJob(ctx, tx, jobID, cutoff)
	if err != nil || job == nil {
		return err
	}
	if strings.TrimSpace(job.ScopeID) == "" {
		return errors.New("stale legacy publication job aggregate scope is missing")
	}
	if job.Type == jobregistry.TypePublishPost {
		return reconcileStaleLegacyPublishPostJobTx(ctx, tx, job, cutoff)
	}
	return reconcileStaleCanonicalPublicationJobTx(ctx, tx, job, cutoff)
}

func lockStaleLegacyPublicationAggregate(ctx context.Context, tx bun.Tx, candidate models.Job) error {
	if strings.TrimSpace(candidate.ScopeID) == "" {
		return nil
	}
	if candidate.Type == jobregistry.TypePublishPublication {
		return lockLegacyPublicationRow(ctx, tx, candidate.ScopeID)
	}
	if candidate.Type != jobregistry.TypePublishPost {
		return nil
	}
	// Match compatibility request lock order: aggregate advisory, linked
	// publication (when present), then the exact stale job.
	if err := lockLegacyPublicationAggregateAdvisory(ctx, tx, candidate.ScopeID); err != nil {
		return err
	}
	root, err := loadLegacyAggregateRoot(ctx, tx, candidate.ScopeID)
	if err != nil {
		return err
	}
	return lockLegacyPublicationRow(ctx, tx, root.PublicationID)
}

func reconcileStaleCanonicalPublicationJobTx(
	ctx context.Context,
	tx bun.Tx,
	job *models.Job,
	cutoff time.Time,
) error {
	protected, err := legacyPublicationJobHasProtectedAttempt(ctx, tx, job.ID)
	if err != nil {
		return err
	}
	if err := makeStaleLegacyPublicationJobPending(ctx, tx, job.ID, cutoff); err != nil {
		return err
	}
	if protected {
		matchesAuthorization, err := protectedLegacyPublicationJobUsesCurrentAuthorization(ctx, tx, job.ID)
		if err != nil {
			return err
		}
		if !matchesAuthorization {
			return quarantineProtectedLegacyPublicationJob(ctx, tx, job.ID)
		}
		if err := verifyPendingLegacyPublicationJobAuthorization(ctx, tx, job.ID); err != nil {
			return quarantineProtectedLegacyPublicationJob(ctx, tx, job.ID)
		}
		return resetInterruptedCanonicalPublicationTargets(ctx, tx, job.ID)
	}
	if err := publicationauth.AuthorizeLegacyJobs(ctx, tx, publicationauth.LegacyJobsInput{JobID: job.ID}); err != nil {
		return err
	}
	if err := verifyPendingLegacyPublicationJobAuthorization(ctx, tx, job.ID); err != nil {
		return err
	}
	return resetInterruptedCanonicalPublicationTargets(ctx, tx, job.ID)
}

func protectedLegacyPublicationJobUsesCurrentAuthorization(ctx context.Context, db bun.IDB, jobID string) (bool, error) {
	var job models.Job
	if err := db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx); err != nil {
		return false, err
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return false, nil
	}
	batchID, _ := payload["authorization_batch_id"].(string)
	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return false, nil
	}
	var receiptIDs []string
	if err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Column("id").
		Where("batch_id = ? AND job_id = ?", batchID, jobID).
		Scan(ctx, &receiptIDs); err != nil {
		return false, err
	}
	receipts := make(map[string]struct{}, len(receiptIDs))
	for _, receiptID := range receiptIDs {
		receipts[receiptID] = struct{}{}
	}
	var attempts []models.ProviderWriteAttempt
	if err := db.NewSelect().Model(&attempts).
		Where("job_id = ?", jobID).
		Where("status IN (?)", bun.List([]string{providerwrite.StatusSending, providerwrite.StatusAmbiguous, providerwrite.StatusAccepted})).
		Scan(ctx); err != nil {
		return false, err
	}
	if len(attempts) == 0 {
		return false, nil
	}
	for _, attempt := range attempts {
		authorizationID := strings.TrimSpace(attempt.AuthorizationID)
		if _, ok := receipts[authorizationID]; !ok || authorizationID == "" {
			return false, nil
		}
		if !strings.HasPrefix(attempt.OperationID, "authorization:"+authorizationID+":") {
			return false, nil
		}
	}
	return true, nil
}

func quarantineProtectedLegacyPublicationJob(ctx context.Context, tx bun.Tx, jobID string) error {
	result, err := tx.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", "failed").
		Set("last_error = ?", "Provider delivery may already have succeeded before authorization receipts were introduced. OpenPost preserved this job and did not retry it.").
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("id = ? AND status = ?", jobID, "pending").
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return errors.New("protected legacy publication job could not be quarantined")
	}
	return failInterruptedQuarantinedPublication(ctx, tx, jobID)
}

func resetInterruptedCanonicalPublicationTargets(ctx context.Context, db bun.IDB, jobID string) error {
	var job models.Job
	if err := db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return err
	}
	if strings.EqualFold(strings.TrimSpace(stringPayloadField(payload, "action")), publicationauth.ActionReply) {
		return nil
	}
	batchID, _ := payload["authorization_batch_id"].(string)
	batchID = strings.TrimSpace(batchID)
	var renditionIDs []string
	if err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Column("rendition_id").
		Where("batch_id = ? AND job_id = ?", batchID, jobID).
		Scan(ctx, &renditionIDs); err != nil {
		return err
	}
	if len(renditionIDs) == 0 {
		return errors.New("active publication job has no authorization targets to recover")
	}
	now := time.Now().UTC()
	if _, err := db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Set("updated_at = ?", now).
		Where("id IN (?)", bun.List(renditionIDs)).
		Where("status = ?", models.RenditionStatusPublishing).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := db.NewUpdate().Model((*models.RenditionSegment)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Set("updated_at = ?", now).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Where("status = ?", models.RenditionStatusPublishing).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := db.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusScheduled).
		Set("updated_at = ?", now).
		Where("id = ? AND status = ?", job.ScopeID, models.PublicationStatusPublishing).
		Exec(ctx); err != nil {
		return err
	}
	_, err := db.NewUpdate().Model((*models.Post)(nil)).
		Set("status = ?", models.PostStatusScheduled).
		Where("publication_id = ? AND status = ?", job.ScopeID, models.PostStatusPublishing).
		Exec(ctx)
	if err != nil && isMissingLegacyAuthoringTable(err) {
		return nil
	}
	return err
}

func failInterruptedQuarantinedPublication(ctx context.Context, db bun.IDB, jobID string) error {
	var job models.Job
	if err := db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx); err != nil {
		return err
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return err
	}
	if strings.EqualFold(strings.TrimSpace(stringPayloadField(payload, "action")), publicationauth.ActionReply) {
		return nil
	}
	renditionIDs, err := interruptedQuarantinedRenditionIDs(ctx, db, job, payload)
	if err != nil || len(renditionIDs) == 0 {
		return err
	}
	return failInterruptedQuarantinedRenditions(ctx, db, job.ScopeID, renditionIDs)
}

func interruptedQuarantinedRenditionIDs(
	ctx context.Context,
	db bun.IDB,
	job models.Job,
	payload map[string]any,
) ([]string, error) {
	targetSet := map[string]struct{}{}
	batchID := strings.TrimSpace(stringPayloadField(payload, "authorization_batch_id"))
	if batchID != "" {
		var receiptTargets []string
		if err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Column("rendition_id").
			Where("batch_id = ? AND job_id = ?", batchID, job.ID).
			Scan(ctx, &receiptTargets); err != nil {
			return nil, err
		}
		for _, renditionID := range receiptTargets {
			if renditionID = strings.TrimSpace(renditionID); renditionID != "" {
				targetSet[renditionID] = struct{}{}
			}
		}
	}
	var attemptTargets []string
	if err := db.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).Column("rendition_id").
		Where("job_id = ?", job.ID).
		Scan(ctx, &attemptTargets); err != nil {
		return nil, err
	}
	for _, renditionID := range attemptTargets {
		if renditionID = strings.TrimSpace(renditionID); renditionID != "" {
			targetSet[renditionID] = struct{}{}
		}
	}
	if payloadTarget := strings.TrimSpace(stringPayloadField(payload, "rendition_id")); payloadTarget != "" {
		targetSet[payloadTarget] = struct{}{}
	}
	renditionIDs := make([]string, 0, len(targetSet))
	for renditionID := range targetSet {
		renditionIDs = append(renditionIDs, renditionID)
	}
	if len(renditionIDs) == 0 {
		if err := db.NewSelect().Model((*models.Rendition)(nil)).Column("id").
			Where("publication_id = ? AND status = ?", job.ScopeID, models.RenditionStatusPublishing).
			Scan(ctx, &renditionIDs); err != nil {
			return nil, err
		}
		if len(renditionIDs) == 0 {
			return nil, nil
		}
	}
	return renditionIDs, nil
}

func failInterruptedQuarantinedRenditions(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
	renditionIDs []string,
) error {
	const message = "Provider delivery may have succeeded, so OpenPost did not retry this interrupted publication."
	now := time.Now().UTC()
	for _, query := range []*bun.UpdateQuery{
		db.NewUpdate().Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusFailed).
			Set("error_message = ?", message).
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("updated_at = ?", now).
			Where("id IN (?)", bun.List(renditionIDs)).
			Where("status = ?", models.RenditionStatusPublishing),
		db.NewUpdate().Model((*models.RenditionSegment)(nil)).
			Set("status = ?", models.RenditionStatusFailed).
			Set("error_message = ?", message).
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("updated_at = ?", now).
			Where("rendition_id IN (?)", bun.List(renditionIDs)).
			Where("status = ?", models.RenditionStatusPublishing),
		db.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusFailed).
			Set("updated_at = ?", now).
			Where("id = ? AND status = ?", publicationID, models.PublicationStatusPublishing),
		db.NewUpdate().Model((*models.Post)(nil)).
			Set("status = ?", models.PostStatusFailed).
			Where("publication_id = ? AND status = ?", publicationID, models.PostStatusPublishing),
		db.NewUpdate().Model((*models.PostDestination)(nil)).
			Set("status = ?", "failed").
			Set("error_message = ?", message).
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Where("post_id IN (SELECT id FROM posts WHERE publication_id = ?)", publicationID).
			Where("social_account_id IN (SELECT social_account_id FROM renditions WHERE id IN (?))", bun.List(renditionIDs)).
			Where("status = ?", "pending"),
	} {
		if _, err := query.Exec(ctx); err != nil && !isMissingLegacyAuthoringTable(err) {
			return err
		}
	}
	return nil
}

func stringPayloadField(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func reconcileStaleLegacyPublishPostJobTx(
	ctx context.Context,
	tx bun.Tx,
	job *models.Job,
	cutoff time.Time,
) error {
	root, err := loadLegacyAggregateRoot(ctx, tx, job.ScopeID)
	if err != nil {
		return err
	}
	posts, err := legacyThreadPosts(ctx, tx, root)
	if err != nil {
		return err
	}
	postIDs := make([]string, 0, len(posts))
	for _, post := range posts {
		postIDs = append(postIDs, post.ID)
	}
	aggregateJobs, err := lockRecoverableLegacyPublishPostJobs(ctx, tx, postIDs, cutoff)
	if err != nil {
		return err
	}
	protected, protectedByJobID, err := recoverStaleLegacyPublishPostJobs(ctx, tx, aggregateJobs, cutoff)
	if err != nil {
		return err
	}
	if protected {
		return quarantineUnprotectedLegacyPublishPostJobs(ctx, tx, aggregateJobs, protectedByJobID)
	}
	if _, err := tx.NewUpdate().Model((*models.Post)(nil)).
		Set("status = ?", models.PostStatusScheduled).
		Where("id IN (?)", bun.List(postIDs)).
		Where("status = ?", models.PostStatusPublishing).
		Exec(ctx); err != nil {
		return err
	}
	return migrateLegacyPostTx(ctx, tx, root, publicationauth.Actor{
		Origin: publicationauth.OriginLegacy,
		UserID: root.CreatedByID,
	})
}

func lockRecoverableLegacyPublishPostJobs(
	ctx context.Context,
	tx bun.Tx,
	postIDs []string,
	cutoff time.Time,
) ([]models.Job, error) {
	var jobs []models.Job
	query := tx.NewSelect().Model(&jobs).
		Where("type = ?", jobregistry.TypePublishPost).
		Where("scope_id IN (?)", bun.List(postIDs)).
		WhereGroup(" AND ", func(query *bun.SelectQuery) *bun.SelectQuery {
			return query.
				WhereOr("status IN (?, ?)", "pending", "failed").
				WhereOr("status = ? AND locked_at IS NOT NULL AND locked_at <= ?", "processing", cutoff)
		}).
		Order("id ASC")
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

func recoverStaleLegacyPublishPostJobs(
	ctx context.Context,
	tx bun.Tx,
	jobs []models.Job,
	cutoff time.Time,
) (bool, map[string]bool, error) {
	protected := false
	protectedByJobID := make(map[string]bool, len(jobs))
	for index := range jobs {
		hasProtectedAttempt, err := legacyPublicationJobHasProtectedAttempt(ctx, tx, jobs[index].ID)
		if err != nil {
			return false, nil, err
		}
		protectedByJobID[jobs[index].ID] = hasProtectedAttempt
		protected = protected || hasProtectedAttempt
		if jobs[index].Status == "processing" {
			if err := makeStaleLegacyPublicationJobPending(ctx, tx, jobs[index].ID, cutoff); err != nil {
				return false, nil, err
			}
			jobs[index].Status = "pending"
		}
	}
	return protected, protectedByJobID, nil
}

func quarantineUnprotectedLegacyPublishPostJobs(
	ctx context.Context,
	tx bun.Tx,
	jobs []models.Job,
	protectedByJobID map[string]bool,
) error {
	for index := range jobs {
		if jobs[index].Status != "pending" || protectedByJobID[jobs[index].ID] {
			continue
		}
		if err := quarantineConflictingPendingLegacyPublishPostJob(ctx, tx, jobs[index].ID); err != nil {
			return err
		}
	}
	return nil
}

func quarantineConflictingPendingLegacyPublishPostJob(ctx context.Context, db bun.IDB, jobID string) error {
	result, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", "failed").
		Set("last_error = ?", "Another delivery for this post may still be active. OpenPost preserved that operation and did not start this duplicate job.").
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("id = ? AND type = ? AND status = ?", jobID, jobregistry.TypePublishPost, jobregistry.StatusPending).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return errors.New("conflicting pending legacy publication job could not be quarantined")
	}
	return nil
}

func makeStaleLegacyPublicationJobPending(
	ctx context.Context,
	tx bun.Tx,
	jobID string,
	cutoff time.Time,
) error {
	result, err := tx.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", "pending").
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("id = ? AND status = ?", jobID, "processing").
		Where("locked_at IS NOT NULL AND locked_at <= ?", cutoff).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return errors.New("stale legacy publication job lock changed during recovery")
	}
	return nil
}

func legacyPublicationJobHasProtectedAttempt(ctx context.Context, db bun.IDB, jobID string) (bool, error) {
	count, err := db.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).
		Where("job_id = ?", jobID).
		Where("status IN (?)", bun.List([]string{
			providerwrite.StatusSending,
			providerwrite.StatusAmbiguous,
			providerwrite.StatusAccepted,
		})).
		Count(ctx)
	if err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return false, nil
		}
		return false, fmt.Errorf("load protected legacy publication provider attempts: %w", err)
	}
	return count > 0, nil
}

func verifyPendingLegacyPublicationJobAuthorization(ctx context.Context, db bun.IDB, jobID string) error {
	var job models.Job
	if err := db.NewSelect().Model(&job).
		Where("id = ? AND type = ? AND status = ?", jobID, jobregistry.TypePublishPublication, jobregistry.StatusPending).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("reload pending legacy publication job: %w", err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return fmt.Errorf("decode pending legacy publication job payload: %w", err)
	}
	publicationID, _ := payload["publication_id"].(string)
	publicationID = strings.TrimSpace(publicationID)
	batchID, _ := payload["authorization_batch_id"].(string)
	batchID = strings.TrimSpace(batchID)
	scheduledAt, _ := payload["authorization_scheduled_at"].(string)
	if publicationID == "" || publicationID != strings.TrimSpace(job.ScopeID) {
		return errors.New("payload publication does not match its aggregate scope")
	}
	if batchID == "" {
		protected, err := legacyPublicationJobHasProtectedAttempt(ctx, db, job.ID)
		if err != nil {
			return err
		}
		if protected {
			return errors.New("protected provider write has no authorization batch binding")
		}
		discarded, err := discardPendingLegacyPublicationJobsWithoutDestinations(ctx, db, publicationID)
		if err != nil {
			return err
		}
		if discarded {
			return nil
		}
		return errors.New("authorization batch binding is missing")
	}
	if strings.TrimSpace(scheduledAt) != job.RunAt.UTC().Format(time.RFC3339Nano) {
		return errors.New("authorization scheduled time does not match the pending job")
	}
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("batch_id = ? AND job_id = ? AND publication_id = ?", batchID, job.ID, publicationID).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("load pending legacy publication authorization receipt: %w", err)
	}
	if receiptCount < 1 {
		return errors.New("authorization receipt is missing")
	}
	return nil
}

func repairLegacyPublicationJobScope(ctx context.Context, db bun.IDB, job *models.Job) error {
	scopeID := legacyPublicationJobPayloadScope(job)
	if scopeID == "" || scopeID == job.ScopeID {
		return nil
	}
	if _, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("scope_id = ?", scopeID).
		Where("id = ? AND type = ?", job.ID, job.Type).
		Exec(ctx); err != nil {
		return fmt.Errorf("repair legacy publication job %s scope: %w", job.ID, err)
	}
	job.ScopeID = scopeID
	return nil
}

func legacyPublicationJobPayloadScope(job *models.Job) string {
	if job == nil {
		return ""
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return ""
	}
	key := "publication_id"
	if job.Type == jobregistry.TypePublishPost {
		key = "post_id"
	}
	scopeID, _ := payload[key].(string)
	return strings.TrimSpace(scopeID)
}

func runLegacyPostBackfillBatch(
	ctx context.Context,
	db *bun.DB,
	state *legacyPublicationBackfillState,
	batchSize int,
) (bool, error) {
	var windowIDs []string
	if err := db.NewSelect().Model((*models.Post)(nil)).Column("id").
		Where("id > ?", state.CursorID).
		Order("id ASC").
		Limit(batchSize).
		Scan(ctx, &windowIDs); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return advanceLegacyPublicationBackfillPhase(ctx, db, state, legacyPublicationBackfillPhaseAuth)
		}
		return false, fmt.Errorf("load legacy post authoring window: %w", err)
	}
	if len(windowIDs) == 0 {
		return advanceLegacyPublicationBackfillPhase(ctx, db, state, legacyPublicationBackfillPhaseAuth)
	}
	var posts []models.Post
	if err := db.NewSelect().Model(&posts).
		Where("id IN (?)", bun.List(windowIDs)).
		Where("status IN (?)", bun.List([]string{models.PostStatusDraft, models.PostStatusScheduled})).
		WhereGroup(" AND ", func(query *bun.SelectQuery) *bun.SelectQuery {
			return query.WhereOr("publication_id IS NULL").WhereOr("publication_id = ''")
		}).
		Scan(ctx); err != nil {
		return false, fmt.Errorf("filter legacy post authoring window: %w", err)
	}
	for index := range posts {
		root, err := loadLegacyAggregateRoot(ctx, db, posts[index].ID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return false, err
		}
		if root.PublicationID != "" {
			continue
		}
		protected, err := legacyPublicationAggregateHasProtectedWrite(ctx, db, root.ID)
		if err != nil {
			return false, err
		}
		if protected {
			continue
		}
		eligible, err := legacyPostHasOwners(ctx, db, root)
		if err != nil {
			return false, err
		}
		if !eligible {
			continue
		}
		actor := publicationauth.Actor{Origin: publicationauth.OriginLegacy, UserID: root.CreatedByID}
		if err := migrateLegacyPost(ctx, db, root, actor); err != nil {
			return false, fmt.Errorf("post %s: %w", root.ID, err)
		}
	}
	return false, updateLegacyPublicationBackfillCursor(ctx, db, state, windowIDs[len(windowIDs)-1], len(windowIDs))
}

func runLegacyAuthorizationBackfillBatch(
	ctx context.Context,
	db *bun.DB,
	state *legacyPublicationBackfillState,
	batchSize int,
) (bool, error) {
	var windowIDs []string
	if err := db.NewSelect().Model((*models.Job)(nil)).Column("id").
		Where("id > ?", state.CursorID).
		Order("id ASC").
		Limit(batchSize).
		Scan(ctx, &windowIDs); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return completeLegacyPublicationBackfill(ctx, db, state)
		}
		return false, fmt.Errorf("load legacy publication authorization window: %w", err)
	}
	if len(windowIDs) == 0 {
		return completeLegacyPublicationBackfill(ctx, db, state)
	}
	var jobs []models.Job
	if err := db.NewSelect().Model(&jobs).
		Where("id IN (?)", bun.List(windowIDs)).
		Where("type = ? AND status = ?", jobregistry.TypePublishPublication, jobregistry.StatusPending).
		Where("scope_id <> ''").
		Scan(ctx); err != nil {
		return false, fmt.Errorf("filter legacy publication authorization window: %w", err)
	}
	for index := range jobs {
		jobID := jobs[index].ID
		if err := authorizePendingLegacyPublicationJob(ctx, db, jobID); err != nil {
			return false, err
		}
	}
	return false, updateLegacyPublicationBackfillCursor(ctx, db, state, windowIDs[len(windowIDs)-1], len(windowIDs))
}

func advanceLegacyPublicationBackfillPhase(
	ctx context.Context,
	db bun.IDB,
	state *legacyPublicationBackfillState,
	nextPhase string,
) (bool, error) {
	result, err := db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", nextPhase).
		Set("cursor_id = ''").
		Set("updated_at = ?", time.Now().UTC()).
		Where("key = ? AND phase = ? AND cursor_id = ?", state.Key, state.Phase, state.CursorID).
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("advance legacy publication authoring backfill phase: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 1 {
		state.Phase = nextPhase
		state.CursorID = ""
	}
	return false, nil
}

func updateLegacyPublicationBackfillCursor(
	ctx context.Context,
	db bun.IDB,
	state *legacyPublicationBackfillState,
	cursorID string,
	processed int,
) error {
	result, err := db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("cursor_id = ?", cursorID).
		Set("processed_count = processed_count + ?", processed).
		Set("updated_at = ?", time.Now().UTC()).
		Where("key = ? AND phase = ? AND cursor_id = ?", state.Key, state.Phase, state.CursorID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("record legacy publication authoring backfill progress: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 1 {
		state.CursorID = cursorID
		state.ProcessedCount += int64(processed)
	}
	return nil
}

func completeLegacyPublicationBackfill(
	ctx context.Context,
	db bun.IDB,
	state *legacyPublicationBackfillState,
) (bool, error) {
	now := time.Now().UTC()
	result, err := db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", legacyPublicationBackfillPhaseComplete).
		Set("cursor_id = ''").
		Set("completed_at = ?", now).
		Set("updated_at = ?", now).
		Where("key = ? AND phase = ? AND cursor_id = ?", state.Key, state.Phase, state.CursorID).
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("complete legacy publication authoring backfill: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect completed legacy publication authoring backfill: %w", err)
	}
	return affected == 1, nil
}
