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
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.BillingSubscription)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
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
}

func seedBillingSubscription(t *testing.T, db *bun.DB, status, snapshot string) {
	t.Helper()

	_, err := db.NewInsert().Model(&models.BillingSubscription{
		WorkspaceID:            "ws-1",
		Provider:               "polar",
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: uuid.NewString(),
		Status:                 status,
		PlanID:                 "creator",
		EntitlementSnapshot:    snapshot,
	}).Exec(context.Background())
	require.NoError(t, err)
}

func TestSubscriptionServiceAllowsWithinActiveSubscriptionLimit(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	seedBillingSubscription(t, db, "active", `{"limits":{"scheduled_posts_monthly":100}}`)
	service := NewSubscriptionService(db, NewSelfHostedService())

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "ws-1",
		Limit:       LimitScheduledPostsMonthly,
		Current:     99,
		Amount:      1,
	})

	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.Equal(t, int64(100), decision.Limit)
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

func TestSubscriptionServiceRejectsMissingSubscription(t *testing.T) {
	t.Parallel()

	service := NewSubscriptionService(newSubscriptionEntitlementTestDB(t), NewSelfHostedService())

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "ws-1",
		Limit:       LimitMediaBytesStored,
		Current:     0,
		Amount:      1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, "active subscription required", decision.Reason)
}

func TestSubscriptionServiceRejectsInactiveSubscription(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	seedBillingSubscription(t, db, "canceled", `{"limits":{"media_bytes_stored":1000}}`)
	service := NewSubscriptionService(db, NewSelfHostedService())

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "ws-1",
		Limit:       LimitMediaBytesStored,
		Current:     0,
		Amount:      1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, "active subscription required", decision.Reason)
}

func TestSubscriptionServiceFallsBackForNonWorkspaceChecks(t *testing.T) {
	t.Parallel()

	service := NewSubscriptionService(newSubscriptionEntitlementTestDB(t), NewStaticService(PlanSnapshot{
		Limits: map[LimitKey]int64{LimitWorkspaces: 1},
	}))

	decision, err := service.Check(context.Background(), Request{
		UserID:  "user-1",
		Limit:   LimitWorkspaces,
		Current: 1,
		Amount:  1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Contains(t, decision.Reason, "workspaces")
}

func TestSubscriptionServiceUsesActiveUserSubscriptionForWorkspaceLimit(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	seedWorkspaceMember(t, db, "user-1")
	seedBillingSubscription(t, db, "active", `{"limits":{"workspaces":3}}`)
	service := NewSubscriptionService(db, NewCloudBootstrapService())

	decision, err := service.Check(context.Background(), Request{
		UserID:  "user-1",
		Limit:   LimitWorkspaces,
		Current: 2,
		Amount:  1,
	})

	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.Equal(t, int64(3), decision.Limit)
}

func TestSubscriptionServiceFallsBackToBootstrapWithoutActiveUserSubscription(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	seedWorkspaceMember(t, db, "user-1")
	seedBillingSubscription(t, db, "canceled", `{"limits":{"workspaces":3}}`)
	service := NewSubscriptionService(db, NewCloudBootstrapService())

	decision, err := service.Check(context.Background(), Request{
		UserID:  "user-1",
		Limit:   LimitWorkspaces,
		Current: 1,
		Amount:  1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Contains(t, decision.Reason, "workspaces")
}

func TestSubscriptionServiceRejectsInvalidSnapshot(t *testing.T) {
	t.Parallel()

	db := newSubscriptionEntitlementTestDB(t)
	seedBillingSubscription(t, db, "active", `{"limits":{"social_accounts":"three"}}`)
	service := NewSubscriptionService(db, NewSelfHostedService())

	_, err := service.Check(context.Background(), Request{
		WorkspaceID: "ws-1",
		Limit:       LimitSocialAccounts,
		Amount:      1,
	})

	require.ErrorContains(t, err, "invalid limit value")
}
