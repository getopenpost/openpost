package botingress

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	testSigningKey    = "nonce-signing-key-that-stays-private"
	testWebhookSecret = "webhook-secret-that-stays-private"
)

func openBotIngressTestDB(t *testing.T, path string, initialize bool) *bun.DB {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", "file:"+path+"?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	if !initialize {
		return db
	}
	_, err = db.ExecContext(t.Context(), `
		CREATE TABLE bot_connection_nonces (
			id TEXT PRIMARY KEY, provider TEXT NOT NULL, workspace_id TEXT NOT NULL,
			created_by_user_id TEXT NOT NULL, nonce_hash TEXT NOT NULL UNIQUE,
			expires_at DATETIME NOT NULL, consumed_at DATETIME, created_at DATETIME NOT NULL
		);
		CREATE TABLE bot_ingress_events (
			id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
			kind TEXT NOT NULL, workspace_id TEXT,
			social_account_id TEXT NOT NULL DEFAULT '', connection_nonce_id TEXT NOT NULL DEFAULT '',
			subject_reference TEXT NOT NULL DEFAULT '', parent_reference TEXT NOT NULL DEFAULT '',
			occurred_at DATETIME NOT NULL, processed_at DATETIME,
			safe_error_code TEXT NOT NULL DEFAULT '', created_at DATETIME NOT NULL,
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

func TestConnectionNonceExpiryReplayBadSecretAndCrossRoleConsumption(t *testing.T) {
	web, worker, now := newBotIngressServices(t)
	ctx := t.Context()

	issued := issueTestNonce(t, web)
	consumed, err := worker.ConsumeNonce(ctx, issued.Credential)
	require.NoError(t, err)
	require.Equal(t, "workspace-1", consumed.WorkspaceID)
	_, err = web.ConsumeNonce(ctx, issued.Credential)
	require.ErrorIs(t, err, ErrNonceConsumed)

	expired := issueTestNonce(t, web)
	worker.SetNowForTest(func() time.Time { return now.Add(ConnectionNonceTTL + time.Second) })
	_, err = worker.ConsumeNonce(ctx, expired.Credential)
	require.ErrorIs(t, err, ErrNonceExpired)

	badSecret := New(worker.db, []byte("different-private-key"))
	badSecret.SetNowForTest(func() time.Time { return now })
	_, err = badSecret.ConsumeNonce(ctx, expired.Credential)
	require.ErrorIs(t, err, ErrInvalidNonce)
	require.NotContains(t, err.Error(), testSigningKey)
	require.NotContains(t, err.Error(), expired.Credential)

	var stored models.BotConnectionNonce
	require.NoError(t, web.db.NewSelect().Model(&stored).Where("id = ?", issued.ID).Scan(ctx))
	require.Len(t, stored.NonceHash, 64)
	require.NotContains(t, fmt.Sprintf("%+v", stored), issued.Credential)
	require.NotContains(t, fmt.Sprintf("%+v", stored), testSigningKey)
}

func TestConnectionNonceConcurrentReplayHasOneWinner(t *testing.T) {
	web, worker, _ := newBotIngressServices(t)
	issued := issueTestNonce(t, web)

	type result struct {
		nonce *models.BotConnectionNonce
		err   error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for _, service := range []*Service{web, worker} {
		go func(service *Service) {
			<-start
			nonce, err := service.ConsumeNonce(context.Background(), issued.Credential)
			results <- result{nonce: nonce, err: err}
		}(service)
	}
	close(start)

	var successes, replays int
	for range 2 {
		outcome := <-results
		switch {
		case outcome.err == nil:
			successes++
			require.NotNil(t, outcome.nonce)
		case errors.Is(outcome.err, ErrNonceConsumed):
			replays++
		default:
			t.Fatalf("unexpected concurrent consume error: %v", outcome.err)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, replays)
}

func TestSignedIngressVerifiesBeforeNormalizationAndQueuesOneSafeReference(t *testing.T) {
	web, _, now := newBotIngressServices(t)
	issued := issueTestNonce(t, web)
	body := []byte(`{"update_id":"provider-update-1","private_payload":"must-never-persist"}`)
	var normalizeCalls atomic.Int32
	normalizer := NormalizeFunc(func(received []byte) (NormalizedEvent, error) {
		normalizeCalls.Add(1)
		require.Equal(t, body, received)
		return NormalizedEvent{
			ProviderEventID: "provider-update-1", Kind: "connection.requested",
			SubjectReference: "chat-42", OccurredAt: now,
			ConnectionCredential: issued.Credential,
		}, nil
	})
	request := AcceptRequest{
		Provider: "telegram", Body: body, Normalizer: normalizer,
		Verifier: SecretHeaderVerifier{HeaderName: "X-Bot-Secret", Secret: testWebhookSecret},
		Headers:  http.Header{"X-Bot-Secret": []string{testWebhookSecret}},
	}

	first, err := web.Accept(t.Context(), request)
	require.NoError(t, err)
	require.False(t, first.Duplicate)
	second, err := web.Accept(t.Context(), request)
	require.NoError(t, err)
	require.True(t, second.Duplicate)
	require.Equal(t, first.EventID, second.EventID)

	badRequest := request
	badRequest.Headers = http.Header{"X-Bot-Secret": []string{"wrong-secret"}}
	_, err = web.Accept(t.Context(), badRequest)
	require.ErrorIs(t, err, ErrInvalidSignature)
	require.Equal(t, int32(2), normalizeCalls.Load(), "a bad signature must be rejected before normalization")
	require.Equal(t, CodeInvalidSignature, CodeOf(err))
	require.Equal(t, http.StatusUnauthorized, HTTPStatusOf(err))
	require.NotContains(t, err.Error(), "wrong-secret")
	require.NotContains(t, err.Error(), testWebhookSecret)

	var event models.BotIngressEvent
	require.NoError(t, web.db.NewSelect().Model(&event).Where("id = ?", first.EventID).Scan(t.Context()))
	require.Equal(t, "workspace-1", event.WorkspaceID)
	require.Equal(t, issued.ID, event.ConnectionNonceID)
	require.Equal(t, "chat-42", event.SubjectReference)

	var jobs []models.Job
	require.NoError(t, web.db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeBotIngress).Scan(t.Context()))
	require.Len(t, jobs, 1)
	require.JSONEq(t, `{"event_id":"`+first.EventID+`","workspace_id":"workspace-1"}`, jobs[0].Payload)
	for _, stored := range []string{fmt.Sprintf("%+v", event), fmt.Sprintf("%+v", jobs[0])} {
		require.NotContains(t, stored, "must-never-persist")
		require.NotContains(t, stored, issued.Credential)
		require.NotContains(t, stored, testWebhookSecret)
		require.NotContains(t, stored, testSigningKey)
	}
}

func TestConcurrentDuplicateUpdateQueuesOnce(t *testing.T) {
	web, worker, now := newBotIngressServices(t)
	normalizer := NormalizeFunc(func([]byte) (NormalizedEvent, error) {
		return NormalizedEvent{ProviderEventID: "same-update", Kind: "reaction.changed", SubjectReference: "message-7", OccurredAt: now}, nil
	})
	request := AcceptRequest{
		Provider: "telegram", Body: []byte(`{"private":"payload"}`), Normalizer: normalizer,
		Verifier: SecretHeaderVerifier{HeaderName: "X-Bot-Secret", Secret: testWebhookSecret},
		Headers:  http.Header{"X-Bot-Secret": []string{testWebhookSecret}},
	}

	type result struct {
		accepted AcceptResult
		err      error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for _, service := range []*Service{web, worker} {
		go func(service *Service) {
			<-start
			accepted, err := service.Accept(context.Background(), request)
			results <- result{accepted: accepted, err: err}
		}(service)
	}
	close(start)
	var originals, duplicates int
	for range 2 {
		outcome := <-results
		require.NoError(t, outcome.err)
		if outcome.accepted.Duplicate {
			duplicates++
		} else {
			originals++
		}
	}
	require.Equal(t, 1, originals)
	require.Equal(t, 1, duplicates)
	count, err := web.db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", jobregistry.TypeBotIngress).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestHandleJobProcessesOnlySafeEventAndNormalizesProcessorFailure(t *testing.T) {
	web, _, now := newBotIngressServices(t)
	accepted, err := web.Accept(t.Context(), AcceptRequest{
		Provider: "telegram", Body: []byte(`{"raw":"private"}`),
		Verifier: VerifyFunc(func(http.Header, []byte) error { return nil }),
		Normalizer: NormalizeFunc(func([]byte) (NormalizedEvent, error) {
			return NormalizedEvent{ProviderEventID: "process-1", Kind: "reaction.changed", SubjectReference: "message-1", OccurredAt: now}, nil
		}),
	})
	require.NoError(t, err)
	var calls atomic.Int32
	require.NoError(t, web.RegisterProcessor("telegram", ProcessorFunc(func(_ context.Context, event models.BotIngressEvent) error {
		calls.Add(1)
		require.Equal(t, "message-1", event.SubjectReference)
		require.Empty(t, event.SafeErrorCode)
		return nil
	})))
	payload, err := jobregistry.EncodeBotIngressPayload(jobregistry.BotIngressPayload{EventID: accepted.EventID})
	require.NoError(t, err)
	require.NoError(t, web.HandleJob(t.Context(), jobregistry.TypeBotIngress, payload))
	require.NoError(t, web.HandleJob(t.Context(), jobregistry.TypeBotIngress, payload))
	require.Equal(t, int32(1), calls.Load())

	failed, err := web.Accept(t.Context(), AcceptRequest{
		Provider: "discord", Body: []byte(`{"provider_secret":"never-store"}`),
		Verifier: VerifyFunc(func(http.Header, []byte) error { return nil }),
		Normalizer: NormalizeFunc(func([]byte) (NormalizedEvent, error) {
			return NormalizedEvent{ProviderEventID: "process-2", Kind: "installation.changed", SubjectReference: "guild-1", OccurredAt: now}, nil
		}),
	})
	require.NoError(t, err)
	require.NoError(t, web.RegisterProcessor("discord", ProcessorFunc(func(context.Context, models.BotIngressEvent) error {
		return errors.New("raw provider body and credentials")
	})))
	failedPayload, err := jobregistry.EncodeBotIngressPayload(jobregistry.BotIngressPayload{EventID: failed.EventID})
	require.NoError(t, err)
	err = web.HandleJob(t.Context(), jobregistry.TypeBotIngress, failedPayload)
	require.ErrorIs(t, err, ErrProcessingFailed)
	require.NotContains(t, err.Error(), "raw provider")
	var event models.BotIngressEvent
	require.NoError(t, web.db.NewSelect().Model(&event).Where("id = ?", failed.EventID).Scan(t.Context()))
	require.Equal(t, string(CodeProcessingFailed), event.SafeErrorCode)
}
