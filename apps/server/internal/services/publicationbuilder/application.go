package publicationbuilder

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/sourcecontext"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	BuildStateQueued    = "queued"
	BuildStateBuilding  = "building"
	BuildStateReady     = "ready"
	BuildStateCommitted = "committed"
	BuildStateFailed    = "failed"
	BuildStateCancelled = "cancelled"

	BuildPhaseQueued     = "queued"
	BuildPhaseSources    = "sources"
	BuildPhaseDirecting  = "directing"
	BuildPhaseDrafting   = "drafting"
	BuildPhaseReviewing  = "reviewing"
	BuildPhaseReady      = "ready"
	BuildPhaseCommitting = "committing"
	BuildPhaseCommitted  = "committed"
	BuildPhaseFailed     = "failed"
	BuildPhaseCancelled  = "cancelled"

	maxIdempotencyKeyLength = 160
	maxActiveBuildsPerUser  = 3
	defaultBuildLease       = 10 * time.Minute
)

var (
	ErrBuildNotFound       = errors.New("publication build not found")
	ErrIdempotencyConflict = errors.New("idempotency key was already used for a different build request")
	ErrBuildNotRetryable   = errors.New("publication build is not retryable")
	ErrTooManyActiveBuilds = errors.New("too many active publication builds")
	ErrRuntimeUnavailable  = errors.New("publication builder runtime is unavailable")
	ErrBuildLeaseActive    = errors.New("publication build lease is active")
	errBuildStopped        = errors.New("publication build stopped")
)

type PackageBuilder interface {
	Build(context.Context, BuildInput) (BuildResult, error)
}

type progressPackageBuilder interface {
	BuildWithProgress(context.Context, BuildInput, func(string) error) (BuildResult, error)
}

type SourceLoader interface {
	Load(context.Context, string) (sourcecontext.Document, error)
}

type BuildAsset struct {
	MediaID    string `json:"media_id"`
	Role       string `json:"role"`
	MayPublish bool   `json:"may_publish" default:"false"`
}

type LoadedAssets struct {
	Sources []SourceMaterial
	Parts   []ai.MultimodalPart
	Images  []ai.Image
	Files   []ai.File
	Audio   []ai.Audio
	Videos  []ai.Video
}

type AssetLoader interface {
	Load(context.Context, string, []BuildAsset) (LoadedAssets, error)
}

type StoredAuthorityFunc func(context.Context, workspaceaccess.StoredAuthority) error

type ApplicationConfig struct {
	Model           string
	Now             func() time.Time
	SourceLoader    SourceLoader
	AssetLoader     AssetLoader
	AuthorizeStored StoredAuthorityFunc
	LeaseDuration   time.Duration
}

type Application struct {
	db              *bun.DB
	builder         PackageBuilder
	model           string
	now             func() time.Time
	sourceLoader    SourceLoader
	assetLoader     AssetLoader
	authorizeStored StoredAuthorityFunc
	leaseDuration   time.Duration
}

type CreateBuildRequest struct {
	WorkspaceID    string                          `json:"workspace_id"`
	CreatedByID    string                          `json:"created_by_id"`
	IdempotencyKey string                          `json:"-"`
	Authority      workspaceaccess.StoredAuthority `json:"authority"`
	Input          BuildInput                      `json:"input"`
	ContextURLs    []string                        `json:"context_urls,omitempty"`
	Assets         []BuildAsset                    `json:"assets,omitempty"`
	SocialSetID    string                          `json:"social_set_id,omitempty"`
	VoiceProfileID string                          `json:"voice_profile_id,omitempty"`
}

type BuildRecord struct {
	bun.BaseModel `bun:"table:publication_builds"`

	ID                 string     `bun:",pk"`
	WorkspaceID        string     `bun:",notnull"`
	CreatedByID        string     `bun:",notnull"`
	PublicationID      *string    `bun:",nullzero"`
	State              string     `bun:",notnull"`
	Phase              string     `bun:",notnull"`
	Revision           int        `bun:",notnull,default:1"`
	IdempotencyKey     string     `bun:",notnull"`
	RequestFingerprint string     `bun:",notnull"`
	AuthorityJSON      string     `bun:",notnull,default:'{}'"`
	RequestJSON        string     `bun:",notnull"`
	VoiceSnapshotJSON  string     `bun:",notnull,default:'{}'"`
	ResultJSON         string     `bun:",notnull,default:'{}'"`
	Model              string     `bun:",notnull,default:''"`
	ProviderRequestID  string     `bun:",notnull,default:''"`
	UsageJSON          string     `bun:",notnull,default:'{}'"`
	ErrorCode          string     `bun:",notnull,default:''"`
	ErrorMessage       string     `bun:",notnull,default:''"`
	CreatedAt          time.Time  `bun:",notnull"`
	UpdatedAt          time.Time  `bun:",notnull"`
	CompletedAt        *time.Time `bun:",nullzero"`
	CancelledAt        *time.Time `bun:",nullzero"`
	LeaseToken         string     `bun:",notnull,default:''"`
	LeaseExpiresAt     *time.Time `bun:",nullzero"`
}

type Build struct {
	ID             string       `json:"id"`
	WorkspaceID    string       `json:"workspace_id"`
	PublicationID  string       `json:"publication_id,omitempty"`
	State          string       `json:"state"`
	Phase          string       `json:"phase"`
	Revision       int          `json:"revision"`
	Input          BuildInput   `json:"input"`
	ContextURLs    []string     `json:"context_urls,omitempty"`
	Assets         []BuildAsset `json:"assets,omitempty"`
	SocialSetID    string       `json:"social_set_id,omitempty"`
	VoiceProfileID string       `json:"voice_profile_id,omitempty"`
	Result         *BuildResult `json:"result,omitempty"`
	ErrorCode      string       `json:"error_code,omitempty"`
	ErrorMessage   string       `json:"error_message,omitempty"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
}

type persistedBuildRequest struct {
	Input          BuildInput   `json:"input"`
	ContextURLs    []string     `json:"context_urls,omitempty"`
	Assets         []BuildAsset `json:"assets,omitempty"`
	SocialSetID    string       `json:"social_set_id,omitempty"`
	VoiceProfileID string       `json:"voice_profile_id,omitempty"`
}

type buildAssetRecord struct {
	bun.BaseModel `bun:"table:publication_build_assets"`

	BuildID      string    `bun:"build_id,pk"`
	MediaID      string    `bun:"media_id,pk"`
	DisplayOrder int       `bun:"display_order,notnull"`
	Role         string    `bun:"role,notnull"`
	MayPublish   bool      `bun:"may_publish,notnull"`
	CreatedAt    time.Time `bun:"created_at,notnull"`
}

func NewApplication(db *bun.DB, builder PackageBuilder, config ApplicationConfig) (*Application, error) {
	if db == nil {
		return nil, errors.New("publication builder database is required")
	}
	if builder == nil {
		return nil, errors.New("publication package builder is required")
	}
	now := config.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	leaseDuration := config.LeaseDuration
	if leaseDuration <= 0 {
		leaseDuration = defaultBuildLease
	}
	authorize := config.AuthorizeStored
	if authorize == nil {
		authorizer := workspaceaccess.NewAuthorizer(db)
		authorize = func(ctx context.Context, authority workspaceaccess.StoredAuthority) error {
			decision, err := authorizer.AuthorizeStored(ctx, authority, workspaceaccess.LevelEdit)
			if err != nil {
				return err
			}
			if !decision.Allowed {
				return errors.New("stored workspace authority no longer permits publication building")
			}
			return nil
		}
	}
	return &Application{
		db: db, builder: builder, model: strings.TrimSpace(config.Model), now: now,
		sourceLoader: config.SourceLoader, assetLoader: config.AssetLoader, authorizeStored: authorize,
		leaseDuration: leaseDuration,
	}, nil
}

//nolint:gocyclo // Admission, idempotency, persistence, and job creation form one atomic enqueue boundary.
func (application *Application) Enqueue(ctx context.Context, request CreateBuildRequest) (Build, bool, error) {
	request.WorkspaceID = strings.TrimSpace(request.WorkspaceID)
	request.CreatedByID = strings.TrimSpace(request.CreatedByID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if request.WorkspaceID == "" || request.CreatedByID == "" {
		return Build{}, false, errors.New("workspace_id and created_by_id are required")
	}
	if len(request.IdempotencyKey) < 8 || len(request.IdempotencyKey) > maxIdempotencyKeyLength {
		return Build{}, false, fmt.Errorf("idempotency key must contain 8 to %d characters", maxIdempotencyKeyLength)
	}
	if request.Authority.UserID != request.CreatedByID || request.Authority.WorkspaceID != request.WorkspaceID {
		return Build{}, false, errors.New("stored authority does not match the build request")
	}
	if err := validateBuildInputWithStoredReferences(
		request.Input,
		len(request.ContextURLs) > 0 || len(request.Assets) > 0,
	); err != nil {
		return Build{}, false, err
	}
	assets, err := normalizeStoredBuildAssets(request.Assets)
	if err != nil {
		return Build{}, false, err
	}
	persisted := persistedBuildRequest{
		Input: request.Input, ContextURLs: request.ContextURLs, Assets: assets,
		SocialSetID:    strings.TrimSpace(request.SocialSetID),
		VoiceProfileID: strings.TrimSpace(request.VoiceProfileID),
	}
	requestJSON, fingerprint, err := encodeBuildRequest(request.WorkspaceID, persisted)
	if err != nil {
		return Build{}, false, err
	}
	authorityJSON, err := json.Marshal(request.Authority)
	if err != nil {
		return Build{}, false, fmt.Errorf("encode stored build authority: %w", err)
	}
	voiceSnapshotJSON, err := encodeVoiceSnapshots(request.Input.Destinations)
	if err != nil {
		return Build{}, false, err
	}
	now := application.now().UTC()
	record := &BuildRecord{
		ID: uuid.NewString(), WorkspaceID: request.WorkspaceID, CreatedByID: request.CreatedByID,
		State: BuildStateQueued, Phase: BuildPhaseQueued, Revision: 1,
		IdempotencyKey: request.IdempotencyKey, RequestFingerprint: fingerprint,
		AuthorityJSON: string(authorityJSON), RequestJSON: requestJSON,
		VoiceSnapshotJSON: voiceSnapshotJSON, ResultJSON: "{}", UsageJSON: "{}", Model: application.model,
		CreatedAt: now, UpdatedAt: now,
	}
	var existing *BuildRecord
	err = application.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if lockErr := lockBuildAdmission(txCtx, tx, application.db.Dialect().Name(), request.WorkspaceID); lockErr != nil {
			return lockErr
		}
		prior, loadErr := loadByIdempotencyKey(txCtx, tx, request.WorkspaceID, request.CreatedByID, request.IdempotencyKey)
		if loadErr == nil {
			if prior.RequestFingerprint != fingerprint {
				return ErrIdempotencyConflict
			}
			existing = &prior
			return nil
		}
		if !errors.Is(loadErr, ErrBuildNotFound) {
			return loadErr
		}
		active, countErr := countActiveBuilds(txCtx, tx, request.WorkspaceID, request.CreatedByID)
		if countErr != nil {
			return fmt.Errorf("count active publication builds: %w", countErr)
		}
		if active >= maxActiveBuildsPerUser {
			return ErrTooManyActiveBuilds
		}
		result, insertErr := tx.NewInsert().Model(record).Exec(txCtx)
		if insertErr != nil {
			return fmt.Errorf("create publication build: %w", insertErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return fmt.Errorf("inspect publication build insert: %w", rowsErr)
		}
		if rows != 1 {
			return errors.New("publication build insert did not create one row")
		}
		if len(assets) > 0 {
			assetRows := make([]buildAssetRecord, 0, len(assets))
			for index, asset := range assets {
				assetRows = append(assetRows, buildAssetRecord{
					BuildID: record.ID, MediaID: asset.MediaID, DisplayOrder: index,
					Role: asset.Role, MayPublish: asset.MayPublish, CreatedAt: now,
				})
			}
			if _, assetErr := tx.NewInsert().Model(&assetRows).Exec(txCtx); assetErr != nil {
				return fmt.Errorf("record publication build sources: %w", assetErr)
			}
		}
		return ensureBuildJob(txCtx, tx, record.ID, now)
	})
	if err != nil {
		return Build{}, false, err
	}
	if existing != nil {
		build, decodeErr := decodeBuild(*existing)
		return build, false, decodeErr
	}
	build, err := decodeBuild(*record)
	return build, true, err
}

func (application *Application) Get(ctx context.Context, userID, buildID string) (Build, error) {
	var record BuildRecord
	err := application.db.NewSelect().Model(&record).
		Where("id = ? AND created_by_id = ?", strings.TrimSpace(buildID), strings.TrimSpace(userID)).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Build{}, ErrBuildNotFound
	}
	if err != nil {
		return Build{}, fmt.Errorf("load publication build: %w", err)
	}
	return decodeBuild(record)
}

//nolint:gocyclo // Lease fencing and durable phase transitions stay visible in the job execution boundary.
func (application *Application) HandleJob(ctx context.Context, jobType, payload string) error {
	if jobType != jobregistry.TypePublicationBuild {
		return fmt.Errorf("unsupported publication builder job type %q", jobType)
	}
	decoded, err := jobregistry.DecodePublicationBuildPayload(payload)
	if err != nil {
		return err
	}
	var record BuildRecord
	if err := application.db.NewSelect().Model(&record).Where("id = ?", decoded.BuildID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrBuildNotFound
		}
		return fmt.Errorf("load queued publication build: %w", err)
	}
	if record.State == BuildStateReady || record.State == BuildStateCommitted || record.State == BuildStateCancelled {
		return nil
	}
	leaseToken, claimed, err := application.claim(ctx, record.ID, record.WorkspaceID, record.CreatedByID)
	if err != nil {
		return err
	}
	if !claimed {
		return ErrBuildLeaseActive
	}
	record.State = BuildStateBuilding
	record.Phase = BuildPhaseSources
	record.LeaseToken = leaseToken
	buildCtx, trace := withGenerationTrace(ctx)

	var authority workspaceaccess.StoredAuthority
	if err := decodeStoredJSON(record.AuthorityJSON, &authority); err != nil {
		return application.fail(ctx, &record, leaseToken, trace, "invalid_authority", "The saved build authority is invalid.", err)
	}
	if err := application.authorizeStored(ctx, authority); err != nil {
		return application.fail(ctx, &record, leaseToken, trace, "access_revoked", "Workspace access no longer allows this build.", err)
	}

	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return application.fail(ctx, &record, leaseToken, trace, "invalid_request", "The saved build request is invalid.", err)
	}
	input := request.Input
	if err := application.resolveSources(ctx, record.WorkspaceID, request, &input); err != nil {
		return application.fail(ctx, &record, leaseToken, trace, "source_unavailable", sourceFailureMessage(err), err)
	}
	if err := validateBuildInput(input); err != nil {
		return application.fail(ctx, &record, leaseToken, trace, "invalid_source", "The selected source material is not usable.", err)
	}
	if err := application.setPhase(ctx, record.ID, leaseToken, BuildPhaseDirecting); err != nil {
		if errors.Is(err, errBuildStopped) {
			return nil
		}
		return err
	}
	var result BuildResult
	if progressive, ok := application.builder.(progressPackageBuilder); ok {
		result, err = progressive.BuildWithProgress(buildCtx, input, func(phase string) error {
			return application.setPhase(ctx, record.ID, leaseToken, phase)
		})
	} else {
		result, err = application.builder.Build(buildCtx, input)
	}
	if err != nil {
		if errors.Is(err, errBuildStopped) {
			return nil
		}
		return application.fail(ctx, &record, leaseToken, trace, "generation_failed", "OpenPost could not build this post. You can retry it.", err)
	}
	result.Sources = resolvedSourceIndex(input)
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return application.fail(ctx, &record, leaseToken, trace, "result_encoding_failed", "OpenPost could not save the generated post.", err)
	}
	model, providerRequestID, usageJSON := trace.encoded()
	if model == "" {
		model = record.Model
	}
	now := application.now().UTC()
	update, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateReady).
		Set("phase = ?", BuildPhaseReady).
		Set("result_json = ?", string(resultJSON)).
		Set("model = ?", model).
		Set("provider_request_id = ?", providerRequestID).
		Set("usage_json = ?", usageJSON).
		Set("error_code = ''").Set("error_message = ''").
		Set("lease_token = ''").Set("lease_expires_at = NULL").
		Set("completed_at = ?", now).Set("updated_at = ?", now).
		Set("revision = revision + 1").
		Where("id = ? AND state = ? AND lease_token = ?", record.ID, BuildStateBuilding, leaseToken).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("store publication build result: %w", err)
	}
	rows, err := update.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect publication build completion: %w", err)
	}
	if rows == 0 {
		return nil
	}
	return nil
}

func resolvedSourceIndex(input BuildInput) []ResolvedSource {
	if strings.TrimSpace(input.Idea) == "" && len(input.Sources) == 0 {
		return nil
	}
	resolved := make([]ResolvedSource, 0, len(input.Sources)+1)
	if strings.TrimSpace(input.Idea) != "" {
		resolved = append(resolved, ResolvedSource{ID: "idea", Kind: "text", Label: "Original idea"})
	}
	for _, source := range input.Sources {
		if source.ID == "idea" {
			continue
		}
		resolved = append(resolved, ResolvedSource{
			ID:          source.ID,
			Kind:        source.Kind,
			Label:       source.Label,
			Publishable: source.Publishable,
		})
	}
	return resolved
}

func (application *Application) Cancel(ctx context.Context, userID, buildID string) (Build, error) {
	now := application.now().UTC()
	result, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateCancelled).Set("phase = ?", BuildPhaseCancelled).
		Set("cancelled_at = ?", now).Set("updated_at = ?", now).
		Set("lease_token = ''").Set("lease_expires_at = NULL").
		Set("revision = revision + 1").
		Where("id = ? AND created_by_id = ?", strings.TrimSpace(buildID), strings.TrimSpace(userID)).
		Where("state IN (?, ?, ?)", BuildStateQueued, BuildStateBuilding, BuildStateFailed).
		Exec(ctx)
	if err != nil {
		return Build{}, fmt.Errorf("cancel publication build: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return application.Get(ctx, userID, buildID)
	}
	return application.Get(ctx, userID, buildID)
}

func (application *Application) Retry(ctx context.Context, userID, buildID string) (Build, error) {
	userID = strings.TrimSpace(userID)
	buildID = strings.TrimSpace(buildID)
	var target BuildRecord
	loadErr := application.db.NewSelect().Model(&target).
		Column("workspace_id").
		Where("id = ? AND created_by_id = ?", buildID, userID).
		Scan(ctx)
	if errors.Is(loadErr, sql.ErrNoRows) {
		return Build{}, ErrBuildNotFound
	}
	if loadErr != nil {
		return Build{}, fmt.Errorf("load publication build retry target: %w", loadErr)
	}
	now := application.now().UTC()
	err := application.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if lockErr := lockBuildAdmission(txCtx, tx, application.db.Dialect().Name(), target.WorkspaceID); lockErr != nil {
			return lockErr
		}
		var current BuildRecord
		loadErr := tx.NewSelect().Model(&current).
			Where("id = ? AND created_by_id = ?", buildID, userID).
			Scan(txCtx)
		if errors.Is(loadErr, sql.ErrNoRows) {
			return ErrBuildNotFound
		}
		if loadErr != nil {
			return loadErr
		}
		if current.State == BuildStateQueued {
			return ensureBuildJob(txCtx, tx, buildID, now)
		}
		if current.State != BuildStateFailed {
			return ErrBuildNotRetryable
		}
		active, countErr := countActiveBuilds(txCtx, tx, current.WorkspaceID, userID)
		if countErr != nil {
			return fmt.Errorf("count active publication builds for retry: %w", countErr)
		}
		if active >= maxActiveBuildsPerUser {
			return ErrTooManyActiveBuilds
		}
		result, updateErr := tx.NewUpdate().Model((*BuildRecord)(nil)).
			Set("state = ?", BuildStateQueued).Set("phase = ?", BuildPhaseQueued).
			Set("error_code = ''").Set("error_message = ''").Set("updated_at = ?", now).
			Set("lease_token = ''").Set("lease_expires_at = NULL").
			Set("revision = revision + 1").
			Where("id = ? AND created_by_id = ? AND state = ?", buildID, userID, BuildStateFailed).
			Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return rowsErr
		}
		if rows == 0 {
			return ErrBuildNotRetryable
		}
		return requeueBuildJob(txCtx, tx, buildID, now)
	})
	if err != nil {
		return Build{}, err
	}
	return application.Get(ctx, userID, buildID)
}

func (application *Application) claim(
	ctx context.Context,
	buildID string,
	workspaceID string,
	createdByID string,
) (string, bool, error) {
	leaseToken := uuid.NewString()
	claimed := false
	err := application.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if lockErr := lockBuildAdmission(txCtx, tx, application.db.Dialect().Name(), workspaceID); lockErr != nil {
			return lockErr
		}
		var current BuildRecord
		loadErr := tx.NewSelect().Model(&current).
			Column("state").
			Where("id = ? AND workspace_id = ? AND created_by_id = ?", buildID, workspaceID, createdByID).
			Scan(txCtx)
		if errors.Is(loadErr, sql.ErrNoRows) {
			return ErrBuildNotFound
		}
		if loadErr != nil {
			return loadErr
		}
		if current.State == BuildStateFailed {
			active, countErr := countActiveBuilds(txCtx, tx, workspaceID, createdByID)
			if countErr != nil {
				return fmt.Errorf("count active publication builds for recovery: %w", countErr)
			}
			if active >= maxActiveBuildsPerUser {
				return ErrTooManyActiveBuilds
			}
		}
		now := application.now().UTC()
		result, updateErr := tx.NewUpdate().Model((*BuildRecord)(nil)).
			Set("state = ?", BuildStateBuilding).Set("phase = ?", BuildPhaseSources).
			Set("lease_token = ?", leaseToken).Set("lease_expires_at = ?", now.Add(application.leaseDuration)).
			Set("updated_at = ?", now).Set("revision = revision + 1").
			Where("id = ?", buildID).
			Where(
				"state IN (?, ?) OR (state = ? AND ((lease_expires_at IS NOT NULL AND lease_expires_at <= ?) OR (lease_expires_at IS NULL AND updated_at <= ?)))",
				BuildStateQueued,
				BuildStateFailed,
				BuildStateBuilding,
				now,
				now.Add(-application.leaseDuration),
			).
			Exec(txCtx)
		if updateErr != nil {
			return fmt.Errorf("claim publication build: %w", updateErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return rowsErr
		}
		claimed = rows == 1
		return nil
	})
	if err != nil {
		return "", false, err
	}
	if !claimed {
		return "", false, nil
	}
	return leaseToken, true, nil
}

func (application *Application) setPhase(ctx context.Context, buildID, leaseToken, phase string) error {
	if phase != BuildPhaseDirecting && phase != BuildPhaseDrafting && phase != BuildPhaseReviewing {
		return fmt.Errorf("unsupported publication build phase %q", phase)
	}
	now := application.now().UTC()
	result, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("phase = ?", phase).
		Set("updated_at = ?", now).
		Set("lease_expires_at = ?", now.Add(application.leaseDuration)).
		Where("id = ? AND state = ? AND lease_token = ?", buildID, BuildStateBuilding, leaseToken).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errBuildStopped
	}
	return nil
}

func (application *Application) resolveSources(ctx context.Context, workspaceID string, request persistedBuildRequest, input *BuildInput) error {
	if len(request.ContextURLs) > 0 && application.sourceLoader == nil {
		return &sourceResolutionError{kind: "link", index: 1, cause: errors.New("public source loading is not configured")}
	}
	for index, rawURL := range request.ContextURLs {
		document, err := application.sourceLoader.Load(ctx, rawURL)
		if err != nil {
			return &sourceResolutionError{kind: "link", index: index + 1, cause: err}
		}
		input.Sources = append(input.Sources, SourceMaterial{
			ID: fmt.Sprintf("url:%d", index+1), Kind: "url", Label: document.Title, Text: document.Text,
		})
	}
	if len(request.Assets) == 0 {
		return nil
	}
	if application.assetLoader == nil {
		return &sourceResolutionError{kind: "asset", index: 1, cause: errors.New("source asset loading is not configured")}
	}
	loaded, err := application.assetLoader.Load(ctx, workspaceID, request.Assets)
	if err != nil {
		var indexed *sourceResolutionError
		if errors.As(err, &indexed) {
			return err
		}
		return &sourceResolutionError{kind: "asset", index: 1, cause: err}
	}
	input.Sources = append(input.Sources, loaded.Sources...)
	input.Parts = append(input.Parts, loaded.Parts...)
	input.Images = append(input.Images, loaded.Images...)
	input.Files = append(input.Files, loaded.Files...)
	input.Audio = append(input.Audio, loaded.Audio...)
	input.Videos = append(input.Videos, loaded.Videos...)
	return nil
}

// ResolvePlanningInput loads the same guarded URL and Workspace media context
// used by a durable build so angle planning does not ignore attached evidence.
func (application *Application) ResolvePlanningInput(
	ctx context.Context,
	workspaceID string,
	input BuildInput,
	contextURLs []string,
	assets []BuildAsset,
) (BuildInput, error) {
	if application == nil {
		return BuildInput{}, ErrRuntimeUnavailable
	}
	err := application.resolveSources(ctx, strings.TrimSpace(workspaceID), persistedBuildRequest{
		ContextURLs: contextURLs,
		Assets:      assets,
	}, &input)
	return input, err
}

type sourceResolutionError struct {
	kind  string
	index int
	cause error
}

func (failure *sourceResolutionError) Error() string {
	return fmt.Sprintf("selected %s %d is unavailable", failure.kind, failure.index)
}

func (failure *sourceResolutionError) Unwrap() error { return failure.cause }

func sourceFailureMessage(err error) string {
	var failure *sourceResolutionError
	if errors.As(err, &failure) {
		return fmt.Sprintf("OpenPost could not read selected %s %d.", failure.kind, failure.index)
	}
	return "OpenPost could not read one of the selected sources."
}

type safeBuildJobError struct {
	message string
}

func (failure *safeBuildJobError) Error() string { return failure.message }

func (application *Application) fail(
	ctx context.Context,
	record *BuildRecord,
	leaseToken string,
	trace *generationTrace,
	code string,
	message string,
	_ error,
) error {
	now := application.now().UTC()
	model, providerRequestID, usageJSON := trace.encoded()
	if model == "" {
		model = record.Model
	}
	result, updateErr := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).Set("phase = ?", BuildPhaseFailed).
		Set("error_code = ?", code).Set("error_message = ?", message).
		Set("model = ?", model).
		Set("provider_request_id = ?", providerRequestID).
		Set("usage_json = ?", usageJSON).
		Set("lease_token = ''").Set("lease_expires_at = NULL").
		Set("updated_at = ?", now).Set("revision = revision + 1").
		Where("id = ? AND state = ? AND lease_token = ?", record.ID, BuildStateBuilding, leaseToken).
		Exec(ctx)
	if updateErr != nil {
		return &safeBuildJobError{message: message}
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		return &safeBuildJobError{message: message}
	}
	if rows == 0 {
		return nil
	}
	return &safeBuildJobError{message: message}
}

// MarkTerminalJobFailure moves an unfinished build out of the active set when
// its durable job has exhausted retries. The caller supplies the transaction
// that fences the terminal job update, so the queue and domain state change
// together or not at all.
func (application *Application) MarkTerminalJobFailure(ctx context.Context, db bun.IDB, payload string) error {
	if application == nil || db == nil {
		return errors.New("publication builder terminal failure handling is unavailable")
	}
	decoded, err := jobregistry.DecodePublicationBuildPayload(payload)
	if err != nil {
		// A malformed job has no trustworthy build identity. The queue may still
		// terminate it without mutating any domain record.
		return nil
	}
	now := application.now().UTC()
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).
		Set("phase = ?", BuildPhaseFailed).
		Set("error_code = ?", "job_failed").
		Set("error_message = ?", "OpenPost could not complete this build. You can retry it.").
		Set("lease_token = ''").
		Set("lease_expires_at = NULL").
		Set("updated_at = ?", now).
		Set("revision = revision + 1").
		Where("id = ?", decoded.BuildID).
		Where("state IN (?, ?)", BuildStateQueued, BuildStateBuilding).
		Exec(ctx)
	return err
}

func ensureBuildJob(ctx context.Context, db bun.IDB, buildID string, runAt time.Time) error {
	payload, err := EncodeBuildJobPayload(buildID)
	if err != nil {
		return err
	}
	job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, payload, runAt)
	if err != nil {
		return err
	}
	identity, err := jobregistry.PublicationBuildIdentity(buildID)
	if err != nil {
		return err
	}
	job.ScopeID = identity.ScopeID
	job.DedupeKey = identity.DedupeKey
	active, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", job.Type, job.ScopeID, job.DedupeKey).
		Where("status IN (?, ?)", jobregistry.StatusPending, jobregistry.StatusProcessing).
		Exists(ctx)
	if err != nil {
		return fmt.Errorf("inspect active publication build job: %w", err)
	}
	if active {
		return nil
	}
	if _, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
		return fmt.Errorf("enqueue publication build job: %w", err)
	}
	active, err = db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", job.Type, job.ScopeID, job.DedupeKey).
		Where("status IN (?, ?)", jobregistry.StatusPending, jobregistry.StatusProcessing).
		Exists(ctx)
	if err != nil {
		return fmt.Errorf("verify publication build job: %w", err)
	}
	if !active {
		return errors.New("publication build job is not runnable")
	}
	return nil
}

func requeueBuildJob(ctx context.Context, db bun.IDB, buildID string, runAt time.Time) error {
	identity, err := jobregistry.PublicationBuildIdentity(buildID)
	if err != nil {
		return err
	}
	result, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobregistry.StatusPending).
		Set("attempts = 0").
		Set("last_error = ''").
		Set("run_at = ?", runAt.UTC()).
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", jobregistry.TypePublicationBuild, identity.ScopeID, identity.DedupeKey).
		Where("status IN (?, ?)", jobregistry.StatusPending, jobregistry.StatusProcessing).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("requeue publication build job: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect publication build job requeue: %w", err)
	}
	if rows > 0 {
		return nil
	}
	return ensureBuildJob(ctx, db, buildID, runAt)
}

func EncodeBuildJobPayload(buildID string) (string, error) {
	buildID = strings.TrimSpace(buildID)
	if buildID == "" {
		return "", errors.New("build id is required")
	}
	encoded, err := json.Marshal(jobregistry.PublicationBuildPayload{BuildID: buildID})
	if err != nil {
		return "", fmt.Errorf("encode publication build job: %w", err)
	}
	return string(encoded), nil
}

func encodeBuildRequest(workspaceID string, request persistedBuildRequest) (string, string, error) {
	encoded, err := json.Marshal(struct {
		WorkspaceID string                `json:"workspace_id"`
		Request     persistedBuildRequest `json:"request"`
	}{WorkspaceID: workspaceID, Request: request})
	if err != nil {
		return "", "", fmt.Errorf("encode publication build request: %w", err)
	}
	digest := sha256.Sum256(encoded)
	requestOnly, err := json.Marshal(request)
	if err != nil {
		return "", "", fmt.Errorf("encode stored publication build request: %w", err)
	}
	return string(requestOnly), "sha256:" + hex.EncodeToString(digest[:]), nil
}

func loadByIdempotencyKey(ctx context.Context, db bun.IDB, workspaceID, userID, key string) (BuildRecord, error) {
	var record BuildRecord
	err := db.NewSelect().Model(&record).
		Where("workspace_id = ? AND created_by_id = ? AND idempotency_key = ?", workspaceID, userID, key).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return BuildRecord{}, ErrBuildNotFound
	}
	return record, err
}

func countActiveBuilds(ctx context.Context, db bun.IDB, workspaceID, userID string) (int, error) {
	return db.NewSelect().Model((*BuildRecord)(nil)).
		Where("workspace_id = ? AND created_by_id = ?", workspaceID, userID).
		Where("state IN (?, ?)", BuildStateQueued, BuildStateBuilding).
		Count(ctx)
}

func lockBuildAdmission(ctx context.Context, tx bun.Tx, dialectName dialect.Name, workspaceID string) error {
	if dialectName == dialect.PG {
		var lockedID string
		err := tx.NewSelect().Table("workspaces").Column("id").
			Where("id = ?", workspaceID).
			For("UPDATE").
			Scan(ctx, &lockedID)
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("publication build workspace is unavailable")
		}
		if err != nil {
			return fmt.Errorf("lock publication build admission: %w", err)
		}
		return nil
	}
	result, err := tx.ExecContext(ctx, "UPDATE workspaces SET id = id WHERE id = ?", workspaceID)
	if err != nil {
		return fmt.Errorf("lock publication build admission: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect publication build admission lock: %w", err)
	}
	if rows != 1 {
		return errors.New("publication build workspace is unavailable")
	}
	return nil
}

func decodeBuild(record BuildRecord) (Build, error) {
	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return Build{}, fmt.Errorf("decode publication build request: %w", err)
	}
	var result *BuildResult
	if record.ResultJSON != "" && record.ResultJSON != "{}" {
		var decoded BuildResult
		if err := decodeStoredJSON(record.ResultJSON, &decoded); err != nil {
			return Build{}, fmt.Errorf("decode publication build result: %w", err)
		}
		result = &decoded
	}
	publicationID := ""
	if record.PublicationID != nil {
		publicationID = *record.PublicationID
	}
	return Build{
		ID: record.ID, WorkspaceID: record.WorkspaceID, PublicationID: publicationID,
		State: record.State, Phase: record.Phase, Revision: record.Revision,
		Input: request.Input, ContextURLs: request.ContextURLs, Assets: request.Assets,
		SocialSetID: request.SocialSetID, VoiceProfileID: request.VoiceProfileID,
		Result: result, ErrorCode: record.ErrorCode, ErrorMessage: record.ErrorMessage,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt,
	}, nil
}

func normalizeStoredBuildAssets(input []BuildAsset) ([]BuildAsset, error) {
	if len(input) > 10 {
		return nil, errors.New("publication build may use at most 10 media sources")
	}
	output := make([]BuildAsset, 0, len(input))
	seen := make(map[string]struct{}, len(input))
	for _, asset := range input {
		asset.MediaID = strings.TrimSpace(asset.MediaID)
		asset.Role = strings.ToLower(strings.TrimSpace(asset.Role))
		if asset.Role == "" {
			asset.Role = "context"
		}
		if asset.MediaID == "" {
			return nil, errors.New("publication build media source id is required")
		}
		if _, duplicate := seen[asset.MediaID]; duplicate {
			return nil, errors.New("publication build media source is repeated")
		}
		seen[asset.MediaID] = struct{}{}
		if asset.Role != "context" && asset.Role != "evidence" && asset.Role != "artifact" {
			return nil, errors.New("publication build media source role is invalid")
		}
		output = append(output, asset)
	}
	return output, nil
}

func encodeVoiceSnapshots(destinations []Destination) (string, error) {
	snapshots := make(map[string]VoiceSnapshot, len(destinations))
	for _, destination := range destinations {
		snapshots[destination.AccountID] = destination.Voice
	}
	encoded, err := json.Marshal(snapshots)
	if err != nil {
		return "", fmt.Errorf("encode publication build voice snapshots: %w", err)
	}
	return string(encoded), nil
}

func decodeStoredJSON(encoded string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("stored JSON contains trailing data")
	}
	return nil
}
