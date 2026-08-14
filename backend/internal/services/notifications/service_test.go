package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func notificationsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.User)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "one@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	return db
}

type recordingNotificationSender struct {
	messages           []passwordmail.NotificationMessage
	invitationMessages []transactionalmail.WorkspaceInvitationMessage
	err                error
}

func (s *recordingNotificationSender) SendPasswordReset(_ context.Context, _ passwordmail.ResetMessage) error {
	return s.err
}

func (s *recordingNotificationSender) SendEmailVerification(_ context.Context, _ passwordmail.VerificationMessage) error {
	return s.err
}

func (s *recordingNotificationSender) SendNotification(_ context.Context, message passwordmail.NotificationMessage) error {
	s.messages = append(s.messages, message)
	return s.err
}

func (s *recordingNotificationSender) SendWorkspaceInvitation(_ context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	s.invitationMessages = append(s.invitationMessages, message)
	return s.err
}

func TestWorkspaceInvitationEmailIsTransactionalDurableAndRecipientIndependent(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test/",
	})
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypeWorkspaceInvite: {InApp: false, Email: false},
	})
	require.NoError(t, err)
	require.True(t, preferences[TypeWorkspaceInvite].InApp)
	require.True(t, preferences[TypeWorkspaceInvite].Email,
		"Transactional access email is not an optional preference")

	delivery, err := service.EnqueueWorkspaceInvitation(ctx, WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", Recipient: "new-person@example.com",
		WorkspaceName: "Launch team", InviterName: "Ada Lovelace", Role: "editor",
		ExpiresAt: now.Add(7 * 24 * time.Hour), RawToken: "op_inv_private-token",
		DeliveryKey: "invitation-1:2026-08-14T12:00:00Z",
	})
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryQueued, delivery.Status)
	require.NotEmpty(t, delivery.JobID)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Contains(t, jobs[0].Payload, `"classification":"transactional"`)
	require.NotContains(t, jobs[0].Payload, `"raw_token"`)
	require.NotContains(t, jobs[0].Payload, `"token_hash"`)
	require.NotContains(t, jobs[0].Payload, "op_inv_private-token")

	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Equal(t, []transactionalmail.WorkspaceInvitationMessage{{
		Recipient: "new-person@example.com", WorkspaceName: "Launch team",
		InviterName: "Ada Lovelace", Role: "editor",
		AcceptURL:      "https://app.openpost.test/invite?token=op_inv_private-token",
		ExpiresAt:      now.Add(7 * 24 * time.Hour),
		IdempotencyKey: "notification-" + jobs[0].ID,
	}}, sender.invitationMessages)

	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "transactional email content must not be persisted as an in-app notification")
}

func TestWorkspaceInvitationEmailReportsProviderUnavailableWithoutQueueing(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{PublicURL: "https://app.openpost.test"})

	delivery, err := service.EnqueueWorkspaceInvitation(t.Context(), WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", Recipient: "person@example.com",
		WorkspaceName: "Launch team", InviterName: "Ada", Role: "viewer",
		ExpiresAt: time.Now().UTC().Add(time.Hour), RawToken: "op_inv_private-token",
		DeliveryKey: "delivery-1",
	})
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryUnavailable, delivery.Status)
	require.Empty(t, delivery.JobID)

	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestWorkspaceInvitationEmailProjectsDurableProviderOutcome(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	job := &models.Job{
		ID: "invite-job", Type: JobTypeEmailDelivery, Payload: `{}`,
		Status: "pending", RunAt: time.Now().UTC(), MaxAttempts: 5,
	}
	_, err := db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	status, err := service.ResolveEmailDeliveryStatus(t.Context(), job.ID, EmailDeliveryUnavailable)
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryQueued, status)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", "completed").Where("id = ?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	status, err = service.ResolveEmailDeliveryStatus(t.Context(), job.ID, EmailDeliveryUnavailable)
	require.NoError(t, err)
	require.Equal(t, EmailDeliverySent, status)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", "failed").Where("id = ?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	status, err = service.ResolveEmailDeliveryStatus(t.Context(), job.ID, EmailDeliveryUnavailable)
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryFailed, status)
}

func TestWorkspaceInvitationProviderFailureDoesNotExposeAcceptanceSecret(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{err: errors.New("provider echoed op_inv_private-token")}
	service := NewService(db, Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test",
	})
	delivery, err := service.EnqueueWorkspaceInvitation(t.Context(), WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", Recipient: "person@example.com",
		WorkspaceName: "Launch", InviterName: "Ada", Role: "viewer",
		ExpiresAt: time.Now().UTC().Add(time.Hour), RawToken: "op_inv_private-token",
		DeliveryKey: "delivery-1",
	})
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", delivery.JobID).Scan(t.Context()))

	err = service.HandleJob(t.Context(), job.Type, job.Payload)
	require.EqualError(t, err, "workspace invitation email delivery failed")
	require.NotContains(t, err.Error(), "op_inv_private-token")
}

func TestNotificationDedupKeyIsIdempotent(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	input := CreateInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Published",
		DedupKey: "publication:one:published",
	}
	require.NoError(t, service.Create(ctx, input))
	require.NoError(t, service.Create(ctx, input))
	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestNotificationPreferencesSuppressOptionalButKeepCritical(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypeNewMessage:    {InApp: false},
		TypePublishFailed: {InApp: false},
	})
	require.NoError(t, err)
	require.False(t, preferences[TypeNewMessage].InApp)
	require.True(t, preferences[TypePublishFailed].InApp)

	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypeNewMessage, Title: "Optional",
	}))
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Critical",
	}))
	page, err := service.List(ctx, "user-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "Critical", page.Items[0].Title)
	require.Equal(t, 1, page.UnreadCount)
}

func TestLegacyNotificationPreferencesAdoptNewEmailDefaults(t *testing.T) {
	db := notificationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.UserNotificationPreference{
		UserID:          "user-1",
		PreferencesJSON: `{"publish_failed":{"in_app":true},"post_published":{"in_app":false}}`,
		UpdatedAt:       time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	preferences, err := NewService(db).GetPreferences(ctx, "user-1")
	require.NoError(t, err)
	require.True(t, preferences[TypePublishFailed].Email)
	require.False(t, preferences[TypePostPublished].Email)
	require.False(t, preferences[TypePostPublished].InApp)
}

func TestNotificationEmailDeliveryIsDurableDeduplicatedAndPreferenceAware(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test/"})
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	require.True(t, DefaultPreferences()[TypePublishFailed].Email)
	require.False(t, DefaultPreferences()[TypePostPublished].Email)
	input := CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Publication failed",
		Body: "OpenPost could not publish to Mastodon.", Href: "/activity?publication=publication-1",
		DedupKey: "publication:publication-1:failed",
	}
	require.NoError(t, service.Create(ctx, input))
	require.NoError(t, service.Create(ctx, input))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Equal(t, "pending", jobs[0].Status)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Equal(t, []passwordmail.NotificationMessage{{
		Recipient:      "one@example.com",
		Title:          "Publication failed",
		Body:           "OpenPost could not publish to Mastodon.",
		ActionURL:      "https://app.openpost.test/activity?publication=publication-1",
		PreferencesURL: "https://app.openpost.test/settings?tab=notifications",
		IdempotencyKey: "notification-" + jobs[0].ID,
	}}, sender.messages)

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypePublishFailed: {InApp: true, Email: false},
	})
	require.NoError(t, err)
	require.False(t, preferences[TypePublishFailed].Email)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 1)
}

func TestNotificationCanDeliverEmailWithoutCreatingOptionalInAppItem(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test"})
	ctx := context.Background()

	_, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypePostPublished: {InApp: false, Email: true},
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Publication completed",
		DedupKey: "publication:publication-1:published",
	}))

	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	jobs, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobTypeEmailDelivery).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, jobs)
}

func TestNotificationListAndChangesUseVisibleWorkspaceScope(t *testing.T) {
	db := notificationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{ID: "user-2", Email: "two@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db)
	for _, input := range []CreateInput{
		{UserID: "user-1", WorkspaceID: "workspace-1", Type: TypePostPublished, Title: "Workspace one"},
		{UserID: "user-1", WorkspaceID: "workspace-2", Type: TypePostPublished, Title: "Workspace two"},
		{UserID: "user-1", Type: TypeWorkspaceInvite, Title: "Global"},
		{UserID: "user-2", WorkspaceID: "workspace-1", Type: TypePostPublished, Title: "Other user"},
	} {
		require.NoError(t, service.Create(ctx, input))
	}

	page, err := service.List(ctx, "user-1", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	require.Equal(t, 2, page.UnreadCount)

	var workspaceTwoID string
	require.NoError(t, db.NewSelect().Model((*models.UserNotification)(nil)).
		Column("id").Where("user_id = ? AND workspace_id = ?", "user-1", "workspace-2").
		Scan(ctx, &workspaceTwoID))
	require.NoError(t, service.MarkRead(ctx, "user-1", "workspace-1", []string{workspaceTwoID}, false))

	otherWorkspace, err := service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Equal(t, 2, otherWorkspace.UnreadCount, "an ID from another workspace must not bypass the visible-workspace scope")
	require.NoError(t, service.MarkRead(ctx, "user-1", "workspace-1", nil, true))

	page, err = service.List(ctx, "user-1", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Zero(t, page.UnreadCount)

	otherWorkspace, err = service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Equal(t, 1, otherWorkspace.UnreadCount, "a workspace-one bulk action must not mark workspace-two notifications read")

	require.NoError(t, service.Delete(ctx, "user-1", "workspace-1", []string{workspaceTwoID}, false))
	require.NoError(t, service.Delete(ctx, "user-1", "workspace-1", nil, true))

	otherWorkspace, err = service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Len(t, otherWorkspace.Items, 1)
	require.Equal(t, "Workspace two", otherWorkspace.Items[0].Title)
	require.Equal(t, 1, otherWorkspace.UnreadCount)

	require.ErrorIs(t, service.MarkRead(ctx, "user-1", "", nil, true), errWorkspaceScopeRequired)
	require.ErrorIs(t, service.Delete(ctx, "user-1", "", nil, true), errWorkspaceScopeRequired)
	otherWorkspace, err = service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Len(t, otherWorkspace.Items, 1)
	require.Equal(t, 1, otherWorkspace.UnreadCount)

	other, err := service.List(ctx, "user-2", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Len(t, other.Items, 1)
}

func TestNotificationListCursorReachesEveryItemWithoutDuplicates(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	base := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	items := make([]models.UserNotification, 0, 125)
	for index := range 125 {
		items = append(items, models.UserNotification{
			ID:          fmt.Sprintf("notification-%03d", index),
			UserID:      "user-1",
			WorkspaceID: "workspace-1",
			Type:        TypePostPublished,
			Title:       fmt.Sprintf("Notification %03d", index),
			CreatedAt:   base.Add(-time.Duration(index/2) * time.Minute),
		})
	}
	_, err := db.NewInsert().Model(&items).Exec(ctx)
	require.NoError(t, err)

	seen := make(map[string]bool, len(items))
	cursor := ""
	pageCount := 0
	for {
		page, err := service.List(ctx, "user-1", "workspace-1", cursor, 30)
		require.NoError(t, err)
		require.Equal(t, len(items), page.UnreadCount)
		for _, item := range page.Items {
			require.False(t, seen[item.ID], "notification %s appeared on more than one page", item.ID)
			seen[item.ID] = true
		}
		pageCount++
		if page.NextCursor == "" {
			break
		}
		require.NotEqual(t, cursor, page.NextCursor)
		cursor = page.NextCursor
	}
	require.Equal(t, 5, pageCount)
	require.Len(t, seen, len(items))

	_, err = service.List(ctx, "user-1", "workspace-1", "not-a-cursor", 30)
	require.ErrorIs(t, err, ErrInvalidCursor)
	_, err = service.List(ctx, "user-1", "workspace-1", base.Format(time.RFC3339Nano)+"|", 30)
	require.ErrorIs(t, err, ErrInvalidCursor)
}

func TestNotificationActionsKeepOnlySafeLocalOperations(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Partial failure",
		Actions: []models.NotificationAction{
			{Label: "Retry failed", Operation: "retry_failed_publication", TargetID: "publication-1", Kind: "primary"},
			{Label: "View results", Href: "/activity?tab=failed"},
			{Label: "Mixed", Href: "https://provider.example/private", Operation: "retry_failed_publication", TargetID: "publication-2"},
			{Label: "Unsafe", Href: "https://provider.example/private"},
			{Label: "Backslash", Href: `/\provider.example/private`},
			{Label: "Unknown", Operation: "delete_everything", TargetID: "publication-1"},
		},
	}))

	page, err := service.List(ctx, "user-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, []models.NotificationAction{
		{Label: "Retry failed", Kind: "primary", Operation: "retry_failed_publication", TargetID: "publication-1"},
		{Label: "View results", Href: "/activity?tab=failed", Kind: "secondary"},
		{Label: "Mixed", Kind: "secondary", Operation: "retry_failed_publication", TargetID: "publication-2"},
	}, page.Items[0].Actions)
}
