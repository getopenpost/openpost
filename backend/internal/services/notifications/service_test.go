package notifications

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func notificationsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
		(*models.UserNotificationDigestItem)(nil),
		(*models.UserNotificationMute)(nil),
		(*models.Job)(nil),
		(*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceInvitationDeliveryEvent)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "one@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Notifications"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Workspace{
		{ID: "workspace-1", OrganizationID: "organization-1", Name: "One"},
		{ID: "workspace-2", OrganizationID: "organization-1", Name: "Other organization"},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	return db
}

func TestWorkspaceMuteCreationRequiresActiveMembershipInTheService(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	_, err := db.NewUpdate().Model((*models.Workspace)(nil)).Set("name = ?", "Other organization").Where("id = ?", "workspace-2").Exec(t.Context())
	require.NoError(t, err)

	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-2", EndsAt: time.Now().Add(time.Hour),
	})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "unknown-user"}, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: time.Now().Add(time.Hour),
	})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)
}

func TestOptionalProducerRechecksMuteWhenCreateReplaceOrEndRacesIt(t *testing.T) {
	for _, action := range []string{"create", "replace", "end"} {
		t.Run(action, func(t *testing.T) {
			db := notificationsTestDB(t)
			service := NewService(db, Options{EmailDelivery: &recordingNotificationSender{}})
			now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
			service.now = func() time.Time { return now }
			_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyImmediate}}, DigestTime: "09:00", DigestTimezone: "UTC"})
			require.NoError(t, err)
			var mute Mute
			if action != "create" {
				mute, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour)})
				require.NoError(t, err)
			}
			paused, resume := make(chan struct{}), make(chan struct{})
			service.beforeOptionalMuteCheck = func() { close(paused); <-resume }
			result := make(chan error, 1)
			go func() {
				result <- service.createWithDB(t.Context(), db, createInput{UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeNewMessage, Title: action, DedupKey: "race:" + action})
			}()
			<-paused
			switch action {
			case "create":
				_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour)})
			case "replace":
				_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(2 * time.Hour)})
			case "end":
				err = service.EndMute(t.Context(), MuteActor{UserID: "user-1"}, mute.ID)
			}
			require.NoError(t, err)
			close(resume)
			require.NoError(t, <-result)
			jobs, countErr := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
			require.NoError(t, countErr)
			if action == "end" {
				require.Equal(t, 1, jobs)
			} else {
				require.Zero(t, jobs)
			}
		})
	}
}

type recordingNotificationSender struct {
	messages           []EmailMessage
	invitationMessages []transactionalmail.WorkspaceInvitationMessage
	err                error
	onNotification     func(EmailMessage)
}

func (s *recordingNotificationSender) DeliverNotificationEmail(_ context.Context, message EmailMessage) error {
	s.messages = append(s.messages, message)
	if s.onNotification != nil {
		s.onNotification(message)
	}
	return s.err
}

func (s *recordingNotificationSender) DeliverWorkspaceInvitationEmail(_ context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	s.invitationMessages = append(s.invitationMessages, message)
	return s.err
}

func TestWorkspaceInvitationEmailReportsProviderUnavailableWithoutQueueing(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{PublicURL: "https://app.openpost.test"})

	delivery, err := service.EnqueueWorkspaceInvitation(t.Context(), WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", WorkspaceID: "workspace-1", Recipient: "person@example.com",
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

func TestNotificationDedupKeyIsIdempotent(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	input := createInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Published",
		DedupKey: "publication:one:published",
	}
	require.NoError(t, service.create(ctx, input))
	require.NoError(t, service.create(ctx, input))
	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}
