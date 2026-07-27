package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesBillingSubscriptionSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'billing_subscriptions'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "organization_id TEXT PRIMARY KEY")
	require.Contains(t, schema, "workspace_id TEXT")
	require.Contains(t, schema, "provider_subscription_id TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "entitlement_snapshot TEXT NOT NULL DEFAULT '{}'")
	require.Contains(t, schema, "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('billing_subscriptions_provider_customer_idx', 'billing_subscriptions_status_idx', 'billing_webhook_events_provider_type_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 3, indexCount)
}

func TestRunMigrationsBillingSubscriptionsIdempotent(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.Organization{ID: "org-billing", Name: "Billing", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-billing", OrganizationID: "org-billing", Name: "Billing"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-billing",
		WorkspaceID:            "ws-billing",
		Provider:               "polar",
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: "sub-1",
		Status:                 "active",
		PlanID:                 "creator",
	}).Exec(ctx)
	require.NoError(t, err)
}

func TestRunMigrationsBillingSubscriptionsCascadeWithOrganization(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.Organization{ID: "org-billing", Name: "Billing", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-billing", OrganizationID: "org-billing", Name: "Billing"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-billing",
		WorkspaceID:            "ws-billing",
		Provider:               "polar",
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
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.BillingWebhookEvent{
		EventID:   "evt-1",
		Provider:  "polar",
		EventType: "subscription.active",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingWebhookEvent{
		EventID:   "evt-1",
		Provider:  "polar",
		EventType: "subscription.active",
	}).Exec(ctx)
	require.Error(t, err)
}
