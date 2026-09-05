package videoprojects

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	AutosaveRetention = 30 * 24 * time.Hour
	TrashRetention    = 30 * 24 * time.Hour
	MaxDocumentBytes  = 16 * 1024 * 1024

	MutationSet    = "set"
	MutationDelete = "delete"

	MutationApplied  = "applied"
	MutationConflict = "conflict"
)

var (
	ErrForbidden       = errors.New("video project access denied")
	ErrNotFound        = errors.New("video project not found")
	ErrInvalid         = errors.New("invalid video project request")
	ErrRevisionChanged = errors.New("video project revision changed")
)

type Service struct {
	db  *bun.DB
	now func() time.Time
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db, now: time.Now}
}

type CreateInput struct {
	ID          string
	WorkspaceID string
	Name        string
	Document    json.RawMessage
	DeviceID    string
}

type ReserveAssetInput struct {
	WorkspaceID      string
	ProjectID        string
	StableMediaID    string
	OriginalFilename string
	MimeType         string
	Size             int64
	SHA256           string
	Preparation      json.RawMessage
	DeviceID         string
}

type MutationOperation struct {
	Kind   string          `json:"kind"`
	Target string          `json:"target"`
	Path   string          `json:"path"`
	Value  json.RawMessage `json:"value,omitempty"`
}

type ApplyMutationInput struct {
	WorkspaceID  string
	ProjectID    string
	MutationID   string
	BaseRevision int64
	DeviceID     string
	Operations   []MutationOperation
}

type MutationResult struct {
	Outcome        string
	Revision       int64
	ConflictID     string
	ConflictName   string
	OverlapTargets []string
	Project        *models.VideoProject
}

type Conflict struct {
	models.VideoProjectConflict
	Document       json.RawMessage
	OverlapTargets []string
}

type Revision struct {
	models.VideoProjectRevision
	Document       json.RawMessage
	TouchedTargets []string
}

func (s *Service) ReserveAsset(ctx context.Context, actor workspaceaccess.ActorFacts, input ReserveAssetInput) (*models.ProjectAsset, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.StableMediaID = strings.TrimSpace(input.StableMediaID)
	input.OriginalFilename = strings.TrimSpace(input.OriginalFilename)
	input.MimeType = strings.TrimSpace(input.MimeType)
	input.SHA256 = strings.ToLower(strings.TrimSpace(input.SHA256))
	input.DeviceID = strings.TrimSpace(input.DeviceID)
	if input.WorkspaceID == "" || input.ProjectID == "" || input.StableMediaID == "" || input.OriginalFilename == "" || input.MimeType == "" || input.Size <= 0 {
		return nil, ErrInvalid
	}
	preparation := input.Preparation
	if len(preparation) == 0 {
		preparation = json.RawMessage(`{}`)
	}
	if !json.Valid(preparation) {
		return nil, ErrInvalid
	}
	var prepared map[string]any
	if err := json.Unmarshal(preparation, &prepared); err != nil || prepared == nil {
		return nil, ErrInvalid
	}
	preparation, _ = json.Marshal(prepared)

	var asset *models.ProjectAsset
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		project, err := loadProject(txCtx, tx, input.WorkspaceID, input.ProjectID, false)
		if err != nil {
			return err
		}
		if err := authorize(txCtx, tx, actor, project.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		var existing models.ProjectAsset
		err = tx.NewSelect().Model(&existing).
			Where("project_id = ? AND stable_media_id = ?", project.ID, input.StableMediaID).
			Scan(txCtx)
		if err == nil {
			asset = &existing
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		now := s.now().UTC()
		asset = &models.ProjectAsset{
			ID: uuid.NewString(), ProjectID: project.ID, WorkspaceID: project.WorkspaceID,
			StableMediaID: input.StableMediaID, OriginalFilename: input.OriginalFilename,
			MimeType: input.MimeType, Size: input.Size, SHA256: input.SHA256,
			Status: models.ProjectAssetStatusPending, PreparationJSON: string(preparation), Required: true,
			UploadedByUserID: actor.UserID, DeviceID: input.DeviceID, CreatedAt: now, UpdatedAt: now,
		}
		if _, err := tx.NewInsert().Model(asset).Exec(txCtx); err != nil {
			return err
		}
		_, err = tx.NewUpdate().Model((*models.VideoProject)(nil)).
			Set("sync_status = ?", models.VideoProjectSyncPending).
			Set("attention_reason = ''").
			Set("updated_at = ?", now).
			Where("id = ?", project.ID).Exec(txCtx)
		return err
	})
	if err != nil {
		return nil, err
	}
	return asset, nil
}

func (s *Service) BeginAssetUpload(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID, assetID string) (*models.ProjectAsset, error) {
	return s.setAssetStatus(ctx, actor, workspaceID, projectID, assetID, models.ProjectAssetStatusUploading, "")
}

func (s *Service) ListAssets(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) ([]models.ProjectAsset, error) {
	project, err := loadProject(ctx, s.db, strings.TrimSpace(workspaceID), strings.TrimSpace(projectID), false)
	if err != nil {
		return nil, err
	}
	if err := authorize(ctx, s.db, actor, project.WorkspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	var assets []models.ProjectAsset
	if err := s.db.NewSelect().Model(&assets).
		Where("project_id = ? AND workspace_id = ?", project.ID, project.WorkspaceID).
		OrderExpr("created_at ASC").
		Scan(ctx); err != nil {
		return nil, err
	}
	return assets, nil
}

func (s *Service) setAssetStatus(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID, assetID, status, reason string) (*models.ProjectAsset, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	projectID = strings.TrimSpace(projectID)
	assetID = strings.TrimSpace(assetID)
	if workspaceID == "" || projectID == "" || assetID == "" {
		return nil, ErrInvalid
	}
	var asset *models.ProjectAsset
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		project, err := loadProject(txCtx, tx, workspaceID, projectID, false)
		if err != nil {
			return err
		}
		if err := authorize(txCtx, tx, actor, project.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		var row models.ProjectAsset
		if err := tx.NewSelect().Model(&row).Where("id = ? AND project_id = ? AND workspace_id = ?", assetID, projectID, workspaceID).Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		row.Status = status
		row.AttentionReason = strings.TrimSpace(reason)
		row.UpdatedAt = s.now().UTC()
		if _, err := tx.NewUpdate().Model(&row).Column("status", "attention_reason", "updated_at").WherePK().Exec(txCtx); err != nil {
			return err
		}
		if err := refreshProjectSyncState(txCtx, tx, project.ID, row.UpdatedAt); err != nil {
			return err
		}
		asset = &row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return asset, nil
}

func BindAssetMediaWithDB(ctx context.Context, db bun.IDB, actor workspaceaccess.ActorFacts, workspaceID, assetID, mediaID, status, sha256 string) error {
	workspaceID = strings.TrimSpace(workspaceID)
	assetID = strings.TrimSpace(assetID)
	mediaID = strings.TrimSpace(mediaID)
	if workspaceID == "" || assetID == "" || mediaID == "" {
		return ErrInvalid
	}
	var asset models.ProjectAsset
	if err := db.NewSelect().Model(&asset).Where("id = ? AND workspace_id = ?", assetID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := authorize(ctx, db, actor, workspaceID, workspaceaccess.LevelEdit); err != nil {
		return err
	}
	var media models.MediaAttachment
	if err := db.NewSelect().Model(&media).Column("id", "workspace_id").Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	now := time.Now().UTC()
	if _, err := db.NewUpdate().Model((*models.ProjectAsset)(nil)).
		Set("media_id = ?", mediaID).
		Set("status = ?", status).
		Set("sha256 = CASE WHEN ? <> '' THEN ? ELSE sha256 END", strings.TrimSpace(sha256), strings.TrimSpace(sha256)).
		Set("attention_reason = ''").
		Set("updated_at = ?", now).
		Where("id = ? AND workspace_id = ?", asset.ID, workspaceID).Exec(ctx); err != nil {
		return err
	}
	return refreshProjectSyncState(ctx, db, asset.ProjectID, now)
}

func CompleteAssetForMedia(ctx context.Context, db *bun.DB, workspaceID, mediaID, sha256 string) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var asset models.ProjectAsset
		if err := tx.NewSelect().Model(&asset).Where("workspace_id = ? AND media_id = ?", workspaceID, mediaID).Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		now := time.Now().UTC()
		if _, err := tx.NewUpdate().Model((*models.ProjectAsset)(nil)).
			Set("status = ?", models.ProjectAssetStatusReady).
			Set("sha256 = ?", strings.TrimSpace(sha256)).
			Set("attention_reason = ''").
			Set("updated_at = ?", now).
			Where("id = ?", asset.ID).Exec(txCtx); err != nil {
			return err
		}
		return refreshProjectSyncState(txCtx, tx, asset.ProjectID, now)
	})
}

func MarkAssetNeedsStorage(ctx context.Context, db *bun.DB, actor workspaceaccess.ActorFacts, workspaceID, assetID, reason string) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var asset models.ProjectAsset
		if err := tx.NewSelect().Model(&asset).Where("id = ? AND workspace_id = ?", assetID, workspaceID).Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if err := authorize(txCtx, tx, actor, workspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		now := time.Now().UTC()
		if _, err := tx.NewUpdate().Model((*models.ProjectAsset)(nil)).
			Set("status = ?", models.ProjectAssetStatusNeedsStorage).
			Set("attention_reason = ?", firstNonEmpty(reason, "storage quota exceeded")).
			Set("updated_at = ?", now).
			Where("id = ?", asset.ID).Exec(txCtx); err != nil {
			return err
		}
		return refreshProjectSyncState(txCtx, tx, asset.ProjectID, now)
	})
}

func MarkAssetNeedsStorageForMedia(ctx context.Context, db *bun.DB, workspaceID, mediaID, reason string) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var asset models.ProjectAsset
		if err := tx.NewSelect().Model(&asset).Where("workspace_id = ? AND media_id = ?", workspaceID, mediaID).Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		now := time.Now().UTC()
		if _, err := tx.NewUpdate().Model((*models.ProjectAsset)(nil)).
			Set("status = ?", models.ProjectAssetStatusNeedsStorage).
			Set("attention_reason = ?", firstNonEmpty(reason, "storage quota exceeded")).
			Set("updated_at = ?", now).
			Where("id = ?", asset.ID).Exec(txCtx); err != nil {
			return err
		}
		return refreshProjectSyncState(txCtx, tx, asset.ProjectID, now)
	})
}

func refreshProjectSyncState(ctx context.Context, db bun.IDB, projectID string, now time.Time) error {
	status, attention, err := projectSyncState(ctx, db, projectID)
	if err != nil {
		return err
	}
	_, err = db.NewUpdate().Model((*models.VideoProject)(nil)).
		Set("sync_status = ?", status).
		Set("attention_reason = ?", attention).
		Set("updated_at = ?", now.UTC()).
		Where("id = ?", projectID).Exec(ctx)
	return err
}

func (s *Service) CreateCheckpoint(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID, name string) (*models.VideoProjectCheckpoint, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	projectID = strings.TrimSpace(projectID)
	name = strings.TrimSpace(name)
	if workspaceID == "" || projectID == "" || name == "" || len(name) > 160 {
		return nil, ErrInvalid
	}
	var checkpoint *models.VideoProjectCheckpoint
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		project, err := loadProject(txCtx, tx, workspaceID, projectID, false)
		if err != nil {
			return err
		}
		if err := authorize(txCtx, tx, actor, project.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		checkpoint = &models.VideoProjectCheckpoint{
			ID: uuid.NewString(), ProjectID: project.ID, Name: name, Revision: project.HeadRevision,
			CreatedByUserID: actor.UserID, CreatedAt: s.now().UTC(),
		}
		_, err = tx.NewInsert().Model(checkpoint).Exec(txCtx)
		return err
	})
	if err != nil {
		return nil, err
	}
	return checkpoint, nil
}

func (s *Service) RestoreRevision(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string, revision int64, deviceID string) (*models.VideoProject, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	projectID = strings.TrimSpace(projectID)
	deviceID = strings.TrimSpace(deviceID)
	if workspaceID == "" || projectID == "" || revision < 1 {
		return nil, ErrInvalid
	}
	var result *models.VideoProject
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		project, err := loadProject(txCtx, tx, workspaceID, projectID, false)
		if err != nil {
			return err
		}
		if err := authorize(txCtx, tx, actor, project.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		document, err := loadRevisionDocument(txCtx, tx, project.ID, revision)
		if err != nil {
			return err
		}
		status, attention, err := projectSyncState(txCtx, tx, project.ID)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		nextRevision := project.HeadRevision + 1
		update, err := tx.NewUpdate().Model((*models.VideoProject)(nil)).
			Set("head_revision = ?", nextRevision).
			Set("document_json = ?", string(document)).
			Set("sync_status = ?", status).
			Set("attention_reason = ?", attention).
			Set("updated_by_user_id = ?", actor.UserID).
			Set("updated_at = ?", now).
			Where("id = ? AND head_revision = ?", project.ID, project.HeadRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := update.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return ErrRevisionChanged
		}
		revisionRow := &models.VideoProjectRevision{
			ID: uuid.NewString(), ProjectID: project.ID, Revision: nextRevision, ParentRevision: project.HeadRevision,
			Kind: "restore", DocumentJSON: string(document), TouchedTargetsJSON: `["project:document"]`,
			AuthorUserID: actor.UserID, DeviceID: deviceID, RestoredFrom: revision,
			CreatedAt: now, ExpiresAt: now.Add(AutosaveRetention),
		}
		if _, err := tx.NewInsert().Model(revisionRow).Exec(txCtx); err != nil {
			return err
		}
		project.HeadRevision = nextRevision
		project.DocumentJSON = string(document)
		project.SyncStatus = status
		project.AttentionReason = attention
		project.UpdatedByUserID = actor.UserID
		project.UpdatedAt = now
		result = project
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) Trash(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) (*models.VideoProject, error) {
	return s.setTrashState(ctx, actor, workspaceID, projectID, true)
}

func (s *Service) RestoreTrash(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) (*models.VideoProject, error) {
	return s.setTrashState(ctx, actor, workspaceID, projectID, false)
}

func (s *Service) setTrashState(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string, trash bool) (*models.VideoProject, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	projectID = strings.TrimSpace(projectID)
	if workspaceID == "" || projectID == "" {
		return nil, ErrInvalid
	}
	var result *models.VideoProject
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		project, err := loadProject(txCtx, tx, workspaceID, projectID, true)
		if err != nil {
			return err
		}
		if err := authorize(txCtx, tx, actor, project.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		now := s.now().UTC()
		project.UpdatedAt = now
		project.UpdatedByUserID = actor.UserID
		if trash {
			if project.TrashedAt.IsZero() {
				project.TrashedAt = now
				project.RetentionExpiresAt = now.Add(TrashRetention)
			}
		} else {
			project.TrashedAt = time.Time{}
			project.RetentionExpiresAt = time.Time{}
		}
		_, err = tx.NewUpdate().Model(project).
			Column("trashed_at", "retention_expires_at", "updated_by_user_id", "updated_at").
			WherePK().Exec(txCtx)
		if err == nil {
			result = project
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) Create(ctx context.Context, actor workspaceaccess.ActorFacts, input CreateInput) (*models.VideoProject, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.Name = strings.TrimSpace(input.Name)
	input.DeviceID = strings.TrimSpace(input.DeviceID)
	if input.WorkspaceID == "" || input.Name == "" || len(input.Name) > 160 {
		return nil, ErrInvalid
	}
	document, err := normalizeDocument(input.Document)
	if err != nil {
		return nil, err
	}
	if err := authorize(ctx, s.db, actor, input.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	if input.ID != "" {
		var existing models.VideoProject
		err := s.db.NewSelect().Model(&existing).Where("id = ?", input.ID).Scan(ctx)
		if err == nil {
			if existing.WorkspaceID != input.WorkspaceID {
				return nil, ErrInvalid
			}
			return &existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}

	now := s.now().UTC()
	project := &models.VideoProject{
		ID: firstNonEmpty(input.ID, uuid.NewString()), WorkspaceID: input.WorkspaceID, Name: input.Name,
		HeadRevision: 1, DocumentJSON: string(document), SyncStatus: models.VideoProjectSyncSynced,
		CreatedByUserID: actor.UserID, UpdatedByUserID: actor.UserID, CreatedAt: now, UpdatedAt: now,
	}
	revision := &models.VideoProjectRevision{
		ID: uuid.NewString(), ProjectID: project.ID, Revision: 1, Kind: "create",
		DocumentJSON: project.DocumentJSON, TouchedTargetsJSON: `[]`, AuthorUserID: actor.UserID,
		DeviceID: input.DeviceID, CreatedAt: now, ExpiresAt: now.Add(AutosaveRetention),
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := authorize(txCtx, tx, actor, input.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(project).Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewInsert().Model(revision).Exec(txCtx)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			return nil, err
		}
		return nil, fmt.Errorf("create video project: %w", err)
	}
	return project, nil
}

func (s *Service) Get(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) (*models.VideoProject, error) {
	project, err := loadProject(ctx, s.db, strings.TrimSpace(workspaceID), strings.TrimSpace(projectID), false)
	if err != nil {
		return nil, err
	}
	if err := authorize(ctx, s.db, actor, project.WorkspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	return project, nil
}

func (s *Service) List(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string, includeTrash bool) ([]models.VideoProject, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if err := authorize(ctx, s.db, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	projects := []models.VideoProject{}
	query := s.db.NewSelect().Model(&projects).Where("workspace_id = ?", workspaceID)
	if !includeTrash {
		query = query.Where("trashed_at IS NULL")
	}
	if err := query.OrderExpr("updated_at DESC, id ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list video projects: %w", err)
	}
	return projects, nil
}

func (s *Service) ApplyMutation(ctx context.Context, actor workspaceaccess.ActorFacts, input ApplyMutationInput) (*MutationResult, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.MutationID = strings.TrimSpace(input.MutationID)
	input.DeviceID = strings.TrimSpace(input.DeviceID)
	if input.WorkspaceID == "" || input.ProjectID == "" || input.MutationID == "" || input.BaseRevision < 1 || len(input.Operations) == 0 {
		return nil, ErrInvalid
	}
	targets, err := validateOperations(input.Operations)
	if err != nil {
		return nil, err
	}

	var result *MutationResult
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		project, err := loadProject(txCtx, tx, input.WorkspaceID, input.ProjectID, false)
		if err != nil {
			return err
		}
		if err := authorize(txCtx, tx, actor, project.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
			return err
		}
		if replay, found, err := loadMutationReplay(txCtx, tx, project.ID, input.MutationID); err != nil {
			return err
		} else if found {
			replay.Project = project
			result = replay
			return nil
		}
		if input.BaseRevision > project.HeadRevision {
			return ErrInvalid
		}

		overlaps, err := overlappingTargets(txCtx, tx, project.ID, input.BaseRevision, targets)
		if err != nil {
			return err
		}
		if len(overlaps) > 0 {
			baseDocument, err := loadRevisionDocument(txCtx, tx, project.ID, input.BaseRevision)
			if err != nil {
				return err
			}
			branchDocument, err := applyOperations(baseDocument, input.Operations)
			if err != nil {
				return err
			}
			now := s.now().UTC()
			conflict := &models.VideoProjectConflict{
				ID: uuid.NewString(), ProjectID: project.ID,
				Name:         fmt.Sprintf("Conflict from %s at revision %d", firstNonEmpty(input.DeviceID, "another device"), project.HeadRevision),
				BaseRevision: input.BaseRevision, HeadRevision: project.HeadRevision, MutationID: input.MutationID,
				DocumentJSON: string(branchDocument), OverlapTargetsJSON: mustMarshal(overlaps),
				AuthorUserID: actor.UserID, DeviceID: input.DeviceID, CreatedAt: now,
			}
			if _, err := tx.NewInsert().Model(conflict).Exec(txCtx); err != nil {
				return err
			}
			mutation := &models.VideoProjectMutation{ProjectID: project.ID, MutationID: input.MutationID, Outcome: MutationConflict, ConflictID: conflict.ID, CreatedAt: now}
			if _, err := tx.NewInsert().Model(mutation).Exec(txCtx); err != nil {
				return err
			}
			result = &MutationResult{Outcome: MutationConflict, Revision: project.HeadRevision, ConflictID: conflict.ID, ConflictName: conflict.Name, OverlapTargets: overlaps, Project: project}
			return nil
		}

		document, err := applyOperations(json.RawMessage(project.DocumentJSON), input.Operations)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		nextRevision := project.HeadRevision + 1
		status, attention, err := projectSyncState(txCtx, tx, project.ID)
		if err != nil {
			return err
		}
		update, err := tx.NewUpdate().Model((*models.VideoProject)(nil)).
			Set("head_revision = ?", nextRevision).
			Set("document_json = ?", string(document)).
			Set("sync_status = ?", status).
			Set("attention_reason = ?", attention).
			Set("updated_by_user_id = ?", actor.UserID).
			Set("updated_at = ?", now).
			Where("id = ? AND head_revision = ?", project.ID, project.HeadRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := update.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return ErrRevisionChanged
		}
		revision := &models.VideoProjectRevision{
			ID: uuid.NewString(), ProjectID: project.ID, Revision: nextRevision, ParentRevision: project.HeadRevision,
			Kind: "autosave", DocumentJSON: string(document), TouchedTargetsJSON: mustMarshal(targets),
			AuthorUserID: actor.UserID, DeviceID: input.DeviceID, MutationID: input.MutationID,
			CreatedAt: now, ExpiresAt: now.Add(AutosaveRetention),
		}
		if _, err := tx.NewInsert().Model(revision).Exec(txCtx); err != nil {
			return err
		}
		mutation := &models.VideoProjectMutation{ProjectID: project.ID, MutationID: input.MutationID, Outcome: MutationApplied, Revision: nextRevision, CreatedAt: now}
		if _, err := tx.NewInsert().Model(mutation).Exec(txCtx); err != nil {
			return err
		}
		project.HeadRevision = nextRevision
		project.DocumentJSON = string(document)
		project.SyncStatus = status
		project.AttentionReason = attention
		project.UpdatedByUserID = actor.UserID
		project.UpdatedAt = now
		result = &MutationResult{Outcome: MutationApplied, Revision: nextRevision, Project: project}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) ListConflicts(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) ([]Conflict, error) {
	project, err := s.Get(ctx, actor, workspaceID, projectID)
	if err != nil {
		return nil, err
	}
	rows := []models.VideoProjectConflict{}
	if err := s.db.NewSelect().Model(&rows).Where("project_id = ? AND resolved_at IS NULL", project.ID).OrderExpr("created_at DESC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	out := make([]Conflict, 0, len(rows))
	for _, row := range rows {
		var overlap []string
		if err := json.Unmarshal([]byte(row.OverlapTargetsJSON), &overlap); err != nil {
			return nil, err
		}
		out = append(out, Conflict{VideoProjectConflict: row, Document: json.RawMessage(row.DocumentJSON), OverlapTargets: overlap})
	}
	return out, nil
}

func (s *Service) ListRevisions(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) ([]Revision, error) {
	project, err := s.Get(ctx, actor, workspaceID, projectID)
	if err != nil {
		return nil, err
	}
	rows := []models.VideoProjectRevision{}
	if err := s.db.NewSelect().Model(&rows).Where("project_id = ?", project.ID).OrderExpr("revision DESC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	out := make([]Revision, 0, len(rows))
	for _, row := range rows {
		var targets []string
		if err := json.Unmarshal([]byte(row.TouchedTargetsJSON), &targets); err != nil {
			return nil, err
		}
		out = append(out, Revision{VideoProjectRevision: row, Document: json.RawMessage(row.DocumentJSON), TouchedTargets: targets})
	}
	return out, nil
}

func normalizeDocument(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || len(raw) > MaxDocumentBytes || !json.Valid(raw) {
		return nil, ErrInvalid
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil || document == nil {
		return nil, ErrInvalid
	}
	stripDeviceState(document)
	normalized, err := json.Marshal(document)
	if err != nil {
		return nil, ErrInvalid
	}
	return normalized, nil
}

func stripDeviceState(value any) {
	deviceKeys := map[string]struct{}{
		"rootFolderHandle": {}, "rootFolderName": {}, "currentFrame": {}, "zoomLevel": {},
		"scrollPosition": {}, "selection": {}, "selections": {}, "panelLayout": {},
	}
	var visit func(any)
	visit = func(node any) {
		switch current := node.(type) {
		case map[string]any:
			for key, child := range current {
				if _, remove := deviceKeys[key]; remove {
					delete(current, key)
					continue
				}
				visit(child)
			}
		case []any:
			for _, child := range current {
				visit(child)
			}
		}
	}
	visit(value)
}

func validateOperations(operations []MutationOperation) ([]string, error) {
	targetSet := make(map[string]struct{}, len(operations))
	targets := make([]string, 0, len(operations))
	for i := range operations {
		op := &operations[i]
		op.Kind = strings.TrimSpace(op.Kind)
		op.Target = strings.TrimSpace(op.Target)
		op.Path = strings.TrimSpace(op.Path)
		if op.Target == "" || op.Path == "" || !strings.HasPrefix(op.Path, "/") {
			return nil, ErrInvalid
		}
		if op.Kind != MutationSet && op.Kind != MutationDelete {
			return nil, ErrInvalid
		}
		if op.Kind == MutationSet && (!json.Valid(op.Value) || len(op.Value) == 0) {
			return nil, ErrInvalid
		}
		if _, found := targetSet[op.Target]; !found {
			targetSet[op.Target] = struct{}{}
			targets = append(targets, op.Target)
		}
	}
	return targets, nil
}

func applyOperations(raw json.RawMessage, operations []MutationOperation) (json.RawMessage, error) {
	normalized, err := normalizeDocument(raw)
	if err != nil {
		return nil, err
	}
	var document any
	if err := json.Unmarshal(normalized, &document); err != nil {
		return nil, ErrInvalid
	}
	for _, operation := range operations {
		var value any
		if operation.Kind == MutationSet {
			if err := json.Unmarshal(operation.Value, &value); err != nil {
				return nil, ErrInvalid
			}
		}
		document, err = applyJSONPointer(document, operation.Path, operation.Kind, value)
		if err != nil {
			return nil, err
		}
	}
	out, err := json.Marshal(document)
	if err != nil || len(out) > MaxDocumentBytes {
		return nil, ErrInvalid
	}
	return out, nil
}

func applyJSONPointer(root any, pointer, kind string, value any) (any, error) {
	parts, err := pointerParts(pointer)
	if err != nil || len(parts) == 0 {
		return nil, ErrInvalid
	}
	updated, err := updateJSONNode(root, parts, kind, value)
	if err != nil {
		return nil, ErrInvalid
	}
	return updated, nil
}

func updateJSONNode(node any, parts []string, kind string, value any) (any, error) {
	key := parts[0]
	last := len(parts) == 1
	switch current := node.(type) {
	case map[string]any:
		if last {
			if kind == MutationDelete {
				if _, exists := current[key]; !exists {
					return nil, ErrInvalid
				}
				delete(current, key)
			} else {
				current[key] = value
			}
			return current, nil
		}
		child, exists := current[key]
		if !exists {
			return nil, ErrInvalid
		}
		updated, err := updateJSONNode(child, parts[1:], kind, value)
		if err != nil {
			return nil, err
		}
		current[key] = updated
		return current, nil
	case []any:
		index, err := strconv.Atoi(key)
		if err != nil || index < 0 || index >= len(current) {
			return nil, ErrInvalid
		}
		if last {
			if kind == MutationDelete {
				return append(current[:index], current[index+1:]...), nil
			}
			current[index] = value
			return current, nil
		}
		updated, err := updateJSONNode(current[index], parts[1:], kind, value)
		if err != nil {
			return nil, err
		}
		current[index] = updated
		return current, nil
	default:
		return nil, ErrInvalid
	}
}

func pointerParts(pointer string) ([]string, error) {
	if pointer == "" || pointer == "/" || !strings.HasPrefix(pointer, "/") {
		return nil, ErrInvalid
	}
	raw := strings.Split(pointer[1:], "/")
	parts := make([]string, len(raw))
	for i, part := range raw {
		part = strings.ReplaceAll(part, "~1", "/")
		part = strings.ReplaceAll(part, "~0", "~")
		if part == "" {
			return nil, ErrInvalid
		}
		parts[i] = part
	}
	return parts, nil
}

func overlappingTargets(ctx context.Context, db bun.IDB, projectID string, baseRevision int64, incoming []string) ([]string, error) {
	rows := []models.VideoProjectRevision{}
	if err := db.NewSelect().Model(&rows).Column("touched_targets_json").Where("project_id = ? AND revision > ?", projectID, baseRevision).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	changed := map[string]struct{}{}
	for _, row := range rows {
		var targets []string
		if err := json.Unmarshal([]byte(row.TouchedTargetsJSON), &targets); err != nil {
			return nil, err
		}
		for _, target := range targets {
			changed[target] = struct{}{}
		}
	}
	overlaps := []string{}
	for _, target := range incoming {
		if _, found := changed[target]; found {
			overlaps = append(overlaps, target)
		}
	}
	return overlaps, nil
}

func loadMutationReplay(ctx context.Context, db bun.IDB, projectID, mutationID string) (*MutationResult, bool, error) {
	var mutation models.VideoProjectMutation
	err := db.NewSelect().Model(&mutation).Where("project_id = ? AND mutation_id = ?", projectID, mutationID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	result := &MutationResult{Outcome: mutation.Outcome, Revision: mutation.Revision, ConflictID: mutation.ConflictID}
	if mutation.ConflictID != "" {
		var conflict models.VideoProjectConflict
		if err := db.NewSelect().Model(&conflict).Where("id = ?", mutation.ConflictID).Scan(ctx); err != nil {
			return nil, false, err
		}
		result.Revision = conflict.HeadRevision
		result.ConflictName = conflict.Name
		if err := json.Unmarshal([]byte(conflict.OverlapTargetsJSON), &result.OverlapTargets); err != nil {
			return nil, false, err
		}
	}
	return result, true, nil
}

func loadRevisionDocument(ctx context.Context, db bun.IDB, projectID string, revision int64) (json.RawMessage, error) {
	var row models.VideoProjectRevision
	if err := db.NewSelect().Model(&row).Column("document_json").Where("project_id = ? AND revision = ?", projectID, revision).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalid
		}
		return nil, err
	}
	return json.RawMessage(row.DocumentJSON), nil
}

func projectSyncState(ctx context.Context, db bun.IDB, projectID string) (string, string, error) {
	assets := []models.ProjectAsset{}
	if err := db.NewSelect().Model(&assets).Column("status", "attention_reason").Where("project_id = ? AND required = TRUE", projectID).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", "", err
	}
	status := models.VideoProjectSyncSynced
	attention := ""
	for _, asset := range assets {
		switch asset.Status {
		case models.ProjectAssetStatusReady:
		case models.ProjectAssetStatusNeedsStorage, models.ProjectAssetStatusFailed:
			status = models.VideoProjectSyncNeedsAttention
			attention = firstNonEmpty(asset.AttentionReason, "required project asset needs attention")
			return status, attention, nil
		case models.ProjectAssetStatusUploading:
			status = models.VideoProjectSyncUploading
		default:
			status = models.VideoProjectSyncPending
		}
	}
	return status, attention, nil
}

func loadProject(ctx context.Context, db bun.IDB, workspaceID, projectID string, includeTrash bool) (*models.VideoProject, error) {
	var project models.VideoProject
	query := db.NewSelect().Model(&project).Where("id = ? AND workspace_id = ?", projectID, workspaceID)
	if !includeTrash {
		query = query.Where("trashed_at IS NULL")
	}
	if err := query.Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &project, nil
}

func authorize(ctx context.Context, db bun.IDB, actor workspaceaccess.ActorFacts, workspaceID string, level workspaceaccess.Level) error {
	decision, err := workspaceaccess.NewAuthorizer(db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return ErrForbidden
	}
	return nil
}

func mustMarshal(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
