package publisher

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestQueuedPublicationResolvesLinkFromAuthoredAccountBodyBeforeWrite(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "link-post"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	source := models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Shared https://shared.example", SettingsJSON: `{"link":{"destinations":{"account-1":{"mode":"post"}}}}`}
	_, err := srv.db.NewInsert().Model(&source).Exec(t.Context())
	require.NoError(t, err)
	body := "Account https://account.example"
	segment := models.RenditionSegment{ID: "output", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: body, BodyOverride: &body, SettingsJSON: `{"url":"https://stale.example"}`, Status: models.RenditionStatusReady}
	_, err = srv.db.NewInsert().Model(&segment).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	require.Equal(t, 1, adapter.publishCalls)
	require.Equal(t, body, adapter.lastRequest.Content)
	require.Equal(t, "https://account.example", adapter.lastRequest.Settings["url"])
}

func TestQueuedInvalidLinkChoiceStopsBeforeProviderWrite(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	source := models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Caption", SettingsJSON: `{"link":{"destinations":{"account-1":{"mode":"custom","url":"javascript:invalid"}}}}`}
	_, err := srv.db.NewInsert().Model(&source).Exec(t.Context())
	require.NoError(t, err)
	segment := models.RenditionSegment{ID: "output", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: "Caption", SettingsJSON: `{}`, Status: models.RenditionStatusReady}
	_, err = srv.db.NewInsert().Model(&segment).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusFailed, rendition.Status)
	require.Equal(t, FailureValidation, rendition.ErrorKind)
	require.Equal(t, FailureActionEdit, rendition.ErrorAction)
	require.Zero(t, adapter.publishCalls)
}
