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
	"github.com/openpost/backend/internal/services/sourcecontext"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
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
)

var (
	ErrBuildNotFound       = errors.New("publication build not found")
	ErrIdempotencyConflict = errors.New("idempotency key was already used for a different build request")
	ErrBuildNotRetryable   = errors.New("publication build is not retryable")
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
}

type Application struct {
	db              *bun.DB
	builder         PackageBuilder
	model           string
	now             func() time.Time
	sourceLoader    SourceLoader
	assetLoader     AssetLoader
	authorizeStored StoredAuthorityFunc
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
	}, nil
}

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
	created := false
	err = application.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, insertErr := tx.NewInsert().Model(record).On("CONFLICT DO NOTHING").Exec(txCtx)
		if insertErr != nil {
			return fmt.Errorf("create publication build: %w", insertErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return fmt.Errorf("inspect publication build insert: %w", rowsErr)
		}
		if rows == 0 {
			return nil
		}
		created = true
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
		return enqueueBuildJob(txCtx, tx, record.ID, now)
	})
	if err != nil {
		return Build{}, false, err
	}
	if !created {
		existing, loadErr := application.loadByIdempotencyKey(ctx, request.WorkspaceID, request.CreatedByID, request.IdempotencyKey)
		if loadErr != nil {
			return Build{}, false, loadErr
		}
		if existing.RequestFingerprint != fingerprint {
			return Build{}, false, ErrIdempotencyConflict
		}
		build, decodeErr := decodeBuild(existing)
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
	var authority workspaceaccess.StoredAuthority
	if err := decodeStoredJSON(record.AuthorityJSON, &authority); err != nil {
		return application.fail(ctx, &record, "invalid_authority", "The saved build authority is invalid.", err)
	}
	if err := application.authorizeStored(ctx, authority); err != nil {
		return application.fail(ctx, &record, "access_revoked", "Workspace access no longer allows this build.", err)
	}
	claimed, err := application.claim(ctx, record.ID)
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}
	record.State = BuildStateBuilding
	record.Phase = BuildPhaseSources

	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return application.fail(ctx, &record, "invalid_request", "The saved build request is invalid.", err)
	}
	input := request.Input
	if err := application.resolveSources(ctx, record.WorkspaceID, request, &input); err != nil {
		return application.fail(ctx, &record, "source_unavailable", "OpenPost could not read one of the selected sources.", err)
	}
	if err := validateBuildInput(input); err != nil {
		return application.fail(ctx, &record, "invalid_source", "The selected source material is not usable.", err)
	}
	if err := application.setPhase(ctx, record.ID, BuildPhaseDirecting); err != nil {
		if errors.Is(err, errBuildStopped) {
			return nil
		}
		return err
	}
	var result BuildResult
	if progressive, ok := application.builder.(progressPackageBuilder); ok {
		result, err = progressive.BuildWithProgress(ctx, input, func(phase string) error {
			return application.setPhase(ctx, record.ID, phase)
		})
	} else {
		result, err = application.builder.Build(ctx, input)
	}
	if err != nil {
		if errors.Is(err, errBuildStopped) {
			return nil
		}
		return application.fail(ctx, &record, "generation_failed", "OpenPost could not build this post. You can retry it.", err)
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return application.fail(ctx, &record, "result_encoding_failed", "OpenPost could not save the generated post.", err)
	}
	now := application.now().UTC()
	update, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateReady).
		Set("phase = ?", BuildPhaseReady).
		Set("result_json = ?", string(resultJSON)).
		Set("error_code = ''").Set("error_message = ''").
		Set("completed_at = ?", now).Set("updated_at = ?", now).
		Set("revision = revision + 1").
		Where("id = ? AND state = ?", record.ID, BuildStateBuilding).
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

func (application *Application) Cancel(ctx context.Context, userID, buildID string) (Build, error) {
	now := application.now().UTC()
	result, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateCancelled).Set("phase = ?", BuildPhaseCancelled).
		Set("cancelled_at = ?", now).Set("updated_at = ?", now).
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
	now := application.now().UTC()
	err := application.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, updateErr := tx.NewUpdate().Model((*BuildRecord)(nil)).
			Set("state = ?", BuildStateQueued).Set("phase = ?", BuildPhaseQueued).
			Set("error_code = ''").Set("error_message = ''").Set("updated_at = ?", now).
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
		return enqueueBuildJob(txCtx, tx, buildID, now)
	})
	if err != nil {
		return Build{}, err
	}
	return application.Get(ctx, userID, buildID)
}

func (application *Application) claim(ctx context.Context, buildID string) (bool, error) {
	now := application.now().UTC()
	result, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateBuilding).Set("phase = ?", BuildPhaseSources).
		Set("updated_at = ?", now).Set("revision = revision + 1").
		Where("id = ? AND state IN (?, ?)", buildID, BuildStateQueued, BuildStateFailed).
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("claim publication build: %w", err)
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (application *Application) setPhase(ctx context.Context, buildID, phase string) error {
	if phase != BuildPhaseDirecting && phase != BuildPhaseDrafting && phase != BuildPhaseReviewing {
		return fmt.Errorf("unsupported publication build phase %q", phase)
	}
	result, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("phase = ?", phase).Set("updated_at = ?", application.now().UTC()).
		Where("id = ? AND state = ?", buildID, BuildStateBuilding).
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
		return errors.New("public source loading is not configured")
	}
	for index, rawURL := range request.ContextURLs {
		document, err := application.sourceLoader.Load(ctx, rawURL)
		if err != nil {
			return err
		}
		input.Sources = append(input.Sources, SourceMaterial{
			ID: fmt.Sprintf("url:%d", index+1), Kind: "url", Label: document.Title, Text: document.Text,
		})
	}
	if len(request.Assets) == 0 {
		return nil
	}
	if application.assetLoader == nil {
		return errors.New("source asset loading is not configured")
	}
	loaded, err := application.assetLoader.Load(ctx, workspaceID, request.Assets)
	if err != nil {
		return err
	}
	input.Sources = append(input.Sources, loaded.Sources...)
	input.Images = append(input.Images, loaded.Images...)
	input.Files = append(input.Files, loaded.Files...)
	input.Audio = append(input.Audio, loaded.Audio...)
	input.Videos = append(input.Videos, loaded.Videos...)
	return nil
}

func (application *Application) fail(ctx context.Context, record *BuildRecord, code, message string, cause error) error {
	now := application.now().UTC()
	_, updateErr := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).Set("phase = ?", BuildPhaseFailed).
		Set("error_code = ?", code).Set("error_message = ?", message).
		Set("updated_at = ?", now).Set("revision = revision + 1").
		Where("id = ? AND state != ?", record.ID, BuildStateCancelled).
		Exec(ctx)
	if updateErr != nil {
		return fmt.Errorf("%s: %w", message, updateErr)
	}
	return fmt.Errorf("%s: %w", message, cause)
}

func enqueueBuildJob(ctx context.Context, db bun.IDB, buildID string, runAt time.Time) error {
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
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
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

func (application *Application) loadByIdempotencyKey(ctx context.Context, workspaceID, userID, key string) (BuildRecord, error) {
	var record BuildRecord
	err := application.db.NewSelect().Model(&record).
		Where("workspace_id = ? AND created_by_id = ? AND idempotency_key = ?", workspaceID, userID, key).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return BuildRecord{}, ErrBuildNotFound
	}
	return record, err
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
