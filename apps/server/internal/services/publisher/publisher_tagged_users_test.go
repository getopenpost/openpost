package publisher

import (
	"context"
	"fmt"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

// resolvingFakeAdapter extends the shared fake adapter with X handle
// resolution, so the publisher wiring can be proven end to end.
type resolvingFakeAdapter struct {
	fakePublisherAdapter
	resolveCalls   int
	resolved       map[string]string
	resolveHandles [][]string
	resolveErr     error
}

func (f *resolvingFakeAdapter) ResolveTaggedUsernames(_ context.Context, _ string, handles []string) (map[string]string, error) {
	f.resolveCalls++
	f.resolveHandles = append(f.resolveHandles, handles)
	if f.resolveErr != nil {
		return nil, f.resolveErr
	}
	resolved := map[string]string{}
	for _, handle := range handles {
		if id, ok := f.resolved[handle]; ok {
			resolved[handle] = id
		}
	}
	return resolved, nil
}

func insertTaggedUsersSegmentFixture(t *testing.T, srv *publisherLifecycleTestServer, segmentID, renditionSegmentID, mediaID, mediaSettings string) {
	t.Helper()
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.PublicationSegment{
		ID: segmentID, PublicationID: "publication-1", Body: "Tagged photo", SettingsJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionSegment{
		ID: renditionSegmentID, RenditionID: "rendition-1", PublicationSegmentID: segmentID,
		Body: "Tagged photo", SettingsJSON: "{}", Status: models.RenditionStatusDraft,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: mediaID, WorkspaceID: "ws-1", OriginalFilename: "photo.jpg", FilePath: "media/photo.jpg",
		MimeType: "image/jpeg", Size: 12, ProcessingStatus: "ready",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionSegmentMedia{
		RenditionSegmentID: renditionSegmentID, MediaID: mediaID, Role: "attachment",
		SettingsJSON: mediaSettings,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionMedia{
		RenditionID: "rendition-1", MediaID: mediaID, Role: "attachment",
	}).Exec(ctx)
	require.NoError(t, err)
}

func publishTaggedUsersFixture(t *testing.T, srv *publisherLifecycleTestServer) error {
	t.Helper()
	jobCtx, payload := srv.authorizedPublicationJob(t)
	var panicValue any
	var publishErr error
	func() {
		defer func() { panicValue = recover() }()
		publishErr = srv.service.HandlePublishPublicationJob(jobCtx, payload)
	}()
	require.Nil(t, panicValue, "publishing must not panic")
	return publishErr
}

func newTaggedUsersTestServer(t *testing.T, adapter *resolvingFakeAdapter) *publisherLifecycleTestServer {
	t.Helper()
	srv := newPublisherLifecycleTestServer(t, &adapter.fakePublisherAdapter)
	for _, model := range []any{
		(*models.ProviderUserResolution)(nil),
		(*models.RenditionMediaDelivery)(nil),
		(*models.RenditionMediaDeliveryRelation)(nil),
		(*models.PublicationSegmentMedia)(nil),
	} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	// The composite unique key lives in the SQL migration, not in Bun model
	// tags; create it here so resolution upserts match production behavior.
	_, err := srv.db.ExecContext(t.Context(), "CREATE UNIQUE INDEX IF NOT EXISTS provider_user_resolutions_provider_workspace_handle_idx ON provider_user_resolutions (provider, workspace_id, handle)")
	require.NoError(t, err)
	srv.service.SetStorage(&fakePublisherStorage{body: "fixture-photo"})
	srv.service.SetProvider("x", adapter)
	return srv
}

func TestXTaggedUserHandlesResolveToNumericIDsBeforeDispatch(t *testing.T) {
	adapter := &resolvingFakeAdapter{resolved: map[string]string{"handle": "2244996801"}}
	srv := newTaggedUsersTestServer(t, adapter)
	// One thread with two segments tagging the same handle: the first
	// dispatch resolves and caches it, the second dispatch hits the cache.
	insertTaggedUsersSegmentFixture(t, srv, "segment-tagged", "rsegment-tagged", "media-tagged", `{"tagged_users":"@Handle, 123"}`)
	insertTaggedUsersSegmentFixture(t, srv, "segment-cached", "rsegment-cached", "media-cached", `{"tagged_users":"@handle"}`)

	require.NoError(t, publishTaggedUsersFixture(t, srv))

	require.Equal(t, 2, adapter.publishCalls)
	require.Equal(t, 1, adapter.resolveCalls, "the second segment's identical handle must hit the cache")
	require.Len(t, adapter.resolveHandles, 1)
	require.Equal(t, []string{"handle"}, adapter.resolveHandles[0])
	require.Equal(t, "2244996801,123", adapter.publishRequests[0].MediaSettings[0]["tagged_users"])
	require.Equal(t, "2244996801", adapter.publishRequests[1].MediaSettings[0]["tagged_users"])

	var stored models.ProviderUserResolution
	require.NoError(t, srv.db.NewSelect().Model(&stored).
		Where("workspace_id = ? AND provider = ? AND handle = ?", "ws-1", "x", "handle").Scan(t.Context()))
	require.Equal(t, "2244996801", stored.ProviderUserID)

	// Stored authorship keeps the authored handles; only the in-memory
	// request carried the resolved IDs.
	var segmentMedia models.RenditionSegmentMedia
	require.NoError(t, srv.db.NewSelect().Model(&segmentMedia).
		Where("rendition_segment_id = ?", "rsegment-tagged").Scan(t.Context()))
	require.Contains(t, segmentMedia.SettingsJSON, "@Handle")

	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)
}

func TestXTaggedUserUnresolvableHandleFailsRendition(t *testing.T) {
	adapter := &resolvingFakeAdapter{resolveErr: fmt.Errorf("x user @missinguser could not be found")}
	srv := newTaggedUsersTestServer(t, adapter)
	insertTaggedUsersSegmentFixture(t, srv, "segment-missing", "rsegment-missing", "media-missing", `{"tagged_users":"@missinguser,123"}`)

	require.NoError(t, publishTaggedUsersFixture(t, srv))
	require.Equal(t, 1, adapter.resolveCalls)
	require.Zero(t, adapter.publishCalls, "rendition must not publish with partial tags")

	var segment models.RenditionSegment
	require.NoError(t, srv.db.NewSelect().Model(&segment).Where("id = ?", "rsegment-missing").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusFailed, segment.Status)
	require.Equal(t, FailureValidation, segment.ErrorKind, "unresolvable handles must read as content validation failures")
}

func TestXTaggedUserNumericEntriesBypassResolution(t *testing.T) {
	adapter := &resolvingFakeAdapter{resolved: map[string]string{}}
	srv := newTaggedUsersTestServer(t, adapter)
	insertTaggedUsersSegmentFixture(t, srv, "segment-numeric", "rsegment-numeric", "media-numeric", `{"tagged_users":"123, 456"}`)

	require.NoError(t, publishTaggedUsersFixture(t, srv))
	require.Equal(t, 1, adapter.publishCalls)
	require.Zero(t, adapter.resolveCalls, "numeric user IDs need no lookup")
	// Numeric-only lists pass through as authored; the adapter validates and
	// splits them at dispatch.
	require.Equal(t, "123, 456", adapter.lastRequest.MediaSettings[0]["tagged_users"])
	var publishedRendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&publishedRendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusPublished, publishedRendition.Status)
}
