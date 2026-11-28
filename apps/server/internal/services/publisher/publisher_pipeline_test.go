package publisher

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
)

func TestMediaAttachedOnlyToASegmentBelongsToItsRendition(t *testing.T) {
	t.Parallel()
	srv := newPublisherMediaStateTestServer(t, "youtube", &fakePublisherAdapter{})
	publication, rendition, account := srv.seedRenditionWithMedia(t, "publication-1", "rendition-1", models.MediaAttachment{ID: "attached"})
	ctx := t.Context()
	// Generated text cards are attached to rendition segments only.
	for _, media := range []models.MediaAttachment{
		{ID: "text-card", WorkspaceID: "ws-1", MimeType: "image/png", FilePath: "media/text-card"},
		{ID: "unattached", WorkspaceID: "ws-1", MimeType: "image/png", FilePath: "media/unattached"},
	} {
		_, err := srv.db.NewInsert().Model(&media).Exec(ctx)
		require.NoError(t, err)
	}
	_, err := srv.db.NewInsert().Model(&models.RenditionSegment{ID: "segment-1", RenditionID: rendition.ID, PublicationSegmentID: "source-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionSegmentMedia{RenditionSegmentID: "segment-1", MediaID: "text-card", Role: "attachment"}).Exec(ctx)
	require.NoError(t, err)

	for _, mediaID := range []string{"attached", "text-card"} {
		require.NoError(t, srv.service.validateRenditionMediaDeliveryOwner(ctx, &publication, &rendition, &account, models.MediaAttachment{ID: mediaID}), mediaID)
	}
	err = srv.service.validateRenditionMediaDeliveryOwner(ctx, &publication, &rendition, &account, models.MediaAttachment{ID: "unattached"})
	require.ErrorContains(t, err, "media unattached does not belong to rendition rendition-1")
}

func TestUploadSettingMediaIsScopedToThePublicationWorkspace(t *testing.T) {
	t.Parallel()
	srv := newPublisherMediaStateTestServer(t, "youtube", &fakePublisherAdapter{})
	_, rendition, _ := srv.seedRenditionWithMedia(t, "publication-1", "rendition-1", models.MediaAttachment{ID: "video"})
	ctx := t.Context()
	for _, media := range []models.MediaAttachment{
		{ID: "own-thumbnail", WorkspaceID: "ws-1", MimeType: "image/png", FilePath: "media/own-thumbnail"},
		{ID: "foreign-thumbnail", WorkspaceID: "ws-2", MimeType: "image/png", FilePath: "media/foreign-thumbnail"},
		{ID: "foreign-caption", WorkspaceID: "ws-2", MimeType: "text/vtt", FilePath: "media/foreign-caption"},
	} {
		_, err := srv.db.NewInsert().Model(&media).Exec(ctx)
		require.NoError(t, err)
	}
	video := models.MediaAttachment{ID: "video", MimeType: "video/mp4", FilePath: "media/video"}

	req, closeReaders, err := srv.service.renditionUploadRequest(ctx, "ws-1", &rendition, video, map[string]any{"thumbnail_media_id": "own-thumbnail"}, false)
	require.NoError(t, err)
	closeReaders()
	require.NotNil(t, req.ThumbnailReader)

	for _, settings := range []map[string]any{
		{"thumbnail_media_id": "foreign-thumbnail"},
		{"cover_media_id": "foreign-thumbnail"},
		{"caption_media_id": "foreign-caption"},
	} {
		_, _, err := srv.service.renditionUploadRequest(ctx, "ws-1", &rendition, video, settings, false)
		require.ErrorContains(t, err, "loading", "%v must not read another workspace's media", settings)
	}
	require.NotContains(t, srv.storage.opened, "foreign-thumbnail")
	require.NotContains(t, srv.storage.opened, "foreign-caption")
}

func TestLaterSegmentValidationFailsBeforeTheFirstSegmentPublishes(t *testing.T) {
	t.Parallel()
	adapter := &resolvingFakeAdapter{resolved: map[string]string{}}
	srv := newTaggedUsersTestServer(t, adapter)
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.PublicationSegment{ID: "source-first", PublicationID: "publication-1", Position: 0, Body: "First", SettingsJSON: "{}"}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionSegment{ID: "output-first", RenditionID: "rendition-1", PublicationSegmentID: "source-first", Position: 0, Body: "First", SettingsJSON: "{}", Status: models.RenditionStatusReady}).Exec(ctx)
	require.NoError(t, err)
	// The second output tags a handle X cannot resolve.
	insertTaggedUsersSegmentFixture(t, srv, "source-second", "output-second", "media-second", `{"tagged_users":"@ghost"}`)
	_, err = srv.db.NewUpdate().Model((*models.RenditionSegment)(nil)).Set("position = 1").Where("id = ?", "output-second").Exec(ctx)
	require.NoError(t, err)

	// The destination fails terminally, so the job itself completes.
	require.NoError(t, publishTaggedUsersFixture(t, srv))

	require.Zero(t, adapter.publishCalls, "no output may be sent while a later output is invalid")
	var segments []models.RenditionSegment
	require.NoError(t, srv.db.NewSelect().Model(&segments).Order("position ASC").Scan(ctx))
	require.Len(t, segments, 2)
	require.NotEqual(t, models.RenditionStatusPublished, segments[0].Status)
	require.Equal(t, models.RenditionStatusFailed, segments[1].Status)
}

func TestSegmentCaptionDoesNotLeakIntoLaterSegments(t *testing.T) {
	t.Parallel()
	caption := `{"caption_mentions":{"field":"description","body":"First caption","mentions":{"version":1,"spans":[]}}}`
	canonical := []models.PublicationSegment{
		{ID: "source-first", Body: "First", SettingsJSON: "{}"},
		{ID: "source-second", Body: "Second", SettingsJSON: "{}"},
	}
	sources := map[string]canonicalSource{}
	for _, source := range canonical {
		sources[source.ID] = canonicalSource{PublicationSegment: source}
	}
	rows := []models.RenditionSegment{
		{ID: "output-first", PublicationSegmentID: "source-first", Body: "First", SettingsJSON: caption, SourceOverridesJSON: "[]"},
		{ID: "output-second", PublicationSegmentID: "source-second", Body: "Second", SettingsJSON: "{}", SourceOverridesJSON: "[]"},
	}
	plan := &deliveryPlan{
		deliveryTarget: &deliveryTarget{
			publication: &models.Publication{ID: "publication-1"},
			rendition:   &models.Rendition{ID: "rendition-1", Platform: "peertube"},
			account:     &models.SocialAccount{ID: "account-1", Platform: "peertube", InstanceURL: "https://video.example"},
		},
		baseSettings: map[string]any{},
	}
	service := &Service{}
	prepared := make([]preparedSegment, len(rows))
	for i := range rows {
		prepared[i] = preparedSegment{id: rows[i].ID, row: &rows[i]}
		require.NoError(t, service.resolveSegmentText(plan, &prepared[i], canonical, sources, nil, false, false))
	}

	require.Equal(t, "First caption", prepared[0].description)
	require.Equal(t, "First caption", prepared[0].settings["description"])
	require.Empty(t, prepared[1].description, "a caption belongs to its own segment")
	require.NotContains(t, prepared[1].settings, "description")
	require.Empty(t, plan.baseSettings, "segment resolution must not change shared destination settings")
}

func TestJobRetryMetadataOnlyChangesTheJobsRendition(t *testing.T) {
	t.Parallel()
	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{})
	ctx := t.Context()
	seedFailedRetryableRenditions(t, srv)
	retryAt := time.Now().UTC().Add(time.Hour).Truncate(time.Second)

	require.NoError(t, srv.service.UpdateJobRetryAt(ctx, "publish_publication", `{"publication_id":"publication-1","rendition_id":"rendition-1"}`, retryAt))

	for _, segment := range loadSegments(t, srv) {
		if segment.RenditionID == "rendition-1" {
			require.True(t, segment.ErrorRetryAt.Equal(retryAt), segment.ID)
		} else {
			require.True(t, segment.ErrorRetryAt.IsZero(), "sibling rendition segment %s must keep its retry time", segment.ID)
		}
	}
}

func TestTerminalPublishFailureStopsAdvertisingRetries(t *testing.T) {
	t.Parallel()
	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{})
	ctx := t.Context()
	seedFailedRetryableRenditions(t, srv)
	for _, model := range []any{(*models.Rendition)(nil), (*models.RenditionSegment)(nil)} {
		_, err := srv.db.NewUpdate().Model(model).Set("error_retry_at = ?", time.Now().UTC()).Where("1 = 1").Exec(ctx)
		require.NoError(t, err)
	}

	require.NoError(t, srv.service.MarkTerminalPublishFailure(ctx, srv.db, "publish_publication", `{"publication_id":"publication-1","rendition_id":"rendition-1"}`))

	var renditions []models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&renditions).Order("id ASC").Scan(ctx))
	require.Len(t, renditions, 2)
	require.False(t, renditions[0].ErrorRetryable)
	require.True(t, renditions[0].ErrorRetryAt.IsZero())
	require.True(t, renditions[1].ErrorRetryable, "another job's rendition keeps its retry")
	require.False(t, renditions[1].ErrorRetryAt.IsZero())
	for _, segment := range loadSegments(t, srv) {
		require.Equal(t, segment.RenditionID != "rendition-1", segment.ErrorRetryable, segment.ID)
		require.Equal(t, segment.RenditionID == "rendition-1", segment.ErrorRetryAt.IsZero(), segment.ID)
	}
}

func seedFailedRetryableRenditions(t *testing.T, srv *publisherLifecycleTestServer) {
	t.Helper()
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.Rendition{ID: "rendition-2", PublicationID: "publication-1", SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText}).Exec(ctx)
	require.NoError(t, err)
	for _, renditionID := range []string{"rendition-1", "rendition-2"} {
		_, err := srv.db.NewInsert().Model(&models.RenditionSegment{ID: "segment-" + renditionID, RenditionID: renditionID, PublicationSegmentID: "source-1"}).Exec(ctx)
		require.NoError(t, err)
	}
	for _, model := range []any{(*models.Rendition)(nil), (*models.RenditionSegment)(nil)} {
		_, err := srv.db.NewUpdate().Model(model).
			Set("status = ?", models.RenditionStatusFailed).Set("error_retryable = ?", true).
			Where("1 = 1").Exec(ctx)
		require.NoError(t, err)
	}
}

func loadSegments(t *testing.T, srv *publisherLifecycleTestServer) []models.RenditionSegment {
	t.Helper()
	var segments []models.RenditionSegment
	require.NoError(t, srv.db.NewSelect().Model(&segments).Order("id ASC").Scan(t.Context()))
	require.Len(t, segments, 2)
	return segments
}

type instanceCredentialAdapter struct{ *fakePublisherAdapter }

func (instanceCredentialAdapter) UsesInstanceCredential() bool { return true }

func TestReplyWithInstanceCredentialDoesNotRequireAccountToken(t *testing.T) {
	t.Parallel()
	adapter := &fakePublisherAdapter{externalID: "reply-1"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	srv.service.SetProvider("x", instanceCredentialAdapter{adapter})
	ctx, _ := srv.authorizedPublicationJob(t)
	var receipt models.PublicationAuthorization
	require.NoError(t, srv.db.NewSelect().Model(&receipt).Where("rendition_id = ?", "rendition-1").Scan(ctx))
	// An unreadable account token proves the reply never asks for one.
	_, err := srv.db.NewUpdate().Model((*models.OAuthGrant)(nil)).Set("access_token_encrypted = ?", []byte("not-encrypted")).Where("1 = 1").Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, srv.service.publishRenditionReply(ctx, "rendition-1", "Follow-up", "parent-post", map[string]any{}, &receipt, providerreadiness.ExecutionIntentProduction))
	require.Equal(t, 1, adapter.publishCalls)
	require.Equal(t, "parent-post", adapter.lastRequest.ReplyToID)
}

func TestStaleWorkerCannotOverwriteDeliveryState(t *testing.T) {
	t.Parallel()
	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{})
	ctx, _ := srv.authorizedPublicationJob(t)
	publication := &models.Publication{ID: "publication-1", WorkspaceID: "ws-1"}
	_, err := srv.db.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusPublished).Where("id = ?", "rendition-1").Exec(ctx)
	require.NoError(t, err)

	// A late failure from the current worker never replaces a published outcome.
	require.NoError(t, srv.service.persistRenditionOutcome(ctx, "rendition-1", failureForKind(FailureNetwork, "", 0, 0)))
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)

	// Once another worker holds the lease, this worker cannot write at all.
	_, err = srv.db.NewUpdate().Model((*models.Job)(nil)).Set("lease_generation = lease_generation + 1").Where("id = ?", srv.jobID).Exec(ctx)
	require.NoError(t, err)
	require.ErrorIs(t, srv.service.finalizePublication(ctx, publication), providerwrite.ErrWriteInProgress)
	require.ErrorIs(t, srv.service.markDeliveryPublishing(ctx, (*models.Rendition)(nil), "rendition-1"), providerwrite.ErrWriteInProgress)
	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusReady, stored.Status)
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)
}

func TestRedactResumableMediaErrorPreservesDeadlineRetryability(t *testing.T) {
	t.Parallel()
	secretURL := "https://upload.example.com/session?upload_id=secret-token-123"
	raw := fmt.Errorf("uploading to %s: %w", secretURL, context.DeadlineExceeded)

	redacted := redactResumableMediaStateFromError(raw, secretURL)
	require.NotContains(t, redacted.Error(), "secret-token-123")
	require.ErrorIs(t, redacted, context.DeadlineExceeded)
	classified := ClassifyFailure(redacted)
	require.Equal(t, FailureNetwork, classified.Kind)
	require.True(t, classified.Retryable)
}

func TestBulkRetryTerminalFailureScopesToAuthorizedBatch(t *testing.T) {
	t.Parallel()
	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{})
	ctx := t.Context()
	seedFailedRetryableRenditions(t, srv)
	// Authorize only rendition-1 in batch-1; rendition-2 belongs to another job.
	_, err := srv.db.NewInsert().Model(&models.PublicationAuthorization{
		ID: "auth-batch-1", BatchID: "batch-1", WorkspaceID: "ws-1",
		PublicationID: "publication-1", RenditionID: "rendition-1",
		SocialAccountID: "account-1", TargetKey: "x:account-1",
		JobID: "job-batch-1", Action: "publish", PolicyMode: "immediate",
		ScheduledAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	payload := `{"publication_id":"publication-1","authorization_batch_id":"batch-1"}`
	require.NoError(t, srv.service.MarkTerminalPublishFailure(ctx, srv.db, "publish_publication", payload))

	var renditions []models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&renditions).Order("id ASC").Scan(ctx))
	require.False(t, renditions[0].ErrorRetryable, "batch-owned rendition stops advertising retries")
	require.True(t, renditions[1].ErrorRetryable, "sibling rendition outside the batch keeps its retry state")
}

func TestFinalizationErrPreservesTypedRetryDelay(t *testing.T) {
	t.Parallel()
	outcome := publishOutcome{
		retry: &RetryableError{
			Provider:    "x",
			RenditionID: "rendition-1",
			Failure: Failure{
				Kind:       FailureRateLimited,
				Retryable:  true,
				RetryAfter: 20 * time.Minute,
				Message:    "rate limited",
			},
		},
	}
	err := outcome.finalizationErr(errors.New("finalize db error"))
	var retryErr *RetryableError
	require.ErrorAs(t, err, &retryErr)
	require.Equal(t, 20*time.Minute, retryErr.Failure.RetryAfter)
}

func TestPersistTerminalPreflightFailureCommitsAtomically(t *testing.T) {
	t.Parallel()
	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{})
	ctx, _ := srv.authorizedPublicationJob(t)

	_, err := srv.db.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusScheduled).
		Set("created_by = ?", "creator-1").
		Where("id = ?", "publication-1").Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Where("id = ?", "rendition-1").Exec(ctx)
	require.NoError(t, err)

	// Fail finalization after the rendition update runs to prove both roll back together.
	_, err = srv.db.ExecContext(ctx, `
		CREATE TRIGGER fail_publication_finalize
		BEFORE UPDATE ON publications
		WHEN NEW.status = 'failed'
		BEGIN
			SELECT RAISE(ABORT, 'finalize unavailable');
		END
	`)
	require.NoError(t, err)

	preflightErr := errors.New("authorization expired")
	err = srv.service.handlePreflightError(ctx, "publication-1", "rendition-1", preflightErr)
	require.ErrorIs(t, err, preflightErr)
	var retryErr *RetryableError
	require.ErrorAs(t, err, &retryErr, "failed persistence stays retryable so the post is not stranded")

	// The rollback must leave both the rendition and publication scheduled so
	// the retry can finalize both together.
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusScheduled, rendition.Status)
	var publication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusScheduled, publication.Status)

	// Once finalization succeeds, both rendition and publication commit as failed.
	_, err = srv.db.ExecContext(ctx, `DROP TRIGGER fail_publication_finalize`)
	require.NoError(t, err)
	err = srv.service.handlePreflightError(ctx, "publication-1", "rendition-1", preflightErr)
	require.ErrorIs(t, err, preflightErr)
	require.False(t, errors.As(err, &retryErr))

	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusFailed, rendition.Status)
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusFailed, publication.Status)
}
