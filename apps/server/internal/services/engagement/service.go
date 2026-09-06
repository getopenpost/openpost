package engagement

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	JobTypeSweep          = jobregistry.TypeEngagementSweep
	JobTypeEngagementSync = jobregistry.TypeEngagementSync
	JobTypeEngagementAct  = jobregistry.TypeEngagementAction
)

const (
	sweepInterval           = 5 * time.Minute
	defaultXDailyReadBudget = 12
	xCommentPageSize        = 100
	xMaxCommentPagesPerSync = 1
)

var (
	ErrAccessDenied = errors.New("workspace access denied")
	ErrNotFound     = errors.New("engagement item not found")
)

type Actor = workspaceaccess.ActorFacts

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type FeatureGate interface {
	IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error)
}

type Service struct {
	db               *bun.DB
	tokenSource      TokenSource
	notifications    *notifications.Service
	providersMu      sync.RWMutex
	providers        map[string]platform.EngagementAdapter
	now              func() time.Time
	featureGate      FeatureGate
	xDailyReadBudget int
}

func NewService(db *bun.DB, tokenSource TokenSource, notificationService *notifications.Service) *Service {
	return &Service{
		db:               db,
		tokenSource:      tokenSource,
		notifications:    notificationService,
		providers:        make(map[string]platform.EngagementAdapter),
		now:              func() time.Time { return time.Now().UTC() },
		xDailyReadBudget: defaultXDailyReadBudget,
	}
}

func (s *Service) SetProvider(name string, adapter platform.EngagementAdapter) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}

func (s *Service) SetFeatureGate(g FeatureGate) {
	s.featureGate = g
}

// SetXDailyReadBudget applies the deployment-owned per-account UTC-day policy.
func (s *Service) SetXDailyReadBudget(limit int) {
	if limit >= 0 {
		s.xDailyReadBudget = limit
	}
}

func (s *Service) isEngagementEnabled(ctx context.Context, accountID string) bool {
	if s.featureGate == nil {
		return false
	}
	enabled, err := s.featureGate.IsEffectiveEnabled(ctx, accountID, "engagement")
	if err != nil {
		return false
	}
	return enabled
}

func (s *Service) authorize(ctx context.Context, workspaceID string, actor Actor, level workspaceaccess.Level) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return fmt.Errorf("authorize engagement workspace: %w", err)
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	return nil
}

func (s *Service) ScheduleSweep(ctx context.Context, runAt time.Time) error {
	payload, _ := json.Marshal(map[string]string{"scheduled_for": runAt.UTC().Truncate(time.Minute).Format(time.RFC3339)})
	_, err := s.enqueue(ctx, "", JobTypeSweep, string(payload), runAt)
	return err
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	switch jobType {
	case JobTypeSweep:
		return s.handleSweep(ctx)
	case JobTypeEngagementSync:
		var input subjectJob
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode engagement sync: %w", err)
		}
		return s.syncEngagement(ctx, input.ID)
	case JobTypeEngagementAct:
		var input engagementActionJob
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode engagement action: %w", err)
		}
		return s.performEngagementAction(ctx, input)
	default:
		return fmt.Errorf("unsupported engagement job type %q", jobType)
	}
}

type subjectJob struct {
	ID string `json:"id"`
}

type engagementActionJob struct {
	ItemID            string `json:"item_id,omitempty"`
	JobID             string `json:"job_id,omitempty"`
	WorkspaceID       string `json:"workspace_id,omitempty"`
	PublicationID     string `json:"publication_id,omitempty"`
	RenditionID       string `json:"rendition_id,omitempty"`
	SocialAccountID   string `json:"social_account_id,omitempty"`
	ProviderCommentID string `json:"provider_comment_id,omitempty"`
	Action            string `json:"action"`
	Message           string `json:"message,omitempty"`
	UserID            string `json:"user_id"`
}

type ProviderCommentActionInput struct {
	Actor             Actor
	WorkspaceID       string
	PublicationID     string
	RenditionID       string
	SocialAccountID   string
	ProviderCommentID string
	Action            string
	Message           string
}

func (s *Service) handleSweep(ctx context.Context) error {
	if _, err := s.db.NewDelete().
		Model((*models.EngagementSyncState)(nil)).
		Where("NOT EXISTS (SELECT 1 FROM renditions AS rendition WHERE rendition.id = engagement_sync_state.rendition_id)").
		Exec(ctx); err != nil {
		return fmt.Errorf("cleaning engagement sync state: %w", err)
	}
	var workspaces []string
	if err := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		ColumnExpr("DISTINCT workspace_id").
		Where("is_active = ?", true).
		Scan(ctx, &workspaces); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var combined error
	for _, workspaceID := range workspaces {
		if _, err := s.refreshWorkspace(ctx, workspaceID, false); err != nil {
			combined = errors.Join(combined, err)
		}
	}
	if err := s.ScheduleSweep(ctx, s.now().Add(sweepInterval)); err != nil {
		combined = errors.Join(combined, err)
	}
	return combined
}

func (s *Service) RefreshWorkspace(ctx context.Context, actor Actor, workspaceID string, force bool) (int, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return 0, err
	}
	return s.refreshWorkspace(ctx, workspaceID, force)
}

//nolint:gocyclo // Scheduling keeps capability, scope, cadence, backoff, budget, and fairness gates in one pass.
func (s *Service) refreshWorkspace(ctx context.Context, workspaceID string, force bool) (int, error) {
	now := s.now()
	queued := 0
	var renditions []models.Rendition
	err := s.db.NewSelect().Model(&renditions).
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Join("LEFT JOIN engagement_sync_states AS engagement_state ON engagement_state.rendition_id = rendition.id").
		Where("publication.workspace_id = ?", workspaceID).
		Where("rendition.status = ? AND rendition.external_id != ''", models.RenditionStatusPublished).
		Where("COALESCE(publication.actual_run_at, publication.updated_at) >= ?", now.Add(-90*24*time.Hour)).
		OrderExpr("CASE WHEN engagement_state.last_attempted_at IS NULL THEN 0 ELSE 1 END ASC").
		Order("engagement_state.last_attempted_at ASC", "rendition.id ASC").
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	for _, rendition := range renditions {
		account, err := s.resolveRenditionAccount(ctx, rendition.SocialAccountID)
		if err != nil {
			return queued, err
		}
		if account.ID == "" {
			continue
		}
		if !s.isEngagementEnabled(ctx, account.ID) {
			_ = s.recordState(ctx, rendition.ID, account, "disabled", "feature_disabled", "Engagement is disabled for this account.", false, 0, 0)
			continue
		}
		engagement := s.adapter(account)
		if engagement == nil || !engagement.EngagementSupport().Enabled {
			continue
		}
		support := engagement.EngagementSupport()
		if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
			_ = s.recordState(ctx, rendition.ID, account, "permission_required", "missing_scope", "Reconnect this account and grant engagement access.", false, 24*time.Hour, 0)
			continue
		}
		state := s.loadState(ctx, rendition.ID)
		if !force && state != nil && state.NextSyncAt.After(now) {
			continue
		}
		if account.Platform == "x" {
			if force && xProviderBackoffActive(state, now) {
				continue
			}
			available, next, budgetErr := s.xReadAvailable(ctx, account, now)
			if budgetErr != nil {
				return queued, budgetErr
			}
			if !available {
				_ = s.recordXDeferredState(ctx, rendition.ID, account, "budget_exhausted", "daily_read_budget", "X engagement collection reached this account's daily read budget.", next)
				continue
			}
		}
		payload, _ := json.Marshal(subjectJob{ID: rendition.ID})
		runAt := now
		if account.Platform == "x" {
			runAt = runAt.Add(time.Duration(queued) * time.Millisecond)
		}
		inserted, enqueueErr := s.enqueue(ctx, workspaceID, JobTypeEngagementSync, string(payload), runAt)
		if enqueueErr != nil {
			return queued, enqueueErr
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

//nolint:gocyclo // One sync preserves the shared provider gates while selecting the optional X incremental seam.
func (s *Service) syncEngagement(ctx context.Context, renditionID string) error {
	var rendition models.Rendition
	if err := s.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return err
	}
	account, err := s.resolveRenditionAccount(ctx, rendition.SocialAccountID)
	if err != nil {
		return err
	}
	if account.ID == "" {
		return nil
	}
	if !s.isEngagementEnabled(ctx, account.ID) {
		return s.recordState(ctx, rendition.ID, account, "disabled", "feature_disabled", "Engagement is disabled for this account.", false, 0, 0)
	}
	commenter := s.adapter(account)
	if commenter == nil || !commenter.EngagementSupport().Enabled {
		return s.recordState(ctx, rendition.ID, account, "unsupported", "unsupported", "Engagement collection is not supported for this provider.", true, 0, 0)
	}
	support := commenter.EngagementSupport()
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
		return s.recordState(ctx, rendition.ID, account, "permission_required", "missing_scope", "Reconnect this account and grant engagement access.", false, 24*time.Hour, 0)
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return s.recordState(ctx, rendition.ID, account, "permission_required", "authentication", "Reconnect this account to resume engagement collection.", true, 24*time.Hour, 0)
	}
	s.resolveAndStoreContentURL(ctx, commenter, token, account, &rendition)
	if account.Platform == "x" {
		if incremental, ok := commenter.(platform.IncrementalCommentAdapter); ok {
			return s.syncXEngagement(ctx, incremental, token, rendition, account)
		}
		allowed, next, budgetErr := s.reserveXReadAttempt(ctx, account, s.now())
		if budgetErr != nil {
			return budgetErr
		}
		if !allowed {
			return s.recordXDeferredState(ctx, rendition.ID, account, "budget_exhausted", "daily_read_budget", "X engagement collection reached this account's daily read budget.", next)
		}
	}
	comments, err := commenter.ListComments(ctx, token, account.AccountID, rendition.ExternalID)
	if err != nil {
		status, code, message, cadence := classifyEngagementReadError(err)
		if account.Platform == "x" {
			if blockErr := s.blockXReadsForError(ctx, account, err, cadence); blockErr != nil {
				return blockErr
			}
		}
		return s.recordState(ctx, rendition.ID, account, status, code, message, true, cadence, 0)
	}
	now := s.now()
	var publication models.Publication
	_ = s.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx)
	if _, err := s.persistEngagementComments(ctx, rendition, account, publication, comments, now); err != nil {
		return err
	}
	publishedAt := publication.ActualRunAt
	if publishedAt.IsZero() {
		publishedAt = firstNonZeroTime(publication.UpdatedAt, publication.CreatedAt)
	}
	cadence := engagementCadence(publishedAt, now, len(comments) == 0)
	if account.Platform == "x" {
		cadence = xEngagementCadence(publishedAt, now, len(comments) == 0)
	}
	return s.recordState(ctx, rendition.ID, account, "ok", "", "", true, cadence, boolToInt(len(comments) == 0))
}

type xCommentCursor struct {
	SinceID       string `json:"since_id,omitempty"`
	NextToken     string `json:"next_token,omitempty"`
	PendingHighID string `json:"pending_high_id,omitempty"`
}

func (s *Service) syncXEngagement(
	ctx context.Context,
	incremental platform.IncrementalCommentAdapter,
	token string,
	rendition models.Rendition,
	account models.SocialAccount,
) error {
	var publication models.Publication
	_ = s.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx)
	state := s.loadState(ctx, rendition.ID)
	cursor := decodeXCommentCursor(state)
	totalComments := 0

	for pageNumber := 0; pageNumber < xMaxCommentPagesPerSync; pageNumber++ {
		now := s.now()
		allowed, next, budgetErr := s.reserveXReadAttempt(ctx, account, now)
		if budgetErr != nil {
			return budgetErr
		}
		if !allowed {
			return s.recordXDeferredState(ctx, rendition.ID, account, "budget_exhausted", "daily_read_budget", "X engagement collection reached this account's daily read budget.", next)
		}
		page, err := incremental.ListCommentPage(ctx, token, account.AccountID, rendition.ExternalID, platform.IncrementalCommentRequest{
			SinceID: cursor.SinceID, NextToken: cursor.NextToken, Limit: xCommentPageSize,
		})
		if err != nil {
			status, code, message, cadence := classifyEngagementReadError(err)
			if blockErr := s.blockXReadsForError(ctx, account, err, cadence); blockErr != nil {
				return blockErr
			}
			return s.recordState(ctx, rendition.ID, account, status, code, message, cursor.NextToken == "", cadence, 0)
		}
		totalComments += len(page.Comments)
		cursor.PendingHighID = maxProviderID(cursor.PendingHighID, page.HighestID)
		for _, comment := range page.Comments {
			cursor.PendingHighID = maxProviderID(cursor.PendingHighID, comment.ID)
		}
		cursor.NextToken = boundedText(page.NextToken, 2048)
		complete := cursor.NextToken == ""
		if complete {
			cursor.SinceID = maxProviderID(cursor.SinceID, cursor.PendingHighID)
			cursor.PendingHighID = ""
		}
		publishedAt := publication.ActualRunAt
		if publishedAt.IsZero() {
			publishedAt = firstNonZeroTime(publication.UpdatedAt, publication.CreatedAt)
		}
		cadence := time.Duration(0)
		status := "syncing"
		if complete || pageNumber == xMaxCommentPagesPerSync-1 {
			cadence = xEngagementCadence(publishedAt, now, totalComments == 0)
			status = "ok"
		}
		if err := s.persistXCommentPage(ctx, rendition, account, publication, page.Comments, cursor, status, cadence, complete, totalComments == 0, now); err != nil {
			return err
		}
		if complete {
			return nil
		}
	}
	return nil
}

func decodeXCommentCursor(state *models.EngagementSyncState) xCommentCursor {
	if state == nil || strings.TrimSpace(state.Cursor) == "" {
		return xCommentCursor{}
	}
	var cursor xCommentCursor
	if json.Unmarshal([]byte(state.Cursor), &cursor) != nil {
		cursor.SinceID = boundedText(state.Cursor, 512)
	}
	cursor.SinceID = boundedText(cursor.SinceID, 512)
	cursor.NextToken = boundedText(cursor.NextToken, 2048)
	cursor.PendingHighID = boundedText(cursor.PendingHighID, 512)
	return cursor
}

func encodeXCommentCursor(cursor xCommentCursor) string {
	encoded, _ := json.Marshal(cursor)
	return string(encoded)
}

func maxProviderID(left, right string) string {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" {
		return right
	}
	if right == "" {
		return left
	}
	if len(left) != len(right) {
		if len(right) > len(left) {
			return right
		}
		return left
	}
	if right > left {
		return right
	}
	return left
}

func (s *Service) persistXCommentPage(
	ctx context.Context,
	rendition models.Rendition,
	account models.SocialAccount,
	publication models.Publication,
	comments []platform.Comment,
	cursor xCommentCursor,
	status string,
	cadence time.Duration,
	complete, empty bool,
	now time.Time,
) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		for _, comment := range comments {
			item, isNew, err := persistEngagementComment(ctx, tx, rendition, account, comment, now)
			if err != nil {
				return err
			}
			if isNew {
				if err := s.notifyNewEngagement(ctx, tx, publication, rendition, account, item); err != nil {
					return err
				}
			}
		}
		var old models.EngagementSyncState
		oldErr := tx.NewSelect().Model(&old).Where("id = ?", syncStateID(rendition.ID)).Scan(ctx)
		if oldErr != nil && !errors.Is(oldErr, sql.ErrNoRows) {
			return oldErr
		}
		next := time.Time{}
		if cadence > 0 {
			next = now.Add(cadence)
		}
		state := &models.EngagementSyncState{
			ID: syncStateID(rendition.ID), WorkspaceID: account.WorkspaceID, RenditionID: rendition.ID,
			SocialAccountID: account.ID, Platform: account.Platform, Status: status,
			Cursor: encodeXCommentCursor(cursor), BackfillComplete: complete,
			LastAttemptedAt: now, LastSuccessAt: old.LastSuccessAt, NextSyncAt: next,
			EmptyStreak: boolToInt(empty), CreatedAt: firstNonZeroTime(old.CreatedAt, now), UpdatedAt: now,
		}
		if status == "ok" {
			state.LastSuccessAt = now
		}
		_, err := tx.NewInsert().Model(state).
			On("CONFLICT (id) DO UPDATE").
			Set("status = EXCLUDED.status").
			Set("error_code = EXCLUDED.error_code").
			Set("error_message = EXCLUDED.error_message").
			Set("cursor = EXCLUDED.cursor").
			Set("backfill_complete = EXCLUDED.backfill_complete").
			Set("last_attempted_at = EXCLUDED.last_attempted_at").
			Set("last_success_at = EXCLUDED.last_success_at").
			Set("next_sync_at = EXCLUDED.next_sync_at").
			Set("empty_streak = EXCLUDED.empty_streak").
			Set("updated_at = EXCLUDED.updated_at").
			Exec(ctx)
		return err
	})
}

func (s *Service) persistEngagementComments(
	ctx context.Context,
	rendition models.Rendition,
	account models.SocialAccount,
	publication models.Publication,
	comments []platform.Comment,
	now time.Time,
) ([]models.EngagementItem, error) {
	newItems := make([]models.EngagementItem, 0)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		for _, comment := range comments {
			item, isNew, err := persistEngagementComment(ctx, tx, rendition, account, comment, now)
			if err != nil {
				return err
			}
			if !isNew {
				continue
			}
			newItems = append(newItems, item)
			if err := s.notifyNewEngagement(ctx, tx, publication, rendition, account, item); err != nil {
				return err
			}
		}
		return nil
	})
	return newItems, err
}

func persistEngagementComment(
	ctx context.Context,
	tx bun.Tx,
	rendition models.Rendition,
	account models.SocialAccount,
	comment platform.Comment,
	now time.Time,
) (models.EngagementItem, bool, error) {
	if strings.TrimSpace(comment.ID) == "" {
		return models.EngagementItem{}, false, nil
	}
	if comment.IsOurs {
		_, err := tx.NewDelete().Model((*models.EngagementItem)(nil)).
			Where("social_account_id = ? AND remote_id = ?", account.ID, comment.ID).
			Exec(ctx)
		return models.EngagementItem{}, false, err
	}
	var existing models.EngagementItem
	existingErr := tx.NewSelect().Model(&existing).
		Where("social_account_id = ? AND remote_id = ?", account.ID, comment.ID).
		Scan(ctx)
	exists := existingErr == nil
	if existingErr != nil && !errors.Is(existingErr, sql.ErrNoRows) {
		return models.EngagementItem{}, false, existingErr
	}
	item := engagementItemFromComment(rendition, account, existing, comment, now)
	_, err := tx.NewInsert().Model(&item).
		On("CONFLICT (social_account_id, remote_id) DO UPDATE").
		Set("parent_remote_id = EXCLUDED.parent_remote_id").
		Set("conversation_remote_id = EXCLUDED.conversation_remote_id").
		Set("author_remote_id = EXCLUDED.author_remote_id").
		Set("author_name = EXCLUDED.author_name").
		Set("author_handle = EXCLUDED.author_handle").
		Set("author_avatar_url = EXCLUDED.author_avatar_url").
		Set("body = EXCLUDED.body").
		Set("attachments_json = EXCLUDED.attachments_json").
		Set("is_ours = EXCLUDED.is_ours").
		Set("can_reply = EXCLUDED.can_reply").
		Set("can_hide = EXCLUDED.can_hide").
		Set("can_delete = EXCLUDED.can_delete").
		Set("can_like = EXCLUDED.can_like").
		Set("can_unlike = EXCLUDED.can_unlike").
		Set("liked = EXCLUDED.liked").
		Set("hidden = EXCLUDED.hidden").
		Set("edited_at = EXCLUDED.edited_at").
		Set("deleted_at = EXCLUDED.deleted_at").
		Set("remote_created_at = EXCLUDED.remote_created_at").
		Set("last_seen_at = EXCLUDED.last_seen_at").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return item, !exists && !comment.IsOurs, err
}

func engagementItemFromComment(
	rendition models.Rendition,
	account models.SocialAccount,
	existing models.EngagementItem,
	comment platform.Comment,
	now time.Time,
) models.EngagementItem {
	attachments, safeAttachments := sanitizeCommentAttachments(comment.Attachments)
	body := boundedText(comment.Text, 10000)
	if comment.Deleted {
		body = ""
		attachments = "[]"
		safeAttachments = nil
		comment.AuthorID = ""
		comment.AuthorName = ""
		comment.AuthorHandle = ""
		comment.AuthorAvatarURL = ""
		comment.CanReply = false
		comment.CanHide = false
		comment.CanDelete = false
		comment.CanLike = false
		comment.CanUnlike = false
	}
	itemID := existing.ID
	if itemID == "" {
		itemID = uuid.NewString()
	}
	liked := comment.Liked
	canLike := comment.CanLike
	canUnlike := comment.CanUnlike
	if !comment.LikeStateKnown {
		if existing.ID != "" {
			liked = existing.Liked
		}
		canLike = comment.CanLike && !liked
		canUnlike = comment.CanUnlike && liked
	}
	return models.EngagementItem{
		ID:                   itemID,
		WorkspaceID:          account.WorkspaceID,
		RenditionID:          rendition.ID,
		SocialAccountID:      account.ID,
		Platform:             account.Platform,
		RemoteID:             boundedText(comment.ID, 512),
		ParentRemoteID:       boundedText(comment.ParentID, 512),
		ConversationRemoteID: boundedText(comment.ConversationID, 512),
		AuthorRemoteID:       boundedText(comment.AuthorID, 512),
		AuthorName:           boundedText(comment.AuthorName, 200),
		AuthorHandle:         boundedText(comment.AuthorHandle, 200),
		AuthorAvatarURL:      safeExternalURL(comment.AuthorAvatarURL),
		Body:                 body,
		AttachmentsJSON:      attachments,
		IsOurs:               comment.IsOurs,
		CanReply:             comment.CanReply,
		CanHide:              comment.CanHide,
		CanDelete:            comment.CanDelete,
		CanLike:              canLike,
		CanUnlike:            canUnlike,
		Liked:                liked,
		Hidden:               comment.Hidden,
		ReadAt:               existing.ReadAt,
		ArchivedAt:           existing.ArchivedAt,
		EditedAt:             engagementEditedAt(existing, comment, attachments, now),
		DeletedAt:            engagementDeletedAt(existing, comment, now),
		RemoteCreatedAt:      firstNonZeroTime(parseProviderTime(comment.CreatedAt), existing.RemoteCreatedAt),
		LastSeenAt:           now,
		CreatedAt:            firstNonZeroTime(existing.CreatedAt, now),
		UpdatedAt:            now,
		Attachments:          safeAttachments,
	}
}

func engagementEditedAt(existing models.EngagementItem, comment platform.Comment, attachments string, now time.Time) time.Time {
	remoteUpdatedAt := parseProviderTime(comment.UpdatedAt)
	if !remoteUpdatedAt.IsZero() && remoteUpdatedAt.After(parseProviderTime(comment.CreatedAt)) {
		return remoteUpdatedAt
	}
	if existing.ID != "" &&
		(existing.Body != boundedText(comment.Text, 10000) || existing.AttachmentsJSON != attachments) {
		return now
	}
	return existing.EditedAt
}

func engagementDeletedAt(existing models.EngagementItem, comment platform.Comment, now time.Time) time.Time {
	if comment.Deleted && existing.DeletedAt.IsZero() {
		return now
	}
	return existing.DeletedAt
}

func (s *Service) notifyNewEngagement(
	ctx context.Context,
	db bun.IDB,
	publication models.Publication,
	rendition models.Rendition,
	account models.SocialAccount,
	item models.EngagementItem,
) error {
	if s.notifications == nil || publication.CreatedByID == "" {
		return nil
	}
	outcome, err := notifications.NewEngagementReceivedOutcome(notifications.EngagementReceivedFacts{
		RecipientUserID: publication.CreatedByID, WorkspaceID: account.WorkspaceID,
		EngagementID: item.ID, PublicationID: publication.ID, RenditionID: rendition.ID,
		Provider: account.Platform, AuthorName: firstNonEmpty(item.AuthorName, item.AuthorHandle),
	})
	if err != nil {
		return err
	}
	return s.notifications.RecordWithDB(ctx, db, outcome)
}

func (s *Service) resolveAndStoreContentURL(
	ctx context.Context,
	commenter platform.CommentAdapter,
	accessToken string,
	account models.SocialAccount,
	rendition *models.Rendition,
) {
	if isSafeProviderPostURL(rendition.ExternalURL) {
		return
	}
	resolver, ok := commenter.(platform.ContentURLResolver)
	if !ok {
		return
	}
	resolved, err := resolver.ResolveContentURL(ctx, accessToken, account.AccountID, rendition.ExternalID)
	if err != nil || !isSafeProviderPostURL(resolved) {
		return
	}
	if _, err := s.db.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("external_url = ?", resolved).
		Where("id = ?", rendition.ID).
		Exec(ctx); err == nil {
		rendition.ExternalURL = resolved
	}
}

func (s *Service) QueueEngagementAction(ctx context.Context, actor Actor, itemID, action, message string) error {
	var item models.EngagementItem
	if err := s.db.NewSelect().Model(&item).Where("id = ?", itemID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := s.authorize(ctx, item.WorkspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return err
	}
	if !s.isEngagementEnabled(ctx, item.SocialAccountID) {
		return fmt.Errorf("engagement is disabled for this account")
	}
	message, err := validateEngagementAction(item, action, message)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(engagementActionJob{ItemID: itemID, Action: action, Message: message, UserID: actor.UserID})
	_, err = s.enqueue(ctx, item.WorkspaceID, JobTypeEngagementAct, string(payload), s.now())
	return err
}

func validateEngagementAction(item models.EngagementItem, action, message string) (string, error) {
	message = strings.TrimSpace(message)
	switch action {
	case "reply":
		if !item.CanReply {
			return "", fmt.Errorf("this provider does not allow a reply to this item")
		}
		if message == "" {
			return "", fmt.Errorf("reply message is required")
		}
	case "hide":
		if !item.CanHide {
			return "", fmt.Errorf("this provider does not allow this item to be hidden")
		}
	case "delete":
		if !item.CanDelete {
			return "", fmt.Errorf("this item cannot be deleted by the connected account")
		}
	case "like":
		if !item.CanLike || item.Liked {
			return "", fmt.Errorf("this provider does not allow this item to be liked")
		}
	case "unlike":
		if !item.CanUnlike || !item.Liked {
			return "", fmt.Errorf("this provider does not allow this item's like to be removed")
		}
	default:
		return "", fmt.Errorf("unsupported engagement action %q", action)
	}
	return message, nil
}

// QueueProviderCommentAction moves the publication comment endpoints onto the
// same durable, one-attempt provider-write path as stored Engagement actions.
// The opaque provider comment ID and reply body stay in the application job
// payload; provider_write_attempts stores only their digest.
//
//nolint:gocyclo // Validation and the fenced ownership query intentionally stay at this transport-independent boundary.
func QueueProviderCommentAction(ctx context.Context, db *bun.DB, gate FeatureGate, input ProviderCommentActionInput) (string, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.SocialAccountID = strings.TrimSpace(input.SocialAccountID)
	input.ProviderCommentID = strings.TrimSpace(input.ProviderCommentID)
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.Message = strings.TrimSpace(input.Message)
	input.Actor.UserID = strings.TrimSpace(input.Actor.UserID)
	if input.WorkspaceID == "" || input.PublicationID == "" || input.RenditionID == "" ||
		input.SocialAccountID == "" || input.ProviderCommentID == "" || input.Actor.UserID == "" {
		return "", fmt.Errorf("provider comment action ownership is required")
	}
	if gate == nil {
		return "", fmt.Errorf("engagement is disabled for this account")
	}
	enabled, err := gate.IsEffectiveEnabled(ctx, input.SocialAccountID, "engagement")
	if err != nil || !enabled {
		return "", fmt.Errorf("engagement is disabled for this account")
	}
	switch input.Action {
	case "reply":
		if input.Message == "" {
			return "", fmt.Errorf("reply message is required")
		}
	case "hide", "delete":
		if input.Message != "" {
			return "", fmt.Errorf("%s comment action cannot include a message", input.Action)
		}
	default:
		return "", fmt.Errorf("unsupported provider comment action %q", input.Action)
	}
	jobID := uuid.NewString()
	payload, err := json.Marshal(engagementActionJob{
		JobID: jobID, WorkspaceID: input.WorkspaceID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, SocialAccountID: input.SocialAccountID,
		ProviderCommentID: input.ProviderCommentID, Action: input.Action,
		Message: input.Message, UserID: input.Actor.UserID,
	})
	if err != nil {
		return "", fmt.Errorf("encode provider comment action: %w", err)
	}
	if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(txCtx, tx, input.WorkspaceID); err != nil {
			return err
		}
		decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(txCtx, input.WorkspaceID, input.Actor, workspaceaccess.LevelEdit)
		if err != nil {
			return fmt.Errorf("authorize provider comment action: %w", err)
		}
		if !decision.Allowed {
			return ErrAccessDenied
		}
		var ownerCount int
		if err := tx.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("renditions AS rendition").
			Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
			Join("JOIN social_accounts AS account ON account.id = rendition.social_account_id").
			Where("publication.id = ? AND publication.workspace_id = ?", input.PublicationID, input.WorkspaceID).
			Where("rendition.id = ? AND rendition.social_account_id = ?", input.RenditionID, input.SocialAccountID).
			Where("account.workspace_id = publication.workspace_id AND account.is_active = ?", true).
			Scan(txCtx, &ownerCount); err != nil {
			return fmt.Errorf("validate provider comment action owner: %w", err)
		}
		if ownerCount != 1 {
			return fmt.Errorf("provider comment action target does not belong to the publication workspace")
		}
		return enqueueProviderCommentJob(txCtx, tx, jobID, string(payload))
	}); err != nil {
		return "", fmt.Errorf("queue provider comment action: %w", err)
	}
	return jobID, nil
}

func enqueueProviderCommentJob(ctx context.Context, db bun.IDB, jobID, payload string) error {
	job, err := jobregistry.NewJob(JobTypeEngagementAct, payload, time.Now().UTC())
	if err != nil {
		return err
	}
	job.ID = jobID
	_, err = db.NewInsert().Model(job).Exec(ctx)
	return err
}

func (s *Service) performEngagementAction(ctx context.Context, input engagementActionJob) error {
	if input.ProviderCommentID != "" || input.RenditionID != "" || input.JobID != "" {
		return s.performProviderCommentAction(ctx, input)
	}
	var item models.EngagementItem
	if err := s.db.NewSelect().Model(&item).Where("id = ?", input.ItemID).Scan(ctx); err != nil {
		return err
	}
	if !s.isEngagementEnabled(ctx, item.SocialAccountID) {
		return fmt.Errorf("engagement is disabled for this account")
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", item.SocialAccountID).Scan(ctx); err != nil {
		return err
	}
	commenter, ok := s.adapter(account).(platform.CommentAdapter)
	if !ok {
		return fmt.Errorf("engagement actions are unsupported")
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return err
	}
	err = s.executeEngagementAction(ctx, commenter, token, account, &item, input)
	if err != nil {
		_ = s.notifyReplyFailed(ctx, input.UserID, item, account, input)
	}
	return err
}

func (s *Service) notifyReplyFailed(ctx context.Context, userID string, item models.EngagementItem, account models.SocialAccount, input engagementActionJob) error {
	if s.notifications == nil || strings.TrimSpace(userID) == "" {
		return nil
	}
	outcome, err := notifications.NewReplyFailedOutcome(notifications.ReplyFailedFacts{
		RecipientUserID: userID, WorkspaceID: item.WorkspaceID, EngagementID: item.ID,
		AttemptID: firstNonEmpty(input.JobID, item.ID+":"+input.Action), Provider: account.Platform,
	})
	if err != nil {
		return err
	}
	return s.notifications.Record(ctx, outcome)
}

func (s *Service) executeEngagementAction(
	ctx context.Context,
	commenter platform.CommentAdapter,
	token string,
	account models.SocialAccount,
	item *models.EngagementItem,
	input engagementActionJob,
) error {
	// Preserve the historical namespace so accepted writes fenced before the
	// module extraction remain idempotent after deployment.
	fingerprint, err := providerwrite.Fingerprint("engagement-action-v1", map[string]string{
		"item_id": item.ID, "remote_id": item.RemoteID, "action": input.Action, "message": input.Message,
	})
	if err != nil {
		return err
	}
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	operationOwner := execution.ID
	if operationOwner == "" {
		operationOwner = item.ID + ":" + input.Action
	}
	_, err = providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: "engagement:" + operationOwner,
		JobID:       execution.ID, WorkspaceID: item.WorkspaceID,
		SocialAccountID: account.ID, TargetKey: engagementProviderKey(account),
		Provider: account.Platform, Operation: "engagement_" + input.Action,
		PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		if err := control.Begin(platform.PublishResult{
			ProviderState: "engagement_" + input.Action,
			RetrySafety:   platform.PublishRetryNever,
		}); err != nil {
			return platform.PublishResult{}, err
		}
		return sendEngagementAction(sendCtx, commenter, token, account, item, input)
	}, nil)
	if err != nil {
		return err
	}
	switch input.Action {
	case "reply":
		return nil
	case "hide":
		_, err = s.db.NewUpdate().Model(item).Set("hidden = ?", true).WherePK().Exec(ctx)
		return err
	case "delete":
		return s.markEngagementItemDeleted(ctx, item)
	case "like", "unlike":
		liked := input.Action == "like"
		_, err = s.db.NewUpdate().Model(item).
			Set("liked = ?", liked).
			Set("can_like = ?", !liked).
			Set("can_unlike = ?", liked).
			Set("updated_at = ?", s.now()).
			WherePK().Exec(ctx)
		return err
	default:
		return fmt.Errorf("unsupported engagement action %q", input.Action)
	}
}

func sendEngagementAction(
	ctx context.Context,
	commenter platform.CommentAdapter,
	token string,
	account models.SocialAccount,
	item *models.EngagementItem,
	input engagementActionJob,
) (platform.PublishResult, error) {
	switch input.Action {
	case "reply":
		if strings.TrimSpace(input.Message) == "" {
			return platform.PublishResult{}, fmt.Errorf("reply message is required")
		}
		externalID, err := commenter.ReplyToComment(ctx, token, account.AccountID, item.RemoteID, input.Message)
		if err != nil {
			return platform.PublishResult{}, err
		}
		return platform.AcceptedPublishResult(externalID), nil
	case "hide":
		if err := commenter.HideComment(ctx, token, account.AccountID, item.RemoteID); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.AcceptedPublishResult(""), nil
	case "delete":
		if err := commenter.DeleteComment(ctx, token, account.AccountID, item.RemoteID); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.AcceptedPublishResult(""), nil
	case "like", "unlike":
		reactions, supported := commenter.(platform.CommentReactionAdapter)
		if !supported {
			return platform.PublishResult{}, fmt.Errorf("reactions are unsupported")
		}
		var err error
		if input.Action == "like" {
			err = reactions.LikeComment(ctx, token, account.AccountID, item.RemoteID)
		} else {
			err = reactions.UnlikeComment(ctx, token, account.AccountID, item.RemoteID)
		}
		if err != nil {
			return platform.PublishResult{}, err
		}
		return platform.AcceptedPublishResult(""), nil
	default:
		return platform.PublishResult{}, fmt.Errorf("unsupported engagement action %q", input.Action)
	}
}

func (s *Service) performProviderCommentAction(ctx context.Context, input engagementActionJob) error {
	input, err := normalizeProviderCommentActionJob(input)
	if err != nil {
		return err
	}
	if !s.isEngagementEnabled(ctx, input.SocialAccountID) {
		return fmt.Errorf("engagement is disabled for this account")
	}
	execution, hasExecution := providerwrite.JobExecutionFromContext(ctx)
	if hasExecution && execution.ID != input.JobID {
		return fmt.Errorf("provider comment action job identity changed")
	}
	account, err := s.loadProviderCommentActionAccount(ctx, input)
	if err != nil {
		return err
	}
	commenter, ok := s.adapter(account).(platform.CommentAdapter)
	if !ok || commenter == nil {
		return fmt.Errorf("provider comment actions are unsupported")
	}
	if s.tokenSource == nil {
		return fmt.Errorf("provider comment token source is unavailable")
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("load provider comment token: %w", err)
	}
	result, writeErr := s.executeProviderCommentWrite(ctx, input, account, commenter, token)
	return s.finishProviderCommentAction(ctx, input, account.Platform, result, writeErr)
}

func normalizeProviderCommentActionJob(input engagementActionJob) (engagementActionJob, error) {
	input.JobID = strings.TrimSpace(input.JobID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.SocialAccountID = strings.TrimSpace(input.SocialAccountID)
	input.ProviderCommentID = strings.TrimSpace(input.ProviderCommentID)
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.Message = strings.TrimSpace(input.Message)
	if input.JobID == "" || input.WorkspaceID == "" || input.PublicationID == "" ||
		input.RenditionID == "" || input.SocialAccountID == "" || input.ProviderCommentID == "" {
		return engagementActionJob{}, fmt.Errorf("provider comment action job is incomplete")
	}
	switch input.Action {
	case "reply":
		if input.Message == "" {
			return engagementActionJob{}, fmt.Errorf("provider comment reply message is required")
		}
	case "hide", "delete":
		if input.Message != "" {
			return engagementActionJob{}, fmt.Errorf("provider comment %s action cannot include a message", input.Action)
		}
	default:
		return engagementActionJob{}, fmt.Errorf("unsupported provider comment action %q", input.Action)
	}
	return input, nil
}

func (s *Service) loadProviderCommentActionAccount(ctx context.Context, input engagementActionJob) (models.SocialAccount, error) {
	var rendition models.Rendition
	if err := s.db.NewSelect().Model(&rendition).
		Where("id = ? AND publication_id = ? AND social_account_id = ?", input.RenditionID, input.PublicationID, input.SocialAccountID).
		Scan(ctx); err != nil {
		return models.SocialAccount{}, fmt.Errorf("load provider comment rendition: %w", err)
	}
	var publication models.Publication
	if err := s.db.NewSelect().Model(&publication).
		Where("id = ? AND workspace_id = ?", input.PublicationID, input.WorkspaceID).
		Scan(ctx); err != nil {
		return models.SocialAccount{}, fmt.Errorf("load provider comment publication: %w", err)
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", input.SocialAccountID, input.WorkspaceID, true).
		Scan(ctx); err != nil {
		return models.SocialAccount{}, fmt.Errorf("load provider comment account: %w", err)
	}
	return account, nil
}

func (s *Service) finishProviderCommentAction(
	ctx context.Context,
	input engagementActionJob,
	provider string,
	result platform.PublishResult,
	writeErr error,
) error {
	if writeErr != nil {
		s.recordProviderCommentLifecycle(ctx, input, lifecycle.EventModerationActionFailed, lifecycle.StatusFailed, "comment "+input.Action+" failed", map[string]any{
			"action": input.Action, "provider_comment_id": input.ProviderCommentID,
			"error_class": providerCommentErrorClass(writeErr),
		})
		if s.notifications != nil && input.UserID != "" {
			outcome, outcomeErr := notifications.NewReplyFailedOutcome(notifications.ReplyFailedFacts{
				RecipientUserID: input.UserID, WorkspaceID: input.WorkspaceID,
				EngagementID: input.ProviderCommentID, AttemptID: input.JobID, Provider: provider,
			})
			if outcomeErr == nil {
				_ = s.notifications.Record(ctx, outcome)
			}
		}
		return writeErr
	}
	message := "comment " + input.Action + " completed"
	switch input.Action {
	case "reply":
		message = "comment reply sent"
	case "hide":
		message = "comment hidden"
	case "delete":
		message = "comment deleted"
	}
	metadata := map[string]any{
		"action": input.Action, "provider_comment_id": input.ProviderCommentID,
	}
	if result.ExternalID != "" {
		metadata["reply_id"] = result.ExternalID
	}
	s.recordProviderCommentLifecycle(ctx, input, lifecycle.EventCommentActionSucceeded, lifecycle.StatusSucceeded, message, metadata)
	return nil
}

func (s *Service) executeProviderCommentWrite(
	ctx context.Context,
	input engagementActionJob,
	account models.SocialAccount,
	commenter platform.CommentAdapter,
	token string,
) (platform.PublishResult, error) {
	fingerprint, err := providerwrite.Fingerprint("provider-comment-action-v1", map[string]string{
		"workspace_id": input.WorkspaceID, "publication_id": input.PublicationID,
		"rendition_id": input.RenditionID, "social_account_id": input.SocialAccountID,
		"provider_comment_id": input.ProviderCommentID, "action": input.Action,
		"message": input.Message,
	})
	if err != nil {
		return platform.PublishResult{}, err
	}
	return providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: "provider-comment:" + input.JobID, JobID: input.JobID,
		WorkspaceID: input.WorkspaceID, SocialAccountID: account.ID,
		TargetKey: engagementProviderKey(account), Provider: account.Platform,
		Operation: "comment_" + input.Action, PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		if beginErr := control.Begin(platform.PublishResult{
			ProviderState: "comment_" + input.Action, RetrySafety: platform.PublishRetryNever,
		}); beginErr != nil {
			return platform.PublishResult{}, beginErr
		}
		switch input.Action {
		case "reply":
			replyID, replyErr := commenter.ReplyToComment(sendCtx, token, account.AccountID, input.ProviderCommentID, input.Message)
			if replyErr != nil {
				return platform.PublishResult{}, replyErr
			}
			return platform.AcceptedPublishResult(replyID), nil
		case "hide":
			if hideErr := commenter.HideComment(sendCtx, token, account.AccountID, input.ProviderCommentID); hideErr != nil {
				return platform.PublishResult{}, hideErr
			}
			return platform.AcceptedPublishResult(""), nil
		case "delete":
			if deleteErr := commenter.DeleteComment(sendCtx, token, account.AccountID, input.ProviderCommentID); deleteErr != nil {
				return platform.PublishResult{}, deleteErr
			}
			return platform.AcceptedPublishResult(""), nil
		default:
			return platform.PublishResult{}, fmt.Errorf("unsupported provider comment action %q", input.Action)
		}
	}, nil)
}

func (s *Service) recordProviderCommentLifecycle(
	ctx context.Context,
	input engagementActionJob,
	eventType, status, message string,
	metadata map[string]any,
) {
	metadata["job_id"] = input.JobID
	_, _ = lifecycle.NewService(s.db).Record(ctx, lifecycle.EventInput{
		WorkspaceID: input.WorkspaceID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, Type: eventType, Status: status,
		Message: message, Metadata: metadata,
		IdempotencyKey: "provider-comment:" + input.JobID + ":" + status,
	})
}

func providerCommentErrorClass(err error) string {
	if providerwrite.IsAmbiguous(err) {
		return "ambiguous_provider_write"
	}
	if _, pending := providerwrite.IsPending(err); pending {
		return "provider_processing"
	}
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) {
		if providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 {
			return "provider_rejected"
		}
		return "provider_unavailable"
	}
	return "provider_write_failed"
}

func (s *Service) markEngagementItemDeleted(
	ctx context.Context,
	item *models.EngagementItem,
) error {
	now := s.now()
	_, err := s.db.NewUpdate().Model(item).
		Set("body = ''").
		Set("attachments_json = '[]'").
		Set("author_remote_id = ''").
		Set("author_name = ''").
		Set("author_handle = ''").
		Set("author_avatar_url = ''").
		Set("deleted_at = ?", now).
		Set("can_reply = ?", false).
		Set("can_hide = ?", false).
		Set("can_delete = ?", false).
		Set("can_like = ?", false).
		Set("can_unlike = ?", false).
		Set("updated_at = ?", now).
		WherePK().Exec(ctx)
	return err
}

type Cursor struct {
	OccurredAt time.Time
	CreatedAt  time.Time
	ID         string
}

type Query struct {
	WorkspaceID   string
	Platform      string
	AccountID     string
	PublicationID string
	UnreadOnly    bool
	Archived      bool
	Limit         int
	Offset        int
	Cursor        *Cursor
}

type Page struct {
	Items      []models.EngagementItem
	Total      int
	NextCursor *Cursor
}

const engagementOccurredAtSQL = "COALESCE(remote_created_at, created_at)"

func (s *Service) ListEngagement(ctx context.Context, actor Actor, input Query) (Page, error) {
	if err := s.authorize(ctx, input.WorkspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return Page{}, err
	}
	return s.listEngagement(ctx, input)
}

func (s *Service) listEngagement(ctx context.Context, input Query) (Page, error) {
	if input.Limit <= 0 || input.Limit > 100 {
		input.Limit = 50
	}
	query := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Where("workspace_id = ?", input.WorkspaceID)
	query = engagementFilters(query, input.Platform, input.AccountID, input.PublicationID, input.UnreadOnly, input.Archived)
	count, err := query.Count(ctx)
	if err != nil {
		return Page{}, err
	}
	var items []models.EngagementItem
	query = s.db.NewSelect().Model(&items).Where("workspace_id = ?", input.WorkspaceID)
	query = engagementFilters(query, input.Platform, input.AccountID, input.PublicationID, input.UnreadOnly, input.Archived)
	if input.Cursor != nil {
		query = query.Where(
			"("+engagementOccurredAtSQL+" < ? OR ("+engagementOccurredAtSQL+" = ? AND (created_at < ? OR (created_at = ? AND id < ?))))",
			input.Cursor.OccurredAt, input.Cursor.OccurredAt, input.Cursor.CreatedAt, input.Cursor.CreatedAt, input.Cursor.ID,
		)
	}
	query = query.OrderExpr(engagementOccurredAtSQL+" DESC").Order("created_at DESC", "id DESC")
	if input.Cursor == nil {
		query = query.Offset(max(0, input.Offset))
	}
	err = query.Limit(input.Limit + 1).Scan(ctx)
	if err != nil {
		return Page{}, err
	}
	hasMore := len(items) > input.Limit
	if hasMore {
		items = items[:input.Limit]
	}
	if err := s.hydrateEngagementProviderURLs(ctx, items); err != nil {
		return Page{}, err
	}
	page := Page{Items: items, Total: count}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		occurredAt := last.RemoteCreatedAt
		if occurredAt.IsZero() {
			occurredAt = last.CreatedAt
		}
		page.NextCursor = &Cursor{OccurredAt: occurredAt, CreatedAt: last.CreatedAt, ID: last.ID}
	}
	return page, nil
}

func (s *Service) hydrateEngagementProviderURLs(ctx context.Context, items []models.EngagementItem) error {
	if len(items) == 0 {
		return nil
	}
	hydration, err := s.loadEngagementHydrationContext(ctx, items)
	if err != nil {
		return err
	}
	for index := range items {
		rendition, renditionOK := hydration.renditions[items[index].RenditionID]
		account, accountOK := hydration.accounts[items[index].SocialAccountID]
		if renditionOK && accountOK {
			items[index].ProviderPostURL = providerPostURL(rendition, account)
			items[index].AccountUsername = account.AccountUsername
			publication := hydration.publications[rendition.PublicationID]
			items[index].PublicationID = publication.ID
			items[index].PublicationTitle = boundedText(publication.Title, 200)
			items[index].PublicationExcerpt = boundedText(publication.SourceText, 280)
		}
		if json.Unmarshal([]byte(items[index].AttachmentsJSON), &items[index].Attachments) != nil {
			items[index].Attachments = []models.EngagementAttachment{}
		}
	}
	return nil
}

type engagementHydrationContext struct {
	renditions   map[string]models.Rendition
	accounts     map[string]models.SocialAccount
	publications map[string]models.Publication
}

func (s *Service) loadEngagementHydrationContext(
	ctx context.Context,
	items []models.EngagementItem,
) (engagementHydrationContext, error) {
	renditionIDs := make([]string, 0, len(items))
	accountIDs := make([]string, 0, len(items))
	for _, item := range items {
		renditionIDs = append(renditionIDs, item.RenditionID)
		accountIDs = append(accountIDs, item.SocialAccountID)
	}
	var renditions []models.Rendition
	if err := s.db.NewSelect().Model(&renditions).Where("id IN (?)", bun.List(renditionIDs)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return engagementHydrationContext{}, fmt.Errorf("load engagement renditions: %w", err)
	}
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("id IN (?)", bun.List(accountIDs)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return engagementHydrationContext{}, fmt.Errorf("load engagement accounts: %w", err)
	}
	renditionByID := make(map[string]models.Rendition, len(renditions))
	publicationIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		renditionByID[rendition.ID] = rendition
		publicationIDs = append(publicationIDs, rendition.PublicationID)
	}
	var publications []models.Publication
	if len(publicationIDs) > 0 {
		if err := s.db.NewSelect().Model(&publications).Where("id IN (?)", bun.List(publicationIDs)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return engagementHydrationContext{}, fmt.Errorf("load engagement publications: %w", err)
		}
	}
	publicationByID := make(map[string]models.Publication, len(publications))
	for _, publication := range publications {
		publicationByID[publication.ID] = publication
	}
	accountByID := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		accountByID[account.ID] = account
	}
	return engagementHydrationContext{
		renditions:   renditionByID,
		accounts:     accountByID,
		publications: publicationByID,
	}, nil
}

func providerPostURL(rendition models.Rendition, account models.SocialAccount) string {
	if isSafeProviderPostURL(rendition.ExternalURL) {
		return rendition.ExternalURL
	}
	externalID := strings.TrimSpace(rendition.ExternalID)
	if externalID == "" {
		return ""
	}
	username := strings.TrimPrefix(strings.TrimSpace(account.AccountUsername), "@")
	switch rendition.Platform {
	case "x":
		return xPostURL(username, externalID)
	case "mastodon":
		return mastodonPostURL(account.InstanceURL, username, externalID)
	case "bluesky":
		return blueskyPostURL(externalID)
	case "linkedin":
		return linkedinPostURL(externalID)
	case "facebook":
		return "https://www.facebook.com/" + url.PathEscape(externalID)
	case "youtube":
		return "https://www.youtube.com/watch?v=" + url.QueryEscape(externalID)
	}
	return ""
}

func xPostURL(username, externalID string) string {
	if username == "" {
		return ""
	}
	return "https://x.com/" + url.PathEscape(username) + "/status/" + url.PathEscape(externalID)
}

func mastodonPostURL(instanceURL, username, externalID string) string {
	instanceURL = strings.TrimRight(strings.TrimSpace(instanceURL), "/")
	if at := strings.Index(username, "@"); at >= 0 {
		username = username[:at]
	}
	if !strings.HasPrefix(instanceURL, "https://") || username == "" {
		return ""
	}
	return instanceURL + "/@" + url.PathEscape(username) + "/" + url.PathEscape(externalID)
}

func blueskyPostURL(externalID string) string {
	uri := blueskyPostURI(externalID)
	if uri == "" {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(uri, "at://"), "/")
	if len(parts) < 3 || parts[0] == "" || parts[2] == "" {
		return ""
	}
	return "https://bsky.app/profile/" + url.PathEscape(parts[0]) + "/post/" + url.PathEscape(parts[2])
}

func linkedinPostURL(externalID string) string {
	if !strings.HasPrefix(externalID, "urn:li:") {
		return ""
	}
	return "https://www.linkedin.com/feed/update/" + externalID + "/"
}

// resolveRenditionAccount preserves comment collection for renditions created
// before an OAuth reconnect. Current reconnects reuse the provider identity,
// while older databases can contain an inactive row and a newer active row for
// the same remote account.
func (s *Service) resolveRenditionAccount(ctx context.Context, accountID string) (models.SocialAccount, error) {
	var original models.SocialAccount
	if err := s.db.NewSelect().Model(&original).Where("id = ?", accountID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.SocialAccount{}, nil
		}
		return models.SocialAccount{}, fmt.Errorf("load rendition account: %w", err)
	}
	if original.IsActive {
		return original, nil
	}

	query := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", original.WorkspaceID).
		Where("platform = ?", original.Platform).
		Where("account_id = ?", original.AccountID).
		Where("is_active = ?", true).
		Order("created_at DESC").
		Limit(1)
	if original.Platform == "mastodon" {
		query = query.Where("instance_url = ?", original.InstanceURL)
	}
	var replacement models.SocialAccount
	if err := query.Scan(ctx, &replacement); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.SocialAccount{}, nil
		}
		return models.SocialAccount{}, fmt.Errorf("load replacement rendition account: %w", err)
	}
	return replacement, nil
}

func blueskyPostURI(externalID string) string {
	if strings.HasPrefix(externalID, "at://") {
		return externalID
	}
	var payload struct {
		URI string `json:"uri"`
	}
	if json.Unmarshal([]byte(externalID), &payload) == nil {
		return strings.TrimSpace(payload.URI)
	}
	return ""
}

func isSafeProviderPostURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

func engagementFilters(query *bun.SelectQuery, platformName, accountID, publicationID string, unreadOnly, archived bool) *bun.SelectQuery {
	query = query.Where("is_ours = ?", false)
	if platformName != "" {
		query = query.Where("platform = ?", platformName)
	}
	if accountID != "" {
		query = query.Where("social_account_id = ?", accountID)
	}
	if publicationID != "" {
		query = query.Where("rendition_id IN (SELECT id FROM renditions WHERE publication_id = ?)", publicationID)
	}
	if unreadOnly {
		query = query.Where("read_at IS NULL")
	}
	if archived {
		query = query.Where("archived_at IS NOT NULL")
	} else {
		query = query.Where("archived_at IS NULL")
	}
	return query
}

func (s *Service) ListEngagementSyncStates(ctx context.Context, actor Actor, workspaceID string) ([]models.EngagementSyncState, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	var states []models.EngagementSyncState
	err := s.db.NewSelect().Model(&states).
		Where("workspace_id = ?", workspaceID).
		Order("platform ASC", "social_account_id ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return states, nil
	}
	return states, err
}

func (s *Service) SetEngagementState(ctx context.Context, actor Actor, workspaceID string, ids []string, read, archived *bool) error {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	query := s.db.NewUpdate().Model((*models.EngagementItem)(nil)).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(ids))
	if read != nil {
		if *read {
			query = query.Set("read_at = ?", s.now())
		} else {
			query = query.Set("read_at = NULL")
		}
	}
	if archived != nil {
		if *archived {
			query = query.Set("archived_at = ?", s.now())
		} else {
			query = query.Set("archived_at = NULL")
		}
	}
	_, err := query.Exec(ctx)
	return err
}

func (s *Service) adapter(account models.SocialAccount) platform.EngagementAdapter {
	key := engagementProviderKey(account)
	s.providersMu.RLock()
	defer s.providersMu.RUnlock()
	return s.providers[key]
}

func engagementProviderKey(account models.SocialAccount) string {
	if account.Platform == "mastodon" || account.Platform == "bluesky" {
		return platform.AccountProviderKey(account.Platform, account.InstanceURL, "")
	}
	return account.Platform
}

func xBudgetWindow(now time.Time) (time.Time, time.Time) {
	now = now.UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return start, start.Add(24 * time.Hour)
}

func (s *Service) xReadAvailable(ctx context.Context, account models.SocialAccount, now time.Time) (bool, time.Time, error) {
	if s.xDailyReadBudget <= 0 {
		_, next := xBudgetWindow(now)
		return false, next, nil
	}
	var budget models.XEngagementReadBudget
	err := s.db.NewSelect().Model(&budget).Where("social_account_id = ?", account.ID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return true, time.Time{}, nil
	}
	if err != nil {
		return false, time.Time{}, fmt.Errorf("load X engagement read budget: %w", err)
	}
	start, next := xBudgetWindow(now)
	if budget.BlockedUntil.After(now) {
		return false, budget.BlockedUntil, nil
	}
	if !budget.WindowStart.Equal(start) || budget.AttemptsUsed < s.xDailyReadBudget {
		return true, time.Time{}, nil
	}
	return false, next, nil
}

func (s *Service) reserveXReadAttempt(ctx context.Context, account models.SocialAccount, now time.Time) (bool, time.Time, error) {
	available, next, err := s.xReadAvailable(ctx, account, now)
	if err != nil || !available {
		return available, next, err
	}
	start, nextWindow := xBudgetWindow(now)
	result, err := s.db.ExecContext(ctx, `
INSERT INTO x_engagement_read_budgets (
  social_account_id, workspace_id, window_start, attempts_used,
  blocked_until, block_code, created_at, updated_at
) VALUES (?, ?, ?, 1, NULL, '', ?, ?)
ON CONFLICT (social_account_id) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  window_start = excluded.window_start,
  attempts_used = CASE
    WHEN x_engagement_read_budgets.window_start = excluded.window_start
      THEN x_engagement_read_budgets.attempts_used + 1
    ELSE 1
  END,
  blocked_until = NULL,
  block_code = '',
  updated_at = excluded.updated_at
WHERE (x_engagement_read_budgets.blocked_until IS NULL OR x_engagement_read_budgets.blocked_until <= excluded.updated_at)
  AND (x_engagement_read_budgets.window_start <> excluded.window_start OR x_engagement_read_budgets.attempts_used < ?)
`, account.ID, account.WorkspaceID, start, now, now, s.xDailyReadBudget)
	if err != nil {
		return false, time.Time{}, fmt.Errorf("reserve X engagement read budget: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, time.Time{}, fmt.Errorf("read X engagement budget reservation: %w", err)
	}
	if rows == 0 {
		available, next, loadErr := s.xReadAvailable(ctx, account, now)
		if loadErr != nil {
			return false, time.Time{}, loadErr
		}
		if available {
			next = nextWindow
		}
		return false, next, nil
	}
	return true, time.Time{}, nil
}

func (s *Service) blockXReadsForError(ctx context.Context, account models.SocialAccount, err error, fallback time.Duration) error {
	var providerErr *platform.HTTPError
	if !errors.As(err, &providerErr) || (providerErr.StatusCode != 429 && providerErr.StatusCode != 402) {
		return nil
	}
	delay := providerErr.RetryAfter
	if delay <= 0 {
		delay = fallback
	}
	if delay <= 0 {
		delay = time.Hour
	}
	now := s.now()
	blockedUntil := now.Add(delay)
	code := firstNonEmpty(providerErr.Code, "rate_limited")
	result, updateErr := s.db.NewUpdate().Model((*models.XEngagementReadBudget)(nil)).
		Set("blocked_until = ?", blockedUntil).
		Set("block_code = ?", code).
		Set("updated_at = ?", now).
		Where("social_account_id = ?", account.ID).
		Where("blocked_until IS NULL OR blocked_until < ?", blockedUntil).
		Exec(ctx)
	if updateErr != nil {
		return fmt.Errorf("store X engagement provider backoff: %w", updateErr)
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		return fmt.Errorf("read X engagement provider backoff result: %w", rowsErr)
	}
	if rows > 0 {
		return nil
	}
	start, _ := xBudgetWindow(now)
	_, insertErr := s.db.NewInsert().Model(&models.XEngagementReadBudget{
		SocialAccountID: account.ID, WorkspaceID: account.WorkspaceID, WindowStart: start,
		AttemptsUsed: 1, BlockedUntil: blockedUntil, BlockCode: code, CreatedAt: now, UpdatedAt: now,
	}).On("CONFLICT (social_account_id) DO NOTHING").Exec(ctx)
	if insertErr != nil {
		return fmt.Errorf("create X engagement provider backoff: %w", insertErr)
	}
	return nil
}

func xProviderBackoffActive(state *models.EngagementSyncState, now time.Time) bool {
	if state == nil || !state.NextSyncAt.After(now) {
		return false
	}
	return state.Status == "rate_limited" || state.ErrorCode == "credits_depleted"
}

func (s *Service) recordXDeferredState(
	ctx context.Context,
	renditionID string,
	account models.SocialAccount,
	status, code, message string,
	next time.Time,
) error {
	now := s.now()
	old := s.loadState(ctx, renditionID)
	state := &models.EngagementSyncState{
		ID: syncStateID(renditionID), WorkspaceID: account.WorkspaceID, RenditionID: renditionID,
		SocialAccountID: account.ID, Platform: account.Platform, Status: status,
		ErrorCode: code, ErrorMessage: message, NextSyncAt: next,
		CreatedAt: now, UpdatedAt: now,
	}
	if old != nil {
		state.Cursor = old.Cursor
		state.BackfillComplete = old.BackfillComplete
		state.LastAttemptedAt = old.LastAttemptedAt
		state.LastSuccessAt = old.LastSuccessAt
		state.EmptyStreak = old.EmptyStreak
		state.CreatedAt = old.CreatedAt
	}
	_, err := s.db.NewInsert().Model(state).
		On("CONFLICT (id) DO UPDATE").
		Set("status = EXCLUDED.status").
		Set("error_code = EXCLUDED.error_code").
		Set("error_message = EXCLUDED.error_message").
		Set("next_sync_at = EXCLUDED.next_sync_at").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Service) loadState(ctx context.Context, renditionID string) *models.EngagementSyncState {
	var state models.EngagementSyncState
	err := s.db.NewSelect().Model(&state).Where("id = ?", syncStateID(renditionID)).Scan(ctx)
	if err != nil {
		return nil
	}
	return &state
}

func (s *Service) recordState(ctx context.Context, renditionID string, account models.SocialAccount, status, code, message string, backfillComplete bool, cadence time.Duration, emptyStreak int) error {
	now := s.now()
	next := time.Time{}
	if cadence > 0 {
		next = now.Add(cadence)
	}
	state := &models.EngagementSyncState{
		ID: syncStateID(renditionID), WorkspaceID: account.WorkspaceID, RenditionID: renditionID,
		SocialAccountID: account.ID, Platform: account.Platform, Status: status,
		ErrorCode: code, ErrorMessage: message, Cursor: "", BackfillComplete: backfillComplete, LastAttemptedAt: now,
		NextSyncAt: next, EmptyStreak: emptyStreak, CreatedAt: now, UpdatedAt: now,
	}
	old := s.loadState(ctx, renditionID)
	if old != nil {
		state.Cursor = old.Cursor
		state.LastSuccessAt = old.LastSuccessAt
		state.CreatedAt = old.CreatedAt
	}
	if status == "ok" {
		state.LastSuccessAt = now
	}
	_, err := s.db.NewInsert().Model(state).
		On("CONFLICT (id) DO UPDATE").
		Set("status = EXCLUDED.status").
		Set("error_code = EXCLUDED.error_code").
		Set("error_message = EXCLUDED.error_message").
		Set("cursor = EXCLUDED.cursor").
		Set("backfill_complete = EXCLUDED.backfill_complete").
		Set("last_attempted_at = EXCLUDED.last_attempted_at").
		Set("last_success_at = EXCLUDED.last_success_at").
		Set("next_sync_at = EXCLUDED.next_sync_at").
		Set("empty_streak = EXCLUDED.empty_streak").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Service) enqueue(ctx context.Context, workspaceID, jobType, payload string, runAt time.Time) (bool, error) {
	job, err := jobregistry.NewJob(jobType, payload, runAt)
	if err != nil {
		return false, err
	}
	var inserted bool
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if workspaceID != "" {
			if err := organizationguard.LockWorkspace(txCtx, tx, workspaceID); err != nil {
				return err
			}
		}
		result, err := tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		inserted = rows > 0
		return err
	})
	return inserted, err
}

func syncStateID(renditionID string) string {
	return "engagement:rendition:" + renditionID
}

func parseProviderTime(raw string) time.Time {
	value, _ := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	return value
}

func firstNonZeroTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Time{}
}

func engagementCadence(publishedAt, now time.Time, empty bool) time.Duration {
	age := now.Sub(publishedAt)
	switch {
	case publishedAt.IsZero() || age > 30*24*time.Hour:
		if empty {
			return 7 * 24 * time.Hour
		}
		return 24 * time.Hour
	case age < 24*time.Hour:
		return 5 * time.Minute
	case age < 7*24*time.Hour:
		return 30 * time.Minute
	default:
		return 6 * time.Hour
	}
}

func xEngagementCadence(publishedAt, now time.Time, quiet bool) time.Duration {
	age := now.Sub(publishedAt)
	switch {
	case publishedAt.IsZero() || age > 30*24*time.Hour:
		if quiet {
			return 7 * 24 * time.Hour
		}
		return 24 * time.Hour
	case age < 24*time.Hour:
		return 30 * time.Minute
	case age < 7*24*time.Hour:
		return 4 * time.Hour
	default:
		return 24 * time.Hour
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func classifyEngagementReadError(err error) (status, code, message string, cadence time.Duration) {
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) {
		switch {
		case providerErr.StatusCode == 401 || providerErr.StatusCode == 403:
			return "permission_required", firstNonEmpty(providerErr.Code, "authentication"), "Reconnect this account to resume engagement collection.", 24 * time.Hour
		case providerErr.StatusCode == 404:
			return "not_found", firstNonEmpty(providerErr.Code, "not_found"), "The provider no longer exposes this post or its replies.", 7 * 24 * time.Hour
		case providerErr.StatusCode == 402:
			retryAfter := providerErr.RetryAfter
			if retryAfter <= 0 {
				retryAfter = 24 * time.Hour
			}
			return "rate_limited", firstNonEmpty(providerErr.Code, "credits_depleted"), "X API read credits are depleted. OpenPost will wait before collecting replies again.", retryAfter
		case providerErr.StatusCode == 429:
			retryAfter := providerErr.RetryAfter
			if retryAfter <= 0 {
				retryAfter = time.Hour
			}
			return "rate_limited", firstNonEmpty(providerErr.Code, "rate_limited"), "The provider asked OpenPost to wait before collecting replies again.", retryAfter
		case providerErr.StatusCode >= 500:
			return "temporarily_unavailable", firstNonEmpty(providerErr.Code, "provider_server"), "The provider is temporarily unavailable. OpenPost will try again.", time.Hour
		default:
			return "failed", firstNonEmpty(providerErr.Code, "provider_error"), "OpenPost could not collect engagement from this provider.", time.Hour
		}
	}
	return "temporarily_unavailable", "network", "OpenPost could not reach the provider. It will try again.", time.Hour
}

func sanitizeCommentAttachments(input []platform.CommentAttachment) (string, []models.EngagementAttachment) {
	attachments := make([]models.EngagementAttachment, 0, min(len(input), 8))
	for _, attachment := range input {
		urlValue := safeExternalURL(attachment.URL)
		thumbnail := safeExternalURL(attachment.Thumbnail)
		if urlValue == "" && thumbnail == "" {
			continue
		}
		attachments = append(attachments, models.EngagementAttachment{
			Type:      boundedText(attachment.Type, 32),
			URL:       urlValue,
			Name:      boundedText(attachment.Name, 200),
			MimeType:  boundedText(attachment.MimeType, 100),
			Thumbnail: thumbnail,
			AltText:   boundedText(attachment.AltText, 500),
		})
		if len(attachments) == 8 {
			break
		}
	}
	encoded, _ := json.Marshal(attachments)
	return string(encoded), attachments
}

func safeExternalURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	parsed.Fragment = ""
	return boundedText(parsed.String(), 2048)
}

func boundedText(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
