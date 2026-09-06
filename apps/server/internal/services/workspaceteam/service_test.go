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
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

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
		(*models.WorkspaceInvitationResend)(nil),
		(*models.WorkspaceInvitationDeliveryEvent)(nil),
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
