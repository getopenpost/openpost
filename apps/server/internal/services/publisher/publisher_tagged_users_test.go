package publisher

import (
	"context"

	"testing"

	"github.com/openpost/backend/internal/models"

	"github.com/openpost/backend/internal/services/usage"
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
	beforeResolve  func()
}

func (f *resolvingFakeAdapter) ResolveTaggedUsernames(_ context.Context, _ string, handles []string) (map[string]string, error) {
	if f.beforeResolve != nil {
		f.beforeResolve()
	}
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

func enableTaggedUsersCostPolicy(t *testing.T, srv *publisherLifecycleTestServer, budget int64) {
	t.Helper()
	for _, model := range []any{(*models.ProviderUsageEvent)(nil), (*models.ProviderUsageReservation)(nil), (*models.ProviderUsagePeriodCounter)(nil)} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	require.NoError(t, srv.service.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(budget, 15000, 200000)))
}

func TestXTaggedUserLookupHonorsZeroBudget(t *testing.T) {
	t.Parallel()
	adapter := &resolvingFakeAdapter{resolved: map[string]string{"handle": "2244996801"}}
	srv := newTaggedUsersTestServer(t, adapter)
	enableTaggedUsersCostPolicy(t, srv, 0)
	insertTaggedUsersSegmentFixture(t, srv, "segment-tagged", "rsegment-tagged", "media-tagged", `{"tagged_users":"@handle"}`)
	require.NoError(t, publishTaggedUsersFixture(t, srv))
	require.Zero(t, adapter.publishCalls, "budget blocks post create")
	require.Zero(t, adapter.resolveCalls, "budget must block paid user lookup")
	var segment models.RenditionSegment
	require.NoError(t, srv.db.NewSelect().Model(&segment).Where("id = ?", "rsegment-tagged").Scan(t.Context()))
	require.Equal(t, FailureBillingRequired, segment.ErrorKind)
}

func TestXTaggedUserLookupAndPublishShareHostedBudget(t *testing.T) {
	t.Parallel()
	adapter := &resolvingFakeAdapter{resolved: map[string]string{"handle": "2244996801"}}
	srv := newTaggedUsersTestServer(t, adapter)
	// One user read costs 10,000, followed by one post create at 15,000.
	enableTaggedUsersCostPolicy(t, srv, 25_000)
	insertTaggedUsersSegmentFixture(t, srv, "segment-tagged", "rsegment-tagged", "media-tagged", `{"tagged_users":"@handle"}`)
	require.NoError(t, publishTaggedUsersFixture(t, srv))
	require.Equal(t, 1, adapter.resolveCalls)
	require.Equal(t, 1, adapter.publishCalls)
	var events []models.ProviderUsageEvent
	require.NoError(t, srv.db.NewSelect().Model(&events).OrderExpr("operation ASC").Scan(t.Context()))
	require.Len(t, events, 2)
	require.Equal(t, usage.XOperationPostCreate, events[0].Operation)
	require.EqualValues(t, 15_000, events[0].CostMicrousd)
	require.Equal(t, usage.XOperationUserRead, events[1].Operation)
	require.EqualValues(t, 10_000, events[1].CostMicrousd)
}
