package workspacedeletion

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/queue"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/uptrace/bun"
)

const ReauthAction = "workspace.delete"

type ErrorKind string

const (
	ErrorInvalid   ErrorKind = "invalid"
	ErrorAuth      ErrorKind = "auth"
	ErrorForbidden ErrorKind = "forbidden"
	ErrorNotFound  ErrorKind = "not_found"
	ErrorConflict  ErrorKind = "conflict"
)

type UseCaseError struct {
	Kind    ErrorKind
	Message string
}

func (e *UseCaseError) Error() string { return e.Message }

type Actor struct {
	UserID             string
	SessionID          string
	TokenID            string
	WorkspaceBindingID string
}

type Confirmation struct {
	CanonicalName   string
	CurrentPassword string
	ReauthGrant     string
}

type Blocker struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Preview struct {
	WorkspaceID      string    `json:"workspace_id"`
	WorkspaceName    string    `json:"workspace_name"`
	Removed          []string  `json:"removed"`
	Retained         []string  `json:"retained"`
	RecoveryPossible bool      `json:"recovery_possible"`
	Blockers         []Blocker `json:"blockers"`
}

type Service struct {
	db       *bun.DB
	auth     *auth.Service
	identity *identity.Service
}

func NewService(db *bun.DB, authService *auth.Service, identityService *identity.Service) *Service {
	return &Service{db: db, auth: authService, identity: identityService}
}

func (s *Service) Preview(ctx context.Context, workspaceID string, actor Actor) (Preview, error) {
	workspace, err := s.authorizeOwner(ctx, workspaceID, actor)
	if err != nil {
		return Preview{}, err
	}
	blockers, err := s.blockers(ctx, s.db, workspace)
	if err != nil {
		return Preview{}, err
	}
	return Preview{
		WorkspaceID: workspace.ID, WorkspaceName: workspace.Name,
		Removed:          []string{"access", "content", "connected_assets"},
		Retained:         []string{"required_records"},
		RecoveryPossible: false, Blockers: blockers,
	}, nil
}

func (s *Service) Delete(ctx context.Context, workspaceID string, actor Actor, confirmation Confirmation) error {
	workspace, objectKeys, err := s.prepareDeletion(ctx, workspaceID, actor, confirmation)
	if err != nil {
		return err
	}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return s.deleteInTransaction(txCtx, tx, workspace, actor, confirmation, objectKeys)
	})
}

func (s *Service) prepareDeletion(ctx context.Context, workspaceID string, actor Actor, confirmation Confirmation) (*models.Workspace, []string, error) {
	workspace, err := s.authorizeOwner(ctx, workspaceID, actor)
	if err != nil {
		return nil, nil, err
	}
	if confirmation.CanonicalName != workspace.Name {
		return nil, nil, &UseCaseError{Kind: ErrorInvalid, Message: "Workspace name confirmation does not match the canonical name"}
	}
	blockers, err := s.blockers(ctx, s.db, workspace)
	if err != nil {
		return nil, nil, err
	}
	if len(blockers) > 0 {
		return nil, nil, &UseCaseError{Kind: ErrorConflict, Message: blockers[0].Message}
	}
	if err := s.reauthenticate(ctx, actor, confirmation); err != nil {
		return nil, nil, err
	}
	objectKeys, err := storedObjectKeys(ctx, s.db, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	return workspace, objectKeys, nil
}

func (s *Service) deleteInTransaction(ctx context.Context, tx bun.Tx, workspace *models.Workspace, actor Actor, confirmation Confirmation, objectKeys []string) error {
	// Every Workspace deletion in the Organization shares this lock, so two
	// concurrent requests cannot both observe a non-final Workspace.
	if _, err := tx.NewUpdate().Model((*models.Organization)(nil)).Set("name = name").Where("id = ?", workspace.OrganizationID).Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().Model((*models.Workspace)(nil)).Set("name = name").Where("id = ?", workspace.ID).Exec(ctx); err != nil {
		return err
	}
	var current models.Workspace
	if err := tx.NewSelect().Model(&current).Where("id = ?", workspace.ID).Scan(ctx); err != nil {
		return err
	}
	if current.Name != confirmation.CanonicalName {
		return &UseCaseError{Kind: ErrorConflict, Message: "The Workspace name changed; review the deletion preview and enter the current canonical name"}
	}
	var member models.OrganizationMember
	err := tx.NewSelect().Model(&member).Where("organization_id = ? AND user_id = ?", current.OrganizationID, actor.UserID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) || member.Role != models.OrganizationRoleOwner {
		return &UseCaseError{Kind: ErrorForbidden, Message: "Organization Owner role required"}
	}
	if err != nil {
		return err
	}
	currentBlockers, err := s.blockers(ctx, tx, &current)
	if err != nil {
		return err
	}
	if len(currentBlockers) > 0 {
		return &UseCaseError{Kind: ErrorConflict, Message: currentBlockers[0].Message}
	}
	if _, err := EnqueueStorageCleanup(ctx, tx, objectKeys); err != nil {
		return err
	}
	event := &models.WorkspaceLifecycleAuditEvent{
		ID: uuid.NewString(), OrganizationID: current.OrganizationID, WorkspaceID: current.ID,
		WorkspaceName: current.Name, ActorUserID: actor.UserID, Action: "workspace.deleted", CreatedAt: time.Now().UTC(),
	}
	if _, err := tx.NewInsert().Model(event).Exec(ctx); err != nil {
		return err
	}
	return DeleteWorkspaceData(ctx, tx, []string{workspace.ID})
}

func (s *Service) authorizeOwner(ctx context.Context, workspaceID string, actor Actor) (*models.Workspace, error) {
	if strings.TrimSpace(actor.WorkspaceBindingID) != "" {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "workspace-bound tokens cannot access organization-level resources"}
	}
	var workspace models.Workspace
	if err := s.db.NewSelect().Model(&workspace).Where("id = ?", workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &UseCaseError{Kind: ErrorNotFound, Message: "Workspace not found"}
		}
		return nil, err
	}
	decision, err := identity.EvaluateOrganizationAccess(ctx, s.db, workspace.OrganizationID, actor.UserID, actor.SessionID, actor.TokenID)
	if err != nil {
		return nil, err
	}
	if !decision.Allowed {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "organization SSO authentication is required"}
	}
	var member models.OrganizationMember
	if err := s.db.NewSelect().Model(&member).Where("organization_id = ? AND user_id = ?", workspace.OrganizationID, actor.UserID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &UseCaseError{Kind: ErrorForbidden, Message: "organization not accessible"}
		}
		return nil, err
	}
	if member.Role != models.OrganizationRoleOwner {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "Organization Owner role required"}
	}
	return &workspace, nil
}

func (s *Service) reauthenticate(ctx context.Context, actor Actor, confirmation Confirmation) error {
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("id = ?", actor.UserID).Scan(ctx); err != nil {
		return &UseCaseError{Kind: ErrorAuth, Message: "account not found"}
	}
	if s.identity != nil && strings.TrimSpace(confirmation.ReauthGrant) != "" {
		if err := s.identity.ConsumeReauthGrant(ctx, confirmation.ReauthGrant, actor.UserID, actor.SessionID, ReauthAction); err == nil {
			return nil
		}
		return &UseCaseError{Kind: ErrorAuth, Message: "recent reauthentication is required"}
	}
	passwordAllowed := true
	if s.identity != nil {
		allowed, err := s.identity.PasswordCredentialAllowed(ctx, actor.UserID)
		if err != nil {
			return err
		}
		passwordAllowed = allowed
	}
	if passwordAllowed && s.auth != nil && s.auth.CheckPassword(confirmation.CurrentPassword, user.PasswordHash) {
		return nil
	}
	if strings.TrimSpace(confirmation.CurrentPassword) == "" && strings.TrimSpace(confirmation.ReauthGrant) == "" {
		return &UseCaseError{Kind: ErrorInvalid, Message: "a current password or one-time reauthentication grant is required"}
	}
	return &UseCaseError{Kind: ErrorAuth, Message: "recent reauthentication is required"}
}

type deletionDB interface{ NewSelect() *bun.SelectQuery }

func (s *Service) blockers(ctx context.Context, db deletionDB, workspace *models.Workspace) ([]Blocker, error) {
	blockers := []Blocker{}
	count, err := db.NewSelect().Model((*models.Workspace)(nil)).Where("organization_id = ?", workspace.OrganizationID).Count(ctx)
	if err != nil {
		return nil, err
	}
	if count <= 1 {
		blockers = append(blockers, Blocker{Code: "final_workspace", Message: "Create another Workspace before deleting the Organization's final Workspace"})
	}
	active, err := db.NewSelect().Model((*models.BillingSubscription)(nil)).Where("workspace_id = ? AND LOWER(status) IN (?)", workspace.ID, bun.List([]string{"active", "trialing", "past_due"})).Exists(ctx)
	if err != nil {
		return nil, err
	}
	if active {
		blockers = append(blockers, Blocker{Code: "active_billing", Message: "Move or cancel the active billing subscription before deleting this Workspace"})
	}
	writes, err := db.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).Where("workspace_id = ? AND status IN (?)", workspace.ID, bun.List([]string{"prepared", "sending", "ambiguous"})).Exists(ctx)
	if err != nil {
		return nil, err
	}
	jobWrites, cleanup, err := s.jobBlockers(ctx, db, workspace.ID)
	if err != nil {
		return nil, err
	}
	writes = writes || jobWrites
	if writes {
		blockers = append(blockers, Blocker{Code: "pending_external_writes", Message: "Wait for publishing and provider actions to finish or resolve them before deleting this Workspace"})
	}
	if cleanup {
		blockers = append(blockers, Blocker{Code: "pending_cleanup", Message: "Wait for the active Workspace cleanup job to finish before deleting this Workspace"})
	}
	return blockers, nil
}

func (s *Service) jobBlockers(ctx context.Context, db deletionDB, workspaceID string) (bool, bool, error) {
	objectKeys, err := storedObjectKeys(ctx, db, workspaceID)
	if err != nil {
		return false, false, err
	}
	references, err := loadDeletionReferences(ctx, db, []string{workspaceID}, objectKeys)
	if err != nil {
		return false, false, err
	}
	var jobs []models.Job
	if err := db.NewSelect().Model(&jobs).Where("status IN (?)", bun.List([]string{"pending", "processing"})).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, false, err
	}
	writes, cleanup := false, false
	now := time.Now().UTC()
	for _, job := range jobs {
		if _, ok := references[job.ScopeID]; !ok && !JobPayloadReferences(job.Payload, references) {
			continue
		}
		if job.Type == jobregistry.TypeStorageDelete || (job.Type == jobregistry.TypeMediaCleanup && (job.Status == jobregistry.StatusProcessing || !job.RunAt.After(now))) {
			cleanup = true
		} else if job.Type != jobregistry.TypeMediaCleanup {
			writes = true
		}
	}
	return writes, cleanup, nil
}

func storedObjectKeys(ctx context.Context, db deletionDB, workspaceID string) ([]string, error) {
	keys := map[string]struct{}{}
	var media []models.MediaAttachment
	if err := db.NewSelect().Model(&media).Column("file_path", "thumbnail_object_key", "thumbnails").Where("workspace_id = ?", workspaceID).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	for _, item := range media {
		fileKey := ""
		if strings.TrimSpace(item.FilePath) != "" {
			fileKey = filepath.Base(item.FilePath)
		}
		for _, key := range []string{fileKey, item.ThumbnailObjectKey} {
			if strings.TrimSpace(key) != "" {
				keys[key] = struct{}{}
			}
		}
		var thumbnails map[string]string
		if json.Unmarshal([]byte(item.ThumbnailsJSON), &thumbnails) == nil {
			for _, key := range thumbnails {
				if strings.TrimSpace(key) != "" {
					keys[key] = struct{}{}
				}
			}
		}
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	return ordered, nil
}

type deletionIDs struct{ posts, publications, renditions, accounts, media, conversations, messages []string }

func loadDeletionIDs(ctx context.Context, db deletionDB, workspaceIDs []string) (deletionIDs, error) {
	ids := deletionIDs{}
	for _, scan := range []struct{ model, dest any }{{(*models.Post)(nil), &ids.posts}, {(*models.Publication)(nil), &ids.publications}, {(*models.SocialAccount)(nil), &ids.accounts}, {(*models.MediaAttachment)(nil), &ids.media}, {(*models.Conversation)(nil), &ids.conversations}, {(*models.DirectMessage)(nil), &ids.messages}} {
		if err := db.NewSelect().Model(scan.model).Column("id").Where("workspace_id IN (?)", bun.List(workspaceIDs)).Scan(ctx, scan.dest); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return ids, err
		}
	}
	if len(ids.publications) > 0 {
		if err := db.NewSelect().Model((*models.Rendition)(nil)).Column("id").Where("publication_id IN (?)", bun.List(ids.publications)).Scan(ctx, &ids.renditions); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return ids, err
		}
	}
	return ids, nil
}

func loadDeletionReferences(ctx context.Context, db deletionDB, workspaceIDs, objectKeys []string) (map[string]struct{}, error) {
	ids, err := loadDeletionIDs(ctx, db, workspaceIDs)
	if err != nil {
		return nil, err
	}
	refs := map[string]struct{}{}
	for _, values := range [][]string{workspaceIDs, ids.posts, ids.publications, ids.renditions, ids.accounts, ids.media, ids.conversations, ids.messages, objectKeys} {
		for _, id := range values {
			refs[id] = struct{}{}
		}
	}
	return refs, nil
}

const StorageCleanupBatchSize = queue.StorageDeleteMaxKeys

func EnqueueStorageCleanup(ctx context.Context, tx bun.Tx, objectKeys []string) ([]string, error) {
	jobIDs := []string{}
	for start := 0; start < len(objectKeys); start += StorageCleanupBatchSize {
		end := min(start+StorageCleanupBatchSize, len(objectKeys))
		payload, err := json.Marshal(struct {
			Keys []string `json:"keys"`
		}{Keys: objectKeys[start:end]})
		if err != nil {
			return nil, err
		}
		job, err := jobregistry.NewJob(jobregistry.TypeStorageDelete, string(payload), time.Now().UTC())
		if err != nil {
			return nil, err
		}
		if _, err := tx.NewInsert().Model(job).Exec(ctx); err != nil {
			return nil, err
		}
		jobIDs = append(jobIDs, job.ID)
	}
	return jobIDs, nil
}

func DeleteWorkspaceData(ctx context.Context, tx bun.Tx, workspaceIDs []string) error {
	ids, err := loadDeletionIDs(ctx, tx, workspaceIDs)
	if err != nil {
		return err
	}
	references, err := loadDeletionReferences(ctx, tx, workspaceIDs, nil)
	if err != nil {
		return err
	}
	if err := DeleteJobsReferencing(ctx, tx, references); err != nil {
		return err
	}
	for _, deletion := range deletionPlan(workspaceIDs, ids) {
		if _, err := tx.NewDelete().Model(deletion.model).Where(deletion.where, deletion.args...).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

type modelDeletion struct {
	model any
	where string
	args  []any
}

func deletionPlan(workspaceIDs []string, ids deletionIDs) []modelDeletion {
	deletions := []modelDeletion{}
	deletions = appendDeletions(deletions, workspaceIDs, "workspace_id IN (?)", (*models.AnalyticsAccountSnapshot)(nil), (*models.AnalyticsRenditionSnapshot)(nil), (*models.AnalyticsSyncState)(nil))
	deletions = appendDeletions(deletions, ids.renditions, "rendition_id IN (?)", (*models.RenditionMediaDelivery)(nil), (*models.RenditionMedia)(nil))
	deletions = appendDeletions(deletions, ids.publications, "publication_id IN (?)", (*models.PublicationAsset)(nil), (*models.PublicationAuthorization)(nil), (*models.PublicationLifecycleEvent)(nil), (*models.Rendition)(nil))
	deletions = appendDeletions(deletions, ids.posts, "post_id IN (?)", (*models.PostMediaDelivery)(nil), (*models.PostDestination)(nil), (*models.PostMedia)(nil), (*models.PostVariant)(nil), (*models.ThreadDraft)(nil))
	deletions = appendDeletions(deletions, ids.accounts, "social_account_id IN (?)", (*models.PostMediaDelivery)(nil), (*models.RenditionMediaDelivery)(nil))
	deletions = appendDeletions(deletions, ids.media, "media_id IN (?)", (*models.PostMediaDelivery)(nil), (*models.RenditionMediaDelivery)(nil), (*models.PostMedia)(nil), (*models.PublicationAsset)(nil), (*models.RenditionMedia)(nil))
	deletions = appendDeletions(deletions, workspaceIDs, "workspace_id IN (?)", (*models.Post)(nil), (*models.Publication)(nil), (*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.PostingSchedule)(nil), (*models.Prompt)(nil), (*models.UsageCounter)(nil), (*models.OAuthAccountSelection)(nil), (*models.XOAuthRequestToken)(nil), (*models.WorkspaceFirstConnection)(nil), (*models.WorkspaceFirstComposition)(nil), (*models.WorkspaceInvitation)(nil), (*models.WorkspaceMember)(nil), (*models.UserNotification)(nil), (*models.MCPToolCall)(nil))
	return appendDeletions(deletions, workspaceIDs, "id IN (?)", (*models.Workspace)(nil))
}
func appendDeletions(out []modelDeletion, ids []string, where string, modelsToDelete ...any) []modelDeletion {
	if len(ids) == 0 {
		return out
	}
	for _, model := range modelsToDelete {
		out = append(out, modelDeletion{model: model, where: where, args: []any{bun.List(ids)}})
	}
	return out
}
func DeleteJobsReferencing(ctx context.Context, tx bun.Tx, refs map[string]struct{}) error {
	var jobs []models.Job
	if err := tx.NewSelect().Model(&jobs).Column("id", "scope_id", "payload").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	for _, job := range jobs {
		if _, ok := refs[job.ScopeID]; !ok && !JobPayloadReferences(job.Payload, refs) {
			continue
		}
		if _, err := tx.NewDelete().Model((*models.Job)(nil)).Where("id = ?", job.ID).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
func JobPayloadReferences(raw string, refs map[string]struct{}) bool {
	var payload any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(value any) bool {
		switch typed := value.(type) {
		case string:
			_, ok := refs[typed]
			return ok
		case []any:
			for _, item := range typed {
				if visit(item) {
					return true
				}
			}
		case map[string]any:
			for _, item := range typed {
				if visit(item) {
					return true
				}
			}
		}
		return false
	}
	return visit(payload)
}
