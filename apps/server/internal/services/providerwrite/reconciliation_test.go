package providerwrite

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestReconciliationExpiresWithoutReplayingProviderWrites(t *testing.T) {
	for _, mode := range []string{"resume", "reconcile"} {
		for _, test := range []struct {
			provider string
			state    string
			limit    time.Duration
		}{
			{provider: "facebook", state: "facebook_video_processing", limit: 24 * time.Hour},
			{provider: "facebook", state: "facebook_video_publishing", limit: 24 * time.Hour},
			{provider: "instagram", state: "container_processing", limit: 24 * time.Hour},
			{provider: "tiktok", state: "processing", limit: 24 * time.Hour},
			{provider: "tiktok", state: "inbox_delivered", limit: 30 * 24 * time.Hour},
			{provider: "peertube", state: "transcoding", limit: 24 * time.Hour},
			{provider: "pinterest", state: "processing", limit: 24 * time.Hour},
			{provider: "googlebusiness", state: "processing", limit: 24 * time.Hour},
			{provider: "discord", state: "discord_message_reconcile", limit: 24 * time.Hour},
		} {
			t.Run(mode+"/"+test.provider+"/"+test.state, func(t *testing.T) {
				db := newProviderWriteTestDB(t)
				service := New(db)
				started := time.Now().UTC()
				now := started
				service.now = func() time.Time { return now }
				input := providerWriteTestInput(t, "bounded-reconciliation")
				input.Provider = test.provider
				pending := platform.PublishResult{
					SubmissionState: platform.PublishSubmissionPending, ProviderState: test.state,
					ProviderReference: "receipt-1", RetrySafety: platform.PublishRetryReconcileOnly,
					ReconcileAfter: time.Minute,
				}
				sends, checks := 0, 0
				send := func(_ context.Context, control *Control) (platform.PublishResult, error) {
					sends++
					return pending, control.Begin(pending)
				}
				check := func(reference string) platform.PublishResult {
					checks++
					require.Equal(t, "receipt-1", reference)
					return pending
				}
				var resume ResumeFunc
				var reconcile ReconcileFunc
				if mode == "resume" {
					resume = func(_ context.Context, _ *Control, reference string) (platform.PublishResult, error) {
						return check(reference), nil
					}
				} else {
					reconcile = func(_ context.Context, reference string) (platform.PublishResult, error) {
						return check(reference), nil
					}
				}
				_, err := service.Execute(t.Context(), input, send, reconcile, resume)
				_, pendingOutcome := IsPending(err)
				require.True(t, pendingOutcome)
				now = started.Add(test.limit - time.Minute)
				_, err = service.Execute(t.Context(), input, send, reconcile, resume)
				_, pendingOutcome = IsPending(err)
				require.True(t, pendingOutcome, "a poll just before expiry must not terminate or reset the window")
				require.Equal(t, 1, checks)
				// A new service simulates a worker restart. Poll timestamps cannot
				// extend the deadline persisted by the original send.
				service = New(db)
				service.now = func() time.Time { return now }
				now = started.Add(test.limit + time.Second)
				_, err = service.Execute(t.Context(), input, send, reconcile, resume)
				require.ErrorContains(t, err, "reconciliation expired")
				require.True(t, IsAmbiguous(err), "a timeout cannot prove provider rejection")
				require.Equal(t, 1, sends)
				require.Equal(t, 1, checks, "an expired resume must not finish an unknown write")
				attempt := latestProviderWriteAttempt(t, db, input.OperationID)
				require.Equal(t, "receipt-1", attempt.ProviderReference)
				require.Equal(t, string(platform.PublishRetryNever), attempt.RetrySafety)
				require.Equal(t, "provider_reconciliation_expired", attempt.SafeErrorCode)
				require.True(t, attempt.ReconcileAfter.IsZero())
				require.Equal(t, DeliveryManualResolution, deliveryState(attempt))
				require.Equal(t, RecoveryManualResolution, DeliveryRecoveryAction(models.ProviderDelivery{
					State: deliveryState(attempt), RetrySafety: attempt.RetrySafety,
				}))
				_, err = service.Execute(t.Context(), input, send, reconcile, resume)
				require.ErrorContains(t, err, "reconciliation expired")
				require.Equal(t, 1, sends)
				require.Equal(t, 1, checks)
			})
		}
	}
}

func TestExpiredReconciliationCannotBeRevivedByAnInflightPoll(t *testing.T) {
	for _, accepted := range []bool{false, true} {
		name := "pending"
		if accepted {
			name = "accepted"
		}
		t.Run(name, func(t *testing.T) {
			service := New(newProviderWriteTestDB(t))
			startedAt := time.Now().UTC()
			var clock atomic.Int64
			clock.Store(startedAt.UnixNano())
			service.now = func() time.Time { return time.Unix(0, clock.Load()).UTC() }
			input := providerWriteTestInput(t, "inflight-expiry")
			pending := platform.PublishResult{SubmissionState: platform.PublishSubmissionPending, ProviderState: "processing", ProviderReference: "receipt-1", RetrySafety: platform.PublishRetryReconcileOnly, ReconcileAfter: time.Minute}
			send := func(_ context.Context, control *Control) (platform.PublishResult, error) {
				return pending, control.Begin(pending)
			}
			_, err := service.Execute(t.Context(), input, send, nil)
			require.Error(t, err)
			clock.Store(startedAt.Add(time.Minute).UnixNano())
			reading, release := make(chan struct{}), make(chan struct{})
			done := make(chan error, 1)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			go func() {
				_, pollErr := service.Execute(ctx, input, send, func(ctx context.Context, _ string) (platform.PublishResult, error) {
					close(reading)
					select {
					case <-release:
					case <-ctx.Done():
						return platform.PublishResult{}, ctx.Err()
					}
					if accepted {
						return platform.AcceptedPublishResult("live-post"), nil
					}
					return pending, nil
				})
				done <- pollErr
			}()
			select {
			case <-reading:
			case <-ctx.Done():
				t.Fatal("provider poll did not start")
			}
			clock.Store(startedAt.Add(24*time.Hour + time.Second).UnixNano())
			_, err = service.Execute(ctx, input, send, nil)
			require.ErrorContains(t, err, "reconciliation expired")
			close(release)
			pollErr := <-done
			attempt := latestProviderWriteAttempt(t, service.db, input.OperationID)
			if accepted {
				require.NoError(t, pollErr)
				require.Equal(t, DeliveryLive, deliveryState(attempt), "positive provider confirmation can settle an expired receipt")
			} else {
				require.ErrorContains(t, pollErr, "reconciliation expired")
				require.Equal(t, DeliveryManualResolution, deliveryState(attempt))
				require.Equal(t, string(platform.PublishRetryNever), attempt.RetrySafety)
				require.True(t, attempt.ReconcileAfter.IsZero())
			}
		})
	}
}

func TestProviderScheduledDeliveryOutlivesProcessingWindow(t *testing.T) {
	service := New(newProviderWriteTestDB(t))
	now := time.Now().UTC()
	service.now = func() time.Time { return now }
	input := providerWriteTestInput(t, "provider-scheduled")
	pending := platform.PublishResult{SubmissionState: platform.PublishSubmissionPending, ProviderState: "scheduled", ProviderReference: "scheduled-post", RetrySafety: platform.PublishRetryReconcileOnly, ReconcileAfter: time.Hour}
	sends := 0
	send := func(_ context.Context, control *Control) (platform.PublishResult, error) {
		sends++
		return pending, control.Begin(pending)
	}
	_, err := service.Execute(t.Context(), input, send, nil)
	require.Error(t, err)
	require.Equal(t, 1, sends)
	now = now.Add(40 * 24 * time.Hour)
	reconciliations := 0
	result, err := service.Execute(t.Context(), input, send, func(_ context.Context, reference string) (platform.PublishResult, error) {
		reconciliations++
		require.Equal(t, "scheduled-post", reference)
		return platform.AcceptedPublishResult("live-post"), nil
	})
	require.NoError(t, err)
	require.Equal(t, "live-post", result.ExternalID)
	require.Equal(t, 1, sends, "a reconcile-only receipt must never send the write again")
	require.Equal(t, 1, reconciliations, "the expired receipt is reconciled exactly once")
}
