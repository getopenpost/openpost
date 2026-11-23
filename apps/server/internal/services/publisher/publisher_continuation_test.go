package publisher

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"

	"github.com/stretchr/testify/require"
)

type pendingPublisherAdapter struct {
	*fakePublisherAdapter
	checks    int
	published bool
}

func (p *pendingPublisherAdapter) Publish(_ context.Context, _, _ string, req *platform.PublishRequest) (platform.PublishResult, error) {
	p.publishCalls++
	result := platform.PublishResult{SubmissionState: platform.PublishSubmissionPending, ProviderState: "processing", ProviderReference: "receipt-1", RetrySafety: platform.PublishRetryReconcileOnly, ReconcileAfter: time.Minute}
	return result, req.BeginWrite(result)
}

func (p *pendingPublisherAdapter) ReconcilePublish(_ context.Context, _, _, reference string) (platform.PublishResult, error) {
	p.checks++
	if p.published {
		return platform.AcceptedPublishResult("external-1"), nil
	}
	return platform.PublishResult{SubmissionState: platform.PublishSubmissionPending, ProviderState: "processing", ProviderReference: reference, RetrySafety: platform.PublishRetryReconcileOnly, ReconcileAfter: time.Minute}, nil
}

func TestPendingDestinationSurvivesLongerRateLimitOnAnotherDestination(t *testing.T) {
	t.Parallel()
	base := &fakePublisherAdapter{}
	srv := newPublisherLifecycleTestServer(t, base)
	pending := &pendingPublisherAdapter{fakePublisherAdapter: base}
	srv.service.SetProvider("x", &mixedPendingPublisherAdapter{pendingPublisherAdapter: pending})
	var account models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(t.Context()))
	account.ID, account.AccountID, account.Slug = "account-2", "rate-limited-account", "rate-limited-account"
	_, err := srv.db.NewInsert().Model(&account).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{ID: "rendition-2", PublicationID: "publication-1", SocialAccountID: account.ID, Platform: "x", Profile: models.ContentProfileShortText, Body: "Another destination", Status: models.RenditionStatusReady}).Exec(t.Context())
	require.NoError(t, err)
	ctx, payload := srv.authorizedPublicationJob(t)
	for attempt := 0; attempt < 2; attempt++ {
		err := srv.service.HandlePublishPublicationJob(ctx, payload)
		var continuation *RetryableError
		require.ErrorAs(t, err, &continuation)
		require.Equal(t, "provider_submission_pending", continuation.Failure.Code, "a pending receipt must retain queue continuation even when another destination asks for a longer retry")
		require.GreaterOrEqual(t, continuation.Failure.RetryAfter, 15*time.Minute, "the rate-limited destination's retry delay must still be respected")
		_, err = srv.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).Set("reconcile_after = ?", time.Now().UTC().Add(-time.Minute)).Where("publication_id = ?", "publication-1").Exec(ctx)
		require.NoError(t, err)
	}
	pending.published = true
	_ = srv.service.HandlePublishPublicationJob(ctx, payload)
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)
	require.Equal(t, 1, pending.publishCalls, "the accepted provider write must not be repeated")
}

type mixedPendingPublisherAdapter struct{ *pendingPublisherAdapter }

func (p *mixedPendingPublisherAdapter) Publish(ctx context.Context, token, accountID string, req *platform.PublishRequest) (platform.PublishResult, error) {
	if accountID == "rate-limited-account" {
		return platform.PublishResult{}, &platform.HTTPError{StatusCode: 429, RetryAfter: 15 * time.Minute}
	}
	return p.pendingPublisherAdapter.Publish(ctx, token, accountID, req)
}
