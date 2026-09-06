package organizationownership

import (
	"context"
	"database/sql"
	"errors"
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

type ownershipTestReauth struct {
	mu   sync.Mutex
	used map[string]bool
}

func (r *ownershipTestReauth) ConsumeReauthGrant(_ context.Context, raw, userID, sessionID, action string) error {
	if raw == "" || userID == "" || sessionID == "" || action != ReauthAction {
		return errors.New("invalid reauthentication grant")
	}
	if raw != "one-time" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.used[raw] {
		return errors.New("reauthentication grant already used")
	}
	r.used[raw] = true
	return nil
}

func newOwnershipTestService(t *testing.T) (*Service, *bun.DB) {
	t.Helper()
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(8)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.User)(nil), (*models.Organization)(nil), (*models.OrganizationMember)(nil), (*models.Workspace)(nil), (*models.OrganizationOwnershipTransfer)(nil), (*models.OrganizationOwnershipAuditEvent)(nil), (*models.BillingSubscription)(nil), (*models.UserNotificationPreference)(nil), (*models.UserNotification)(nil), (*models.Job)(nil)} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	now := time.Date(2026, 8, 14, 18, 0, 0, 0, time.UTC)
	users := []models.User{{ID: "owner", Email: "owner@example.com"}, {ID: "nominee", Email: "nominee@example.com"}, {ID: "outsider", Email: "outsider@example.com"}}
	_, err = db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org", Name: "Acme", CreatedByID: "owner", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	members := []models.OrganizationMember{{OrganizationID: "org", UserID: "owner", Role: models.OrganizationRoleOwner, CreatedAt: now}, {OrganizationID: "org", UserID: "nominee", Role: models.OrganizationRoleMember, CreatedAt: now}}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, nil, &ownershipTestReauth{used: map[string]bool{}})
	service.now = func() time.Time { return now }
	return service, db
}

func testCredential(userID string) Credential {
	return Credential{UserID: userID, SessionID: userID + "-session"}
}

func TestAcceptanceAtomicallySwapsExactlyOneOwnerAndIsSingleUse(t *testing.T) {
	service, db := newOwnershipTestService(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org", Provider: models.BillingProviderPaddle,
		ProviderCustomerID: "customer", ProviderSubscriptionID: "subscription",
		Status: "active", PlanID: "pro", EntitlementSnapshot: `{"limits":{"social_accounts":10}}`,
	}).Exec(t.Context())
	require.NoError(t, err)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)

	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, acceptErr := service.Accept(context.Background(), transfer.ID, testCredential("nominee"))
			results <- acceptErr
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for result := range results {
		if result == nil {
			successes++
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, ownerCount(t, db))
	require.Equal(t, models.OrganizationRoleAdmin, memberRole(t, db, "owner"))
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "nominee"))
	var creatorID string
	require.NoError(t, db.NewSelect().Model((*models.Organization)(nil)).Column("created_by").Where("id = ?", "org").Scan(t.Context(), &creatorID))
	require.Equal(t, "nominee", creatorID)
	linkedSubscriptions, countErr := db.NewSelect().Model((*models.BillingSubscription)(nil)).
		Join("JOIN organizations AS o ON o.id = billing_subscription.organization_id").
		Where("billing_subscription.organization_id = ? AND o.created_by = ?", "org", "nominee").Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 1, linkedSubscriptions, "billing authority remains attached to the transferred Organization")
	legacyOrganizations := []models.Organization{
		{ID: "nominee-legacy", Name: "Nominee legacy", CreatedByID: "nominee"},
		{ID: "owner-legacy", Name: "Prior owner legacy", CreatedByID: "owner"},
	}
	_, err = db.NewInsert().Model(&legacyOrganizations).Exec(t.Context())
	require.NoError(t, err)
	legacyWorkspaces := []models.Workspace{
		{ID: "nominee-workspace", OrganizationID: "nominee-legacy", Name: "Nominee workspace"},
		{ID: "owner-workspace", OrganizationID: "owner-legacy", Name: "Prior owner workspace"},
	}
	_, err = db.NewInsert().Model(&legacyWorkspaces).Exec(t.Context())
	require.NoError(t, err)
	subscriptions := entitlements.NewSubscriptionService(db, entitlements.NewCloudBootstrapService())
	newOwnerDecision, entitlementErr := subscriptions.Check(t.Context(), entitlements.Request{
		UserID: "nominee", WorkspaceID: "nominee-workspace", Limit: entitlements.LimitSocialAccounts, Amount: 1,
	})
	require.NoError(t, entitlementErr)
	require.True(t, newOwnerDecision.Allowed, "the accepted Owner receives creator-backed subscription authority")
	priorOwnerDecision, entitlementErr := subscriptions.Check(t.Context(), entitlements.Request{
		UserID: "owner", WorkspaceID: "owner-workspace", Limit: entitlements.LimitSocialAccounts, Amount: 1,
	})
	require.NoError(t, entitlementErr)
	require.False(t, priorOwnerDecision.Allowed, "the prior Owner loses creator-backed subscription authority")
	actions := ownershipAuditActions(t, db)
	require.Contains(t, actions, ActionAccepted)
	require.Contains(t, actions, ActionAcceptanceFailed)
}

func TestAcceptanceRollsBackRolesWhenCreatorAuthorityChanged(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Organization)(nil)).Set("created_by = ?", "outsider").Where("id = ?", "org").Exec(t.Context())
	require.NoError(t, err)

	_, err = service.Accept(t.Context(), transfer.ID, testCredential("nominee"))
	require.ErrorIs(t, err, ErrOwnerRequired)
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))
	require.Equal(t, models.OrganizationRoleMember, memberRole(t, db, "nominee"))
	var stored models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", transfer.ID).Scan(t.Context()))
	require.Equal(t, StatusPending, stored.Status)
}

func ownershipAuditActions(t *testing.T, db *bun.DB) []string {
	t.Helper()
	var actions []string
	require.NoError(t, db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Column("action").Order("created_at ASC", "id ASC").Scan(t.Context(), &actions))
	return actions
}

func memberRole(t *testing.T, db *bun.DB, userID string) string {
	t.Helper()
	var role string
	require.NoError(t, db.NewSelect().Model((*models.OrganizationMember)(nil)).Column("role").Where("organization_id = ? AND user_id = ?", "org", userID).Scan(t.Context(), &role))
	return role
}

func ownerCount(t *testing.T, db *bun.DB) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND role = ?", "org", models.OrganizationRoleOwner).Count(t.Context())
	require.NoError(t, err)
	return count
}
