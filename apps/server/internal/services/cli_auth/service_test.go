package cli_auth

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestExpireIfNeededDoesNotOverwriteAConcurrentApproval(t *testing.T) {
	db := newCLIAuthServiceTestDB(t)
	now := time.Now().UTC()
	stored := &models.CLIAuthSession{
		ID: "approved-session", DeviceCodeHash: strings.Repeat("a", 64),
		UserCodeHash: strings.Repeat("b", 64), ClientName: "OpenPost CLI",
		RequestedScopes: apitokens.ScopeCLI, Status: statusApproved,
		IntervalSeconds: DefaultInterval, ExpiresAt: now.Add(-time.Minute), CreatedAt: now.Add(-time.Hour),
	}
	_, err := db.NewInsert().Model(stored).Exec(t.Context())
	require.NoError(t, err)
	stale := *stored
	stale.Status = statusPending

	service := NewService(db, apitokens.NewService(db))
	err = service.expireIfNeeded(t.Context(), &stale, now)
	require.ErrorIs(t, err, ErrAlreadyUsed)
	require.Equal(t, statusApproved, stale.Status)
	status, err := service.sessionStatus(t.Context(), stored.ID)
	require.NoError(t, err)
	require.Equal(t, statusApproved, status)
}

func newCLIAuthServiceTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.CLIAuthSession)(nil)).Exec(context.Background())
	require.NoError(t, err)
	return db
}
