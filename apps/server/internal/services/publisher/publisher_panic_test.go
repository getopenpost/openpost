package publisher

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
)

type panickingPublisherAdapter struct {
	*fakePublisherAdapter
	phase string
	calls int
}

func (p *panickingPublisherAdapter) Publish(_ context.Context, _, _ string, req *platform.PublishRequest) (platform.PublishResult, error) {
	p.calls++
	if p.phase != "before_write" {
		result := platform.PublishResult{RetrySafety: platform.PublishRetryNever}
		if p.phase == "pending" {
			result = platform.PublishResult{SubmissionState: platform.PublishSubmissionPending, ProviderReference: "receipt-1", RetrySafety: platform.PublishRetryReconcileOnly, ReconcileAfter: time.Minute}
		}
		if err := req.BeginWrite(result); err != nil {
			return platform.PublishResult{}, err
		}
		if p.phase == "pending" {
			if err := req.Checkpoint(result); err != nil {
				return platform.PublishResult{}, err
			}
		}
		if p.phase == "accepted" {
			if err := req.Checkpoint(platform.AcceptedPublishResult("accepted-before-panic")); err != nil {
				return platform.PublishResult{}, err
			}
		}
	}
	panic("private provider payload must not reach destination errors")
}

func (p *panickingPublisherAdapter) ReconcilePublish(context.Context, string, string, string) (platform.PublishResult, error) {
	return platform.AcceptedPublishResult("accepted-after-reconcile"), nil
}

func TestPublicationPanicFinalizesDestinationAndPreservesWriteReceipts(t *testing.T) {
	t.Parallel()
	for _, phase := range []string{"before_write", "sending", "accepted", "pending"} {
		t.Run(phase, func(t *testing.T) {
			base := &fakePublisherAdapter{}
			srv := newPublisherLifecycleTestServer(t, base)
			adapter := &panickingPublisherAdapter{fakePublisherAdapter: base, phase: phase}
			srv.service.SetProvider("x", adapter)
			_, err := srv.db.NewInsert().Model(&models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Content", SettingsJSON: "{}"}).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.RenditionSegment{ID: "segment", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: "Content", SettingsJSON: "{}", Status: models.RenditionStatusReady}).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewCreateTable().Model((*models.PublicationSegmentMedia)(nil)).IfNotExists().Exec(t.Context())
			require.NoError(t, err)
			ctx, payload := srv.authorizedPublicationJob(t)
			var publishErr error
			require.NotPanics(t, func() { publishErr = srv.service.HandlePublishPublicationJob(ctx, payload) })
			require.Error(t, publishErr)
			var recovered *diagnostics.PanicError
			require.ErrorAs(t, publishErr, &recovered)
			require.NotEmpty(t, recovered.Frames)
			var rendition models.Rendition
			var publication models.Publication
			var segment models.RenditionSegment
			require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
			require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
			require.NoError(t, srv.db.NewSelect().Model(&segment).Where("id = ?", "segment").Scan(ctx))
			require.Equal(t, models.PublicationStatusFailed, publication.Status)
			require.Equal(t, models.RenditionStatusFailed, rendition.Status)
			require.Equal(t, models.RenditionStatusFailed, segment.Status)
			require.NotContains(t, rendition.ErrorMessage, "private provider payload")
			if phase == "before_write" {
				require.False(t, rendition.ErrorRetryable)
				return
			}
			require.True(t, rendition.ErrorRetryable, "recovery must reuse the same authorization, rather than create a fresh send")
			_, err = srv.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).Set("reconcile_after = NULL").Where("publication_id = ?", "publication-1").Exec(ctx)
			require.NoError(t, err)
			err = srv.service.HandlePublishPublicationJob(ctx, payload)
			require.Equal(t, 1, adapter.calls, "recovery must not send again")
			if phase == "sending" {
				require.True(t, providerwrite.IsAmbiguous(err))
			} else {
				require.NoError(t, err)
				require.NoError(t, srv.db.NewSelect().Model(&publication).WherePK().Scan(ctx))
				require.Equal(t, models.PublicationStatusPublished, publication.Status)
			}
		})
	}
}
