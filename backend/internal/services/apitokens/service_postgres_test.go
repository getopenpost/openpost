package apitokens

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestValidateTokenCannotReturnPrincipalAfterConcurrentRevocationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	adminSQL := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQL, pgdialect.New())
	require.NoError(t, adminDB.PingContext(t.Context()))
	schema := fmt.Sprintf("api_token_validation_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)

	testSQL := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	testSQL.SetMaxOpenConns(4)
	db := bun.NewDB(testSQL, pgdialect.New())
	t.Cleanup(func() {
		require.NoError(t, db.Close())
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
		require.NoError(t, adminDB.Close())
	})
	require.NoError(t, db.PingContext(t.Context()))
	for _, model := range []any{(*models.User)(nil), (*models.APIToken)(nil)} {
		_, err = db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	seedServiceUser(t.Context(), t, db, "user-1", "user@example.com")

	service := NewService(db)
	generated, err := service.GenerateToken(t.Context(), "user-1", "Postgres race", ScopeAPIRead, nil)
	require.NoError(t, err)
	hook := newBlockLastUsedUpdateHook()
	db.AddQueryHook(hook)
	type validationResult struct {
		principal *Principal
		err       error
	}
	validated := make(chan validationResult, 1)
	go func() {
		principal, validateErr := service.ValidateToken(context.Background(), generated.Token)
		validated <- validationResult{principal: principal, err: validateErr}
	}()

	select {
	case <-hook.started:
	case <-time.After(5 * time.Second):
		t.Fatal("validation did not reach its final active-token fence")
	}
	require.NoError(t, service.RevokeToken(t.Context(), "user-1", generated.Model.ID))
	close(hook.release)

	select {
	case result := <-validated:
		require.Nil(t, result.principal)
		require.ErrorIs(t, result.err, ErrInvalidToken)
	case <-time.After(5 * time.Second):
		t.Fatal("validation did not finish after revocation")
	}
}
