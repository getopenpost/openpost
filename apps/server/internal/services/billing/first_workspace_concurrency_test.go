package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestConfirmFirstWorkspaceConcurrentKeysPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	schema := fmt.Sprintf("billing_first_workspace_%d", time.Now().UnixNano())
	adminDB := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	sqlDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	sqlDB.SetMaxOpenConns(24)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.BillingCheckoutAttempt)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.ExecContext(t.Context(), `CREATE TABLE voice_profiles (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		normalized_name TEXT NOT NULL,
		is_default BOOLEAN NOT NULL DEFAULT false,
		revision INTEGER NOT NULL DEFAULT 1,
		schema_version INTEGER NOT NULL DEFAULT 1,
		definition_json TEXT NOT NULL DEFAULT '{}',
		created_by_id TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
	)`)
	require.NoError(t, err)

	service := NewService(db, "", PaddleConfig{
		Environment: "sandbox",
		ClientToken: "test_client_token",
		AppURL:      "https://app.openpost.test",
		ReturnURL:   "https://app.openpost.test/checkout?status=success",
		Plans: map[string]PlanConfig{
			"founder": {PaddlePriceIDs: PaddlePriceIDs{Monthly: "pri_founder_month", Annual: "pri_founder_year"}},
		},
	})
	choice := PurchaseChoice{PlanID: "founder", BillingPeriod: "monthly"}
	const attempts = 16
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	for index := range attempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := service.ConfirmFirstWorkspace(t.Context(), ConfirmFirstWorkspaceInput{
				UserID: "user-1", CustomerEmail: "user@example.com", WorkspaceName: "First Workspace",
				ConfirmationKey: fmt.Sprintf("confirmation-%d", index), Choice: choice,
			})
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	successes := 0
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		require.True(t, errors.Is(err, ErrFirstWorkspaceExists) || errors.Is(err, ErrOrganizationMemberExists), "unexpected confirmation error: %v", err)
	}
	require.Equal(t, 1, successes)
	var workspaceCount, attemptCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspaces").Scan(t.Context(), &workspaceCount))
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_checkout_attempts").Scan(t.Context(), &attemptCount))
	require.Equal(t, 1, workspaceCount)
	require.Equal(t, 1, attemptCount)
}
