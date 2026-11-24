package messaging

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type failingIncrementalProvider struct {
	testProvider
	fetchEvents func() (platform.FetchMessageEventsResult, error)
}

func (p failingIncrementalProvider) FetchMessageEvents(context.Context, string, platform.FetchMessageEventsRequest) (platform.FetchMessageEventsResult, error) {
	return p.fetchEvents()
}

func TestCollectionSchedulingPreservesStoredPermissionDeadline(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, db, account, actor := messagingBackendFixture(t, backend)
			now := time.Now().UTC().Truncate(time.Second)
			s.now = func() time.Time { return now }
			s.SetProvider("bluesky", testProvider{})
			owner, acquired, err := s.acquireCollection(t.Context(), account.ID)
			require.NoError(t, err)
			require.True(t, acquired)
			require.NoError(t, s.states.record(t.Context(), syncStateUpdate{account: account, status: syncStatePermissionRequired, cadence: 24 * time.Hour, attemptedAt: now}))
			s.finishCollection(t.Context(), account.ID, owner, time.Minute, true)
			var checkpoint time.Time
			require.NoError(t, db.NewRaw(`SELECT next_poll_at FROM message_event_checkpoints WHERE social_account_id=?`, account.ID).Scan(t.Context(), &checkpoint))
			require.True(t, now.Add(24*time.Hour).Equal(checkpoint))
			now = now.Add(time.Minute)
			require.NoError(t, s.Heartbeat(t.Context(), actor, Activity{WorkspaceID: "workspace", ClientID: "new-device", View: "chats"}))
			_, err = db.NewRaw(`UPDATE message_event_checkpoints SET next_poll_at=? WHERE social_account_id=?`, now, account.ID).Exec(t.Context())
			require.NoError(t, err)
			require.NoError(t, s.enqueueActiveAccounts(t.Context()))
			jobs, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, jobs)
		})
	}
}

// Provider refusals that retrying cannot fix (access denied, or the provider
// does not implement chat for this account) record a durable state with a
// daily deadline and complete the job instead of failing it every cycle.
func TestPermanentProviderRefusalRecordsStateWithoutFailingTheJob(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name        string
		failure     error
		incremental bool
		wantStatus  string
		wantCode    string
	}{
		{name: "snapshot permission denied", failure: &platform.HTTPError{StatusCode: http.StatusForbidden, Code: "200"}, wantStatus: "permission_required", wantCode: "provider_permission_denied"},
		{name: "incremental permission denied", failure: &platform.HTTPError{StatusCode: http.StatusForbidden}, incremental: true, wantStatus: "permission_required", wantCode: "provider_permission_denied"},
		{name: "incremental method not implemented", failure: &platform.HTTPError{StatusCode: http.StatusNotImplemented, Code: "MethodNotImplemented"}, incremental: true, wantStatus: "unsupported", wantCode: "provider_unsupported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, account, actor := messagingFixture(t)
			now := time.Now().UTC().Truncate(time.Second)
			s.now = func() time.Time { return now }
			provider := testProvider{fetch: func() (platform.FetchMessagesResult, error) {
				return platform.FetchMessagesResult{}, tc.failure
			}}
			s.SetProvider("bluesky", provider)
			if tc.incremental {
				s.SetProvider("bluesky", failingIncrementalProvider{testProvider: provider, fetchEvents: func() (platform.FetchMessageEventsResult, error) {
					return platform.FetchMessageEventsResult{}, tc.failure
				}})
				_, err := db.NewRaw(`INSERT INTO message_event_checkpoints(social_account_id,initialized) VALUES(?,?)`, account.ID, true).Exec(t.Context())
				require.NoError(t, err)
			}
			require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account"}`))
			states, err := s.ListSyncStates(t.Context(), actor, "workspace")
			require.NoError(t, err)
			require.Len(t, states, 1)
			require.Equal(t, tc.wantStatus, states[0].Status)
			require.Equal(t, tc.wantCode, states[0].ErrorCode)
			require.True(t, now.Add(24*time.Hour).Equal(states[0].NextSyncAt), "next=%s", states[0].NextSyncAt)
		})
	}
}
