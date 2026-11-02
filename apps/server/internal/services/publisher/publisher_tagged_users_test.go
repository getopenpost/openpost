package publisher

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
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

func enableTaggedUsersCostPolicy(t *testing.T, srv *publisherLifecycleTestServer, budget int64) {
	t.Helper()
	for _, model := range []any{(*models.ProviderUsageEvent)(nil), (*models.ProviderUsageReservation)(nil), (*models.ProviderUsagePeriodCounter)(nil)} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	require.NoError(t, srv.service.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(budget, 15000, 200000)))
}

func TestXTaggedUserLookupHonorsZeroBudget(t *testing.T) {
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

func TestXTaggedUserLookupReservesOnlyUncachedUsers(t *testing.T) {
	adapter := &resolvingFakeAdapter{resolved: map[string]string{"first": "123", "second": "456"}}
	srv := newTaggedUsersTestServer(t, adapter)
	enableTaggedUsersCostPolicy(t, srv, 20_000)
	adapter.beforeResolve = func() {
		var reservation models.ProviderUsageReservation
		require.NoError(t, srv.db.NewSelect().Model(&reservation).Scan(t.Context()))
		require.Equal(t, usage.XOperationUserRead, reservation.Operation)
		require.EqualValues(t, 1, reservation.Units)
		require.EqualValues(t, 10_000, reservation.CostMicrousd, "exposure must exist before provider lookup")
	}
	resolve := func(tags string) error {
		req := &platform.PublishRequest{MediaSettings: []map[string]interface{}{{"tagged_users": tags}}}
		return srv.service.resolveRenditionTaggedUsers(t.Context(), "ws-1", adapter, "token", req)
	}
	require.NoError(t, resolve("@First,@first,789"))
	require.NoError(t, resolve("@first,@Second,@second"))
	require.NoError(t, resolve("@first,@second"), "cache hits must succeed with the read budget exhausted")
	require.Equal(t, [][]string{{"first"}, {"second"}}, adapter.resolveHandles)
	var events []models.ProviderUsageEvent
	require.NoError(t, srv.db.NewSelect().Model(&events).OrderExpr("created_at ASC").Scan(t.Context()))
	require.Len(t, events, 2)
	for _, event := range events {
		require.Equal(t, usage.XOperationUserRead, event.Operation)
		require.EqualValues(t, 1, event.Units)
		require.EqualValues(t, 10_000, event.CostMicrousd)
	}
	require.NotEqual(t, events[0].OperationKey, events[1].OperationKey)
	require.ErrorIs(t, resolve("@third"), usage.ErrProviderCostBudgetExceeded)
	require.Equal(t, 2, adapter.resolveCalls)
}

func TestXTaggedUserLookupFailureSettlement(t *testing.T) {
	for _, tc := range []struct {
		name     string
		err      error
		reserved bool
	}{
		{"rejected", &platform.HTTPError{StatusCode: http.StatusForbidden}, false},
		{"server error", &platform.HTTPError{StatusCode: http.StatusInternalServerError}, true},
		{"transport", context.DeadlineExceeded, true},
		{"partial response", errors.New("x user @missing could not be found"), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter := &resolvingFakeAdapter{resolveErr: tc.err}
			srv := newTaggedUsersTestServer(t, adapter)
			enableTaggedUsersCostPolicy(t, srv, 20_000)
			// A new uncached request after a failure can be billed again. Its cost
			// identity must not be reused, even within the same publication attempt.
			for range 2 {
				req := &platform.PublishRequest{MediaSettings: []map[string]interface{}{{"tagged_users": "@missing"}}}
				require.Error(t, srv.service.resolveRenditionTaggedUsers(t.Context(), "ws-1", adapter, "token", req))
			}
			require.Equal(t, 2, adapter.resolveCalls)
			var reservations []models.ProviderUsageReservation
			require.NoError(t, srv.db.NewSelect().Model(&reservations).Scan(t.Context()))
			if tc.reserved {
				require.Len(t, reservations, 2)
				for _, reservation := range reservations {
					require.Equal(t, "unknown", reservation.State)
					require.EqualValues(t, 10_000, reservation.CostMicrousd)
				}
			} else {
				require.Empty(t, reservations)
			}
			count, err := srv.db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count, "failed reads must not appear as confirmed cost")
		})
	}
}

func TestXTaggedUserLookupAndPublishShareHostedBudget(t *testing.T) {
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
