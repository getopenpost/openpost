package messaging

import (
	"context"

	"net/http"
	"testing"
	"time"

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
