package workspaceteam

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

type teamInvitationSender struct {
	messages []transactionalmail.WorkspaceInvitationMessage
}

func (s *teamInvitationSender) SendPasswordReset(context.Context, passwordmail.ResetMessage) error {
	return nil
}

func (s *teamInvitationSender) SendEmailVerification(context.Context, passwordmail.VerificationMessage) error {
	return nil
}

func (s *teamInvitationSender) SendNotification(context.Context, passwordmail.NotificationMessage) error {
	return nil
}

func (s *teamInvitationSender) SendWorkspaceInvitation(_ context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	s.messages = append(s.messages, message)
	return nil
}

func newTeamTestService(t *testing.T, seatLimit int64) (*Service, *bun.DB) {
	t.Helper()
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.User)(nil), (*models.Organization)(nil), (*models.OrganizationMember)(nil), (*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil), (*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceAccessAuditEvent)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	service := NewService(db, entitlements.NewStaticService(entitlements.PlanSnapshot{
		PlanID: "test", Limits: map[entitlements.LimitKey]int64{entitlements.LimitTeamMembers: seatLimit},
	}), nil)
	now := time.Date(2026, time.August, 9, 18, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	seedTeamUser(t, db, "admin-1", "admin@example.com")
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Team", CreatedByID: "admin-1", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationMember{OrganizationID: "org-1", UserID: "admin-1", Role: models.OrganizationRoleOwner, CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "Team", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	seedTeamMember(t, db, "admin-1", models.WorkspaceRoleAdmin, now)
	return service, db
}

func seedTeamUser(t *testing.T, db *bun.DB, id, email string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.User{ID: id, Email: email}).Exec(t.Context())
	require.NoError(t, err)
}

func seedTeamMember(t *testing.T, db *bun.DB, userID, role string, now time.Time) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: userID, Role: role, Status: models.WorkspaceMemberStatusActive,
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func TestMemberLifecycleAuditsEveryAccessChange(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	now := service.now()
	seedTeamUser(t, db, "member-1", "member@example.com")
	seedTeamMember(t, db, "member-1", models.WorkspaceRoleViewer, now)

	member, err := service.UpdateMember(t.Context(), UpdateMemberInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1", SubjectUserID: "member-1",
		Role: models.WorkspaceRoleEditor,
	})
	require.NoError(t, err)
	require.Equal(t, models.WorkspaceRoleEditor, member.Role)

	member, err = service.UpdateMember(t.Context(), UpdateMemberInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1", SubjectUserID: "member-1",
		Status: models.WorkspaceMemberStatusInactive,
	})
	require.NoError(t, err)
	require.Equal(t, models.WorkspaceMemberStatusInactive, member.Status)
	require.False(t, member.DeactivatedAt.IsZero())

	team, err := service.List(t.Context(), "workspace-1", "admin-1", Filters{Status: "inactive", Query: "MEMBER@"})
	require.NoError(t, err)
	require.Len(t, team.Members, 1)
	require.Equal(t, int64(1), team.CurrentSeats, "inactive members do not reserve seats")

	member, err = service.UpdateMember(t.Context(), UpdateMemberInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1", SubjectUserID: "member-1",
		Status: models.WorkspaceMemberStatusActive,
	})
	require.NoError(t, err)
	require.True(t, member.DeactivatedAt.IsZero())

	require.NoError(t, service.RemoveMember(t.Context(), "workspace-1", "member-1", "admin-1"))
	events, err := service.ListAudit(t.Context(), "workspace-1", "admin-1", 50)
	require.NoError(t, err)
	actions := make([]string, 0, len(events))
	for _, event := range events {
		actions = append(actions, event.Action)
	}
	require.ElementsMatch(t, []string{
		ActionMemberRoleChanged, ActionMemberDeactivated, ActionMemberReactivated, ActionMemberRemoved,
	}, actions)
}

func TestLastAdminAndUnauthorizedMutationSafeguards(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	seedTeamUser(t, db, "viewer-1", "viewer@example.com")
	seedTeamMember(t, db, "viewer-1", models.WorkspaceRoleViewer, service.now())

	_, err := service.UpdateMember(t.Context(), UpdateMemberInput{
		WorkspaceID: "workspace-1", ActorUserID: "viewer-1", SubjectUserID: "admin-1",
		Role: models.WorkspaceRoleViewer,
	})
	require.Equal(t, ErrorForbidden, ErrorKindOf(err))

	for _, update := range []UpdateMemberInput{
		{WorkspaceID: "workspace-1", ActorUserID: "admin-1", SubjectUserID: "admin-1", Role: models.WorkspaceRoleEditor},
		{WorkspaceID: "workspace-1", ActorUserID: "admin-1", SubjectUserID: "admin-1", Status: models.WorkspaceMemberStatusInactive},
	} {
		_, err := service.UpdateMember(t.Context(), update)
		require.Equal(t, ErrorConflict, ErrorKindOf(err))
		require.Contains(t, err.Error(), "at least one active administrator")
	}
	err = service.RemoveMember(t.Context(), "workspace-1", "admin-1", "admin-1")
	require.Equal(t, ErrorConflict, ErrorKindOf(err))

	seedTeamUser(t, db, "admin-2", "admin2@example.com")
	seedTeamMember(t, db, "admin-2", models.WorkspaceRoleAdmin, service.now())
	require.NoError(t, service.RemoveMember(t.Context(), "workspace-1", "admin-1", "admin-1"), "self-removal is safe when another active admin remains")
	_, err = service.List(t.Context(), "workspace-1", "admin-1", Filters{})
	require.Equal(t, ErrorForbidden, ErrorKindOf(err))
}

func TestInvitationResendRevocationAcceptanceAndSearch(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	seedTeamUser(t, db, "invitee-1", "invitee@example.com")

	invitation, oldToken, err := service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1", Email: " Invitee@Example.com ", Role: models.WorkspaceRoleEditor,
	})
	require.NoError(t, err)
	require.Equal(t, "invitee@example.com", invitation.Email)

	resent, newToken, err := service.ResendInvitation(t.Context(), "workspace-1", invitation.ID, "admin-1")
	require.NoError(t, err)
	require.NotEqual(t, oldToken, newToken)
	require.Equal(t, service.now().Add(InvitationLifetime), resent.ExpiresAt)
	_, err = service.FindInvitationByToken(t.Context(), oldToken)
	require.Equal(t, ErrorNotFound, ErrorKindOf(err))

	team, err := service.List(t.Context(), "workspace-1", "admin-1", Filters{Status: "pending", Query: "INVITEE"})
	require.NoError(t, err)
	require.Len(t, team.Invitations, 1)
	require.Equal(t, int64(2), team.CurrentSeats)

	require.NoError(t, service.RevokeInvitation(t.Context(), "workspace-1", invitation.ID, "admin-1"))
	err = service.AcceptInvitation(t.Context(), resent, "invitee-1")
	require.Equal(t, ErrorConflict, ErrorKindOf(err))
	require.Contains(t, err.Error(), "revoked")

	second, _, err := service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1", Email: "invitee@example.com", Role: models.WorkspaceRoleViewer,
	})
	require.NoError(t, err)
	require.NoError(t, service.AcceptInvitation(t.Context(), second, "invitee-1"))
	team, err = service.List(t.Context(), "workspace-1", "admin-1", Filters{Status: "active", Role: models.WorkspaceRoleViewer})
	require.NoError(t, err)
	require.Len(t, team.Members, 1)
	require.Equal(t, "invitee-1", team.Members[0].UserID)
}

func TestInvitationQueuesTransactionalEmailForUnregisteredRecipient(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	_, err := db.NewCreateTable().Model((*models.Job)(nil)).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.UserNotification)(nil)).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.UserNotificationPreference)(nil)).Exec(t.Context())
	require.NoError(t, err)
	sender := &teamInvitationSender{}
	service.notifications = notifications.NewService(db, notifications.Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test",
	})

	invitation, rawToken, err := service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1",
		Email: "not-registered@example.com", Role: models.WorkspaceRoleEditor,
	})
	require.NoError(t, err)
	require.Equal(t, notifications.EmailDeliveryQueued, invitation.EmailDeliveryStatus)
	require.NotEmpty(t, invitation.EmailDeliveryJobID)
	require.NotEmpty(t, rawToken)

	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", invitation.EmailDeliveryJobID).Scan(t.Context()))
	require.NotContains(t, job.Payload, invitation.TokenHash)
	require.NoError(t, service.notifications.HandleJob(t.Context(), job.Type, job.Payload))
	require.Len(t, sender.messages, 1)
	require.Equal(t, "not-registered@example.com", sender.messages[0].Recipient)
	require.Equal(t, "Team", sender.messages[0].WorkspaceName)
	require.Equal(t, "admin@example.com", sender.messages[0].InviterName)

	resent, _, err := service.ResendInvitation(t.Context(), "workspace-1", invitation.ID, "admin-1")
	require.NoError(t, err)
	require.Equal(t, notifications.EmailDeliveryQueued, resent.EmailDeliveryStatus)
	require.NotEqual(t, invitation.EmailDeliveryJobID, resent.EmailDeliveryJobID)
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", notifications.JobTypeEmailDelivery).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, jobCount, "each rotated invitation secret gets exactly one durable delivery")
}

func TestResendCrashStateAndStaleDeliveryCompletionStayTruthful(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	for _, model := range []any{
		(*models.Job)(nil), (*models.UserNotification)(nil), (*models.UserNotificationPreference)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	service.notifications = notifications.NewService(db, notifications.Options{
		Sender: &teamInvitationSender{}, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test",
	})

	invitation, _, err := service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1",
		Email: "person@example.com", Role: models.WorkspaceRoleViewer,
	})
	require.NoError(t, err)
	require.Equal(t, notifications.EmailDeliveryQueued, invitation.EmailDeliveryStatus)

	rawToken, tokenHash, err := GenerateInvitationToken()
	require.NoError(t, err)
	rotated, err := service.rotateInvitation(
		t.Context(), "workspace-1", invitation.ID, "admin-1", tokenHash,
		entitlements.Decision{Allowed: true, Unlimited: true}, service.now(),
	)
	require.NoError(t, err)
	require.Equal(t, notifications.EmailDeliveryUnavailable, rotated.EmailDeliveryStatus,
		"a crash before enqueue must not leave the invalidated email marked sent or queued")
	require.Empty(t, rotated.EmailDeliveryJobID)

	var stored models.WorkspaceInvitation
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", rotated.ID).Scan(t.Context()))
	require.Equal(t, notifications.EmailDeliveryUnavailable, stored.EmailDeliveryStatus)
	require.Empty(t, stored.EmailDeliveryJobID)

	jobCountBefore, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	stale := rotated
	stale.TokenHash = "superseded-generation"
	err = service.finishInvitationDelivery(t.Context(), &stale, "op_inv_superseded", true)
	require.Equal(t, ErrorConflict, ErrorKindOf(err))
	jobCountAfter, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, jobCountBefore, jobCountAfter, "a stale generation must roll back its delivery job")

	require.NoError(t, service.finishInvitationDelivery(t.Context(), &rotated, rawToken, true))
	require.Equal(t, notifications.EmailDeliveryQueued, rotated.EmailDeliveryStatus)
}

func TestRegisteredInvitationKeepsRawTokenOutOfNotificationAndAuditRecords(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	for _, model := range []any{
		(*models.Job)(nil), (*models.UserNotification)(nil), (*models.UserNotificationPreference)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	seedTeamUser(t, db, "invitee-1", "registered@example.com")
	sender := &teamInvitationSender{}
	service.notifications = notifications.NewService(db, notifications.Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test",
	})
	_, err := service.notifications.UpdatePreferences(t.Context(), "invitee-1", notifications.Preferences{
		notifications.TypeWorkspaceInvite: {InApp: false, Email: false},
	})
	require.NoError(t, err)

	invitation, rawToken, err := service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1",
		Email: "registered@example.com", Role: models.WorkspaceRoleAdmin,
	})
	require.NoError(t, err)
	require.Equal(t, notifications.EmailDeliveryQueued, invitation.EmailDeliveryStatus,
		"Transactional delivery bypasses the recipient's optional email preference")

	var inApp models.UserNotification
	require.NoError(t, db.NewSelect().Model(&inApp).Where("user_id = ?", "invitee-1").Scan(t.Context()))
	require.NotContains(t, inApp.Title, rawToken)
	require.NotContains(t, inApp.Body, rawToken)
	require.NotContains(t, inApp.Href, rawToken)
	require.NotContains(t, inApp.PayloadJSON, rawToken)

	var audit models.WorkspaceAccessAuditEvent
	require.NoError(t, db.NewSelect().Model(&audit).Where("invitation_id = ?", invitation.ID).Scan(t.Context()))
	require.NotContains(t, fmt.Sprintf("%+v", audit), rawToken)
}

func TestInvitationEnqueueFailureKeepsOneInvitationAndCopyToken(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	sender := &teamInvitationSender{}
	service.notifications = notifications.NewService(db, notifications.Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test",
	})

	invitation, rawToken, err := service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1",
		Email: "person@example.com", Role: models.WorkspaceRoleViewer,
	})
	require.NoError(t, err)
	require.NotEmpty(t, rawToken, "the one-time copy-link token remains actionable")
	require.Equal(t, notifications.EmailDeliveryFailed, invitation.EmailDeliveryStatus)
	require.Empty(t, invitation.EmailDeliveryJobID)

	count, err := db.NewSelect().Model((*models.WorkspaceInvitation)(nil)).
		Where("workspace_id = ? AND email = ? AND revoked_at IS NULL", "workspace-1", "person@example.com").
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	team, err := service.List(t.Context(), "workspace-1", "admin-1", Filters{})
	require.NoError(t, err)
	require.Len(t, team.Invitations, 1)
	require.Equal(t, notifications.EmailDeliveryFailed, team.Invitations[0].EmailDeliveryStatus)

	_, _, err = service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1",
		Email: "person@example.com", Role: models.WorkspaceRoleViewer,
	})
	require.Equal(t, ErrorConflict, ErrorKindOf(err))
}

func TestConcurrentInvitationsCannotExceedSeatLimit(t *testing.T) {
	service, _ := newTeamTestService(t, 2)
	const attempts = 12
	start := make(chan struct{})
	errs := make([]error, attempts)
	var wait sync.WaitGroup
	for index := 0; index < attempts; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			_, _, errs[index] = service.Invite(context.Background(), InviteInput{
				WorkspaceID: "workspace-1", ActorUserID: "admin-1",
				Email: fmt.Sprintf("invitee-%02d@example.com", index), Role: models.WorkspaceRoleViewer,
			})
		}(index)
	}
	close(start)
	wait.Wait()
	successes := 0
	for _, err := range errs {
		if err == nil {
			successes++
			continue
		}
		require.Equal(t, ErrorPayment, ErrorKindOf(err))
	}
	require.Equal(t, 1, successes)
	team, err := service.List(t.Context(), "workspace-1", "admin-1", Filters{})
	require.NoError(t, err)
	require.Equal(t, int64(2), team.CurrentSeats)
}

func TestResendingExpiredInvitationCannotExceedSeatLimit(t *testing.T) {
	service, db := newTeamTestService(t, 1)
	expired := &models.WorkspaceInvitation{
		ID: "expired-invite", WorkspaceID: "workspace-1", Email: "expired@example.com",
		Role: models.WorkspaceRoleViewer, InvitedByUserID: "admin-1",
		TokenHash: HashInvitationToken("old-token"), ExpiresAt: service.now().Add(-time.Hour),
		LastSentAt: service.now().Add(-InvitationLifetime), CreatedAt: service.now().Add(-InvitationLifetime),
	}
	_, err := db.NewInsert().Model(expired).Exec(t.Context())
	require.NoError(t, err)

	_, _, err = service.ResendInvitation(t.Context(), "workspace-1", expired.ID, "admin-1")
	require.Equal(t, ErrorPayment, ErrorKindOf(err))

	var unchanged models.WorkspaceInvitation
	require.NoError(t, db.NewSelect().Model(&unchanged).Where("id = ?", expired.ID).Scan(t.Context()))
	require.Equal(t, expired.TokenHash, unchanged.TokenHash)
	require.True(t, unchanged.ExpiresAt.Equal(expired.ExpiresAt))
}

func TestInactiveAdminCannotManageTeam(t *testing.T) {
	service, db := newTeamTestService(t, 10)
	_, err := db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("status = ?", models.WorkspaceMemberStatusInactive).
		Where("workspace_id = ? AND user_id = ?", "workspace-1", "admin-1").Exec(t.Context())
	require.NoError(t, err)
	_, _, err = service.Invite(t.Context(), InviteInput{
		WorkspaceID: "workspace-1", ActorUserID: "admin-1", Email: "person@example.com", Role: models.WorkspaceRoleEditor,
	})
	require.Equal(t, ErrorForbidden, ErrorKindOf(err))
}
