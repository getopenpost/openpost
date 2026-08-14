package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/workspaceteam"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestWorkspaceAccessLifecycleMigrationSQLite(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.ExecContext(t.Context(), "PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	exerciseWorkspaceAccessLifecycleMigration(t, db, false)
}

func TestWorkspaceAccessLifecycleMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	adminSQLDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(t.Context()))
	schema := fmt.Sprintf("workspace_access_080_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	scopedSQLDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	scopedSQLDB.SetMaxOpenConns(16)
	db := bun.NewDB(scopedSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	exerciseWorkspaceAccessLifecycleMigration(t, db, true)
}

func exerciseWorkspaceAccessLifecycleMigration(t *testing.T, db *bun.DB, concurrent bool) {
	t.Helper()
	ctx := t.Context()
	for _, statement := range []string{
		`CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
		`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
		`CREATE TABLE workspace_members (
			workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
			PRIMARY KEY (workspace_id, user_id)
		)`,
		`CREATE TABLE workspace_invitations (
			id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, email TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'editor', invited_by_user_id TEXT NOT NULL,
			accepted_by_user_id TEXT, token_hash TEXT NOT NULL UNIQUE,
			expires_at TIMESTAMP NOT NULL, accepted_at TIMESTAMP, revoked_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		)`,
		`INSERT INTO users (id, email) VALUES ('admin-1', 'admin@example.com')`,
		`INSERT INTO workspaces (id, name) VALUES ('workspace-1', 'Workspace')`,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace-1', 'admin-1', 'admin')`,
		`INSERT INTO workspace_invitations (
			id, workspace_id, email, role, invited_by_user_id, token_hash, expires_at
		) VALUES ('legacy-invite', 'workspace-1', 'legacy@example.com', 'viewer', 'admin-1', 'legacy-hash', current_timestamp)`,
	} {
		_, err := db.ExecContext(ctx, statement)
		require.NoError(t, err)
	}
	raw, err := migrationFiles.ReadFile("080_workspace_access_lifecycle.sql")
	require.NoError(t, err)
	item := migration{version: 80, name: "080_workspace_access_lifecycle.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(raw))}
	require.NoError(t, prepareMigration(ctx, db, item))
	require.NoError(t, runMigration(ctx, db, item))
	require.NoError(t, ensureWorkspaceAccessLifecycleSchema(ctx, db))

	var member models.WorkspaceMember
	require.NoError(t, db.NewSelect().Model(&member).Where("workspace_id = ? AND user_id = ?", "workspace-1", "admin-1").Scan(ctx))
	require.Equal(t, models.WorkspaceMemberStatusActive, member.Status)
	require.False(t, member.CreatedAt.IsZero())
	require.False(t, member.UpdatedAt.IsZero())
	var legacyInvitationLastSentAt time.Time
	require.NoError(t, db.NewSelect().Table("workspace_invitations").
		Column("last_sent_at").Where("id = ?", "legacy-invite").Scan(ctx, &legacyInvitationLastSentAt))
	require.False(t, legacyInvitationLastSentAt.IsZero())

	_, err = db.NewInsert().Model(&models.WorkspaceAccessAuditEvent{
		ID: "audit-1", WorkspaceID: "workspace-1", ActorUserID: "admin-1",
		Action: workspaceteam.ActionMemberRoleChanged, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	if concurrent {
		exerciseWorkspaceSeatSerialization(t, db)
	}
	_, err = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = 'workspace-1'`)
	require.NoError(t, err)
	var auditCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspace_access_audit_events").Scan(ctx, &auditCount))
	require.Zero(t, auditCount)
}

func exerciseWorkspaceSeatSerialization(t *testing.T, db *bun.DB) {
	t.Helper()
	service := workspaceteam.NewService(db, entitlements.NewStaticService(entitlements.PlanSnapshot{
		PlanID: "test", Limits: map[entitlements.LimitKey]int64{entitlements.LimitTeamMembers: 2},
	}), nil)
	const attempts = 16
	start := make(chan struct{})
	errs := make([]error, attempts)
	var wait sync.WaitGroup
	for index := 0; index < attempts; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			_, _, errs[index] = service.Invite(context.Background(), workspaceteam.InviteInput{
				WorkspaceID: "workspace-1", ActorUserID: "admin-1",
				Email: fmt.Sprintf("postgres-%02d@example.com", index), Role: models.WorkspaceRoleViewer,
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
		require.Equal(t, workspaceteam.ErrorPayment, workspaceteam.ErrorKindOf(err))
	}
	require.Equal(t, 1, successes)
}
