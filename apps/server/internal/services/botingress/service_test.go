package botingress

import (
	"fmt"
	"net/http"
	"path/filepath"

	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	testSigningKey    = "nonce-signing-key-that-stays-private"
	testWebhookSecret = "webhook-secret-that-stays-private"
)

func openBotIngressTestDB(t *testing.T, path string, initialize bool) *bun.DB {
	t.Helper()
	db, err := testdb.OpenWithDriver("sqlite", "file:"+path+"?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	if !initialize {
		return db
	}
	_, err = db.ExecContext(t.Context(), `
		CREATE TABLE bot_connection_nonces (
			id TEXT PRIMARY KEY, provider TEXT NOT NULL, workspace_id TEXT NOT NULL,
			created_by_user_id TEXT NOT NULL, nonce_hash TEXT NOT NULL UNIQUE,
			expected_subject_reference TEXT NOT NULL DEFAULT '',
			expires_at DATETIME NOT NULL, consumed_at DATETIME, created_at DATETIME NOT NULL
		);
		CREATE TABLE bot_ingress_events (
			id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
			kind TEXT NOT NULL, workspace_id TEXT,
			social_account_id TEXT NOT NULL DEFAULT '', connection_nonce_id TEXT NOT NULL DEFAULT '',
			subject_reference TEXT NOT NULL DEFAULT '', parent_reference TEXT NOT NULL DEFAULT '',
			content_profile TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '',
			metrics_json TEXT NOT NULL DEFAULT '{}', occurred_at DATETIME NOT NULL, processed_at DATETIME,
			safe_error_code TEXT NOT NULL DEFAULT '', processing_attempts INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL,
			UNIQUE (provider, provider_event_id)
		);
	`)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.Job)(nil)).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, jobregistry.EnsureActiveDedupeIndex(t.Context(), db))
	return db
}

func newBotIngressServices(t *testing.T) (*Service, *Service, time.Time) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "bot-ingress.db")
	firstDB := openBotIngressTestDB(t, path, true)
	secondDB := openBotIngressTestDB(t, path, false)
	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	first := New(firstDB, []byte(testSigningKey))
	second := New(secondDB, []byte(testSigningKey))
	first.SetNowForTest(func() time.Time { return now })
	second.SetNowForTest(func() time.Time { return now })
	return first, second, now
}

func issueTestNonce(t *testing.T, service *Service) IssuedNonce {
	t.Helper()
	issued, err := service.IssueNonce(t.Context(), IssueNonceInput{
		Provider: "telegram", WorkspaceID: "workspace-1", CreatedByUserID: "user-1",
	})
	require.NoError(t, err)
	require.NotEmpty(t, issued.Credential)
	return issued
}

// acceptCredential delivers a signed connection request that carries the
// credential through the production ingress path with a distinct provider event
// identity.
func acceptCredential(t *testing.T, service *Service, credential, providerEventID string, occurredAt time.Time) (AcceptResult, error) {
	t.Helper()
	normalizer := NormalizeFunc(func([]byte) (NormalizedEvent, error) {
		return NormalizedEvent{
			ProviderEventID: providerEventID, Kind: "connection.requested",
			WorkspaceID: "workspace-1", SubjectReference: "chat-42", OccurredAt: occurredAt,
			ConnectionCredential: credential,
		}, nil
	})
	return service.Accept(t.Context(), AcceptRequest{
		Provider: "telegram", Body: []byte(`{"update_id":"` + providerEventID + `"}`),
		Normalizer: normalizer,
		Verifier:   SecretHeaderVerifier{HeaderName: "X-Bot-Secret", Secret: testWebhookSecret},
		Headers:    http.Header{"X-Bot-Secret": []string{testWebhookSecret}},
	})
}

func TestAcceptRejectsExpiredReplayedAndForeignSignedConnectionCredentials(t *testing.T) {
	web, worker, now := newBotIngressServices(t)
	ctx := t.Context()

	// Control: a fresh credential is accepted exactly once through the real
	// ingress path, consuming it on the other database handle.
	issued := issueTestNonce(t, web)
	first, err := acceptCredential(t, worker, issued.Credential, "provider-connect-1", now)
	require.NoError(t, err)
	require.False(t, first.Duplicate)
	var consumed models.BotConnectionNonce
	require.NoError(t, web.db.NewSelect().Model(&consumed).Where("id = ?", issued.ID).Scan(ctx))
	require.Equal(t, "workspace-1", consumed.WorkspaceID)
	require.False(t, consumed.ConsumedAt.IsZero())

	// Replay: a different provider event carrying the consumed credential is
	// rejected and persists nothing, so event dedupe cannot mask the rejection.
	_, err = acceptCredential(t, web, issued.Credential, "provider-connect-2", now)
	require.ErrorIs(t, err, ErrNonceConsumed)
	replayed, err := web.db.NewSelect().Model((*models.BotIngressEvent)(nil)).
		Where("provider = ? AND provider_event_id = ?", "telegram", "provider-connect-2").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, replayed)

	// Expiry: the same credential is rejected once its signed lifetime ends.
	expired := issueTestNonce(t, web)
	worker.SetNowForTest(func() time.Time { return now.Add(ConnectionNonceTTL + time.Second) })
	_, err = acceptCredential(t, worker, expired.Credential, "provider-connect-3", now.Add(ConnectionNonceTTL+time.Second))
	require.ErrorIs(t, err, ErrNonceExpired)

	// Foreign signing key: the credential is not authenticatable and neither the
	// error nor the stored row may echo signing or credential material.
	foreign := New(worker.db, []byte("different-private-key"))
	foreign.SetNowForTest(func() time.Time { return now })
	_, err = acceptCredential(t, foreign, expired.Credential, "provider-connect-4", now)
	require.ErrorIs(t, err, ErrInvalidNonce)
	require.NotContains(t, err.Error(), testSigningKey)
	require.NotContains(t, err.Error(), expired.Credential)

	require.Len(t, consumed.NonceHash, 64)
	require.NotContains(t, fmt.Sprintf("%+v", consumed), issued.Credential)
	require.NotContains(t, fmt.Sprintf("%+v", consumed), testSigningKey)
}
