package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsBillingSubscriptionsIdempotent(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Organization{ID: "org-billing", Name: "Billing", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-billing", OrganizationID: "org-billing", Name: "Billing"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-billing",
		WorkspaceID:            "ws-billing",
		Provider:               models.BillingProviderPaddle,
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: "sub-1",
		Status:                 "active",
		PlanID:                 "founder",
	}).Exec(ctx)
	require.NoError(t, err)
}

func TestRunMigrationsBillingSubscriptionsCascadeWithOrganization(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Organization{ID: "org-billing", Name: "Billing", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-billing", OrganizationID: "org-billing", Name: "Billing"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-billing",
		WorkspaceID:            "ws-billing",
		Provider:               models.BillingProviderPaddle,
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: "sub-1",
		Status:                 "active",
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM organizations WHERE id = ?", "org-billing")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_subscriptions").Scan(ctx, &count))
	require.Equal(t, 0, count)
}

func TestRunMigrationsBillingWebhookEventsDeduplicate(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.BillingWebhookEvent{
		EventID:   "evt-1",
		Provider:  models.BillingProviderPaddle,
		EventType: "subscription.activated",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingWebhookEvent{
		EventID:   "evt-1",
		Provider:  models.BillingProviderPaddle,
		EventType: "subscription.activated",
	}).Exec(ctx)
	require.Error(t, err)
}
