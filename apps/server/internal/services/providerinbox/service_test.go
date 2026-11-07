package providerinbox

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func inboxTestService(t *testing.T) (*Service, MetaApp) {
	t.Helper()
	var db *bun.DB
	var err error
	if dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL"); dsn != "" {
		db, err = database.InitDBWithDriver("postgres", dsn)
		require.NoError(t, err)
		db.SetMaxOpenConns(1)
		schema := "provider_inbox_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		_, err = db.ExecContext(t.Context(), "CREATE SCHEMA "+schema)
		require.NoError(t, err)
		_, err = db.ExecContext(t.Context(), "SET search_path TO "+schema)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, dropErr := db.ExecContext(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
			require.NoError(t, dropErr)
			require.NoError(t, db.Close())
		})
	} else {
		db, err = database.InitDB(filepath.Join(t.TempDir(), "inbox.db"))
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
	}
	require.NoError(t, database.CreateSchema(db))
	ctx := t.Context()
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws", Name: "Inbox"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthGrant{ID: "grant", WorkspaceID: "ws", Provider: "instagram", ProviderProjectID: "ig-client", ValidationStatus: "valid", GrantedScopes: "instagram_business_basic,instagram_business_manage_messages", AccessTokenEnc: []byte("cipher")}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "ws", Slug: "instagram", Platform: "instagram", AccountID: "ig-self", OAuthGrantID: "grant", AccessTokenEnc: []byte("cipher"), IsActive: true, CapabilityState: `{"connection_type":"instagram_login"}`}).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db, servicecrypto.NewTokenEncryptor("test-key"))
	service.SetReceiptScheduler(func(context.Context) error { return nil })
	return service, MetaApp{ID: "ig-app", ClientID: "ig-client", Platform: "instagram", ConnectionMode: "instagram_login", AppSecret: "app-secret", VerifyToken: "verify-secret"}
}

const inboundMetaBody = `{"object":"instagram","entry":[{"id":"ig-self","messaging":[{"sender":{"id":"alice"},"recipient":{"id":"ig-self"},"timestamp":1792490400000,"message":{"mid":"mid-1","text":"private message"}}]}]}`

func signedRequest(body, secret string) *http.Request {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "https://openpost.test/provider-inbox/ig-app", strings.NewReader(body))
	digest := hmac.New(sha256.New, []byte(secret))
	_, _ = digest.Write([]byte(body))
	r.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(digest.Sum(nil)))
	return r
}

func TestMetaIntakePersistsBeforeAcknowledgementAndRetriesAfterRestart(t *testing.T) {
	s, app := inboxTestService(t)
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	handler := s.MetaHandler(app)
	for range 2 {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, signedRequest(inboundMetaBody, app.AppSecret))
		require.Equal(t, http.StatusOK, response.Code)
	}
	var rows []receipt
	require.NoError(t, s.db.NewSelect().Model(&rows).Scan(t.Context()))
	require.Len(t, rows, 1, "duplicate delivery must have one durable receipt before 200")
	require.NotContains(t, string(rows[0].PayloadEncrypted), "private message")
	count, err := s.ProcessPending(t.Context(), 10, func(_ context.Context, e Event) error {
		require.Contains(t, string(e.Payload), "private message")
		return errors.New("temporary apply failure")
	})
	require.NoError(t, err)
	require.Zero(t, count)
	require.NoError(t, s.db.NewSelect().Model(&rows[0]).WherePK().Scan(t.Context()))
	require.Equal(t, 1, rows[0].Attempts)
	require.Zero(t, rows[0].ProcessedAt)
	now = now.Add(time.Minute)
	restarted := NewService(s.db, s.encryptor)
	restarted.now = func() time.Time { return now }
	calls := 0
	count, err = restarted.ProcessPending(t.Context(), 10, func(_ context.Context, e Event) error {
		calls++
		require.Equal(t, "account", e.AccountID)
		require.Equal(t, "grant", e.OAuthGrantID)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, 1, count)
	require.Equal(t, 1, calls)
	require.NoError(t, s.db.NewSelect().Model(&rows[0]).WherePK().Scan(t.Context()))
	require.NotZero(t, rows[0].ProcessedAt)
	require.Empty(t, rows[0].PayloadEncrypted)
}

func TestMetaIntakeRejectsBadSignatureForeignAppAndWrongLoginMode(t *testing.T) {
	s, app := inboxTestService(t)
	malformed := httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(malformed, signedRequest(`not-json`, app.AppSecret))
	require.Equal(t, http.StatusBadRequest, malformed.Code)
	bad := httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(bad, signedRequest(inboundMetaBody, "wrong"))
	require.Equal(t, http.StatusForbidden, bad.Code)
	for _, alter := range []func(*MetaApp){func(a *MetaApp) { a.ClientID = "another-app" }, func(a *MetaApp) { a.ConnectionMode = "" }} {
		foreign := app
		alter(&foreign)
		response := httptest.NewRecorder()
		s.MetaHandler(foreign).ServeHTTP(response, signedRequest(inboundMetaBody, foreign.AppSecret))
		require.Equal(t, http.StatusOK, response.Code)
	}
	count, err := s.db.NewSelect().Model((*receipt)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	response := httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(response, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "https://openpost.test/?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=12345", nil))
	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, "12345", response.Body.String())
}

func TestMetaIntakeDoesNotAcknowledgeFailedPersistence(t *testing.T) {
	s, app := inboxTestService(t)
	_, err := s.db.ExecContext(t.Context(), "DROP TABLE provider_inbox_receipts")
	require.NoError(t, err)
	response := httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(response, signedRequest(inboundMetaBody, app.AppSecret))
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
}

func TestMetaReceiptCannotCrossReplacementGrant(t *testing.T) {
	s, app := inboxTestService(t)
	response := httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(response, signedRequest(inboundMetaBody, app.AppSecret))
	require.Equal(t, http.StatusOK, response.Code)
	_, err := s.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("oauth_grant_id = ''").Where("id = 'account'").Exec(t.Context())
	require.NoError(t, err)
	calls := 0
	_, err = s.ProcessPending(t.Context(), 10, func(context.Context, Event) error { calls++; return nil })
	require.NoError(t, err)
	require.Zero(t, calls)
}

func TestTransportLeaseHasSingleOwnerAndReleasesOnCancellation(t *testing.T) {
	s, _ := inboxTestService(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered := make(chan struct{})
	stopped := make(chan error, 1)
	eligible := func(context.Context) (bool, error) { return true, nil }
	go func() {
		stopped <- s.RunLeasedStream(ctx, "account", eligible, func(ctx context.Context) error { close(entered); <-ctx.Done(); return ctx.Err() })
	}()
	select {
	case <-entered:
	case err := <-stopped:
		t.Fatalf("stream setup failed: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("stream did not start")
	}
	calls := 0
	require.NoError(t, s.RunLeasedStream(t.Context(), "account", eligible, func(context.Context) error { calls++; return nil }))
	require.Zero(t, calls)
	cancel()
	select {
	case err := <-stopped:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(3 * time.Second):
		t.Fatal("stream did not stop")
	}
	var leases []transportLease
	require.NoError(t, s.db.NewSelect().Model(&leases).Scan(t.Context()))
	require.Empty(t, leases)
}

func TestMetaReplayRequeuesAfterDurableSchedulerFailure(t *testing.T) {
	s, app := inboxTestService(t)
	calls := 0
	s.SetReceiptScheduler(func(context.Context) error { calls++; return errors.New("queue unavailable") })
	response := httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(response, signedRequest(inboundMetaBody, app.AppSecret))
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
	count, err := s.db.NewSelect().Model((*receipt)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count, "receipt must commit even when wakeup fails")
	s.SetReceiptScheduler(func(context.Context) error { calls++; return nil })
	response = httptest.NewRecorder()
	s.MetaHandler(app).ServeHTTP(response, signedRequest(inboundMetaBody, app.AppSecret))
	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, 2, calls)
	count, err = s.db.NewSelect().Model((*receipt)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestTransportLeaseDeadlineCancelsIndependentlyOfRenewal(t *testing.T) {
	for _, renewEarly := range []bool{false, true} {
		t.Run(map[bool]string{false: "expires", true: "renewal updates deadline"}[renewEarly], func(t *testing.T) {
			deadline := time.Now().Add(25 * time.Millisecond)
			if renewEarly {
				deadline = time.Now().Add(5 * time.Second)
			}
			ctx, cancel, renew := transportLeaseContext(t.Context(), deadline)
			defer cancel()
			if renewEarly {
				renew(time.Now().Add(25 * time.Millisecond))
			}
			// No monitor or database callback has to return for the upstream context
			// to stop. A stalled renewal cannot keep an expired owner consuming.
			select {
			case <-ctx.Done():
				require.NoError(t, t.Context().Err())
			case <-time.After(time.Second):
				t.Fatal("lease deadline did not cancel the stream")
			}
		})
	}
}
