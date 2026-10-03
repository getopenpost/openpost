package repurpose

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/aiusage"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const analysisTimeout = 3 * time.Minute
const leaseDuration = 5 * time.Minute

type record struct {
	bun.BaseModel     `bun:"table:repurpose_suggestions"`
	ID                string `bun:",pk"`
	WorkspaceID       string
	UserID            string
	SourceID          string
	SourceRevision    string
	Revision          int
	Generation        int
	State             string
	IdempotencyKey    string
	Fingerprint       string
	AuthorityJSON     string
	RequestJSON       string
	CandidatesJSON    string
	ErrorMessage      string
	Model             string
	ProviderRequestID string
	UsageJSON         string
	LeaseToken        string
	LeaseExpiresAt    *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type Service struct {
	db        *bun.DB
	generator ai.Generator
	model     string
	usage     *aiusage.Service
}

func New(db *bun.DB, generator ai.Generator, model string) *Service {
	return &Service{db: db, generator: generator, model: model, usage: aiusage.NewService(db)}
}

func (service *Service) authorize(ctx context.Context, db bun.IDB, actor workspaceaccess.ActorFacts, workspaceID string, level workspaceaccess.Level) (workspaceaccess.StoredAuthority, error) {
	decision, err := workspaceaccess.NewAuthorizer(db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return workspaceaccess.StoredAuthority{}, err
	}
	if !decision.Allowed {
		return workspaceaccess.StoredAuthority{}, ErrAccess
	}
	return workspaceaccess.StoredAuthority{UserID: actor.UserID, WorkspaceID: workspaceID, OrganizationID: decision.OrganizationID, IdentityProviderID: decision.ProviderID, AssuredAt: time.Now().UTC()}, nil
}

func (service *Service) sourceAccess(ctx context.Context, db bun.IDB, request *SuggestionRequest) error {
	mediaID := request.Source.MediaID
	if mediaID == "" {
		mediaID = request.Source.ID
	}
	var media models.MediaAttachment
	err := db.NewSelect().Model(&media).Column("id", "workspace_id", "processing_status", "trashed_at").Where("id = ?", mediaID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) && request.Source.MediaID == "" {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrAccess
	}
	if err != nil {
		return err
	}
	if media.WorkspaceID != request.WorkspaceID || !media.TrashedAt.IsZero() || media.ProcessingStatus != "ready" {
		return ErrAccess
	}
	request.Source.MediaID = media.ID
	return nil
}

// lockActor serializes admission and retries across an actor's workspaces on both databases.
func lockActor(ctx context.Context, db bun.IDB, userID string) error {
	result, err := db.ExecContext(ctx, "UPDATE users SET id = id WHERE id = ?", userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrAccess
	}
	return nil
}

func checkCapacity(ctx context.Context, db bun.IDB, userID string) error {
	count, err := db.NewSelect().Model((*record)(nil)).Where("user_id = ? AND state IN (?, ?)", userID, StateQueued, StateAnalyzing).Count(ctx)
	if err != nil {
		return err
	}
	if count >= maxActivePerActor {
		return ErrCapacity
	}
	return nil
}

func (service *Service) Create(ctx context.Context, actor workspaceaccess.ActorFacts, key string, request SuggestionRequest) (ClipSuggestions, error) {
	if service.generator == nil || strings.TrimSpace(service.model) == "" {
		return ClipSuggestions{}, ErrUnavailable
	}
	if err := validateRequest(request); err != nil {
		return ClipSuggestions{}, err
	}
	if !requiredText(key, 160) || len(key) < 8 {
		return ClipSuggestions{}, ErrInvalid
	}
	if request.DesiredDurationSeconds == 0 {
		request.DesiredDurationSeconds = 45
	}
	var stored record
	err := service.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if err := lockActor(ctx, tx, actor.UserID); err != nil {
			return err
		}
		authority, err := service.authorize(ctx, tx, actor, request.WorkspaceID, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if err := service.sourceAccess(ctx, tx, &request); err != nil {
			return err
		}
		candidate, err := service.newRecord(authority, key, request)
		if err != nil {
			return err
		}
		stored, err = admit(ctx, tx, candidate)
		return err
	})
	if err != nil {
		return ClipSuggestions{}, err
	}
	return decode(stored)
}

func admit(ctx context.Context, db bun.IDB, candidate record) (record, error) {
	var stored record
	err := db.NewSelect().Model(&stored).Where("workspace_id = ? AND user_id = ? AND idempotency_key = ?", candidate.WorkspaceID, candidate.UserID, candidate.IdempotencyKey).Scan(ctx)
	if err == nil {
		if stored.Fingerprint != candidate.Fingerprint {
			return record{}, ErrConflict
		}
		return stored, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return record{}, err
	}
	if err := checkCapacity(ctx, db, candidate.UserID); err != nil {
		return record{}, err
	}
	if _, err := db.NewInsert().Model(&candidate).Exec(ctx); err != nil {
		return record{}, err
	}
	return candidate, enqueue(ctx, db, candidate)
}

func (service *Service) newRecord(authority workspaceaccess.StoredAuthority, key string, request SuggestionRequest) (record, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return record{}, err
	}
	authJSON, err := json.Marshal(authority)
	if err != nil {
		return record{}, err
	}
	digest := sha256.Sum256(payload)
	now := time.Now().UTC()
	return record{ID: uuid.NewString(), WorkspaceID: request.WorkspaceID, UserID: authority.UserID, SourceID: request.Source.ID, SourceRevision: request.Source.Revision, Revision: 1, Generation: 1, State: StateQueued, IdempotencyKey: key, Fingerprint: hex.EncodeToString(digest[:]), AuthorityJSON: string(authJSON), RequestJSON: string(payload), CandidatesJSON: "[]", UsageJSON: "{}", Model: service.model, CreatedAt: now, UpdatedAt: now}, nil
}

func enqueue(ctx context.Context, db bun.IDB, stored record) error {
	payload, err := json.Marshal(jobregistry.RepurposePayload{SuggestionID: stored.ID, Generation: stored.Generation})
	if err != nil {
		return err
	}
	job, err := jobregistry.NewJob(jobregistry.TypeRepurposeSuggestions, string(payload), time.Now().UTC())
	if err != nil {
		return err
	}
	job.ScopeID = stored.ID
	job.DedupeKey = fmt.Sprint(stored.Generation)
	_, err = db.NewInsert().Model(job).Exec(ctx)
	return err
}

func (service *Service) load(ctx context.Context, db bun.IDB, actor workspaceaccess.ActorFacts, id string, level workspaceaccess.Level) (record, error) {
	var stored record
	err := db.NewSelect().Model(&stored).Where("id = ? AND user_id = ?", id, actor.UserID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return record{}, ErrNotFound
	}
	if err != nil {
		return record{}, err
	}
	_, err = service.authorize(ctx, db, actor, stored.WorkspaceID, level)
	return stored, err
}

func (service *Service) Get(ctx context.Context, actor workspaceaccess.ActorFacts, id string) (ClipSuggestions, error) {
	stored, err := service.load(ctx, service.db, actor, id, workspaceaccess.LevelRead)
	if err != nil {
		return ClipSuggestions{}, err
	}
	return decode(stored)
}

func (service *Service) Cancel(ctx context.Context, actor workspaceaccess.ActorFacts, id string, revision int) (ClipSuggestions, error) {
	return service.transition(ctx, actor, id, revision, StateCancelled)
}

func (service *Service) Retry(ctx context.Context, actor workspaceaccess.ActorFacts, id string, revision int) (ClipSuggestions, error) {
	if service.generator == nil {
		return ClipSuggestions{}, ErrUnavailable
	}
	return service.transition(ctx, actor, id, revision, StateQueued)
}

func (service *Service) transition(ctx context.Context, actor workspaceaccess.ActorFacts, id string, revision int, next string) (ClipSuggestions, error) {
	var stored record
	err := service.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if err := lockActor(ctx, tx, actor.UserID); err != nil {
			return err
		}
		var err error
		stored, err = service.load(ctx, tx, actor, id, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if stored.Revision != revision {
			return ErrConflict
		}
		if next == StateCancelled && stored.State != StateQueued && stored.State != StateAnalyzing {
			return ErrConflict
		}
		if next == StateQueued {
			if err := service.prepareRetry(ctx, tx, &stored); err != nil {
				return err
			}
		}
		stored.State = next
		stored.Revision++
		stored.LeaseToken = ""
		stored.LeaseExpiresAt = nil
		stored.ErrorMessage = ""
		stored.CandidatesJSON = "[]"
		stored.UpdatedAt = time.Now().UTC()
		result, err := tx.NewUpdate().Model(&stored).Where("id = ? AND revision = ?", id, revision).Exec(ctx)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrConflict
		}
		if next == StateQueued {
			return enqueue(ctx, tx, stored)
		}
		return nil
	})
	if err != nil {
		return ClipSuggestions{}, err
	}
	return decode(stored)
}

func (service *Service) prepareRetry(ctx context.Context, db bun.IDB, stored *record) error {
	if stored.State != StateFailed && stored.State != StateCancelled {
		return ErrConflict
	}
	if err := checkCapacity(ctx, db, stored.UserID); err != nil {
		return err
	}
	var request SuggestionRequest
	if err := json.Unmarshal([]byte(stored.RequestJSON), &request); err != nil {
		return err
	}
	if err := service.sourceAccess(ctx, db, &request); err != nil {
		return err
	}
	stored.Generation++
	return nil
}

func decode(stored record) (ClipSuggestions, error) {
	candidates := []ClipCandidate{}
	if err := json.Unmarshal([]byte(stored.CandidatesJSON), &candidates); err != nil {
		return ClipSuggestions{}, err
	}
	return ClipSuggestions{ID: stored.ID, WorkspaceID: stored.WorkspaceID, SourceID: stored.SourceID, SourceRevision: stored.SourceRevision, Revision: stored.Revision, State: stored.State, Candidates: candidates, ErrorMessage: stored.ErrorMessage, UpdatedAt: stored.UpdatedAt}, nil
}

// HandleJob fences every result to its generation and lease. Cancellation or retry
// may race the provider without allowing the old response to overwrite the review.
func (service *Service) HandleJob(ctx context.Context, payload string) error {
	decoded, err := jobregistry.DecodeRepurposePayload(payload)
	if err != nil {
		return err
	}
	if service.generator == nil {
		return ErrUnavailable
	}
	var stored record
	err = service.db.NewSelect().Model(&stored).Where("id = ?", decoded.SuggestionID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if stored.Generation != decoded.Generation || (stored.State != StateQueued && stored.State != StateAnalyzing) {
		return nil
	}
	if err := service.claim(ctx, &stored); err != nil {
		return err
	}
	return service.analyze(ctx, stored)
}

func (service *Service) claim(ctx context.Context, stored *record) error {
	now := time.Now().UTC()
	token := uuid.NewString()
	result, err := service.db.NewUpdate().Model((*record)(nil)).
		Set("state = ?", StateAnalyzing).Set("lease_token = ?", token).Set("lease_expires_at = ?", now.Add(leaseDuration)).Set("updated_at = ?", now).Set("revision = revision + 1").
		Where("id = ? AND generation = ? AND state IN (?, ?) AND (lease_expires_at IS NULL OR lease_expires_at < ?)", stored.ID, stored.Generation, StateQueued, StateAnalyzing, now).Exec(ctx)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrLeaseActive
	}
	stored.LeaseToken = token
	return nil
}

func (service *Service) analyze(ctx context.Context, stored record) error {
	analysisCtx, cancel := context.WithTimeout(ctx, analysisTimeout)
	defer cancel()
	var authority workspaceaccess.StoredAuthority
	var request SuggestionRequest
	if json.Unmarshal([]byte(stored.AuthorityJSON), &authority) != nil || json.Unmarshal([]byte(stored.RequestJSON), &request) != nil || validateRequest(request) != nil {
		return service.finish(ctx, stored, nil, ai.GenerateResult{}, "The saved source is not usable. Create a new review.")
	}
	decision, err := workspaceaccess.NewAuthorizer(service.db).AuthorizeStored(analysisCtx, authority, workspaceaccess.LevelEdit)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return service.finish(ctx, stored, nil, ai.GenerateResult{}, "Workspace access no longer allows this analysis.")
	}
	if err := service.sourceAccess(analysisCtx, service.db, &request); err != nil {
		return service.finish(ctx, stored, nil, ai.GenerateResult{}, "The source is no longer available in this workspace.")
	}
	candidates, generated, err := service.plan(analysisCtx, request, aiusage.EditorIdentity{WorkspaceID: stored.WorkspaceID, UserID: stored.UserID, RunID: "repurpose:" + stored.ID + ":" + stored.LeaseToken, Step: stored.Generation})
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return service.finish(ctx, stored, nil, generated, "Clip suggestions could not be created. You can retry this review.")
	}
	return service.finish(ctx, stored, candidates, generated, "")
}

func (service *Service) finish(ctx context.Context, stored record, candidates []ClipCandidate, generated ai.GenerateResult, message string) error {
	state := StateReady
	if message != "" {
		state = StateFailed
		candidates = []ClipCandidate{}
	}
	encoded, err := json.Marshal(candidates)
	if err != nil {
		return err
	}
	usage, err := json.Marshal(generated.Usage)
	if err != nil {
		usage = []byte("{}")
	}
	model := generated.Model
	if model == "" {
		model = service.model
	}
	_, err = service.db.NewUpdate().Model((*record)(nil)).Set("state = ?", state).Set("candidates_json = ?", string(encoded)).Set("error_message = ?", message).
		Set("model = ?", bounded(model, 200)).Set("provider_request_id = ?", bounded(generated.RequestID, 256)).Set("usage_json = ?", string(usage)).
		Set("lease_token = ''").Set("lease_expires_at = NULL").Set("updated_at = ?", time.Now().UTC()).Set("revision = revision + 1").
		Where("id = ? AND generation = ? AND state = ? AND lease_token = ?", stored.ID, stored.Generation, StateAnalyzing, stored.LeaseToken).Exec(ctx)
	return err
}

func bounded(value string, maximum int) string {
	runes := []rune(value)
	if len(runes) > maximum {
		runes = runes[:maximum]
	}
	return string(runes)
}

func (service *Service) MarkTerminalJobFailure(ctx context.Context, db bun.IDB, payload string) error {
	decoded, err := jobregistry.DecodeRepurposePayload(payload)
	if err != nil {
		return err
	}
	_, err = db.NewUpdate().Model((*record)(nil)).Set("state = ?", StateFailed).Set("error_message = ?", "Clip analysis was interrupted. You can retry this review.").Set("lease_token = ''").Set("lease_expires_at = NULL").Set("updated_at = ?", time.Now().UTC()).Set("revision = revision + 1").Where("id = ? AND generation = ? AND state IN (?, ?)", decoded.SuggestionID, decoded.Generation, StateQueued, StateAnalyzing).Exec(ctx)
	return err
}
