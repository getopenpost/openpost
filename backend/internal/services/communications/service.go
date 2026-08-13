package communications

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
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/uptrace/bun"
)

const (
	JobTypeSweep          = jobregistry.TypeCommunicationsSweep
	JobTypeEngagementSync = jobregistry.TypeEngagementSync
	JobTypeMessagesSync   = jobregistry.TypeMessagesSync
	JobTypeEngagementAct  = jobregistry.TypeEngagementAction
	JobTypeMessageSend    = jobregistry.TypeMessageSend

	capabilityEngagement = "engagement"
	capabilityMessages   = "messages"
	subjectRendition     = "rendition"
	subjectAccount       = "account"
)

const sweepInterval = 5 * time.Minute

var ErrConversationNotFound = errors.New("conversation not found")

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Service struct {
	db            *bun.DB
	tokenSource   TokenSource
	notifications *notifications.Service
	providersMu   sync.RWMutex
	providers     map[string]platform.Adapter
	now           func() time.Time
}

func accountMessagesEnabled(account models.SocialAccount) bool {
	state := map[string]string{}
	if err := json.Unmarshal([]byte(account.CapabilityState), &state); err != nil {
		return false
	}
	return state["messages_enabled"] == "true"
}

func NewService(db *bun.DB, tokenSource TokenSource, notificationService *notifications.Service) *Service {
	return &Service{
		db:            db,
		tokenSource:   tokenSource,
		notifications: notificationService,
		providers:     make(map[string]platform.Adapter),
		now:           func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}

func (s *Service) ScheduleSweep(ctx context.Context, runAt time.Time) error {
	payload, _ := json.Marshal(map[string]string{"scheduled_for": runAt.UTC().Truncate(time.Minute).Format(time.RFC3339)})
	_, err := s.enqueue(ctx, JobTypeSweep, string(payload), runAt)
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
	case JobTypeMessagesSync:
		var input subjectJob
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode messages sync: %w", err)
		}
		return s.syncMessages(ctx, input.ID)
	case JobTypeEngagementAct:
		var input engagementActionJob
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode engagement action: %w", err)
		}
		return s.performEngagementAction(ctx, input)
	case JobTypeMessageSend:
		var input subjectJob
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode message send: %w", err)
		}
		return s.sendMessage(ctx, input.ID)
	default:
		return fmt.Errorf("unsupported communications job type %q", jobType)
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
	WorkspaceID       string
	PublicationID     string
	RenditionID       string
	SocialAccountID   string
	ProviderCommentID string
	Action            string
	Message           string
	UserID            string
}

func (s *Service) handleSweep(ctx context.Context) error {
	if _, err := s.db.NewDelete().
		Model((*models.CommunicationSyncState)(nil)).
		Where("capability = ? AND subject_type = ?", capabilityEngagement, subjectRendition).
		Where("NOT EXISTS (SELECT 1 FROM renditions AS rendition WHERE rendition.id = communication_sync_state.subject_id)").
		Exec(ctx); err != nil {
		return fmt.Errorf("cleaning communications sync state: %w", err)
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
		if _, err := s.RefreshWorkspace(ctx, workspaceID, false); err != nil {
			combined = errors.Join(combined, err)
		}
	}
	if err := s.ScheduleSweep(ctx, s.now().Add(sweepInterval)); err != nil {
		combined = errors.Join(combined, err)
	}
	return combined
}

//nolint:gocyclo // One sweep applies capability, scope, opt-in, cadence, and job-uniqueness gates.
func (s *Service) RefreshWorkspace(ctx context.Context, workspaceID string, force bool) (int, error) {
	now := s.now()
	queued := 0
	var renditions []models.Rendition
	err := s.db.NewSelect().Model(&renditions).
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Where("publication.workspace_id = ?", workspaceID).
		Where("rendition.status = ? AND rendition.external_id != ''", models.RenditionStatusPublished).
		Where("COALESCE(publication.actual_run_at, publication.updated_at) >= ?", now.Add(-90*24*time.Hour)).
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
		engagement, ok := s.adapter(account).(platform.EngagementAdapter)
		if !ok || !engagement.EngagementSupport().Enabled {
			continue
		}
		support := engagement.EngagementSupport()
		if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
			_ = s.recordState(ctx, capabilityEngagement, subjectRendition, rendition.ID, account, "permission_required", "missing_scope", "Reconnect this account and grant engagement access.", "", false, 24*time.Hour, 0)
			continue
		}
		if !force && !s.due(ctx, capabilityEngagement, subjectRendition, rendition.ID, now) {
			continue
		}
		payload, _ := json.Marshal(subjectJob{ID: rendition.ID})
		inserted, enqueueErr := s.enqueue(ctx, JobTypeEngagementSync, string(payload), now)
		if enqueueErr != nil {
			return queued, enqueueErr
		}
		if inserted {
			queued++
		}
	}
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).
		Where("workspace_id = ? AND is_active = ?", workspaceID, true).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return queued, err
	}
	for _, account := range accounts {
		messenger, ok := s.adapter(account).(platform.MessagingAdapter)
		if !ok || !messenger.MessagingSupport().Enabled {
			continue
		}
		if messenger.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
			_ = s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "disabled", "opt_in_required", "Enable inbox sync for this account to collect messages.", "", false, 0, 0)
			continue
		}
		if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, messenger.MessagingSupport().RequiredScopes); len(missing) > 0 {
			_ = s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "permission_required", "missing_scope", "Reconnect this account and grant messaging access.", "", false, 24*time.Hour, 0)
			continue
		}
		if !force && !s.due(ctx, capabilityMessages, subjectAccount, account.ID, now) {
			continue
		}
		payload, _ := json.Marshal(subjectJob{ID: account.ID})
		inserted, enqueueErr := s.enqueue(ctx, JobTypeMessagesSync, string(payload), now)
		if enqueueErr != nil {
			return queued, enqueueErr
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

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
	commenter, ok := s.adapter(account).(platform.EngagementAdapter)
	if !ok || !commenter.EngagementSupport().Enabled {
		return s.recordState(ctx, capabilityEngagement, subjectRendition, rendition.ID, account, "unsupported", "unsupported", "Engagement collection is not supported for this provider.", "", true, 0, 0)
	}
	support := commenter.EngagementSupport()
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
		return s.recordState(ctx, capabilityEngagement, subjectRendition, rendition.ID, account, "permission_required", "missing_scope", "Reconnect this account and grant engagement access.", "", false, 24*time.Hour, 0)
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return s.recordState(ctx, capabilityEngagement, subjectRendition, rendition.ID, account, "permission_required", "authentication", "Reconnect this account to resume engagement collection.", "", true, 24*time.Hour, 0)
	}
	s.resolveAndStoreContentURL(ctx, commenter, token, account, &rendition)
	comments, err := commenter.ListComments(ctx, token, account.AccountID, rendition.ExternalID)
	if err != nil {
		status, code, message, cadence := classifyCommunicationReadError(err)
		return s.recordState(ctx, capabilityEngagement, subjectRendition, rendition.ID, account, status, code, message, "", true, cadence, 0)
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
	return s.recordState(ctx, capabilityEngagement, subjectRendition, rendition.ID, account, "ok", "", "", "", true, cadence, boolToInt(len(comments) == 0))
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
	return s.notifications.CreateWithDB(ctx, db, notifications.CreateInput{
		UserID:      publication.CreatedByID,
		WorkspaceID: account.WorkspaceID,
		Type:        notifications.TypeNewEngagement,
		Title:       "New " + providerLabel(account.Platform) + " engagement",
		Body:        firstNonEmpty(item.AuthorName, item.AuthorHandle, "Someone") + " replied to your post.",
		Href:        "/engagement?item=" + item.ID,
		DedupKey:    "engagement:" + account.ID + ":" + item.RemoteID,
		Payload: map[string]any{
			"engagement_item_id": item.ID,
			"publication_id":     publication.ID,
			"rendition_id":       rendition.ID,
		},
		Actions: []models.NotificationAction{{
			Label: "Open reply",
			Href:  "/engagement?item=" + item.ID,
			Kind:  "primary",
		}},
	})
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

//nolint:gocyclo // Keeps newest-page collection, bounded backfill, persistence, and health state ordered.
func (s *Service) syncMessages(ctx context.Context, accountID string) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", accountID, true).Scan(ctx); err != nil {
		return err
	}
	messenger, ok := s.adapter(account).(platform.MessagingAdapter)
	if !ok || !messenger.MessagingSupport().Enabled {
		return s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "unsupported", "unsupported", "Messages are not supported for this provider.", "", false, 0, 0)
	}
	if messenger.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "disabled", "opt_in_required", "Enable inbox sync for this account to collect messages.", "", false, 0, 0)
	}
	state := s.loadState(ctx, capabilityMessages, subjectAccount, account.ID)
	cursor := ""
	backfillComplete := false
	emptyStreak := 0
	if state != nil {
		cursor = state.Cursor
		backfillComplete = state.BackfillComplete
		emptyStreak = state.EmptyStreak
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "failed", "authentication", "Reconnect this account to resume messages.", cursor, backfillComplete, time.Hour, emptyStreak)
	}
	result, err := messenger.FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Limit: 100})
	if err != nil {
		return s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "failed", "provider_error", "OpenPost could not collect messages from this provider.", cursor, backfillComplete, time.Hour, emptyStreak)
	}
	newInbound, err := s.persistConversations(ctx, account, result.Conversations)
	if err != nil {
		return err
	}
	fetchedCount := len(result.Conversations)
	nextCursor := cursor
	if !backfillComplete {
		if cursor == "" {
			nextCursor = result.NextCursor
			backfillComplete = nextCursor == ""
		} else {
			older, fetchErr := messenger.FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Cursor: cursor, Limit: 100})
			if fetchErr != nil {
				return s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "failed", "backfill_failed", "Current messages were collected, but OpenPost could not collect older message history.", cursor, false, time.Hour, emptyStreak)
			}
			olderInbound, persistErr := s.persistConversations(ctx, account, older.Conversations)
			if persistErr != nil {
				return persistErr
			}
			newInbound = append(newInbound, olderInbound...)
			fetchedCount += len(older.Conversations)
			nextCursor = older.NextCursor
			backfillComplete = nextCursor == ""
		}
	}
	for _, conversation := range newInbound {
		for _, userID := range s.workspaceMemberIDs(ctx, account.WorkspaceID) {
			_ = s.notify(ctx, userID, account.WorkspaceID, notifications.TypeNewMessage,
				"New message from "+firstNonEmpty(conversation.CounterpartName, conversation.CounterpartHandle, "a social account"),
				conversation.LastMessagePreview, "/messages?conversation="+conversation.ID)
		}
	}
	if fetchedCount == 0 {
		emptyStreak++
	} else {
		emptyStreak = 0
	}
	return s.recordState(ctx, capabilityMessages, subjectAccount, account.ID, account, "ok", "", "", nextCursor, backfillComplete, messageCadence(emptyStreak), emptyStreak)
}

func (s *Service) persistConversations(ctx context.Context, account models.SocialAccount, fetched []platform.ProviderConversation) ([]models.Conversation, error) {
	now := s.now()
	newInbound := make([]models.Conversation, 0)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		for _, remote := range fetched {
			if remote.ID == "" {
				continue
			}
			var existing models.Conversation
			existingErr := tx.NewSelect().Model(&existing).
				Where("social_account_id = ? AND remote_conversation_id = ?", account.ID, remote.ID).
				Scan(ctx)
			conversationID := existing.ID
			if errors.Is(existingErr, sql.ErrNoRows) {
				conversationID = uuid.NewString()
			} else if existingErr != nil {
				return existingErr
			}
			conversation := models.Conversation{
				ID:                       conversationID,
				WorkspaceID:              account.WorkspaceID,
				SocialAccountID:          account.ID,
				Platform:                 account.Platform,
				RemoteConversationID:     remote.ID,
				CounterpartRemoteID:      remote.CounterpartRemoteID,
				CounterpartName:          remote.CounterpartName,
				CounterpartHandle:        remote.CounterpartHandle,
				CounterpartAvatarURL:     remote.CounterpartAvatarURL,
				LastMessageAt:            remote.LastMessageAt,
				LastMessagePreview:       remote.LastMessagePreview,
				LastRemoteMessageID:      remote.LastRemoteMessageID,
				UnreadCount:              existing.UnreadCount,
				MessagingWindowExpiresAt: remote.ReplyWindowExpiresAt,
				CreatedAt:                now,
				UpdatedAt:                now,
			}
			_, err := tx.NewInsert().Model(&conversation).
				On("CONFLICT (social_account_id, remote_conversation_id) DO UPDATE").
				Set("counterpart_remote_id = EXCLUDED.counterpart_remote_id").
				Set("counterpart_name = EXCLUDED.counterpart_name").
				Set("counterpart_handle = EXCLUDED.counterpart_handle").
				Set("counterpart_avatar_url = EXCLUDED.counterpart_avatar_url").
				Set("last_message_at = EXCLUDED.last_message_at").
				Set("last_message_preview = EXCLUDED.last_message_preview").
				Set("last_remote_message_id = EXCLUDED.last_remote_message_id").
				Set("messaging_window_expires_at = EXCLUDED.messaging_window_expires_at").
				Set("updated_at = EXCLUDED.updated_at").
				Exec(ctx)
			if err != nil {
				return err
			}
			newInboundCount := 0
			for _, remoteMessage := range remote.Messages {
				if remoteMessage.ID == "" {
					continue
				}
				exists, err := tx.NewSelect().Model((*models.DirectMessage)(nil)).
					Where("conversation_id = ? AND remote_message_id = ?", conversationID, remoteMessage.ID).
					Exists(ctx)
				if err != nil {
					return err
				}
				attachments, _ := json.Marshal(remoteMessage.Attachments)
				message := models.DirectMessage{
					ID:              uuid.NewString(),
					WorkspaceID:     account.WorkspaceID,
					ConversationID:  conversationID,
					RemoteMessageID: remoteMessage.ID,
					Direction:       remoteMessage.Direction,
					AuthorRemoteID:  remoteMessage.AuthorRemoteID,
					Body:            remoteMessage.Body,
					AttachmentsJSON: string(attachments),
					SendStatus:      "received",
					RemoteCreatedAt: remoteMessage.RemoteCreatedAt,
					CreatedAt:       now,
					UpdatedAt:       now,
				}
				if remoteMessage.Direction == "outbound" {
					message.SendStatus = "sent"
				}
				_, err = tx.NewInsert().Model(&message).On("CONFLICT DO NOTHING").Exec(ctx)
				if err != nil {
					return err
				}
				if !exists && remoteMessage.Direction == "inbound" {
					newInboundCount++
				}
			}
			if newInboundCount > 0 {
				if _, err := tx.NewUpdate().Model((*models.Conversation)(nil)).
					Set("unread_count = unread_count + ?", newInboundCount).
					Set("read_at = NULL").
					Where("id = ?", conversationID).
					Exec(ctx); err != nil {
					return err
				}
				newInbound = append(newInbound, conversation)
			}
		}
		return nil
	})
	return newInbound, err
}

func (s *Service) QueueEngagementAction(ctx context.Context, itemID, action, message, userID string) error {
	var item models.EngagementItem
	if err := s.db.NewSelect().Model(&item).Where("id = ?", itemID).Scan(ctx); err != nil {
		return err
	}
	switch action {
	case "reply":
		if !item.CanReply {
			return fmt.Errorf("this provider does not allow a reply to this item")
		}
		if strings.TrimSpace(message) == "" {
			return fmt.Errorf("reply message is required")
		}
	case "hide":
		if !item.CanHide {
			return fmt.Errorf("this provider does not allow this item to be hidden")
		}
	case "delete":
		if !item.CanDelete {
			return fmt.Errorf("this item cannot be deleted by the connected account")
		}
	case "like":
		if !item.CanLike || item.Liked {
			return fmt.Errorf("this provider does not allow this item to be liked")
		}
	case "unlike":
		if !item.CanUnlike || !item.Liked {
			return fmt.Errorf("this provider does not allow this item's like to be removed")
		}
	default:
		return fmt.Errorf("unsupported engagement action %q", action)
	}
	payload, _ := json.Marshal(engagementActionJob{ItemID: itemID, Action: action, Message: strings.TrimSpace(message), UserID: userID})
	_, err := s.enqueue(ctx, JobTypeEngagementAct, string(payload), s.now())
	return err
}

// QueueProviderCommentAction moves the publication comment endpoints onto the
// same durable, one-attempt provider-write path as the communications inbox.
// The opaque provider comment ID and reply body stay in the application job
// payload; provider_write_attempts stores only their digest.
func QueueProviderCommentAction(ctx context.Context, db bun.IDB, input ProviderCommentActionInput) (string, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.SocialAccountID = strings.TrimSpace(input.SocialAccountID)
	input.ProviderCommentID = strings.TrimSpace(input.ProviderCommentID)
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.Message = strings.TrimSpace(input.Message)
	input.UserID = strings.TrimSpace(input.UserID)
	if input.WorkspaceID == "" || input.PublicationID == "" || input.RenditionID == "" ||
		input.SocialAccountID == "" || input.ProviderCommentID == "" || input.UserID == "" {
		return "", fmt.Errorf("provider comment action ownership is required")
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
	var ownerCount int
	if err := db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("renditions AS rendition").
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Join("JOIN social_accounts AS account ON account.id = rendition.social_account_id").
		Where("publication.id = ? AND publication.workspace_id = ?", input.PublicationID, input.WorkspaceID).
		Where("rendition.id = ? AND rendition.social_account_id = ?", input.RenditionID, input.SocialAccountID).
		Where("account.workspace_id = publication.workspace_id AND account.is_active = ?", true).
		Scan(ctx, &ownerCount); err != nil {
		return "", fmt.Errorf("validate provider comment action owner: %w", err)
	}
	if ownerCount != 1 {
		return "", fmt.Errorf("provider comment action target does not belong to the publication workspace")
	}
	jobID := uuid.NewString()
	payload, err := json.Marshal(engagementActionJob{
		JobID: jobID, WorkspaceID: input.WorkspaceID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, SocialAccountID: input.SocialAccountID,
		ProviderCommentID: input.ProviderCommentID, Action: input.Action,
		Message: input.Message, UserID: input.UserID,
	})
	if err != nil {
		return "", fmt.Errorf("encode provider comment action: %w", err)
	}
	if err := enqueueProviderCommentJob(ctx, db, jobID, string(payload)); err != nil {
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
		_ = s.notify(ctx, input.UserID, item.WorkspaceID, notifications.TypeReplyFailed, "Engagement action failed", "OpenPost could not complete the action. Try again.", "/engagement?item="+item.ID)
	}
	return err
}

func (s *Service) executeEngagementAction(
	ctx context.Context,
	commenter platform.CommentAdapter,
	token string,
	account models.SocialAccount,
	item *models.EngagementItem,
	input engagementActionJob,
) error {
	fingerprint, err := providerwrite.Fingerprint("communications-engagement-action-v1", map[string]string{
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
		OperationID: "communications:" + operationOwner,
		JobID:       execution.ID, WorkspaceID: item.WorkspaceID,
		SocialAccountID: account.ID, TargetKey: communicationProviderKey(account),
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
	return s.finishProviderCommentAction(ctx, input, result, writeErr)
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
	result platform.PublishResult,
	writeErr error,
) error {
	if writeErr != nil {
		s.recordProviderCommentLifecycle(ctx, input, lifecycle.EventModerationActionFailed, lifecycle.StatusFailed, "comment "+input.Action+" failed", map[string]any{
			"action": input.Action, "provider_comment_id": input.ProviderCommentID,
			"error_class": providerCommentErrorClass(writeErr),
		})
		_ = s.notify(ctx, input.UserID, input.WorkspaceID, notifications.TypeReplyFailed, "Comment action failed", "OpenPost did not repeat the provider action. Check the provider before trying again.", "/publications")
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
		TargetKey: communicationProviderKey(account), Provider: account.Platform,
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

func (s *Service) QueueMessage(ctx context.Context, conversationID, body string) (*models.DirectMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, fmt.Errorf("message is required")
	}
	var conversation models.Conversation
	if err := s.db.NewSelect().Model(&conversation).Where("id = ?", conversationID).Scan(ctx); err != nil {
		return nil, err
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", conversation.SocialAccountID, true).Scan(ctx); err != nil {
		return nil, fmt.Errorf("connected account is unavailable")
	}
	messenger, ok := s.adapter(account).(platform.MessagingAdapter)
	if !ok || !messenger.MessagingSupport().CanSend {
		return nil, fmt.Errorf("sending messages is unsupported for this provider")
	}
	if messenger.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return nil, fmt.Errorf("enable inbox sync for this account before sending messages")
	}
	if !conversation.MessagingWindowExpiresAt.IsZero() && !conversation.MessagingWindowExpiresAt.After(s.now()) {
		return nil, fmt.Errorf("the provider reply window has closed")
	}
	now := s.now()
	message := &models.DirectMessage{
		ID:              uuid.NewString(),
		WorkspaceID:     conversation.WorkspaceID,
		ConversationID:  conversation.ID,
		Direction:       "outbound",
		Body:            body,
		AttachmentsJSON: "[]",
		SendStatus:      "queued",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	payload, _ := json.Marshal(subjectJob{ID: message.ID})
	job, err := jobregistry.NewJob(JobTypeMessageSend, string(payload), now)
	if err != nil {
		return nil, err
	}
	if err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(message).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewUpdate().Model((*models.Conversation)(nil)).
			Set("last_message_at = ?", now).
			Set("last_message_preview = ?", body).
			Set("updated_at = ?", now).
			Where("id = ?", conversation.ID).
			Exec(txCtx)
		return err
	}); err != nil {
		return nil, err
	}
	return message, nil
}

func (s *Service) sendMessage(ctx context.Context, messageID string) error {
	var message models.DirectMessage
	if err := s.db.NewSelect().Model(&message).Where("id = ?", messageID).Scan(ctx); err != nil {
		return err
	}
	var conversation models.Conversation
	if err := s.db.NewSelect().Model(&conversation).Where("id = ?", message.ConversationID).Scan(ctx); err != nil {
		return err
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", conversation.SocialAccountID).Scan(ctx); err != nil {
		return err
	}
	messenger, ok := s.adapter(account).(platform.MessagingAdapter)
	if !ok || !messenger.MessagingSupport().CanSend {
		return fmt.Errorf("sending messages is unsupported for this provider")
	}
	if messenger.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return fmt.Errorf("enable inbox sync for this account before sending messages")
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return err
	}
	writeResult, err := s.sendMessageThroughFence(ctx, message, conversation, account, messenger, token)
	if err != nil {
		errorMessage := "The provider rejected this message."
		if providerwrite.IsAmbiguous(err) {
			errorMessage = "The provider may have accepted this message. OpenPost did not send it again."
		}
		_, _ = s.db.NewUpdate().Model(&message).Set("send_status = ?", "failed").Set("error_message = ?", errorMessage).Set("updated_at = ?", s.now()).WherePK().Exec(ctx)
		for _, userID := range s.workspaceMemberIDs(ctx, conversation.WorkspaceID) {
			_ = s.notify(ctx, userID, conversation.WorkspaceID, notifications.TypeReplyFailed,
				"Message failed", "OpenPost could not send a message to "+firstNonEmpty(conversation.CounterpartName, conversation.CounterpartHandle, "this conversation")+".",
				"/messages?conversation="+conversation.ID)
		}
		return err
	}
	createdAt := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model(&message).
			Set("remote_message_id = ?", writeResult.ExternalID).
			Set("send_status = ?", "sent").
			Set("error_message = ''").
			Set("remote_created_at = ?", createdAt).
			Set("updated_at = ?", s.now()).
			WherePK().Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewUpdate().Model(&conversation).
			Set("last_remote_message_id = ?", writeResult.ExternalID).
			Set("last_message_at = ?", createdAt).
			Set("last_message_preview = ?", message.Body).
			Set("updated_at = ?", s.now()).
			WherePK().Exec(txCtx)
		return err
	})
}

func (s *Service) sendMessageThroughFence(
	ctx context.Context,
	message models.DirectMessage,
	conversation models.Conversation,
	account models.SocialAccount,
	messenger platform.MessagingAdapter,
	token string,
) (platform.PublishResult, error) {
	request := platform.SendMessageRequest{
		AccountID: account.AccountID, RemoteConversationID: conversation.RemoteConversationID,
		CounterpartRemoteID: conversation.CounterpartRemoteID, CounterpartHandle: conversation.CounterpartHandle,
		ReplyToRemoteID: conversation.LastRemoteMessageID, Body: message.Body,
	}
	fingerprint, err := providerwrite.Fingerprint("communications-message-send-v1", request)
	if err != nil {
		return platform.PublishResult{}, err
	}
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	operationOwner := execution.ID
	if operationOwner == "" {
		operationOwner = message.ID
	}
	return providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: "communications:" + operationOwner,
		JobID:       execution.ID, WorkspaceID: message.WorkspaceID,
		SocialAccountID: account.ID, TargetKey: communicationProviderKey(account),
		Provider: account.Platform, Operation: "message_send", PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		if beginErr := control.Begin(platform.PublishResult{
			ProviderState: "send_message", RetrySafety: platform.PublishRetryNever,
		}); beginErr != nil {
			return platform.PublishResult{}, beginErr
		}
		result, sendErr := messenger.SendMessage(sendCtx, token, request)
		if sendErr != nil {
			return platform.PublishResult{}, sendErr
		}
		return platform.AcceptedPublishResult(result.RemoteMessageID), nil
	}, nil)
}

type EngagementCursor struct {
	OccurredAt time.Time
	CreatedAt  time.Time
	ID         string
}

type EngagementQuery struct {
	WorkspaceID   string
	Platform      string
	AccountID     string
	PublicationID string
	UnreadOnly    bool
	Archived      bool
	Limit         int
	Offset        int
	Cursor        *EngagementCursor
}

type EngagementPage struct {
	Items      []models.EngagementItem
	Total      int
	NextCursor *EngagementCursor
}

const engagementOccurredAtSQL = "COALESCE(remote_created_at, created_at)"

func (s *Service) ListEngagement(ctx context.Context, input EngagementQuery) (EngagementPage, error) {
	if input.Limit <= 0 || input.Limit > 100 {
		input.Limit = 50
	}
	query := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Where("workspace_id = ?", input.WorkspaceID)
	query = engagementFilters(query, input.Platform, input.AccountID, input.PublicationID, input.UnreadOnly, input.Archived)
	count, err := query.Count(ctx)
	if err != nil {
		return EngagementPage{}, err
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
		return EngagementPage{}, err
	}
	hasMore := len(items) > input.Limit
	if hasMore {
		items = items[:input.Limit]
	}
	if err := s.hydrateEngagementProviderURLs(ctx, items); err != nil {
		return EngagementPage{}, err
	}
	page := EngagementPage{Items: items, Total: count}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		occurredAt := last.RemoteCreatedAt
		if occurredAt.IsZero() {
			occurredAt = last.CreatedAt
		}
		page.NextCursor = &EngagementCursor{OccurredAt: occurredAt, CreatedAt: last.CreatedAt, ID: last.ID}
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

func (s *Service) ListEngagementSyncStates(ctx context.Context, workspaceID string) ([]models.CommunicationSyncState, error) {
	var states []models.CommunicationSyncState
	err := s.db.NewSelect().Model(&states).
		Where("workspace_id = ? AND capability = ?", workspaceID, capabilityEngagement).
		Order("platform ASC", "social_account_id ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return states, nil
	}
	return states, err
}

func (s *Service) SetEngagementState(ctx context.Context, workspaceID string, ids []string, read, archived *bool) error {
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

func (s *Service) ListConversations(ctx context.Context, workspaceID, platformName, accountID string, archived bool, limit, offset int) ([]models.Conversation, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	base := func(query *bun.SelectQuery) *bun.SelectQuery {
		query = query.Where("workspace_id = ?", workspaceID)
		if platformName != "" {
			query = query.Where("platform = ?", platformName)
		}
		if accountID != "" {
			query = query.Where("social_account_id = ?", accountID)
		}
		if archived {
			return query.Where("archived_at IS NOT NULL")
		}
		return query.Where("archived_at IS NULL")
	}
	count, err := base(s.db.NewSelect().Model((*models.Conversation)(nil))).Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	var conversations []models.Conversation
	err = base(s.db.NewSelect().Model(&conversations)).
		Order("last_message_at DESC", "updated_at DESC").Limit(limit).Offset(max(0, offset)).Scan(ctx)
	return conversations, count, err
}

func (s *Service) ListMessageSyncStates(ctx context.Context, workspaceID string) ([]models.CommunicationSyncState, error) {
	var states []models.CommunicationSyncState
	err := s.db.NewSelect().Model(&states).
		Where("workspace_id = ? AND capability = ?", workspaceID, capabilityMessages).
		Order("platform ASC", "social_account_id ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return states, nil
	}
	return states, err
}

func (s *Service) ListMessages(ctx context.Context, workspaceID, conversationID string, limit, offset int) ([]models.DirectMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	exists, err := s.db.NewSelect().Model((*models.Conversation)(nil)).
		Where("id = ? AND workspace_id = ?", conversationID, workspaceID).
		Exists(ctx)
	if err != nil {
		return nil, fmt.Errorf("check conversation: %w", err)
	}
	if !exists {
		return nil, ErrConversationNotFound
	}
	var messages []models.DirectMessage
	err = s.db.NewSelect().Model(&messages).
		Join("JOIN conversations AS conversation ON conversation.id = direct_message.conversation_id").
		Where("direct_message.conversation_id = ? AND conversation.workspace_id = ?", conversationID, workspaceID).
		OrderExpr("COALESCE(direct_message.remote_created_at, direct_message.created_at) ASC").
		Limit(limit).Offset(max(0, offset)).Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("list conversation messages: %w", err)
	}
	return messages, nil
}

func (s *Service) SetConversationState(ctx context.Context, workspaceID, conversationID string, read, archived *bool) error {
	query := s.db.NewUpdate().Model((*models.Conversation)(nil)).
		Where("workspace_id = ? AND id = ?", workspaceID, conversationID)
	if read != nil {
		if *read {
			query = query.Set("read_at = ?", s.now()).Set("unread_count = 0")
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

func (s *Service) adapter(account models.SocialAccount) platform.Adapter {
	key := communicationProviderKey(account)
	s.providersMu.RLock()
	defer s.providersMu.RUnlock()
	return s.providers[key]
}

func communicationProviderKey(account models.SocialAccount) string {
	key := account.Platform
	if account.Platform == "mastodon" {
		key += ":" + account.InstanceURL
	}
	return key
}

func (s *Service) due(ctx context.Context, capability, subjectType, subjectID string, now time.Time) bool {
	state := s.loadState(ctx, capability, subjectType, subjectID)
	return state == nil || state.NextSyncAt.IsZero() || !state.NextSyncAt.After(now)
}

func (s *Service) loadState(ctx context.Context, capability, subjectType, subjectID string) *models.CommunicationSyncState {
	var state models.CommunicationSyncState
	err := s.db.NewSelect().Model(&state).Where("id = ?", syncStateID(capability, subjectType, subjectID)).Scan(ctx)
	if err != nil {
		return nil
	}
	return &state
}

func (s *Service) recordState(ctx context.Context, capability, subjectType, subjectID string, account models.SocialAccount, status, code, message, cursor string, backfillComplete bool, cadence time.Duration, emptyStreak int) error {
	now := s.now()
	next := time.Time{}
	if cadence > 0 {
		next = now.Add(cadence)
	}
	state := &models.CommunicationSyncState{
		ID: syncStateID(capability, subjectType, subjectID), WorkspaceID: account.WorkspaceID,
		Capability: capability, SubjectType: subjectType, SubjectID: subjectID,
		SocialAccountID: account.ID, Platform: account.Platform, Status: status,
		ErrorCode: code, ErrorMessage: message, Cursor: cursor, BackfillComplete: backfillComplete, LastAttemptedAt: now,
		NextSyncAt: next, EmptyStreak: emptyStreak, CreatedAt: now, UpdatedAt: now,
	}
	old := s.loadState(ctx, capability, subjectType, subjectID)
	if old != nil {
		state.LastSuccessAt = old.LastSuccessAt
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

func (s *Service) enqueue(ctx context.Context, jobType, payload string, runAt time.Time) (bool, error) {
	job, err := jobregistry.NewJob(jobType, payload, runAt)
	if err != nil {
		return false, err
	}
	result, err := s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows > 0, err
}

func (s *Service) notify(ctx context.Context, userID, workspaceID, eventType, title, body, href string) error {
	if s.notifications == nil || userID == "" {
		return nil
	}
	return s.notifications.Create(ctx, notifications.CreateInput{
		UserID: userID, WorkspaceID: workspaceID, Type: eventType,
		Title: title, Body: body, Href: href, Payload: map[string]any{},
	})
}

func (s *Service) workspaceMemberIDs(ctx context.Context, workspaceID string) []string {
	var ids []string
	_ = s.db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Column("user_id").Where("workspace_id = ? AND status = ?", workspaceID, models.WorkspaceMemberStatusActive).Scan(ctx, &ids)
	return ids
}

func syncStateID(capability, subjectType, subjectID string) string {
	return capability + ":" + subjectType + ":" + subjectID
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

func messageCadence(emptyStreak int) time.Duration {
	switch {
	case emptyStreak <= 0:
		return 2 * time.Minute
	case emptyStreak == 1:
		return 5 * time.Minute
	case emptyStreak == 2:
		return 15 * time.Minute
	default:
		return time.Hour
	}
}

func providerLabel(provider string) string {
	if provider == "x" {
		return "X"
	}
	if provider == "" {
		return "social"
	}
	return strings.ToUpper(provider[:1]) + provider[1:]
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

func classifyCommunicationReadError(err error) (status, code, message string, cadence time.Duration) {
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) {
		switch {
		case providerErr.StatusCode == 401 || providerErr.StatusCode == 403:
			return "permission_required", firstNonEmpty(providerErr.Code, "authentication"), "Reconnect this account to resume engagement collection.", 24 * time.Hour
		case providerErr.StatusCode == 404:
			return "not_found", firstNonEmpty(providerErr.Code, "not_found"), "The provider no longer exposes this post or its replies.", 7 * 24 * time.Hour
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
