package publisher

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
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

func TestPendingPublicationContinuesWithoutFailureEvents(t *testing.T) {
	t.Parallel()
	for _, segmented := range []bool{false, true} {
		name := "single"
		if segmented {
			name = "segment"
		}
		t.Run(name, func(t *testing.T) {
			base := &fakePublisherAdapter{}
			srv := newPublisherLifecycleTestServer(t, base)
			adapter := &pendingPublisherAdapter{fakePublisherAdapter: base}
			srv.service.SetProvider("x", adapter)
			if segmented {
				_, err := srv.db.NewInsert().Model(&models.PublicationSegment{ID: "source-1", PublicationID: "publication-1", Body: "Content", SettingsJSON: "{}"}).Exec(t.Context())
				require.NoError(t, err)
				_, err = srv.db.NewInsert().Model(&models.RenditionSegment{ID: "segment-1", RenditionID: "rendition-1", PublicationSegmentID: "source-1", Body: "Content", SettingsJSON: "{}", Status: models.RenditionStatusReady}).Exec(t.Context())
				require.NoError(t, err)
			}
			ctx, payload := srv.authorizedPublicationJob(t)
			for attempt := 0; attempt < 2; attempt++ {
				err := srv.service.HandlePublishPublicationJob(ctx, payload)
				var continuation *RetryableError
				require.ErrorAs(t, err, &continuation)
				require.Equal(t, "provider_submission_pending", continuation.Failure.Code)
				var rendition models.Rendition
				require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
				require.Equal(t, models.RenditionStatusPublishing, rendition.Status)
				if segmented {
					var segment models.RenditionSegment
					require.NoError(t, srv.db.NewSelect().Model(&segment).Where("id = ?", "segment-1").Scan(ctx))
					require.Equal(t, models.RenditionStatusPublishing, segment.Status)
				}
				var publication models.Publication
				require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
				require.Equal(t, models.PublicationStatusPublishing, publication.Status)
				for _, event := range srv.lifecycleEvents(t) {
					require.NotEqual(t, lifecycle.EventFailed, event.Type, "pending checks must not trigger failure webhooks")
					require.NotEqual(t, lifecycle.EventRetried, event.Type, "normal processing is not a failed publish retry")
				}
				_, err = srv.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
					Set("reconcile_after = ?", time.Now().UTC().Add(-time.Minute)).Where("publication_id = ?", "publication-1").Exec(ctx)
				require.NoError(t, err)
			}
			adapter.published = true
			require.NoError(t, srv.service.HandlePublishPublicationJob(ctx, payload))
			require.Equal(t, 1, adapter.publishCalls, "continuation must not replay the publication")
			require.Equal(t, 2, adapter.checks)
			var rendition models.Rendition
			require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
			require.Equal(t, models.RenditionStatusPublished, rendition.Status)
			require.Equal(t, "external-1", rendition.ExternalID)
		})
	}
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
