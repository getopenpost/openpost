package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	TypePostPublished         = "post_published"
	TypePublishFailed         = "publish_failed"
	TypeAccountNeedsAttention = "account_needs_attention"
	TypeNewEngagement         = "new_engagement"
	TypeNewMessage            = "new_message"
	TypeReplyFailed           = "reply_failed"
	TypeWorkspaceInvite       = "workspace_invite"
)

var criticalInApp = map[string]bool{
	TypePublishFailed:         true,
	TypeAccountNeedsAttention: true,
	TypeReplyFailed:           true,
	TypeWorkspaceInvite:       true,
}

type ChannelPreference struct {
	InApp bool `json:"in_app"`
}

type Preferences map[string]ChannelPreference

func DefaultPreferences() Preferences {
	return Preferences{
		TypePostPublished:         {InApp: true},
		TypePublishFailed:         {InApp: true},
		TypeAccountNeedsAttention: {InApp: true},
		TypeNewEngagement:         {InApp: true},
		TypeNewMessage:            {InApp: true},
		TypeReplyFailed:           {InApp: true},
		TypeWorkspaceInvite:       {InApp: true},
	}
}

type CreateInput struct {
	UserID      string
	WorkspaceID string
	Type        string
	Title       string
	Body        string
	Href        string
	DedupKey    string
	Payload     map[string]any
	Actions     []models.NotificationAction
}

type NotificationPage struct {
	Items       []models.UserNotification `json:"items"`
	NextCursor  string                    `json:"next_cursor,omitempty"`
	UnreadCount int                       `json:"unread_count"`
}

type Service struct {
	db  *bun.DB
	now func() time.Time
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Create(ctx context.Context, input CreateInput) error {
	return s.CreateWithDB(ctx, s.db, input)
}

// CreateWithDB lets callers write an attention notification in the same
// transaction as the operational state that produced it.
func (s *Service) CreateWithDB(ctx context.Context, db bun.IDB, input CreateInput) error {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.Type) == "" {
		return fmt.Errorf("notification user and type are required")
	}
	preferences, err := s.getPreferences(ctx, db, input.UserID)
	if err != nil {
		return err
	}
	preference := preferences[input.Type]
	if !preference.InApp && !criticalInApp[input.Type] {
		return nil
	}
	payloadValues := make(map[string]any, len(input.Payload)+1)
	for key, value := range input.Payload {
		payloadValues[key] = value
	}
	actions := safeActions(input.Actions)
	if len(actions) > 0 {
		payloadValues["actions"] = actions
	}
	payload, err := json.Marshal(payloadValues)
	if err != nil {
		return fmt.Errorf("encode notification payload: %w", err)
	}
	notification := &models.UserNotification{
		ID:          uuid.NewString(),
		UserID:      input.UserID,
		WorkspaceID: input.WorkspaceID,
		Type:        input.Type,
		Title:       strings.TrimSpace(input.Title),
		Body:        strings.TrimSpace(input.Body),
		Href:        strings.TrimSpace(input.Href),
		PayloadJSON: string(payload),
		DedupKey:    strings.TrimSpace(input.DedupKey),
		CreatedAt:   s.now(),
	}
	query := db.NewInsert().Model(notification)
	if notification.DedupKey != "" {
		query = query.On("CONFLICT DO NOTHING")
	}
	_, err = query.Exec(ctx)
	return err
}

func (s *Service) List(ctx context.Context, userID, workspaceID, cursor string, limit int) (NotificationPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var items []models.UserNotification
	query := s.db.NewSelect().Model(&items).
		Where("user_id = ?", userID).
		Order("created_at DESC", "id DESC").
		Limit(limit + 1)
	if workspaceID != "" {
		query = query.Where("(workspace_id = ? OR workspace_id = '')", workspaceID)
	}
	if cursor != "" {
		var createdAt time.Time
		var id string
		if decoded, err := time.Parse(time.RFC3339Nano, strings.SplitN(cursor, "|", 2)[0]); err == nil {
			createdAt = decoded
			parts := strings.SplitN(cursor, "|", 2)
			if len(parts) == 2 {
				id = parts[1]
			}
			query = query.Where("(created_at < ? OR (created_at = ? AND id < ?))", createdAt, createdAt, id)
		}
	}
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return NotificationPage{}, err
	}
	for index := range items {
		items[index].Actions = notificationActions(items[index].PayloadJSON)
	}
	page := NotificationPage{Items: items}
	if len(page.Items) > limit {
		last := page.Items[limit-1]
		page.NextCursor = last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID
		page.Items = page.Items[:limit]
	}
	unreadQuery := s.db.NewSelect().Model((*models.UserNotification)(nil)).
		Where("user_id = ? AND read_at IS NULL", userID)
	if workspaceID != "" {
		unreadQuery = unreadQuery.Where("(workspace_id = ? OR workspace_id = '')", workspaceID)
	}
	count, err := unreadQuery.Count(ctx)
	if err != nil {
		return NotificationPage{}, err
	}
	page.UnreadCount = count
	return page, nil
}

func (s *Service) MarkRead(ctx context.Context, userID string, ids []string, all bool) error {
	query := s.db.NewUpdate().Model((*models.UserNotification)(nil)).
		Set("read_at = ?", s.now()).
		Where("user_id = ? AND read_at IS NULL", userID)
	if !all {
		if len(ids) == 0 {
			return nil
		}
		query = query.Where("id IN (?)", bun.List(ids))
	}
	_, err := query.Exec(ctx)
	return err
}

func (s *Service) Delete(ctx context.Context, userID string, ids []string, all bool) error {
	query := s.db.NewDelete().Model((*models.UserNotification)(nil)).Where("user_id = ?", userID)
	if !all {
		if len(ids) == 0 {
			return nil
		}
		query = query.Where("id IN (?)", bun.List(ids))
	}
	_, err := query.Exec(ctx)
	return err
}

func (s *Service) GetPreferences(ctx context.Context, userID string) (Preferences, error) {
	return s.getPreferences(ctx, s.db, userID)
}

func (s *Service) getPreferences(ctx context.Context, db bun.IDB, userID string) (Preferences, error) {
	preferences := DefaultPreferences()
	var row models.UserNotificationPreference
	err := db.NewSelect().Model(&row).Where("user_id = ?", userID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return preferences, nil
	}
	if err != nil {
		return nil, err
	}
	var stored Preferences
	if err := json.Unmarshal([]byte(row.PreferencesJSON), &stored); err != nil {
		return nil, fmt.Errorf("decode notification preferences: %w", err)
	}
	for eventType, value := range stored {
		if criticalInApp[eventType] {
			value.InApp = true
		}
		preferences[eventType] = value
	}
	return preferences, nil
}

func safeActions(actions []models.NotificationAction) []models.NotificationAction {
	safe := make([]models.NotificationAction, 0, min(len(actions), 3))
	for _, action := range actions {
		label := strings.TrimSpace(action.Label)
		href := strings.TrimSpace(action.Href)
		operation := strings.TrimSpace(action.Operation)
		targetID := strings.TrimSpace(action.TargetID)
		hasSafeHref := isSafeLocalNotificationHref(href)
		hasSafeOperation := operation == "retry_failed_publication" &&
			targetID != "" && len(targetID) <= 96
		if label == "" || len([]rune(label)) > 80 || (!hasSafeHref && !hasSafeOperation) {
			continue
		}
		if !hasSafeHref {
			href = ""
		}
		if !hasSafeOperation {
			operation = ""
			targetID = ""
		}
		kind := strings.TrimSpace(action.Kind)
		if kind != "primary" && kind != "secondary" {
			kind = "secondary"
		}
		safe = append(safe, models.NotificationAction{
			Label: label, Href: href, Kind: kind, Operation: operation, TargetID: targetID,
		})
		if len(safe) == 3 {
			break
		}
	}
	return safe
}

func isSafeLocalNotificationHref(href string) bool {
	if href == "" ||
		!strings.HasPrefix(href, "/") ||
		strings.HasPrefix(href, "//") ||
		strings.Contains(href, `\`) {
		return false
	}
	parsed, err := url.ParseRequestURI(href)
	return err == nil &&
		!parsed.IsAbs() &&
		parsed.Host == "" &&
		parsed.User == nil &&
		strings.HasPrefix(parsed.Path, "/")
}

func notificationActions(payloadJSON string) []models.NotificationAction {
	var payload struct {
		Actions []models.NotificationAction `json:"actions"`
	}
	if json.Unmarshal([]byte(payloadJSON), &payload) != nil {
		return nil
	}
	return safeActions(payload.Actions)
}

func (s *Service) UpdatePreferences(ctx context.Context, userID string, preferences Preferences) (Preferences, error) {
	allowed := DefaultPreferences()
	clean := DefaultPreferences()
	for eventType, value := range preferences {
		if _, ok := allowed[eventType]; !ok {
			continue
		}
		if criticalInApp[eventType] {
			value.InApp = true
		}
		clean[eventType] = value
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return nil, err
	}
	now := s.now()
	row := &models.UserNotificationPreference{UserID: userID, PreferencesJSON: string(encoded), UpdatedAt: now}
	_, err = s.db.NewInsert().Model(row).
		On("CONFLICT (user_id) DO UPDATE").
		Set("preferences_json = EXCLUDED.preferences_json").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return clean, err
}
