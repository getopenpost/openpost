package messaging

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type failingMessagingToken struct{ err error }

func (f failingMessagingToken) GetValidAccessToken(context.Context, string) (string, error) {
	return "", f.err
}

type failingIncrementalProvider struct {
	testProvider
	fetchEvents func() (platform.FetchMessageEventsResult, error)
}

func (p failingIncrementalProvider) FetchMessageEvents(context.Context, string, platform.FetchMessageEventsRequest) (platform.FetchMessageEventsResult, error) {
	return p.fetchEvents()
}

func TestCollectionFailureBackoffSurvivesForegroundAndPeriodicWakeups(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, tc := range []struct {
			name        string
			failure     error
			incremental bool
			auth        bool
			wantDelay   time.Duration
		}{
			{name: "snapshot failure", failure: errors.New("provider unavailable"), wantDelay: time.Hour},
			{name: "authentication failure", failure: errors.New("credentials expired"), auth: true, wantDelay: time.Hour},
			{name: "snapshot retry after", failure: &platform.HTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: 2 * time.Hour}, wantDelay: 2 * time.Hour},
			{name: "incremental retry after", failure: &platform.HTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: 2 * time.Hour}, incremental: true, wantDelay: 2 * time.Hour},
		} {
			t.Run(backend+"/"+tc.name, func(t *testing.T) {
				s, db, account, actor := messagingBackendFixture(t, backend)
				now := time.Now().UTC().Truncate(time.Second)
				s.now = func() time.Time { return now }
				providerCalls := 0
				provider := testProvider{fetch: func() (platform.FetchMessagesResult, error) {
					providerCalls++
					return platform.FetchMessagesResult{}, tc.failure
				}}
				s.SetProvider("bluesky", provider)
				if tc.incremental {
					s.SetProvider("bluesky", failingIncrementalProvider{testProvider: provider, fetchEvents: func() (platform.FetchMessageEventsResult, error) {
						providerCalls++
						return platform.FetchMessageEventsResult{}, tc.failure
					}})
					_, err := db.NewRaw(`INSERT INTO message_event_checkpoints(social_account_id,initialized) VALUES(?,?)`, account.ID, true).Exec(t.Context())
					require.NoError(t, err)
				}
				if tc.auth {
					s.tokens = failingMessagingToken{err: tc.failure}
				}
				require.NoError(t, s.Heartbeat(t.Context(), actor, Activity{WorkspaceID: "workspace", ClientID: "first-device", View: "conversation", ConversationID: "conversation"}))
				require.ErrorIs(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account"}`), tc.failure)
				deadline := now.Add(tc.wantDelay)
				var checkpoint time.Time
				require.NoError(t, db.NewRaw(`SELECT next_poll_at FROM message_event_checkpoints WHERE social_account_id=?`, account.ID).Scan(t.Context(), &checkpoint))
				require.True(t, deadline.Equal(checkpoint), "checkpoint=%s, want %s", checkpoint, deadline)
				states, err := s.ListSyncStates(t.Context(), actor, "workspace")
				require.NoError(t, err)
				require.Len(t, states, 1)
				require.Equal(t, "failed", states[0].Status)
				require.True(t, deadline.Equal(states[0].NextSyncAt))
				now = now.Add(61 * time.Second)
				require.NoError(t, s.Heartbeat(t.Context(), actor, Activity{WorkspaceID: "workspace", ClientID: "new-device", View: "conversation", ConversationID: "conversation"}))
				require.NoError(t, db.NewRaw(`SELECT next_poll_at FROM message_event_checkpoints WHERE social_account_id=?`, account.ID).Scan(t.Context(), &checkpoint))
				require.True(t, deadline.Equal(checkpoint), "a new device shortened the failure deadline")
				// A stale checkpoint must not overrule the authoritative failure state.
				_, err = db.NewRaw(`UPDATE message_event_checkpoints SET next_poll_at=? WHERE social_account_id=?`, now.Add(-time.Second), account.ID).Exec(t.Context())
				require.NoError(t, err)
				require.NoError(t, s.enqueueActiveAccounts(t.Context()))
				jobs, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
				require.NoError(t, err)
				require.Zero(t, jobs, "periodic collection bypassed a future failure deadline")
				callsBefore := providerCalls
				require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account"}`), "already-queued work must respect the same deadline")
				require.Equal(t, callsBefore, providerCalls)
				// Collection becomes eligible again at the exact deadline.
				now = deadline
				require.NoError(t, s.Heartbeat(t.Context(), actor, Activity{WorkspaceID: "workspace", ClientID: "new-device", View: "conversation", ConversationID: "conversation"}))
				require.NoError(t, s.enqueueActiveAccounts(t.Context()))
				jobs, err = db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
				require.NoError(t, err)
				require.Equal(t, 1, jobs)
			})
		}
	}
}

func TestCollectionSchedulingPreservesStoredPermissionDeadline(t *testing.T) {
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
