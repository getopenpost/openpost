package oauth2messaging

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func testService(t *testing.T) *Service {
	t.Helper()
	db := messagingTestDB(t)
	var err error
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	s := NewService(db, encryptor, Config{ClientID: "messaging-client", ClientSecret: "messaging-secret", RedirectURI: "https://app.example/x-complete"}, usage.NewService(db))
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "workspace", Platform: "x", AccountID: "111", Slug: "x", AccessTokenEnc: []byte("unchanged-oauth1"), IsActive: true}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace", UserID: "owner", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}).Exec(t.Context())
	require.NoError(t, err)
	return s
}

// The optional PostgreSQL run uses the complete production schema so quota,
// receipt, and authorization queries exercise Hosted's types and constraints.
func messagingTestDB(t *testing.T) *bun.DB {
	t.Helper()
	if dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL"); dsn != "" {
		db, err := database.InitDBWithDriver("postgres", dsn)
		require.NoError(t, err)
		db.SetMaxOpenConns(1)
		schema := "x_messaging_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		_, err = db.ExecContext(t.Context(), "CREATE SCHEMA "+schema)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, dropErr := db.ExecContext(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
			require.NoError(t, dropErr)
			require.NoError(t, db.Close())
		})
		_, err = db.ExecContext(t.Context(), "SET search_path TO "+schema)
		require.NoError(t, err)
		require.NoError(t, database.CreateSchema(db))
		_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace", Name: "Messaging"}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.User{ID: "owner", Email: "owner@example.test"}).Exec(t.Context())
		require.NoError(t, err)
		return db
	}
	dbSQL, err := sql.Open(sqliteshim.ShimName, "file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared")
	require.NoError(t, err)
	dbSQL.SetMaxOpenConns(1)
	db := bun.NewDB(dbSQL, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.SocialAccount)(nil), (*models.WorkspaceMember)(nil), (*models.ProviderUsageEvent)(nil), (*models.ProviderUsageReservation)(nil), (*models.ProviderUsagePeriodCounter)(nil)} {
		_, err = db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	migration, err := os.ReadFile("../../database/migrations/167_x_messaging_oauth2.sql")
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), string(migration))
	require.NoError(t, err)
	return db
}
func seedGrant(t *testing.T, s *Service, expires time.Time) {
	t.Helper()
	row := grant{SocialAccountID: "account", WorkspaceID: "workspace", RemoteUserID: "111", ClientID: s.config.ClientID}
	require.NoError(t, s.protect(&row, tokenResponse{AccessToken: "access", RefreshToken: "refresh", Scope: messagingScopes, ExpiresIn: 7200}))
	row.ExpiresAt = expires
	_, err := s.db.NewInsert().Model(&row).Exec(t.Context())
	require.NoError(t, err)
}
func providerServer(t *testing.T, s *Service, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	s.httpClient = server.Client()
	s.apiBase = server.URL
}

// Protects the actual authorization exchange and storage boundary: PKCE and
// user/account binding, single-use callback, encrypted supplemental tokens,
// and preservation of the working publishing grant.
func TestSupplementalOAuth2AuthorizationIdentityAndPKCE(t *testing.T) {
	s := testService(t)
	ctx := t.Context()
	authorizeURL, err := s.Begin(ctx, workspaceaccess.ActorFacts{UserID: "owner"}, "workspace", "account")
	require.NoError(t, err)
	parsed, err := url.Parse(authorizeURL)
	require.NoError(t, err)
	query := parsed.Query()
	require.Equal(t, "S256", query.Get("code_challenge_method"))
	var request authRequest
	require.NoError(t, s.db.NewSelect().Model(&request).Where("state = ?", query.Get("state")).Scan(ctx))
	verifier, err := s.encryptor.Decrypt(request.VerifierEncrypted)
	require.NoError(t, err)
	sum := sha256.Sum256([]byte(verifier))
	require.Equal(t, base64.RawURLEncoding.EncodeToString(sum[:]), query.Get("code_challenge"))
	require.NotContains(t, authorizeURL, verifier)
	actor := workspaceaccess.ActorFacts{UserID: "owner"}
	_, err = s.Complete(ctx, workspaceaccess.ActorFacts{UserID: "someone-else"}, query.Get("state"), "code")
	require.ErrorIs(t, err, ErrState)
	remoteID := "222"
	tokenCalls := 0
	providerServer(t, s, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/2/oauth2/token":
			tokenCalls++
			require.NoError(t, r.ParseForm())
			require.Equal(t, "authorization_code", r.Form.Get("grant_type"))
			require.Equal(t, verifier, r.Form.Get("code_verifier"))
			require.Equal(t, s.config.RedirectURI, r.Form.Get("redirect_uri"))
			require.Equal(t, "messaging-client", r.Form.Get("client_id"))
			user, secret, ok := r.BasicAuth()
			require.True(t, ok)
			require.Equal(t, "messaging-client", user)
			require.Equal(t, "messaging-secret", secret)
			_, _ = fmt.Fprint(w, `{"access_token":"new-access","refresh_token":"new-refresh","scope":"tweet.read users.read dm.read dm.write offline.access","token_type":"bearer","expires_in":7200}`)
		case "/2/users/me":
			require.Equal(t, "Bearer new-access", r.Header.Get("Authorization"))
			_, _ = fmt.Fprintf(w, `{"data":{"id":%q}}`, remoteID)
		default:
			t.Errorf("unexpected provider endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	})
	_, err = s.Complete(ctx, actor, query.Get("state"), "code")
	require.ErrorIs(t, err, ErrReconnect)
	var count int64
	count, err = s.db.NewSelect().Model((*grant)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	_, err = s.Complete(ctx, actor, query.Get("state"), "code")
	require.ErrorIs(t, err, ErrState)
	require.Equal(t, 1, tokenCalls)
	remoteID = "111"
	authorizeURL, err = s.Begin(ctx, workspaceaccess.ActorFacts{UserID: "owner"}, "workspace", "account")
	require.NoError(t, err)
	parsed, err = url.Parse(authorizeURL)
	require.NoError(t, err)
	require.NoError(t, s.db.NewSelect().Model(&request).Where("state = ?", parsed.Query().Get("state")).Scan(ctx))
	verifier, err = s.encryptor.Decrypt(request.VerifierEncrypted)
	require.NoError(t, err)
	workspace, err := s.Complete(ctx, actor, parsed.Query().Get("state"), "code")
	require.NoError(t, err)
	require.Equal(t, "workspace", workspace)
	token, err := s.AccessToken(ctx, "workspace", "account")
	require.NoError(t, err)
	require.Equal(t, platform.XMessagingOAuth2Token("new-access"), token)
	var row grant
	require.NoError(t, s.db.NewSelect().Model(&row).Scan(ctx))
	require.NotContains(t, string(row.AccessTokenEncrypted), "new-access")
	require.NotContains(t, string(row.RefreshTokenEncrypted), "new-refresh")
	var original []byte
	require.NoError(t, s.db.NewSelect().Model((*models.SocialAccount)(nil)).Column("access_token_encrypted").Where("id = ?", "account").Scan(ctx, &original))
	require.Equal(t, []byte("unchanged-oauth1"), original)
	_, err = s.AccessToken(ctx, "other-workspace", "account")
	require.Error(t, err)
}

func TestMessagingGrantFallbackAndRefreshFailure(t *testing.T) {
	s := testService(t)
	_, err := s.AccessToken(t.Context(), "workspace", "account")
	require.ErrorIs(t, err, ErrNotConnected)
	seedGrant(t, s, s.now().Add(-time.Minute))
	providerServer(t, s, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/2/oauth2/token", r.URL.Path)
		w.WriteHeader(400)
		_, _ = fmt.Fprint(w, `{"error":"invalid_grant"}`)
	})
	_, err = s.AccessToken(t.Context(), "workspace", "account")
	require.Error(t, err)
	require.False(t, errors.Is(err, ErrNotConnected))
	ready, err := s.Readiness(t.Context(), "workspace", "account")
	require.NoError(t, err)
	require.False(t, ready.Authorized)
	require.Equal(t, "reconnect_required", ready.Reason)
}

func TestMessagingRefreshHasOneDurableOwner(t *testing.T) {
	s := testService(t)
	seedGrant(t, s, s.now().Add(-time.Minute))
	started, finish := make(chan struct{}), make(chan struct{})
	providerServer(t, s, func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		require.Equal(t, "refresh", r.Form.Get("refresh_token"))
		close(started)
		<-finish
		_, _ = fmt.Fprint(w, `{"access_token":"rotated-access","refresh_token":"rotated-refresh","token_type":"bearer","expires_in":7200}`)
	})
	var wg sync.WaitGroup
	wg.Add(1)
	var token string
	var firstErr error
	go func() { defer wg.Done(); token, firstErr = s.AccessToken(context.Background(), "workspace", "account") }()
	<-started
	_, err := s.AccessToken(t.Context(), "workspace", "account")
	require.ErrorIs(t, err, ErrRefreshBusy)
	close(finish)
	wg.Wait()
	require.NoError(t, firstErr)
	require.Equal(t, platform.XMessagingOAuth2Token("rotated-access"), token)
	var row grant
	require.NoError(t, s.db.NewSelect().Model(&row).Scan(t.Context()))
	refresh, err := s.encryptor.Decrypt(row.RefreshTokenEncrypted)
	require.NoError(t, err)
	require.Equal(t, "rotated-refresh", refresh)
}

func TestXQuotaSurvivesRestartAndHonorsProviderReset(t *testing.T) {
	s := testService(t)
	now := time.Date(2026, 10, 20, 12, 1, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	for i := 0; i < 15; i++ {
		require.NoError(t, s.ReserveXMessagingRequest(t.Context(), "111", platform.XMessagingRead))
	}
	restarted := NewService(s.db, s.encryptor, s.config, s.costs)
	restarted.now = s.now
	var quota *QuotaError
	require.ErrorAs(t, restarted.ReserveXMessagingRequest(t.Context(), "111", platform.XMessagingRead), &quota)
	require.NoError(t, restarted.ReserveXMessagingRequest(t.Context(), "111", platform.XMessagingSend))
	reset := now.Add(30 * time.Minute)
	require.NoError(t, s.ObserveXMessagingResponse(t.Context(), "111", platform.XMessagingSend, 429, http.Header{"X-Rate-Limit-Reset": {fmt.Sprint(reset.Unix())}, "X-Rate-Limit-Remaining": {"0"}}))
	now = now.Add(16 * time.Minute)
	require.ErrorAs(t, restarted.ReserveXMessagingRequest(t.Context(), "111", platform.XMessagingSend), &quota)
	require.Greater(t, quota.RetryAfter, time.Minute)
	var httpError *platform.HTTPError
	require.ErrorAs(t, quota, &httpError)
	require.Equal(t, http.StatusTooManyRequests, httpError.StatusCode)
	require.Equal(t, quota.RetryAfter, httpError.RetryAfter)
}

func TestXActivityBudgetAdmissionAndDurableReceipts(t *testing.T) {
	s := testService(t)
	seedGrant(t, s, s.now().Add(time.Hour))
	calls := 0
	providerServer(t, s, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method == http.MethodDelete {
			w.WriteHeader(200)
			_, _ = fmt.Fprint(w, `{}`)
			return
		}
		var payload map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		require.Equal(t, "dm.received", payload["event_type"])
		require.Equal(t, "12345", payload["webhook_id"])
		require.NotEmpty(t, payload["expires_at"])
		require.Equal(t, "Bearer access", r.Header.Get("Authorization"))
		var reservations int64
		reservations, err := s.db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(t.Context())
		require.NoError(t, err)
		require.EqualValues(t, 2, reservations, "reserve complete exposure before external I/O")
		_, _ = fmt.Fprint(w, `{"data":{"subscription":{"subscription_id":"98765"}}}`)
	})
	_, err := s.StartSubscription(t.Context(), "workspace", "account", "dm.received", 2)
	require.ErrorIs(t, err, ErrBudget)
	require.Zero(t, calls)
	s.config.MonthlyBudgetMicrousd = 10_000
	s.config.ProviderSpendingLimitConfirmed = true
	s.config.WebhookID = "12345"
	require.NoError(t, s.costs.SetProviderCostPolicy(AddPricing(usage.ProviderCostPolicy{}, s.config.MonthlyBudgetMicrousd)))
	_, err = s.StartSubscription(t.Context(), "workspace", "account", "dm.received", 2)
	require.ErrorIs(t, err, usage.ErrProviderCostBudgetExceeded)
	require.Zero(t, calls)
	s.config.MonthlyBudgetMicrousd = 20_000
	require.NoError(t, s.costs.SetProviderCostPolicy(AddPricing(usage.ProviderCostPolicy{}, s.config.MonthlyBudgetMicrousd)))
	sub, err := s.StartSubscription(t.Context(), "workspace", "account", "dm.received", 2)
	require.NoError(t, err)
	require.Equal(t, 1, calls)
	raw := []byte(fmt.Sprintf(`{"data":{"event_uuid":"event-1","event_type":"dm.received","tag":%q,"filter":{"user_id":"111"},"payload":{"direct_message_events":[{"type":"message_create","id":"message-1","created_timestamp":"1784928224372","message_create":{"target":{"recipient_id":"111"},"sender_id":"222","message_data":{"text":"hello"}}}],"users":{"222":{"data":{"id":"222","name":"Other person","username":"other"}}}}}}`, sub.ID))
	require.ErrorIs(t, s.Receive(t.Context(), "invalid", raw), ErrAccessDenied)
	scheduled := 0
	s.SetReceiptScheduler(func(ctx context.Context) error {
		scheduled++
		count, err := s.db.NewSelect().Model((*receipt)(nil)).Count(ctx)
		require.NoError(t, err)
		require.EqualValues(t, 1, count, "receipt must commit before enqueue")
		if scheduled == 1 {
			return errors.New("queue unavailable")
		}
		return nil
	})
	require.ErrorContains(t, s.Receive(t.Context(), sign(s.config.ClientSecret, raw), raw), "queue unavailable")

	require.NoError(t, s.Receive(t.Context(), sign(s.config.ClientSecret, raw), raw))
	require.Equal(t, 2, scheduled)
	var receiptRow receipt
	require.NoError(t, s.db.NewSelect().Model(&receiptRow).Scan(t.Context()))
	require.NotContains(t, string(receiptRow.PayloadEncrypted), "hello")
	attempts := 0
	apply := func(_ context.Context, accountID string, batch platform.FetchMessagesResult) error {
		attempts++
		require.Equal(t, "account", accountID)
		require.Empty(t, batch.NextCursor)
		require.Len(t, batch.Conversations, 1)
		conversation := batch.Conversations[0]
		require.Equal(t, "111-222", conversation.ID)
		require.Equal(t, "message-1", conversation.Messages[0].ID)
		require.Equal(t, "hello", conversation.Messages[0].Body)
		require.Equal(t, "inbound", conversation.Messages[0].Direction)
		if attempts == 1 {
			return errors.New("storage unavailable")
		}
		return nil
	}
	_, err = s.Drain(t.Context(), apply, 100)
	require.Error(t, err)
	retryAt := s.now().Add(31 * time.Second)
	s.now = func() time.Time { return retryAt }
	processed, err := s.Drain(t.Context(), apply, 100)
	require.NoError(t, err)
	require.Equal(t, 1, processed)
	processed, err = s.Drain(t.Context(), apply, 100)
	require.NoError(t, err)
	require.Zero(t, processed)
	require.Equal(t, 2, attempts)
	// Delivery replay settles the same reservation, never a second billed event.
	count, err := s.db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	encrypted := strings.Replace(strings.Replace(string(raw), "dm.received", "chat.received", 1), "event-1", "event-encrypted", 1)
	require.NoError(t, s.Receive(t.Context(), sign(s.config.ClientSecret, []byte(encrypted)), []byte(encrypted)))
	count, err = s.db.NewSelect().Model((*receipt)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestXQuotaCannotBurstAcrossLocalWindowBoundary(t *testing.T) {
	s := testService(t)
	now := time.Date(2026, 10, 20, 12, 14, 59, 0, time.UTC)
	s.now = func() time.Time { return now }
	for i := 0; i < 15; i++ {
		require.NoError(t, s.ReserveXMessagingRequest(t.Context(), "111", platform.XMessagingRead))
	}
	now = now.Add(2 * time.Second)
	var quota *QuotaError
	require.ErrorAs(t, s.ReserveXMessagingRequest(t.Context(), "111", platform.XMessagingRead), &quota, "a UTC boundary is not proof that X reset its quota")
}

func TestReceiptFailureDoesNotBlockOtherAccountsOrSubscriptionShutdown(t *testing.T) {
	s := testService(t)
	seedGrant(t, s, s.now().Add(time.Hour))
	ctx := t.Context()
	_, err := s.db.NewInsert().Model(&models.SocialAccount{ID: "other", WorkspaceID: "workspace", Platform: "x", AccountID: "333", Slug: "other", AccessTokenEnc: []byte("oauth1"), IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	otherGrant := grant{SocialAccountID: "other", WorkspaceID: "workspace", RemoteUserID: "333", ClientID: s.config.ClientID}
	require.NoError(t, s.protect(&otherGrant, tokenResponse{AccessToken: "other-token", RefreshToken: "refresh", Scope: messagingScopes, ExpiresIn: 7200}))
	_, err = s.db.NewInsert().Model(&otherGrant).Exec(ctx)
	require.NoError(t, err)
	for i, account := range []string{"account", "other"} {
		remote := []string{"111", "333"}[i]
		sub := subscription{ID: fmt.Sprint(i), SocialAccountID: account, WorkspaceID: "workspace", RemoteUserID: remote, RemoteSubscriptionID: fmt.Sprint(101 + i), EventType: "dm.sent", EventLimit: 1, Received: 1, State: "active", ExpiresAt: s.now().Add(time.Hour), CreatedAt: s.now()}
		_, err = s.db.NewInsert().Model(&sub).Exec(ctx)
		require.NoError(t, err)
		raw := fmt.Sprintf(`{"data":{"event_type":"dm.sent","payload":{"direct_message_events":[{"type":"message_create","id":"message-%d","created_timestamp":"1784928224372","message_create":{"target":{"recipient_id":"222"},"sender_id":%q,"message_data":{"text":"hello"}}}]}}}`, i, remote)
		encrypted, encryptErr := s.encryptor.Encrypt(raw)
		require.NoError(t, encryptErr)
		_, err = s.db.NewInsert().Model(&receipt{EventUUID: fmt.Sprint(i), SubscriptionID: sub.ID, SocialAccountID: account, PayloadEncrypted: encrypted, CreatedAt: s.now().Add(time.Duration(i) * time.Second)}).Exec(ctx)
		require.NoError(t, err)
	}

	var failedReceipt receipt
	require.NoError(t, s.db.NewSelect().Model(&failedReceipt).Where("event_uuid = ?", "0").Scan(ctx))
	for i := 0; i < 2; i++ {
		copy := failedReceipt
		copy.EventUUID = fmt.Sprintf("poison-%d", i)
		copy.CreatedAt = failedReceipt.CreatedAt.Add(time.Duration(i+1) * time.Millisecond)
		_, err = s.db.NewInsert().Model(&copy).Exec(ctx)
		require.NoError(t, err)
	}
	attempted := map[string]int{}
	providerServer(t, s, func(w http.ResponseWriter, r *http.Request) {
		attempted[r.URL.Path]++
		if strings.HasSuffix(r.URL.Path, "101") {
			w.WriteHeader(403)
			_, _ = fmt.Fprint(w, `{"errors":[{"title":"revoked"}]}`)
			return
		}
		_, _ = fmt.Fprint(w, `{"data":{"deleted":true}}`)
	})
	apply := func(_ context.Context, account string, _ platform.FetchMessagesResult) error {
		if account == "account" {
			return errors.New("account apply denied")
		}
		return nil
	}
	processed, err := s.Drain(ctx, apply, 2)
	require.Error(t, err)
	require.Zero(t, processed)
	// Even after retries become due again, the next batch must prioritize work
	// that has not yet been attempted instead of repeating the same poison rows.
	retryTime := s.now().Add(5 * time.Minute)
	s.now = func() time.Time { return retryTime }
	processed, err = s.Drain(ctx, apply, 2)
	require.Error(t, err)
	require.Equal(t, 1, processed)
	require.Equal(t, 2, attempted["/2/activity/subscriptions/101"])
	require.Equal(t, 1, attempted["/2/activity/subscriptions/102"])
	var stopped subscription
	require.NoError(t, s.db.NewSelect().Model(&stopped).Where("id = ?", "1").Scan(ctx))
	require.Equal(t, "stopped", stopped.State)
}

func TestSubscriptionDeletionRequiresProviderConfirmation(t *testing.T) {
	s := testService(t)
	seedGrant(t, s, s.now().Add(time.Hour))
	ctx := t.Context()
	sub := subscription{ID: "subscription", SocialAccountID: "account", WorkspaceID: "workspace", RemoteUserID: "111", RemoteSubscriptionID: "101", EventType: "dm.sent", EventLimit: 1, State: "active", ExpiresAt: s.now().Add(time.Hour), CreatedAt: s.now()}
	_, err := s.db.NewInsert().Model(&sub).Exec(ctx)
	require.NoError(t, err)
	confirmed := false
	providerServer(t, s, func(w http.ResponseWriter, _ *http.Request) {
		if confirmed {
			_, _ = fmt.Fprint(w, `{"data":{"deleted":true}}`)
		} else {
			_, _ = fmt.Fprint(w, `{"data":{"deleted":false},"errors":[{"title":"still active"}]}`)
		}
	})
	require.Error(t, s.StopSubscription(ctx, "workspace", sub.ID))
	require.NoError(t, s.db.NewSelect().Model(&sub).WherePK().Scan(ctx))
	require.Equal(t, "active", sub.State)
	confirmed = true
	require.NoError(t, s.StopSubscription(ctx, "workspace", sub.ID))
	require.NoError(t, s.db.NewSelect().Model(&sub).WherePK().Scan(ctx))
	require.Equal(t, "stopped", sub.State)
}

func TestDefinitiveSubscriptionRejectionReleasesUnspentExposure(t *testing.T) {
	s := testService(t)
	seedGrant(t, s, s.now().Add(time.Hour))
	s.config.MonthlyBudgetMicrousd = 10_000
	s.config.ProviderSpendingLimitConfirmed = true
	s.config.WebhookID = "12345"
	require.NoError(t, s.costs.SetProviderCostPolicy(AddPricing(usage.ProviderCostPolicy{}, 10_000)))
	providerServer(t, s, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(403)
		_, _ = fmt.Fprint(w, `{"errors":[{"title":"permission denied"}]}`)
	})
	_, err := s.StartSubscription(t.Context(), "workspace", "account", "dm.received", 1)
	require.Error(t, err)
	var sub subscription
	require.NoError(t, s.db.NewSelect().Model(&sub).Scan(t.Context()))
	require.Equal(t, "stopped", sub.State)
	count, err := s.db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}
