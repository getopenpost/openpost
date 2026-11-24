package messaging

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func messagingBackendFixture(t *testing.T, backend string) (*Service, *bun.DB, models.SocialAccount, Actor) {
	t.Helper()
	if backend == "sqlite" {
		return messagingFixture(t)
	}
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	schema := "messaging_deletions_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn), pgdriver.WithConnParams(map[string]any{"search_path": schema})))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err := db.NewRaw(`CREATE SCHEMA ?`, bun.Ident(schema)).Exec(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.NewRaw(`DROP SCHEMA ? CASCADE`, bun.Ident(schema)).Exec(context.Background())
		require.NoError(t, err)
	})
	_, err = db.NewRaw(`SET search_path TO ?`, bun.Ident(schema)).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	account := models.SocialAccount{ID: "account", WorkspaceID: "workspace", Platform: "bluesky", AccountID: "did:plc:self", Slug: "self", AccessTokenEnc: []byte("token"), IsActive: true}
	for _, row := range []any{
		&models.User{ID: "user", Email: "messaging@example.test", PasswordHash: "hash"},
		&models.Organization{ID: "org", Name: "Org", CreatedByID: "user"},
		&models.Workspace{ID: "workspace", Name: "Workspace", OrganizationID: "org"},
		&models.WorkspaceMember{WorkspaceID: "workspace", UserID: "user", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&account,
		&models.Conversation{ID: "conversation", WorkspaceID: "workspace", SocialAccountID: "account", Platform: "bluesky", RemoteConversationID: "remote-thread"},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	s := NewService(db, testToken{}, nil)
	s.SetFeatureGate(testGate{})
	return s, db, account, Actor{UserID: "user"}
}

type historyTestProvider struct {
	testProvider
	page        platform.FetchMessageHistoryResult
	beforeFetch func()
}

func (p historyTestProvider) FetchMessageHistory(context.Context, string, platform.FetchMessageHistoryRequest) (platform.FetchMessageHistoryResult, error) {
	if p.beforeFetch != nil {
		p.beforeFetch()
	}
	return p.page, nil
}
