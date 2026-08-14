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
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	JobTypeEmailDelivery             = jobregistry.TypeNotificationEmail
	TypePostPublished                = "post_published"
	TypePublishFailed                = "publish_failed"
	TypeAccountNeedsAttention        = "account_needs_attention"
	TypeNewEngagement                = "new_engagement"
	TypeNewMessage                   = "new_message"
	TypeReplyFailed                  = "reply_failed"
	TypeWorkspaceInvite              = "workspace_invite"
	TypeOwnershipTransfer            = "ownership_transfer"
	TypeSecurityAction               = "security_action"
	TypeAccessChanged                = "access_changed"
	TypeCriticalBilling              = "critical_billing"
	EmailDeliveryQueued              = "queued"
	EmailDeliveryCreated             = "created"
	EmailDeliveryUnavailable         = "unavailable"
	EmailDeliveryFailed              = "failed"
	EmailDeliverySent                = "sent"
	EmailDeliveryDelivered           = "delivered"
	EmailClassificationTransactional = "transactional"
	EmailClassificationRequired      = "required_notification"
	EmailClassificationDailyDigest   = "daily_digest"
	OwnershipTransferSemanticKind    = "organization_ownership_nomination"
	OwnershipTransferReviewAction    = "ownership_transfer.review"

	visibleWorkspaceNotifications = "(workspace_id = ? OR workspace_id = '')"
)

var (
	ErrInvalidCursor          = errors.New("invalid notification cursor")
	ErrInvalidPreferences     = errors.New("invalid notification preferences")
	ErrInvalidMute            = errors.New("invalid notification mute")
	ErrMuteWorkspaceAccess    = errors.New("notification mute workspace access denied")
	ErrMuteNotFound           = errors.New("notification mute not found")
	errWorkspaceScopeRequired = errors.New("notification workspace scope is required")
)

var criticalInApp = map[string]bool{
	TypePublishFailed:         true,
	TypeAccountNeedsAttention: true,
	TypeReplyFailed:           true,
	TypeWorkspaceInvite:       true,
	TypeOwnershipTransfer:     true,
	TypeSecurityAction:        true,
	TypeAccessChanged:         true,
	TypeCriticalBilling:       true,
}

var transactionalEmail = map[string]bool{
	TypeWorkspaceInvite:   true,
	TypeOwnershipTransfer: true,
	TypeSecurityAction:    true,
	TypeAccessChanged:     true,
	TypeCriticalBilling:   true,
}

type EmailFrequency string

const (
	EmailFrequencyOff       EmailFrequency = "off"
	EmailFrequencyImmediate EmailFrequency = "immediate"
	EmailFrequencyDaily     EmailFrequency = "daily"
)

func (frequency EmailFrequency) valid() bool {
	return frequency == EmailFrequencyOff || frequency == EmailFrequencyImmediate || frequency == EmailFrequencyDaily
}

type ChannelPreference struct {
	InApp          bool           `json:"in_app"`
	EmailFrequency EmailFrequency `json:"email_frequency" enum:"off,immediate,daily"`
}

type Preferences map[string]ChannelPreference

func DefaultPreferences() Preferences {
	return Preferences{
		TypePostPublished:         {InApp: true, EmailFrequency: EmailFrequencyOff},
		TypePublishFailed:         {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		TypeAccountNeedsAttention: {InApp: true, EmailFrequency: EmailFrequencyOff},
		TypeNewEngagement:         {InApp: true, EmailFrequency: EmailFrequencyOff},
		TypeNewMessage:            {InApp: true, EmailFrequency: EmailFrequencyOff},
		TypeReplyFailed:           {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		TypeWorkspaceInvite:       {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		TypeOwnershipTransfer:     {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		TypeSecurityAction:        {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		TypeAccessChanged:         {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		TypeCriticalBilling:       {InApp: true, EmailFrequency: EmailFrequencyImmediate},
	}
}

type PreferenceSettings struct {
	Preferences      Preferences `json:"preferences"`
	EmailAvailable   bool        `json:"email_available"`
	EmailAddress     string      `json:"email_address"`
	DigestTime       string      `json:"digest_time" example:"09:00"`
	DigestTimezone   string      `json:"digest_timezone" example:"Europe/Lisbon"`
	DigestConfigured bool        `json:"digest_configured"`
	Mutes            []Mute      `json:"mutes"`
}

type PreferenceUpdate struct {
	Preferences    Preferences `json:"preferences"`
	DigestTime     string      `json:"digest_time" pattern:"^[0-2][0-9]:[0-5][0-9]$"`
	DigestTimezone string      `json:"digest_timezone"`
}

type MuteScope string

const (
	MuteScopeAccount   MuteScope = "account"
	MuteScopeWorkspace MuteScope = "workspace"
)

func (scope MuteScope) valid() bool {
	return scope == MuteScopeAccount || scope == MuteScopeWorkspace
}

type MuteCreate struct {
	Scope       MuteScope `json:"scope" enum:"account,workspace"`
	WorkspaceID string    `json:"workspace_id,omitempty"`
	EndsAt      time.Time `json:"ends_at" format:"date-time"`
}

type MuteActor struct {
	UserID             string
	WorkspaceBindingID string
}

type Mute struct {
	ID            string    `json:"id"`
	Scope         MuteScope `json:"scope" enum:"account,workspace"`
	WorkspaceID   string    `json:"workspace_id,omitempty"`
	WorkspaceName string    `json:"workspace_name,omitempty"`
	StartsAt      time.Time `json:"starts_at"`
	EndsAt        time.Time `json:"ends_at"`
}

type CreateInput struct {
	UserID        string
	WorkspaceID   string
	Type          string
	Title         string
	Body          string
	Href          string
	DedupKey      string
	Payload       map[string]any
	Actions       []models.NotificationAction
	SuppressEmail bool
}

type WorkspaceInvitationEmailInput struct {
	InvitationID  string
	Recipient     string
	WorkspaceName string
	InviterName   string
	Role          string
	ExpiresAt     time.Time
	RawToken      string
	DeliveryKey   string
}

type EmailDelivery struct {
	Status string
	JobID  string
}

type WorkspaceInvitationDeliveryEvent struct {
	EventID      string
	InvitationID string
	DeliveryID   string
	Outcome      string
	OccurredAt   time.Time
}

type WorkspaceInvitationDeliveryResult struct {
	Applied   bool
	Duplicate bool
	Ignored   bool
}

type NotificationPage struct {
	Items       []models.UserNotification `json:"items"`
	NextCursor  string                    `json:"next_cursor,omitempty"`
	UnreadCount int                       `json:"unread_count"`
}

type Service struct {
	db        *bun.DB
	sender    passwordmail.Sender
	encryptor *servicecrypto.TokenEncryptor
	publicURL string
	now       func() time.Time
	// beforeDigestPreferenceLock is a deterministic concurrency seam for tests.
	beforeDigestPreferenceLock func()
	// beforeOptionalMuteCheck is a deterministic producer-boundary seam for tests.
	beforeOptionalMuteCheck func()
	// Mute persistence seams let contention tests prove final durable state.
	beforeMuteCreatePersist func()
	beforeMuteEndPersist    func()
}

type Options struct {
	Sender    passwordmail.Sender
	Encryptor *servicecrypto.TokenEncryptor
	PublicURL string
}

func NewService(db *bun.DB, options ...Options) *Service {
	service := &Service{db: db, now: func() time.Time { return time.Now().UTC() }}
	if len(options) > 0 {
		service.sender = options[0].Sender
		service.encryptor = options[0].Encryptor
		service.publicURL = strings.TrimRight(strings.TrimSpace(options[0].PublicURL), "/")
	}
	return service
}

func (s *Service) CreateMute(ctx context.Context, actor MuteActor, input MuteCreate) (Mute, error) {
	now := s.now().UTC()
	userID, input, err := normalizeMuteCreate(actor, input, now)
	if err != nil {
		return Mute{}, err
	}
	if err := s.authorizeMuteCreate(ctx, actor, userID, input); err != nil {
		return Mute{}, err
	}
	id := uuid.NewSHA1(uuid.NameSpaceOID, []byte("notification-mute\x00"+userID+"\x00"+string(input.Scope)+"\x00"+input.WorkspaceID)).String()
	row := &models.UserNotificationMute{
		ID: id, UserID: userID, Scope: string(input.Scope), WorkspaceID: input.WorkspaceID,
		StartsAt: now, EndsAt: input.EndsAt, CreatedAt: now, UpdatedAt: now,
	}
	if s.beforeMuteCreatePersist != nil {
		s.beforeMuteCreatePersist()
	}
	_, err = s.db.NewInsert().Model(row).
		On("CONFLICT (id) DO UPDATE").
		Set("starts_at = EXCLUDED.starts_at").
		Set("ends_at = EXCLUDED.ends_at").
		Set("ended_at = NULL").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return Mute{}, err
	}
	return s.muteView(ctx, s.db, *row)
}

func normalizeMuteCreate(actor MuteActor, input MuteCreate, now time.Time) (string, MuteCreate, error) {
	userID := strings.TrimSpace(actor.UserID)
	input.Scope = MuteScope(strings.TrimSpace(string(input.Scope)))
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.EndsAt = input.EndsAt.UTC()
	if userID == "" || !input.EndsAt.After(now) ||
		(input.Scope == MuteScopeAccount && input.WorkspaceID != "") ||
		(input.Scope == MuteScopeWorkspace && input.WorkspaceID == "") || !input.Scope.valid() {
		return "", MuteCreate{}, ErrInvalidMute
	}
	return userID, input, nil
}

func (s *Service) authorizeMuteCreate(ctx context.Context, actor MuteActor, userID string, input MuteCreate) error {
	workspaceBindingID := strings.TrimSpace(actor.WorkspaceBindingID)
	if workspaceBindingID != "" && (input.Scope != MuteScopeWorkspace || input.WorkspaceID != workspaceBindingID) {
		return ErrMuteWorkspaceAccess
	}
	if input.Scope != MuteScopeWorkspace {
		return nil
	}
	allowed, err := workspaceaccess.Allows(ctx, s.db, input.WorkspaceID, userID)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrMuteWorkspaceAccess
	}
	return nil
}

func (s *Service) EndMute(ctx context.Context, actor MuteActor, muteID string) error {
	now := s.now().UTC()
	userID := strings.TrimSpace(actor.UserID)
	workspaceBindingID := strings.TrimSpace(actor.WorkspaceBindingID)
	var mute models.UserNotificationMute
	if err := s.db.NewSelect().Model(&mute).
		Where("id = ? AND user_id = ?", strings.TrimSpace(muteID), userID).
		Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return ErrMuteNotFound
	} else if err != nil {
		return err
	}
	if workspaceBindingID != "" && (MuteScope(mute.Scope) != MuteScopeWorkspace || mute.WorkspaceID != workspaceBindingID) {
		return ErrMuteWorkspaceAccess
	}
	if !mute.EndedAt.IsZero() || !mute.EndsAt.After(now) {
		return nil
	}
	if s.beforeMuteEndPersist != nil {
		s.beforeMuteEndPersist()
	}
	_, err := s.db.NewUpdate().Model((*models.UserNotificationMute)(nil)).
		Set("ended_at = ?", now).Set("updated_at = ?", now).
		Where("id = ? AND user_id = ? AND ended_at IS NULL AND ends_at > ?", strings.TrimSpace(muteID), strings.TrimSpace(userID), now).
		Exec(ctx)
	if err != nil {
		return err
	}
	// Another EndMute may have won after the read. Ending an existing Mute is
	// idempotent so retries and concurrent transports converge safely.
	return nil
}

func (s *Service) ResolveEffectiveMute(ctx context.Context, userID, workspaceID string) (Mute, error) {
	var row models.UserNotificationMute
	workspaceID = strings.TrimSpace(workspaceID)
	query := s.scopedActiveMuteQuery(s.db, userID, workspaceID, true, s.now().UTC()).Model(&row)
	if workspaceID != "" {
		query = query.
			OrderExpr("CASE WHEN scope = ? AND workspace_id = ? THEN 0 ELSE 1 END", MuteScopeWorkspace, workspaceID)
	}
	query = query.Order("ends_at DESC").Limit(1)
	if err := query.Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return Mute{}, nil
	} else if err != nil {
		return Mute{}, err
	}
	return s.muteView(ctx, s.db, row)
}

func (s *Service) scopedActiveMuteQuery(db bun.IDB, userID, workspaceID string, workspaceKnown bool, now time.Time) *bun.SelectQuery {
	query := db.NewSelect().Model((*models.UserNotificationMute)(nil)).
		Where("user_id = ? AND ended_at IS NULL AND starts_at <= ? AND ends_at > ?", strings.TrimSpace(userID), now, now)
	if !workspaceKnown {
		return query
	}
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return query.Where("scope = ?", MuteScopeAccount)
	}
	return query.Where("scope = ? OR (scope = ? AND workspace_id = ?)", MuteScopeAccount, MuteScopeWorkspace, workspaceID)
}

func (s *Service) isMutedWithDB(ctx context.Context, db bun.IDB, userID, workspaceID string, workspaceKnown bool) (bool, error) {
	return s.scopedActiveMuteQuery(db, userID, workspaceID, workspaceKnown, s.now().UTC()).Exists(ctx)
}

func (s *Service) listActiveMutes(ctx context.Context, db bun.IDB, userID, workspaceBindingID string) ([]Mute, error) {
	var rows []models.UserNotificationMute
	query := s.scopedActiveMuteQuery(db, userID, "", false, s.now().UTC()).Model(&rows)
	if workspaceBindingID = strings.TrimSpace(workspaceBindingID); workspaceBindingID != "" {
		query = query.Where("scope = ? AND workspace_id = ?", MuteScopeWorkspace, workspaceBindingID)
	}
	if err := query.
		OrderExpr("CASE WHEN scope = ? THEN 0 ELSE 1 END", MuteScopeAccount).
		Order("ends_at ASC", "id ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	mutes := make([]Mute, 0, len(rows))
	for _, row := range rows {
		view, err := s.muteView(ctx, db, row)
		if err != nil {
			return nil, err
		}
		if MuteScope(row.Scope) == MuteScopeWorkspace && view.WorkspaceName == "" {
			continue
		}
		mutes = append(mutes, view)
	}
	return mutes, nil
}

func (s *Service) muteView(ctx context.Context, db bun.IDB, row models.UserNotificationMute) (Mute, error) {
	view := Mute{ID: row.ID, Scope: MuteScope(row.Scope), WorkspaceID: row.WorkspaceID, StartsAt: row.StartsAt, EndsAt: row.EndsAt}
	if MuteScope(row.Scope) != MuteScopeWorkspace || row.WorkspaceID == "" {
		return view, nil
	}
	err := db.NewSelect().Model((*models.Workspace)(nil)).Column("name").
		Where("id = ?", row.WorkspaceID).
		Where("EXISTS (SELECT 1 FROM workspace_members AS member WHERE member.workspace_id = workspace.id AND member.user_id = ? AND member.status = ?)", row.UserID, models.WorkspaceMemberStatusActive).
		Scan(ctx, &view.WorkspaceName)
	if errors.Is(err, sql.ErrNoRows) {
		return view, nil
	}
	return view, err
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
	deliverEmail, err := s.shouldDeliverOptionalEmail(ctx, db, input, preference)
	if err != nil {
		return err
	}
	if !deliverInApp && !deliverEmail {
		return nil
	}
	if deliverInApp {
		if err := s.storeInAppNotification(ctx, db, input); err != nil {
			return err
		}
	}
	if !deliverEmail {
		return nil
	}
	if preference.EmailFrequency == EmailFrequencyDaily && !transactionalEmail[input.Type] {
		return s.enqueueDigestItemWithDB(ctx, db, input)
	}
	return s.enqueueEmailWithDB(ctx, db, input)
}

func (s *Service) shouldDeliverOptionalEmail(
	ctx context.Context,
	db bun.IDB,
	input CreateInput,
	preference ChannelPreference,
) (bool, error) {
	if preference.EmailFrequency == EmailFrequencyOff || s.sender == nil || input.SuppressEmail {
		return false, nil
	}
	if transactionalEmail[input.Type] {
		return true, nil
	}
	if s.beforeOptionalMuteCheck != nil {
		s.beforeOptionalMuteCheck()
	}
	muted, err := s.isMutedWithDB(ctx, db, input.UserID, input.WorkspaceID, true)
	return !muted, err
}

func (s *Service) storeInAppNotification(ctx context.Context, db bun.IDB, input CreateInput) error {
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

type emailDeliveryJob struct {
	DeliveryID          string            `json:"delivery_id"`
	Classification      string            `json:"classification,omitempty"`
	UserID              string            `json:"user_id,omitempty"`
	WorkspaceID         string            `json:"workspace_id,omitempty"`
	WorkspaceScopeKnown bool              `json:"workspace_scope_known,omitempty"`
	Type                string            `json:"type,omitempty"`
	Title               string            `json:"title,omitempty"`
	Body                string            `json:"body,omitempty"`
	SemanticData        map[string]string `json:"semantic_data,omitempty"`
	Href                string            `json:"href,omitempty"`
	Recipient           string            `json:"recipient,omitempty"`
	WorkspaceName       string            `json:"workspace_name,omitempty"`
	InviterName         string            `json:"inviter_name,omitempty"`
	Role                string            `json:"role,omitempty"`
	AcceptURLEnc        []byte            `json:"accept_url_encrypted,omitempty"`
	ExpiresAt           time.Time         `json:"expires_at,omitempty"`
	DeliveryWindowAt    time.Time         `json:"delivery_window_at,omitempty"`
}

func (s *Service) EnqueueWorkspaceInvitation(ctx context.Context, input WorkspaceInvitationEmailInput) (EmailDelivery, error) {
	return s.enqueueWorkspaceInvitation(ctx, s.db, input)
}

// EnqueueWorkspaceInvitationTx stores an invitation email in the caller's
// transaction so its delivery metadata can commit atomically with the job.
func (s *Service) EnqueueWorkspaceInvitationTx(ctx context.Context, tx bun.Tx, input WorkspaceInvitationEmailInput) (EmailDelivery, error) {
	return s.enqueueWorkspaceInvitation(ctx, tx, input)
}

func (s *Service) enqueueWorkspaceInvitation(ctx context.Context, db bun.IDB, input WorkspaceInvitationEmailInput) (EmailDelivery, error) {
	invitationSender, available := s.sender.(transactionalmail.WorkspaceInvitationSender)
	if !available || invitationSender == nil || s.encryptor == nil || s.publicURL == "" {
		return EmailDelivery{Status: EmailDeliveryUnavailable}, nil
	}
	if !workspaceInvitationEmailInputValid(input) {
		return EmailDelivery{Status: EmailDeliveryFailed}, fmt.Errorf("workspace invitation delivery facts are required")
	}
	if !publicHTTPURLValid(s.publicURL) {
		return EmailDelivery{Status: EmailDeliveryUnavailable}, nil
	}
	acceptURL := s.publicURL + "/invite?token=" + url.QueryEscape(strings.TrimSpace(input.RawToken))
	acceptURLEnc, err := s.encryptor.Encrypt(acceptURL)
	if err != nil {
		return EmailDelivery{Status: EmailDeliveryFailed}, fmt.Errorf("encrypt workspace invitation acceptance URL: %w", err)
	}
	jobID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("workspace-invitation\x00"+input.DeliveryKey)).String()
	payload, err := json.Marshal(emailDeliveryJob{
		DeliveryID: jobID, Classification: EmailClassificationTransactional,
		Recipient: strings.TrimSpace(input.Recipient), WorkspaceName: strings.TrimSpace(input.WorkspaceName),
		InviterName: strings.TrimSpace(input.InviterName), Role: strings.TrimSpace(input.Role),
		AcceptURLEnc: acceptURLEnc, ExpiresAt: input.ExpiresAt,
	})
	if err != nil {
		return EmailDelivery{Status: EmailDeliveryFailed}, fmt.Errorf("encode workspace invitation email job: %w", err)
	}
	job, err := jobregistry.NewJob(JobTypeEmailDelivery, string(payload), s.now())
	if err != nil {
		return EmailDelivery{Status: EmailDeliveryFailed}, err
	}
	job.ID = jobID
	if _, err := db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
		return EmailDelivery{Status: EmailDeliveryFailed}, err
	}
	return EmailDelivery{Status: EmailDeliveryQueued, JobID: jobID}, nil
}

func workspaceInvitationEmailInputValid(input WorkspaceInvitationEmailInput) bool {
	return strings.TrimSpace(input.InvitationID) != "" &&
		strings.TrimSpace(input.Recipient) != "" &&
		strings.TrimSpace(input.RawToken) != "" &&
		strings.TrimSpace(input.DeliveryKey) != ""
}

func publicHTTPURLValid(rawURL string) bool {
	publicURL, err := url.Parse(rawURL)
	return err == nil &&
		(publicURL.Scheme == "http" || publicURL.Scheme == "https") &&
		publicURL.Host != "" && publicURL.User == nil
}

func (s *Service) ResolveEmailDeliveryStatus(ctx context.Context, jobID, fallback string) (string, error) {
	if fallback == EmailDeliveryDelivered || fallback == EmailDeliveryFailed {
		return fallback, nil
	}
	if strings.TrimSpace(jobID) == "" {
		return fallback, nil
	}
	var status string
	err := s.db.NewSelect().Model((*models.Job)(nil)).Column("status").Where("id = ?", jobID).Scan(ctx, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return "", err
	}
	switch status {
	case jobregistry.StatusCompleted:
		return EmailDeliverySent, nil
	case jobregistry.StatusFailed:
		return EmailDeliveryFailed, nil
	default:
		return EmailDeliveryQueued, nil
	}
}

// RecordWorkspaceInvitationDelivery applies one authenticated callback after
// the transport-facing handler has verified its signature. A callback can
// affect only the current delivery generation of a live invitation.
func (s *Service) RecordWorkspaceInvitationDelivery(
	ctx context.Context,
	event WorkspaceInvitationDeliveryEvent,
) (WorkspaceInvitationDeliveryResult, error) {
	event, err := normalizeWorkspaceInvitationDeliveryEvent(event)
	if err != nil {
		return WorkspaceInvitationDeliveryResult{}, err
	}
	result := WorkspaceInvitationDeliveryResult{}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var recordErr error
		result, recordErr = s.recordWorkspaceInvitationDelivery(txCtx, tx, event)
		return recordErr
	})
	return result, err
}

func normalizeWorkspaceInvitationDeliveryEvent(event WorkspaceInvitationDeliveryEvent) (WorkspaceInvitationDeliveryEvent, error) {
	event.EventID = strings.TrimSpace(event.EventID)
	event.InvitationID = strings.TrimSpace(event.InvitationID)
	event.DeliveryID = strings.TrimSpace(event.DeliveryID)
	event.Outcome = strings.TrimSpace(event.Outcome)
	if event.EventID == "" || event.InvitationID == "" || event.DeliveryID == "" || event.OccurredAt.IsZero() {
		return WorkspaceInvitationDeliveryEvent{}, errors.New("delivery callback fields are required")
	}
	if event.Outcome != EmailDeliveryDelivered && event.Outcome != EmailDeliveryFailed {
		return WorkspaceInvitationDeliveryEvent{}, errors.New("delivery callback outcome is invalid")
	}
	event.OccurredAt = event.OccurredAt.UTC()
	return event, nil
}

func (s *Service) recordWorkspaceInvitationDelivery(ctx context.Context, tx bun.Tx, event WorkspaceInvitationDeliveryEvent) (WorkspaceInvitationDeliveryResult, error) {
	var invitation models.WorkspaceInvitation
	if err := tx.NewSelect().Model(&invitation).Where("id = ?", event.InvitationID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return WorkspaceInvitationDeliveryResult{Ignored: true}, nil
	} else if err != nil {
		return WorkspaceInvitationDeliveryResult{}, err
	}
	duplicate, err := s.insertWorkspaceInvitationDeliveryEvidence(ctx, tx, event)
	if err != nil {
		return WorkspaceInvitationDeliveryResult{}, err
	}
	if duplicate {
		return WorkspaceInvitationDeliveryResult{Duplicate: true}, nil
	}
	if invitation.EmailDeliveryJobID != event.DeliveryID || !invitation.AcceptedAt.IsZero() || !invitation.RevokedAt.IsZero() ||
		(!invitation.EmailDeliveryUpdatedAt.IsZero() && !event.OccurredAt.After(invitation.EmailDeliveryUpdatedAt)) {
		return WorkspaceInvitationDeliveryResult{Ignored: true}, nil
	}
	updated, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
		Set("email_delivery_status = ?", event.Outcome).
		Set("email_delivery_updated_at = ?", event.OccurredAt).
		Where("id = ? AND email_delivery_job_id = ?", event.InvitationID, event.DeliveryID).
		Where("accepted_at IS NULL AND revoked_at IS NULL").
		Where("email_delivery_updated_at IS NULL OR email_delivery_updated_at < ?", event.OccurredAt).
		Exec(ctx)
	if err != nil {
		return WorkspaceInvitationDeliveryResult{}, err
	}
	rows, err := updated.RowsAffected()
	if err != nil {
		return WorkspaceInvitationDeliveryResult{}, err
	}
	return WorkspaceInvitationDeliveryResult{Applied: rows == 1, Ignored: rows == 0}, nil
}

func (s *Service) insertWorkspaceInvitationDeliveryEvidence(ctx context.Context, tx bun.Tx, event WorkspaceInvitationDeliveryEvent) (bool, error) {
	evidence := &models.WorkspaceInvitationDeliveryEvent{
		EventID: event.EventID, InvitationID: event.InvitationID, DeliveryID: event.DeliveryID,
		Outcome: event.Outcome, OccurredAt: event.OccurredAt, CreatedAt: s.now(),
	}
	inserted, err := tx.NewInsert().Model(evidence).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := inserted.RowsAffected()
	return rows == 0, err
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
	classification := ""
	if transactionalEmail[input.Type] {
		classification = EmailClassificationRequired
	}
	payload, err := json.Marshal(emailDeliveryJob{
		DeliveryID:          jobID,
		Classification:      classification,
		UserID:              input.UserID,
		WorkspaceID:         strings.TrimSpace(input.WorkspaceID),
		WorkspaceScopeKnown: true,
		Type:                input.Type,
		Title:               strings.TrimSpace(input.Title),
		Body:                strings.TrimSpace(input.Body),
		SemanticData:        notificationSemanticData(input),
		Href:                href,
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

func (s *Service) enqueueDigestItemWithDB(ctx context.Context, db bun.IDB, input CreateInput) error {
	if s.beforeDigestPreferenceLock != nil {
		s.beforeDigestPreferenceLock()
	}
	settings, err := s.lockPreferenceSettings(ctx, db, input.UserID)
	if err != nil {
		return err
	}
	preference := settings.Preferences[input.Type]
	if preference.EmailFrequency == EmailFrequencyOff {
		return nil
	}
	if preference.EmailFrequency == EmailFrequencyImmediate {
		return s.enqueueEmailWithDB(ctx, db, input)
	}
	windowAt, err := nextDigestWindow(s.now(), settings.DigestTime, settings.DigestTimezone)
	if err != nil {
		return err
	}
	dedupKey := strings.TrimSpace(input.DedupKey)
	itemID := uuid.NewString()
	if dedupKey != "" {
		itemID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("notification-digest-item\x00"+input.UserID+"\x00"+dedupKey)).String()
	}
	href := strings.TrimSpace(input.Href)
	if !isSafeLocalNotificationHref(href) {
		href = ""
	}
	item := &models.UserNotificationDigestItem{
		ID: itemID, UserID: input.UserID, WorkspaceID: strings.TrimSpace(input.WorkspaceID), WorkspaceScopeKnown: true, Type: input.Type,
		Title: strings.TrimSpace(input.Title), Body: strings.TrimSpace(input.Body), Href: href,
		DedupKey: dedupKey, DeliveryWindowAt: windowAt, CreatedAt: s.now(),
	}
	if _, err := db.NewInsert().Model(item).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
		return fmt.Errorf("store notification digest item: %w", err)
	}
	return s.enqueueDigestJobWithDB(ctx, db, input.UserID, windowAt)
}

func (s *Service) enqueueDigestJobWithDB(ctx context.Context, db bun.IDB, userID string, windowAt time.Time) error {
	jobID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("notification-digest\x00"+userID+"\x00"+windowAt.Format(time.RFC3339Nano))).String()
	payload, err := json.Marshal(emailDeliveryJob{
		DeliveryID: jobID, Classification: EmailClassificationDailyDigest,
		UserID: userID, DeliveryWindowAt: windowAt,
	})
	if err != nil {
		return fmt.Errorf("encode notification digest job: %w", err)
	}
	job, err := jobregistry.NewJob(JobTypeEmailDelivery, string(payload), windowAt)
	if err != nil {
		return err
	}
	job.ID = jobID
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func nextDigestWindow(now time.Time, digestTime, timezone string) (time.Time, error) {
	hour, minute, err := parseDigestTime(digestTime)
	if err != nil {
		return time.Time{}, err
	}
	location, err := time.LoadLocation(strings.TrimSpace(timezone))
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: digest timezone is invalid", ErrInvalidPreferences)
	}
	localNow := now.In(location)
	window := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), hour, minute, 0, 0, location)
	if !window.After(localNow) {
		window = time.Date(localNow.Year(), localNow.Month(), localNow.Day()+1, hour, minute, 0, 0, location)
	}
	return window.UTC(), nil
}

func parseDigestTime(value string) (int, int, error) {
	parsed, err := time.Parse("15:04", strings.TrimSpace(value))
	if err != nil || parsed.Format("15:04") != strings.TrimSpace(value) {
		return 0, 0, fmt.Errorf("%w: digest time must use HH:MM", ErrInvalidPreferences)
	}
	return parsed.Hour(), parsed.Minute(), nil
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
	if job.Classification == EmailClassificationTransactional {
		return s.handleWorkspaceInvitationEmail(ctx, job)
	}
	if job.Classification == EmailClassificationDailyDigest {
		return s.handleDailyDigestEmail(ctx, job)
	}
	return s.handleImmediateEmail(ctx, job)
}

func (s *Service) handleImmediateEmail(ctx context.Context, job emailDeliveryJob) error {
	deliver, err := s.shouldDeliverImmediateJob(ctx, job)
	if err != nil {
		return err
	}
	if !deliver {
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
	if job.Classification != EmailClassificationRequired && s.publicURL != "" {
		preferencesURL = s.publicURL + "/settings?tab=notifications"
	}
	title, body := notificationEmailPresentation(job)
	err = s.sender.SendNotification(ctx, passwordmail.NotificationMessage{
		Recipient:      email,
		Title:          title,
		Body:           body,
		ActionURL:      actionURL,
		PreferencesURL: preferencesURL,
		IdempotencyKey: "notification-" + job.DeliveryID,
	})
	if err != nil && job.Classification == EmailClassificationRequired {
		// Provider responses may echo action content. Required notifications can
		// carry sensitive account actions, so worker evidence uses a fixed error.
		return errors.New("required notification email delivery failed")
	}
	return err
}

func notificationSemanticData(input CreateInput) map[string]string {
	if input.Type != TypeOwnershipTransfer || input.Payload["kind"] != OwnershipTransferSemanticKind {
		return nil
	}
	organizationName, _ := input.Payload["organization_name"].(string)
	organizationName = strings.TrimSpace(organizationName)
	if organizationName == "" {
		return nil
	}
	return map[string]string{"kind": OwnershipTransferSemanticKind, "organization_name": organizationName}
}

func notificationEmailPresentation(job emailDeliveryJob) (string, string) {
	if job.Type != TypeOwnershipTransfer || job.SemanticData["kind"] != OwnershipTransferSemanticKind {
		return job.Title, job.Body
	}
	organizationName := strings.TrimSpace(job.SemanticData["organization_name"])
	if organizationName == "" {
		return job.Title, job.Body
	}
	return "Organization ownership / Propriedade da Organização",
		fmt.Sprintf("Review the ownership nomination for %s. Accept or decline before it expires.\n\nReveja a nomeação de propriedade de %s. Aceite ou recuse antes de expirar.", organizationName, organizationName)
}

func (s *Service) shouldDeliverImmediateJob(ctx context.Context, job emailDeliveryJob) (bool, error) {
	if job.Classification == EmailClassificationRequired {
		return true, nil
	}
	preferences, err := s.GetPreferences(ctx, job.UserID)
	if err != nil {
		return false, err
	}
	if preferences[job.Type].EmailFrequency != EmailFrequencyImmediate {
		return false, nil
	}
	muted, err := s.isMutedWithDB(ctx, s.db, job.UserID, job.WorkspaceID, job.WorkspaceScopeKnown)
	return !muted, err
}

func (s *Service) handleDailyDigestEmail(ctx context.Context, job emailDeliveryJob) error {
	if strings.TrimSpace(job.UserID) == "" || job.DeliveryWindowAt.IsZero() {
		return errors.New("daily digest user and delivery window are required")
	}
	items, total, err := s.loadDailyDigestItems(ctx, job.UserID, job.DeliveryID, job.DeliveryWindowAt)
	if err != nil || total == 0 {
		return err
	}
	var email string
	if err := s.db.NewSelect().Model((*models.User)(nil)).Column("email").Where("id = ?", job.UserID).Scan(ctx, &email); errors.Is(err, sql.ErrNoRows) {
		return nil
	} else if err != nil {
		return fmt.Errorf("load notification digest recipient: %w", err)
	}
	body := renderDailyDigestBody(items, total)
	preferencesURL := ""
	if s.publicURL != "" {
		preferencesURL = s.publicURL + "/settings?tab=notifications"
	}
	if err := s.sender.SendNotification(ctx, passwordmail.NotificationMessage{
		Recipient: email, Title: "Your daily OpenPost digest", Body: body,
		PreferencesURL: preferencesURL, IdempotencyKey: "notification-digest-" + job.DeliveryID,
	}); err != nil {
		return err
	}
	_, err = s.db.NewUpdate().Model((*models.UserNotificationDigestItem)(nil)).
		Set("delivered_at = ?", s.now()).
		Where("user_id = ? AND delivery_id = ? AND delivered_at IS NULL", job.UserID, job.DeliveryID).
		Exec(ctx)
	return err
}

func (s *Service) loadDailyDigestItems(
	ctx context.Context,
	userID string,
	deliveryID string,
	windowAt time.Time,
) ([]models.UserNotificationDigestItem, int, error) {
	preferences, err := s.GetPreferences(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	dailyTypes := dailyEmailTypes(preferences)
	pendingDelete := s.db.NewDelete().Model((*models.UserNotificationDigestItem)(nil)).
		Where("user_id = ? AND delivery_window_at = ? AND delivered_at IS NULL", userID, windowAt).
		Where("delivery_id = '' OR delivery_id = ?", deliveryID)
	if len(dailyTypes) == 0 {
		_, err = pendingDelete.Exec(ctx)
		return nil, 0, err
	}
	if _, err = pendingDelete.Where("type NOT IN (?)", bun.List(dailyTypes)).Exec(ctx); err != nil {
		return nil, 0, fmt.Errorf("discard disabled notification digest items: %w", err)
	}
	if err = s.discardMutedDigestItems(ctx, userID, deliveryID, windowAt); err != nil {
		return nil, 0, fmt.Errorf("discard muted notification digest items: %w", err)
	}
	claimed, err := s.db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).
		Where("user_id = ? AND delivery_id = ? AND delivered_at IS NULL", userID, deliveryID).Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("inspect notification digest claim: %w", err)
	}
	if claimed == 0 {
		if _, err = s.db.NewUpdate().Model((*models.UserNotificationDigestItem)(nil)).
			Set("delivery_id = ?", deliveryID).
			Where("user_id = ? AND delivery_window_at = ? AND delivered_at IS NULL AND delivery_id = ''", userID, windowAt).
			Where("type IN (?)", bun.List(dailyTypes)).Exec(ctx); err != nil {
			return nil, 0, fmt.Errorf("claim notification digest items: %w", err)
		}
	}
	pending := s.db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).
		Where("user_id = ? AND delivery_id = ? AND delivered_at IS NULL", userID, deliveryID)
	total, err := pending.Count(ctx)
	if err != nil || total == 0 {
		return nil, total, err
	}
	var items []models.UserNotificationDigestItem
	if err = s.db.NewSelect().Model(&items).
		Where("user_id = ? AND delivery_id = ? AND delivered_at IS NULL", userID, deliveryID).
		Order("created_at ASC", "id ASC").Limit(20).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, 0, fmt.Errorf("load notification digest items: %w", err)
	}
	return items, total, nil
}

func (s *Service) discardMutedDigestItems(ctx context.Context, userID, deliveryID string, windowAt time.Time) error {
	var candidates []models.UserNotificationDigestItem
	if err := s.db.NewSelect().Model(&candidates).
		Column("id", "workspace_id", "workspace_scope_known").
		Where("user_id = ? AND delivery_window_at = ? AND delivered_at IS NULL", userID, windowAt).
		Where("delivery_id = '' OR delivery_id = ?", deliveryID).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	mutedByScope := map[string]bool{}
	mutedIDs := make([]string, 0)
	for _, item := range candidates {
		key := fmt.Sprintf("%t\x00%s", item.WorkspaceScopeKnown, item.WorkspaceID)
		muted, found := mutedByScope[key]
		if !found {
			var err error
			muted, err = s.isMutedWithDB(ctx, s.db, userID, item.WorkspaceID, item.WorkspaceScopeKnown)
			if err != nil {
				return err
			}
			mutedByScope[key] = muted
		}
		if muted {
			mutedIDs = append(mutedIDs, item.ID)
		}
	}
	if len(mutedIDs) == 0 {
		return nil
	}
	_, err := s.db.NewDelete().Model((*models.UserNotificationDigestItem)(nil)).Where("id IN (?)", bun.List(mutedIDs)).Exec(ctx)
	return err
}

func renderDailyDigestBody(items []models.UserNotificationDigestItem, total int) string {
	const maxBodyRunes = 1900
	var builder strings.Builder
	for index, item := range items {
		line := fmt.Sprintf("%d. %s", index+1, truncateRunes(strings.Join(strings.Fields(item.Title), " "), 120))
		if body := strings.TrimSpace(item.Body); body != "" {
			line += " — " + truncateRunes(strings.Join(strings.Fields(body), " "), 240)
		}
		if index > 0 {
			line = "\n" + line
		}
		if len([]rune(builder.String()+line)) > maxBodyRunes {
			break
		}
		builder.WriteString(line)
	}
	shown := strings.Count(builder.String(), "\n") + 1
	if total > shown {
		remaining := total - shown
		if remaining == 1 {
			builder.WriteString("\n1 more notification is included in this digest.")
		} else {
			fmt.Fprintf(&builder, "\n%d more notifications are included in this digest.", remaining)
		}
	}
	return builder.String()
}

func truncateRunes(value string, limit int) string {
	characters := []rune(value)
	if len(characters) <= limit {
		return value
	}
	return string(characters[:limit-1]) + "…"
}

func (s *Service) handleWorkspaceInvitationEmail(ctx context.Context, job emailDeliveryJob) error {
	invitationSender, ok := s.sender.(transactionalmail.WorkspaceInvitationSender)
	if !ok || s.encryptor == nil {
		return fmt.Errorf("transactional workspace invitation delivery is not configured")
	}
	acceptURL, err := s.encryptor.Decrypt(job.AcceptURLEnc)
	if err != nil || strings.TrimSpace(acceptURL) == "" {
		return errors.New("workspace invitation acceptance URL could not be decrypted")
	}
	err = invitationSender.SendWorkspaceInvitation(ctx, transactionalmail.WorkspaceInvitationMessage{
		Recipient: job.Recipient, WorkspaceName: job.WorkspaceName, InviterName: job.InviterName,
		Role: job.Role, AcceptURL: acceptURL, ExpiresAt: job.ExpiresAt,
		IdempotencyKey: "notification-" + job.DeliveryID,
	})
	if err != nil {
		// Provider responses may echo request content. Keep the acceptance URL
		// out of worker logs and telemetry by returning a fixed error.
		return errors.New("workspace invitation email delivery failed")
	}
	return nil
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
	return s.getPreferenceSettings(ctx, s.db, userID)
}

func (s *Service) GetPreferenceSettingsForActor(ctx context.Context, actor MuteActor) (PreferenceSettings, error) {
	userID := strings.TrimSpace(actor.UserID)
	workspaceBindingID := strings.TrimSpace(actor.WorkspaceBindingID)
	if workspaceBindingID == "" {
		return s.getPreferenceSettings(ctx, s.db, userID)
	}
	allowed, err := workspaceaccess.Allows(ctx, s.db, workspaceBindingID, userID)
	if err != nil {
		return PreferenceSettings{}, err
	}
	if !allowed {
		return PreferenceSettings{}, ErrMuteWorkspaceAccess
	}
	mutes, err := s.listActiveMutes(ctx, s.db, userID, workspaceBindingID)
	if err != nil {
		return PreferenceSettings{}, err
	}
	return PreferenceSettings{Preferences: Preferences{}, Mutes: mutes}, nil
}

func (s *Service) getPreferenceSettings(ctx context.Context, db bun.IDB, userID string) (PreferenceSettings, error) {
	preferences, err := s.getPreferences(ctx, db, userID)
	if err != nil {
		return PreferenceSettings{}, err
	}
	var email string
	if err := db.NewSelect().Model((*models.User)(nil)).
		Column("email").Where("id = ?", userID).Scan(ctx, &email); err != nil {
		return PreferenceSettings{}, err
	}
	var row models.UserNotificationPreference
	err = db.NewSelect().Model(&row).Where("user_id = ?", userID).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return PreferenceSettings{}, err
	}
	digestTime := "09:00"
	digestTimezone := "UTC"
	digestConfigured := false
	if err == nil {
		if strings.TrimSpace(row.DigestTime) != "" {
			digestTime = row.DigestTime
		}
		if strings.TrimSpace(row.DigestTimezone) != "" {
			digestTimezone = row.DigestTimezone
		}
		digestConfigured = row.DigestConfigured
	}
	mutes, err := s.listActiveMutes(ctx, db, userID, "")
	if err != nil {
		return PreferenceSettings{}, err
	}
	return PreferenceSettings{
		Preferences: preferences, EmailAvailable: s.sender != nil, EmailAddress: strings.TrimSpace(email),
		DigestTime: digestTime, DigestTimezone: digestTimezone, DigestConfigured: digestConfigured,
		Mutes: mutes,
	}, nil
}

// lockPreferenceSettings establishes one per-user serialization point for
// digest producers and preference updates. The no-op update takes a row lock
// on PostgreSQL and a write lock on SQLite, including for users who had no
// saved preference row before this transaction.
func (s *Service) lockPreferenceSettings(ctx context.Context, db bun.IDB, userID string) (PreferenceSettings, error) {
	encoded, err := json.Marshal(DefaultPreferences())
	if err != nil {
		return PreferenceSettings{}, err
	}
	seed := &models.UserNotificationPreference{
		UserID: userID, PreferencesJSON: string(encoded), DigestTime: "09:00",
		DigestTimezone: "UTC", DigestConfigured: false, UpdatedAt: s.now(),
	}
	if _, err := db.NewInsert().Model(seed).On("CONFLICT (user_id) DO NOTHING").Exec(ctx); err != nil {
		return PreferenceSettings{}, fmt.Errorf("ensure notification preferences: %w", err)
	}
	if _, err := db.NewUpdate().Model((*models.UserNotificationPreference)(nil)).
		Set("user_id = user_id").Where("user_id = ?", userID).Exec(ctx); err != nil {
		return PreferenceSettings{}, fmt.Errorf("lock notification preferences: %w", err)
	}
	return s.getPreferenceSettings(ctx, db, userID)
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
		InApp          *bool          `json:"in_app"`
		Email          *bool          `json:"email"`
		EmailFrequency EmailFrequency `json:"email_frequency"`
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
		if value.EmailFrequency.valid() {
			preference.EmailFrequency = value.EmailFrequency
		} else if value.Email != nil {
			if *value.Email {
				preference.EmailFrequency = EmailFrequencyImmediate
			} else {
				preference.EmailFrequency = EmailFrequencyOff
			}
		}
		if criticalInApp[eventType] {
			preference.InApp = true
		}
		if transactionalEmail[eventType] {
			preference.EmailFrequency = EmailFrequencyImmediate
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
	current, err := s.GetPreferenceSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	settings, err := s.UpdatePreferenceSettings(ctx, MuteActor{UserID: userID}, PreferenceUpdate{
		Preferences: preferences, DigestTime: current.DigestTime, DigestTimezone: current.DigestTimezone,
	})
	return settings.Preferences, err
}

func (s *Service) UpdatePreferenceSettings(ctx context.Context, actor MuteActor, update PreferenceUpdate) (PreferenceSettings, error) {
	userID := strings.TrimSpace(actor.UserID)
	if strings.TrimSpace(actor.WorkspaceBindingID) != "" {
		return PreferenceSettings{}, ErrMuteWorkspaceAccess
	}
	allowed := DefaultPreferences()
	clean := DefaultPreferences()
	for eventType, value := range update.Preferences {
		if _, ok := allowed[eventType]; !ok {
			return PreferenceSettings{}, fmt.Errorf("%w: unknown notification topic %q", ErrInvalidPreferences, eventType)
		}
		if !value.EmailFrequency.valid() {
			return PreferenceSettings{}, fmt.Errorf("%w: email frequency for %s is invalid", ErrInvalidPreferences, eventType)
		}
		if criticalInApp[eventType] {
			if !value.InApp {
				return PreferenceSettings{}, fmt.Errorf("%w: in-app delivery for %s must remain immediate", ErrInvalidPreferences, eventType)
			}
		}
		if transactionalEmail[eventType] {
			if value.EmailFrequency != EmailFrequencyImmediate {
				return PreferenceSettings{}, fmt.Errorf("%w: transactional email for %s must remain immediate", ErrInvalidPreferences, eventType)
			}
		}
		clean[eventType] = value
	}
	if _, _, err := parseDigestTime(update.DigestTime); err != nil {
		return PreferenceSettings{}, err
	}
	if _, err := time.LoadLocation(strings.TrimSpace(update.DigestTimezone)); err != nil {
		return PreferenceSettings{}, fmt.Errorf("%w: digest timezone is invalid", ErrInvalidPreferences)
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return PreferenceSettings{}, err
	}
	now := s.now()
	row := &models.UserNotificationPreference{
		UserID: userID, PreferencesJSON: string(encoded), DigestTime: strings.TrimSpace(update.DigestTime),
		DigestTimezone: strings.TrimSpace(update.DigestTimezone), DigestConfigured: true, UpdatedAt: now,
	}
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := s.lockPreferenceSettings(ctx, tx, userID); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(row).
			On("CONFLICT (user_id) DO UPDATE").
			Set("preferences_json = EXCLUDED.preferences_json").
			Set("digest_time = EXCLUDED.digest_time").
			Set("digest_timezone = EXCLUDED.digest_timezone").
			Set("digest_configured = EXCLUDED.digest_configured").
			Set("updated_at = EXCLUDED.updated_at").
			Exec(ctx); err != nil {
			return err
		}
		return s.reschedulePendingDigests(ctx, tx, userID, clean, update.DigestTime, update.DigestTimezone)
	})
	if err != nil {
		return PreferenceSettings{}, err
	}
	return s.GetPreferenceSettings(ctx, userID)
}

func (s *Service) reschedulePendingDigests(
	ctx context.Context,
	db bun.IDB,
	userID string,
	preferences Preferences,
	digestTime string,
	digestTimezone string,
) error {
	dailyTypes := dailyEmailTypes(preferences)
	pendingDelete := db.NewDelete().Model((*models.UserNotificationDigestItem)(nil)).
		Where("user_id = ? AND delivered_at IS NULL AND delivery_id = ''", userID)
	if len(dailyTypes) == 0 {
		_, err := pendingDelete.Exec(ctx)
		return err
	}
	if _, err := pendingDelete.Where("type NOT IN (?)", bun.List(dailyTypes)).Exec(ctx); err != nil {
		return fmt.Errorf("discard disabled notification digest items: %w", err)
	}
	count, err := db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).
		Where("user_id = ? AND delivered_at IS NULL AND delivery_id = ''", userID).
		Where("type IN (?)", bun.List(dailyTypes)).Count(ctx)
	if err != nil || count == 0 {
		return err
	}
	windowAt, err := nextDigestWindow(s.now(), digestTime, digestTimezone)
	if err != nil {
		return err
	}
	if _, err = db.NewUpdate().Model((*models.UserNotificationDigestItem)(nil)).
		Set("delivery_window_at = ?", windowAt).
		Where("user_id = ? AND delivered_at IS NULL AND delivery_id = ''", userID).
		Where("type IN (?)", bun.List(dailyTypes)).Exec(ctx); err != nil {
		return fmt.Errorf("reschedule notification digest items: %w", err)
	}
	return s.enqueueDigestJobWithDB(ctx, db, userID, windowAt)
}

func dailyEmailTypes(preferences Preferences) []string {
	types := make([]string, 0, len(preferences))
	for eventType, preference := range preferences {
		if preference.EmailFrequency == EmailFrequencyDaily {
			types = append(types, eventType)
		}
	}
	return types
}
