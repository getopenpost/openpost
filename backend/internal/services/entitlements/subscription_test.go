package entitlements

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newSubscriptionEntitlementTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.OrganizationMember)(nil),
		(*models.BillingSubscription)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Subscribed", CreatedByID: "user-1"}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}

func seedWorkspaceMember(t *testing.T, db *bun.DB, userID string) {
	t.Helper()

	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      userID,
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org-1",
		UserID:         userID,
		Role:           models.OrganizationRoleOwner,
	}).On("CONFLICT DO NOTHING").Exec(context.Background())
	require.NoError(t, err)
}

func seedBillingSubscription(t *testing.T, db *bun.DB, status, snapshot string) {
	t.Helper()

	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-1",
		WorkspaceID:            "ws-1",
		Provider:               "paddle",
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: uuid.NewString(),
		Status:                 status,
		PlanID:                 "founder",
		EntitlementSnapshot:    snapshot,
	}).Exec(context.Background())
	require.NoError(t, err)
}

func TestSubscriptionServiceDoesNotApplyUsersPlanToAnotherOwnersWorkspace(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-other", Name: "Other", CreatedByID: "user-2"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Workspace)(nil)).
		Set("organization_id = ?", "org-other").
		Where("id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org-1", UserID: "user-1", Role: models.OrganizationRoleOwner,
	}).Exec(t.Context())
	require.NoError(t, err)
	seedBillingSubscription(t, db, "active", `{"limits":{"social_accounts":10}}`)
	service := NewSubscriptionService(db, NewCloudBootstrapService())

	decision, err := service.Check(t.Context(), Request{
		UserID:      "user-1",
		WorkspaceID: "ws-1",
		Limit:       LimitSocialAccounts,
		Current:     0,
		Amount:      1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
}

func TestSubscriptionServiceRejectsExceededActiveSubscriptionLimit(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	seedBillingSubscription(t, db, "active", `{"limits":{"social_accounts":3}}`)
	service := NewSubscriptionService(db, NewSelfHostedService())

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "ws-1",
		Limit:       LimitSocialAccounts,
		Current:     3,
		Amount:      1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Contains(t, decision.Reason, "social_accounts")
}
