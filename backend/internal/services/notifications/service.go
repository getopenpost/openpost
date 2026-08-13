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
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/uptrace/bun"
)

const (
	JobTypeEmailDelivery      = jobregistry.TypeNotificationEmail
	TypePostPublished         = "post_published"
	TypePublishFailed         = "publish_failed"
	TypeAccountNeedsAttention = "account_needs_attention"
	TypeNewEngagement         = "new_engagement"
	TypeNewMessage            = "new_message"
	TypeReplyFailed           = "reply_failed"
	TypeWorkspaceInvite       = "workspace_invite"

	visibleWorkspaceNotifications = "(workspace_id = ? OR workspace_id = '')"
)

var (
	ErrInvalidCursor          = errors.New("invalid notification cursor")
	errWorkspaceScopeRequired = errors.New("notification workspace scope is required")
)

var criticalInApp = map[string]bool{
	TypePublishFailed:         true,
	TypeAccountNeedsAttention: true,
	TypeReplyFailed:           true,
	TypeWorkspaceInvite:       true,
}

type ChannelPreference struct {
	InApp bool `json:"in_app"`
	Email bool `json:"email"`
}

type Preferences map[string]ChannelPreference

func DefaultPreferences() Preferences {
	return Preferences{
		TypePostPublished:         {InApp: true, Email: false},
		TypePublishFailed:         {InApp: true, Email: true},
		TypeAccountNeedsAttention: {InApp: true, Email: false},
		TypeNewEngagement:         {InApp: true, Email: false},
		TypeNewMessage:            {InApp: true, Email: false},
		TypeReplyFailed:           {InApp: true, Email: true},
		TypeWorkspaceInvite:       {InApp: true, Email: true},
	}
}

type PreferenceSettings struct {
	Preferences    Preferences `json:"preferences"`
	EmailAvailable bool        `json:"email_available"`
	EmailAddress   string      `json:"email_address"`
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
	db        *bun.DB
	sender    passwordmail.Sender
	publicURL string
	now       func() time.Time
}

type Options struct {
	Sender    passwordmail.Sender
	PublicURL string
}

func NewService(db *bun.DB, options ...Options) *Service {
	service := &Service{db: db, now: func() time.Time { return time.Now().UTC() }}
	if len(options) > 0 {
		service.sender = options[0].Sender
		service.publicURL = strings.TrimRight(strings.TrimSpace(options[0].PublicURL), "/")
	}
	return service
}

func (s *Service) Create(ctx context.Context, input CreateInput) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		return s.CreateWithDB(ctx, tx, input)
	})
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
	deliverInApp := preference.InApp || criticalInApp[input.Type]
	deliverEmail := preference.Email && s.sender != nil
	if !deliverInApp && !deliverEmail {
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
	if deliverInApp {
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
		if _, err := query.Exec(ctx); err != nil {
			return err
		}
	}
	if !deliverEmail {
		return nil
	}
	return s.enqueueEmailWithDB(ctx, db, input)
}

type emailDeliveryJob struct {
	DeliveryID string `json:"delivery_id"`
	UserID     string `json:"user_id"`
	Type       string `json:"type"`
	Title      string `json:"title"`
	Body       string `json:"body"`
	Href       string `json:"href,omitempty"`
}

func (s *Service) enqueueEmailWithDB(ctx context.Context, db bun.IDB, input CreateInput) error {
	jobID := uuid.NewString()
	if dedupKey := strings.TrimSpace(input.DedupKey); dedupKey != "" {
		jobID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(input.UserID+"\x00"+dedupKey)).String()
	}
	href := strings.TrimSpace(input.Href)
	if !isSafeLocalNotificationHref(href) {
		href = ""
	}
	payload, err := json.Marshal(emailDeliveryJob{
		DeliveryID: jobID,
		UserID:     input.UserID,
		Type:       input.Type,
		Title:      strings.TrimSpace(input.Title),
		Body:       strings.TrimSpace(input.Body),
		Href:       href,
	})
	if err != nil {
		return fmt.Errorf("encode notification email job: %w", err)
	}
	job, err := jobregistry.NewJob(JobTypeEmailDelivery, string(payload), s.now())
	if err != nil {
		return err
	}
	job.ID = jobID
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	if jobType != JobTypeEmailDelivery {
		return fmt.Errorf("unsupported notification job type %q", jobType)
	}
	if s.sender == nil {
		return fmt.Errorf("notification email delivery is not configured")
	}
	var job emailDeliveryJob
	if err := json.Unmarshal([]byte(payload), &job); err != nil {
		return fmt.Errorf("decode notification email job: %w", err)
	}
	preferences, err := s.GetPreferences(ctx, job.UserID)
	if err != nil {
		return err
	}
	if !preferences[job.Type].Email {
		return nil
	}
	var email string
	err = s.db.NewSelect().Model((*models.User)(nil)).
		Column("email").Where("id = ?", job.UserID).Scan(ctx, &email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load notification email recipient: %w", err)
	}
	actionURL := ""
	if job.Href != "" && s.publicURL != "" {
		actionURL = s.publicURL + job.Href
	}
	preferencesURL := ""
	if s.publicURL != "" {
		preferencesURL = s.publicURL + "/settings?tab=notifications"
	}
	return s.sender.SendNotification(ctx, passwordmail.NotificationMessage{
		Recipient:      email,
		Title:          job.Title,
		Body:           job.Body,
		ActionURL:      actionURL,
		PreferencesURL: preferencesURL,
		IdempotencyKey: "notification-" + job.DeliveryID,
	})
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
		query = query.Where(visibleWorkspaceNotifications, workspaceID)
	}
	if cursor != "" {
		createdAt, id, err := parseCursor(cursor)
		if err != nil {
			return NotificationPage{}, err
		}
		query = query.Where("(created_at < ? OR (created_at = ? AND id < ?))", createdAt, createdAt, id)
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
		unreadQuery = unreadQuery.Where(visibleWorkspaceNotifications, workspaceID)
	}
	count, err := unreadQuery.Count(ctx)
	if err != nil {
		return NotificationPage{}, err
	}
	page.UnreadCount = count
	return page, nil
}

func parseCursor(cursor string) (time.Time, string, error) {
	parts := strings.Split(cursor, "|")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return time.Time{}, "", ErrInvalidCursor
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", ErrInvalidCursor
	}
	return createdAt, parts[1], nil
}

func (s *Service) MarkRead(ctx context.Context, userID, workspaceID string, ids []string, all bool) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return errWorkspaceScopeRequired
	}
	query := s.db.NewUpdate().Model((*models.UserNotification)(nil)).
		Set("read_at = ?", s.now()).
		Where("user_id = ? AND read_at IS NULL", userID).
		Where(visibleWorkspaceNotifications, workspaceID)
	if !all {
		if len(ids) == 0 {
			return nil
		}
		query = query.Where("id IN (?)", bun.List(ids))
	}
	_, err := query.Exec(ctx)
	return err
}

func (s *Service) Delete(ctx context.Context, userID, workspaceID string, ids []string, all bool) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return errWorkspaceScopeRequired
	}
	query := s.db.NewDelete().Model((*models.UserNotification)(nil)).
		Where("user_id = ?", userID).
		Where(visibleWorkspaceNotifications, workspaceID)
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

func (s *Service) GetPreferenceSettings(ctx context.Context, userID string) (PreferenceSettings, error) {
	preferences, err := s.GetPreferences(ctx, userID)
	if err != nil {
		return PreferenceSettings{}, err
	}
	var email string
	if err := s.db.NewSelect().Model((*models.User)(nil)).
		Column("email").Where("id = ?", userID).Scan(ctx, &email); err != nil {
		return PreferenceSettings{}, err
	}
	return PreferenceSettings{
		Preferences:    preferences,
		EmailAvailable: s.sender != nil,
		EmailAddress:   strings.TrimSpace(email),
	}, nil
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
	type storedChannelPreference struct {
		InApp *bool `json:"in_app"`
		Email *bool `json:"email"`
	}
	var stored map[string]storedChannelPreference
	if err := json.Unmarshal([]byte(row.PreferencesJSON), &stored); err != nil {
		return nil, fmt.Errorf("decode notification preferences: %w", err)
	}
	for eventType, value := range stored {
		preference, allowed := preferences[eventType]
		if !allowed {
			continue
		}
		if value.InApp != nil {
			preference.InApp = *value.InApp
		}
		if value.Email != nil {
			preference.Email = *value.Email
		}
		if criticalInApp[eventType] {
			preference.InApp = true
		}
		preferences[eventType] = preference
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
