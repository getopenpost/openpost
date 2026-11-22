package inboxchanges_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func journalDB(t *testing.T, postgres bool) *bun.DB {
	t.Helper()
	var db *bun.DB
	if !postgres {
		var err error
		db, err = testdb.OpenWithDriver("sqlite", "file:"+uuid.NewString()+"?mode=memory&cache=shared")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
	} else {
		dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
		if dsn == "" {
			t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
		}
		admin := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
		schema := "inbox_journal_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		_, err := admin.NewRaw(`CREATE SCHEMA ?`, bun.Ident(schema)).Exec(t.Context())
		require.NoError(t, err)
		db = bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn), pgdriver.WithConnParams(map[string]any{"search_path": schema}))), pgdialect.New())
		db.SetMaxOpenConns(4)
		t.Cleanup(func() {
			require.NoError(t, db.Close())
			_, err := admin.NewRaw(`DROP SCHEMA ? CASCADE`, bun.Ident(schema)).Exec(context.Background())
			require.NoError(t, err)
			require.NoError(t, admin.Close())
		})
	}
	require.NoError(t, database.CreateSchema(db))
	for _, row := range []any{&models.User{ID: "u", Email: "journal@example.test", PasswordHash: "hash"}, &models.Organization{ID: "o", Name: "Org", CreatedByID: "u"}, &models.Workspace{ID: "w", Name: "Workspace", OrganizationID: "o"}} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	return db
}
func appendChange(ctx context.Context, db bun.IDB, id string) error {
	return inboxchanges.Append(ctx, db, "w", inboxchanges.Change{Kind: "message", ConversationID: "c", MessageID: id})
}

func TestJournalRollbackBatchReplayAndWorkspaceFence(t *testing.T) {
	db := journalDB(t, false)
	ctx := t.Context()
	start, err := inboxchanges.Read(ctx, db, "w", "")
	require.NoError(t, err)
	rejected := errors.New("rollback")
	require.ErrorIs(t, db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		require.NoError(t, appendChange(ctx, tx, "rolled-back"))
		return rejected
	}), rejected)
	changes := make([]inboxchanges.Change, 201)
	for i := range changes {
		changes[i] = inboxchanges.Change{Kind: "message", ConversationID: "c", MessageID: fmt.Sprint(i)}
	}
	require.NoError(t, db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error { return inboxchanges.Append(ctx, tx, "w", changes...) }))
	page, err := inboxchanges.Read(ctx, db, "w", start.Cursor)
	require.NoError(t, err)
	require.Len(t, page.Changes, 200)
	require.Equal(t, int64(1), page.Changes[0].Revision)
	require.Equal(t, "0", page.Changes[0].MessageID)
	tail, err := inboxchanges.Read(ctx, db, "w", page.Cursor)
	require.NoError(t, err)
	require.Len(t, tail.Changes, 1)
	require.Equal(t, "200", tail.Changes[0].MessageID)
	_, err = inboxchanges.Read(ctx, db, "other", tail.Cursor)
	require.ErrorIs(t, err, inboxchanges.ErrInvalidCursor)
}

func TestJournalPostgresCannotSkipLateCommit(t *testing.T) {
	db := journalDB(t, true)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	start, err := inboxchanges.Read(ctx, db, "w", "")
	require.NoError(t, err)
	slow, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = slow.Rollback() }()
	require.NoError(t, appendChange(ctx, slow, "slow"))
	before, err := inboxchanges.Read(ctx, db, "w", start.Cursor)
	require.NoError(t, err)
	require.Empty(t, before.Changes)
	done := make(chan error, 1)
	go func() {
		done <- db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error { return appendChange(ctx, tx, "fast") })
	}()
	select {
	case err := <-done:
		t.Fatalf("second writer escaped uncommitted revision fence: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	require.NoError(t, slow.Commit())
	require.NoError(t, <-done)
	page, err := inboxchanges.Read(ctx, db, "w", start.Cursor)
	require.NoError(t, err)
	require.Len(t, page.Changes, 2)
	require.Equal(t, "slow", page.Changes[0].MessageID)
	require.Equal(t, "fast", page.Changes[1].MessageID)
}
