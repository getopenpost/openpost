package tokenmanager

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

type blockingRefreshAdapter struct {
	calls   atomic.Int32
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (a *blockingRefreshAdapter) GenerateAuthURL(string) (string, map[string]string) { return "", nil }
func (a *blockingRefreshAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}
func (a *blockingRefreshAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{Supported: true, CredentialSource: platform.RefreshCredentialRefreshToken}
}
func (a *blockingRefreshAdapter) RefreshToken(_ context.Context, input platform.RefreshTokenInput) (*platform.TokenResult, error) {
	a.calls.Add(1)
	a.once.Do(func() { close(a.started) })
	<-a.release
	if input.RefreshToken != "rotating-refresh-v1" {
		return nil, fmt.Errorf("unexpected refresh token")
	}
	return &platform.TokenResult{
		AccessToken:      "access-v2",
		RefreshToken:     "rotating-refresh-v2",
		ExpiresIn:        3600,
		RefreshExpiresIn: 7200,
		TokenType:        "Bearer",
		Extra:            map[string]string{"scope": "write read"},
	}, nil
}
func (a *blockingRefreshAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}
func (a *blockingRefreshAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}
func (a *blockingRefreshAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func newGrantSQLiteDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createGrantConcurrencyTables(t, db)
	return db
}

func createGrantConcurrencyTables(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, model := range []interface{}{(*models.OAuthGrant)(nil), (*models.SocialAccount)(nil), (*models.Job)(nil)} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
}

func seedSharedGrant(t *testing.T, db *bun.DB, encryptor *crypto.TokenEncryptor) {
	t.Helper()
	access, err := encryptor.Encrypt("access-v1")
	require.NoError(t, err)
	refresh, err := encryptor.Encrypt("rotating-refresh-v1")
	require.NoError(t, err)
	grant := &models.OAuthGrant{
		ID:                    "grant-shared",
		WorkspaceID:           "workspace-1",
		Provider:              "linkedin",
		ProviderProjectID:     "project-1",
		ProviderSubject:       "member-1",
		AccessTokenEnc:        access,
		RefreshTokenEnc:       refresh,
		AccessTokenExpiresAt:  time.Now().UTC().Add(time.Minute),
		RefreshTokenExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		GrantedScopes:         "read write",
		TokenType:             "Bearer",
		TokenVersion:          1,
		ExecutionMode:         "oauth2",
		AuthorizationEvidence: `{"source":"test"}`,
		ConsentedByID:         "user-1",
		ConsentedAt:           time.Now().UTC(),
		ValidatedAt:           time.Now().UTC(),
		ValidationStatus:      "valid",
		CreatedAt:             time.Now().UTC(),
		UpdatedAt:             time.Now().UTC(),
	}
	_, err = db.NewInsert().Model(grant).Exec(t.Context())
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "destination-person", WorkspaceID: "workspace-1", Platform: "linkedin", AccountID: "urn:li:person:member-1", OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, IsActive: true},
		{ID: "destination-page", WorkspaceID: "workspace-1", Platform: "linkedin", AccountID: "urn:li:organization:42", OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(t.Context())
	require.NoError(t, err)
}

func exerciseConcurrentSiblingRefresh(t *testing.T, db *bun.DB) {
	t.Helper()
	encryptor := crypto.NewTokenEncryptor("grant-concurrency-secret")
	seedSharedGrant(t, db, encryptor)
	adapter := &blockingRefreshAdapter{started: make(chan struct{}), release: make(chan struct{})}
	manager := NewTokenManager(db, encryptor)
	manager.waitInterval = time.Millisecond
	manager.SetProvider("linkedin", adapter)

	type result struct {
		token string
		err   error
	}
	results := make(chan result, 2)
	go func() {
		token, err := manager.ForceRefreshAccessToken(context.Background(), "destination-person")
		results <- result{token: token, err: err}
	}()
	select {
	case <-adapter.started:
	case <-time.After(5 * time.Second):
		t.Fatal("first refresh did not reach provider")
	}
	go func() {
		token, err := manager.ForceRefreshAccessToken(context.Background(), "destination-page")
		results <- result{token: token, err: err}
	}()
	time.Sleep(20 * time.Millisecond)
	close(adapter.release)

	for range 2 {
		out := <-results
		require.NoError(t, out.err)
		require.Equal(t, "access-v2", out.token)
	}
	require.EqualValues(t, 1, adapter.calls.Load(), "rotating refresh credential must be exchanged once")

	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", "grant-shared").Scan(t.Context()))
	require.EqualValues(t, 2, grant.TokenVersion)
	require.Empty(t, grant.RefreshLeaseOwner)
	require.Equal(t, "access-v2", decryptToken(t, encryptor, grant.AccessTokenEnc))
	require.Equal(t, "rotating-refresh-v2", decryptToken(t, encryptor, grant.RefreshTokenEnc))
	require.Equal(t, "read write", grant.GrantedScopes)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ? AND status = ?", "refresh_token", "pending").Scan(t.Context()))
	require.Len(t, jobs, 1)
	target, err := ParseRefreshJobPayload(jobs[0].Payload)
	require.NoError(t, err)
	require.Equal(t, "grant-shared", target.GrantID)
	require.Empty(t, target.AccountID)
}

func TestConcurrentSiblingRefreshRotatesGrantOnceSQLite(t *testing.T) {
	exerciseConcurrentSiblingRefresh(t, newGrantSQLiteDB(t))
}

func TestGetValidAccessTokenRejectsCrossWorkspaceGrantReference(t *testing.T) {
	db := newGrantSQLiteDB(t)
	encryptor := crypto.NewTokenEncryptor("grant-concurrency-secret")
	seedSharedGrant(t, db, encryptor)
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID:             "corrupt-destination",
		WorkspaceID:    "workspace-2",
		Platform:       "linkedin",
		AccountID:      "urn:li:person:other-workspace",
		OAuthGrantID:   "grant-shared",
		AccessTokenEnc: []byte{},
		IsActive:       true,
	}).Exec(t.Context())
	require.NoError(t, err)

	token, err := NewTokenManager(db, encryptor).GetValidAccessToken(t.Context(), "corrupt-destination")
	require.Empty(t, token)
	require.ErrorContains(t, err, "missing or belongs to another workspace")
}

func TestConcurrentSiblingRefreshRotatesGrantOncePostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("oauth_grant_refresh_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	createGrantConcurrencyTables(t, db)
	exerciseConcurrentSiblingRefresh(t, db)
}

func TestRevocationWinsRefreshCompareAndSwap(t *testing.T) {
	db := newGrantSQLiteDB(t)
	encryptor := crypto.NewTokenEncryptor("grant-concurrency-secret")
	seedSharedGrant(t, db, encryptor)
	adapter := &blockingRefreshAdapter{started: make(chan struct{}), release: make(chan struct{})}
	manager := NewTokenManager(db, encryptor)
	manager.SetProvider("linkedin", adapter)

	result := make(chan error, 1)
	go func() {
		_, err := manager.ForceRefreshAccessToken(context.Background(), "destination-person")
		result <- err
	}()
	<-adapter.started
	_, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("access_token_encrypted = ?", []byte{}).
		Set("refresh_token_encrypted = ?", []byte{}).
		Set("token_version = token_version + 1").
		Set("revoked_at = ?", time.Now().UTC()).
		Set("validation_status = ?", "revoked").
		Where("id = ?", "grant-shared").
		Exec(t.Context())
	require.NoError(t, err)
	close(adapter.release)
	require.ErrorContains(t, <-result, "changed or was revoked")

	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", "grant-shared").Scan(t.Context()))
	require.EqualValues(t, 2, grant.TokenVersion)
	require.Empty(t, grant.AccessTokenEnc)
	require.Empty(t, grant.RefreshTokenEnc)
}
