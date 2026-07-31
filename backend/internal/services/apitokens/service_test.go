package apitokens

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newServiceTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.User)(nil),
		(*models.APIToken)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}

func TestGenerateTokenStoresHashOnlyAndDefaultExpiry(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newServiceTestDB(t)
	seedServiceUser(ctx, t, db, "user-1", "user@example.com")

	service := NewService(db)
	generated, err := service.GenerateTokenWithOptions(ctx, "user-1", "Laptop", "", GenerateOptions{
		WorkspaceID: "ws-1",
		Audience:    "https://app.openpost.test/mcp",
	})
	require.NoError(t, err)
	require.NotEmpty(t, generated.Token)
	require.NotContains(t, generated.Model.TokenHash, generated.Token)
	require.Equal(t, DefaultScope, generated.Model.Scope)
	require.Equal(t, "ws-1", generated.Model.WorkspaceID)
	require.WithinDuration(t, time.Now().UTC().Add(DefaultExpiration), generated.Model.ExpiresAt, 5*time.Second)

	parts := strings.SplitN(generated.Token, "_", 4)
	require.Len(t, parts, 4)
	require.Equal(t, "op", parts[0])
	require.Equal(t, "cli", parts[1])
	require.Len(t, parts[2], prefixHexLength)
	require.Len(t, parts[3], 43)

	prefix, hash := HashToken(parts[3])
	require.Equal(t, prefix, generated.Model.TokenPrefix)
	require.Equal(t, hash, generated.Model.TokenHash)
}

func TestGenerateTokenSupportsNeverExpires(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newServiceTestDB(t)
	seedServiceUser(ctx, t, db, "user-1", "user@example.com")

	never := time.Time{}
	generated, err := NewService(db).GenerateToken(ctx, "user-1", "CI", DefaultScope, &never)
	require.NoError(t, err)
	require.True(t, generated.Model.ExpiresAt.IsZero())
}

func TestGenerateTokenValidatesScope(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newServiceTestDB(t)
	seedServiceUser(ctx, t, db, "user-1", "user@example.com")

	service := NewService(db)
	mcpRead, err := service.GenerateToken(ctx, "user-1", "Read-only MCP", ScopeMCPRead, nil)
	require.NoError(t, err)
	require.Equal(t, ScopeMCPRead, mcpRead.Model.Scope)

	mcp, err := service.GenerateToken(ctx, "user-1", "ChatGPT App", ScopeMCP, nil)
	require.NoError(t, err)
	require.Equal(t, ScopeMCP, mcp.Model.Scope)

	_, err = service.GenerateToken(ctx, "user-1", "Bad", "media:read", nil)
	require.ErrorIs(t, err, ErrInvalidScope)
}

func TestValidateTokenReturnsPrincipalAndTouchesLastUsed(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newServiceTestDB(t)
	seedServiceUser(ctx, t, db, "user-1", "user@example.com")

	service := NewService(db)
	generated, err := service.GenerateTokenWithOptions(ctx, "user-1", "Laptop", "", GenerateOptions{
		WorkspaceID: "ws-1",
		Audience:    "https://app.openpost.test/mcp",
	})
	require.NoError(t, err)

	principal, err := service.ValidateToken(ctx, generated.Token)
	require.NoError(t, err)
	require.Equal(t, "user-1", principal.UserID)
	require.Equal(t, "user@example.com", principal.Email)
	require.Equal(t, DefaultScope, principal.Scope)
	require.Equal(t, "ws-1", principal.WorkspaceID)
	require.Equal(t, "https://app.openpost.test/mcp", principal.Audience)
	require.Equal(t, generated.Model.ID, principal.TokenID)
	require.Equal(t, "Laptop", principal.TokenName)
	require.Equal(t, generated.Model.TokenPrefix, principal.TokenPrefix)

	var stored models.APIToken
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", generated.Model.ID).Scan(ctx))
	require.False(t, stored.LastUsedAt.IsZero())
}

func TestValidateTokenRejectsInvalidExpiredAndRevokedTokens(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newServiceTestDB(t)
	seedServiceUser(ctx, t, db, "user-1", "user@example.com")

	service := NewService(db)
	expiredAt := time.Now().UTC().Add(-time.Minute)
	expired, err := service.GenerateToken(ctx, "user-1", "Expired", "", &expiredAt)
	require.NoError(t, err)
	_, err = service.ValidateToken(ctx, expired.Token)
	require.ErrorIs(t, err, ErrExpiredToken)

	active, err := service.GenerateToken(ctx, "user-1", "Revoked", "", nil)
	require.NoError(t, err)
	require.NoError(t, service.RevokeToken(ctx, "user-1", active.Model.ID))
	_, err = service.ValidateToken(ctx, active.Token)
	require.ErrorIs(t, err, ErrRevokedToken)

	_, err = service.ValidateToken(ctx, "op_cli_12345678_not-the-secret")
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestListAndRevokeTokensAreScopedToUser(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newServiceTestDB(t)
	seedServiceUser(ctx, t, db, "user-1", "one@example.com")
	seedServiceUser(ctx, t, db, "user-2", "two@example.com")

	service := NewService(db)
	one, err := service.GenerateToken(ctx, "user-1", "One", "", nil)
	require.NoError(t, err)
	_, err = service.GenerateToken(ctx, "user-2", "Two", "", nil)
	require.NoError(t, err)

	tokens, err := service.ListTokens(ctx, "user-1")
	require.NoError(t, err)
	require.Len(t, tokens, 1)
	require.Equal(t, one.Model.ID, tokens[0].ID)

	err = service.RevokeToken(ctx, "user-2", one.Model.ID)
	require.True(t, errors.Is(err, sql.ErrNoRows))

	require.NoError(t, service.RevokeToken(ctx, "user-1", one.Model.ID))
	var stored models.APIToken
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", one.Model.ID).Scan(ctx))
	require.False(t, stored.RevokedAt.IsZero())
}

func seedServiceUser(ctx context.Context, t *testing.T, db *bun.DB, id, email string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.User{
		ID:           id,
		Email:        email,
		PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
}
