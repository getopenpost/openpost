package engagement

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
)

type activityProvider struct {
	pages      map[string]platform.AccountActivityPage
	fail       string
	cursors    []string
	duringRead func()
}

func (*activityProvider) AccountActivitySupport() []platform.AccountActivitySupport {
	return []platform.AccountActivitySupport{{Feed: "mentions"}}
}
func (p *activityProvider) ListAccountActivity(_ context.Context, _, _ string, input platform.AccountActivityRequest) (platform.AccountActivityPage, error) {
	p.cursors = append(p.cursors, input.Cursor)
	if p.duringRead != nil {
		p.duringRead()
	}
	if input.Cursor == p.fail {
		return platform.AccountActivityPage{}, &platform.HTTPError{StatusCode: http.StatusTooManyRequests}
	}
	page, found := p.pages[input.Cursor]
	if !found {
		return platform.AccountActivityPage{}, fmt.Errorf("unexpected cursor %q", input.Cursor)
	}
	return page, nil
}

func activityMention(id, body string) platform.AccountActivityItem {
	return platform.AccountActivityItem{Kind: "mention", ObservedAt: time.Now().UTC(),
		Comment: platform.Comment{ID: id, Text: body, AuthorName: "Alice", CanReply: true},
		Subject: inboxactivity.EngagementSubject{Kind: "post", RemoteID: id, URL: "https://social.example/posts/" + id}}
}

func accountActivityReceipt(t *testing.T, s *Service) models.Job {
	t.Helper()
	_, err := s.RefreshWorkspace(t.Context(), Actor{UserID: "u"}, "w", true)
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).Where("type=? AND status='pending'", jobregistry.TypeEngagementAccountSync).Order("created_at DESC").Limit(1).Scan(t.Context()))
	job.Status, job.Attempts, job.LockedAt = "processing", 1, time.Now().UTC()
	_, err = s.db.NewUpdate().Model(&job).Column("status", "attempts", "locked_at").WherePK().Exec(t.Context())
	require.NoError(t, err)
	return job
}

func executeAccountActivity(t *testing.T, s *Service, job models.Job) {
	t.Helper()
	ctx := providerwrite.WithJobExecution(t.Context(), job.ID, job.Attempts, job.LockedAt)
	require.NoError(t, s.HandleJob(ctx, job.Type, job.Payload))
}

func TestAccountActivityResumesPartialPagesAndPreservesSharedReadState(t *testing.T) {
	t.Parallel()
	s := admissionTestService(t)
	s.notifications = notifications.NewService(s.db)
	s.tokenSource = moderationTokens{}
	provider := &activityProvider{fail: "second", pages: map[string]platform.AccountActivityPage{
		"":       {Items: []platform.AccountActivityItem{activityMention("one", "First mention")}, NextCursor: "second"},
		"second": {Items: []platform.AccountActivityItem{activityMention("one", "Edited mention"), activityMention("two", "Second mention")}},
	}}
	s.SetActivityProvider("bluesky", provider)
	job := accountActivityReceipt(t, s)
	executeAccountActivity(t, s, job)
	var state models.EngagementAccountSyncState
	require.NoError(t, s.db.NewSelect().Model(&state).Where("social_account_id='a' AND feed='mentions'").Scan(t.Context()))
	require.Equal(t, "second", state.Cursor)
	require.Equal(t, "rate_limited", state.Status)
	require.True(t, state.Watermark.IsZero(), "a failed later page is not completed coverage")
	page, err := s.ListEngagement(t.Context(), Actor{UserID: "u"}, Query{WorkspaceID: "w", Kind: "mention"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	first := page.Items[0]
	require.Empty(t, first.RenditionID)
	require.Empty(t, first.PublicationID)
	require.Equal(t, "one", first.Subject.RemoteID)
	changed, err := s.MarkAllRead(t.Context(), Actor{UserID: "u"}, Query{WorkspaceID: "w", Kind: "mention"})
	require.NoError(t, err)
	require.Equal(t, 1, changed)
	provider.fail = "never"
	executeAccountActivity(t, s, job)
	require.Equal(t, []string{"", "second", "second"}, provider.cursors)
	page, err = s.ListEngagement(t.Context(), Actor{UserID: "u"}, Query{WorkspaceID: "w", Kind: "mention"})
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	for _, item := range page.Items {
		if item.RemoteID == "one" {
			require.Equal(t, first.ID, item.ID)
			require.Equal(t, "Edited mention", item.Body)
			require.False(t, item.ReadAt.IsZero())
		}
	}
	require.NoError(t, s.db.NewSelect().Model(&state).WherePK().Scan(t.Context()))
	require.Empty(t, state.Cursor)
	require.Equal(t, "ok", state.Status)
	require.False(t, state.Watermark.IsZero())
	var original models.EngagementItem
	require.NoError(t, s.db.NewSelect().Model(&original).Where("id='c'").Scan(t.Context()))
	require.True(t, original.ReadAt.IsZero(), "filtered bulk read leaves comments unchanged")
}

func TestAccountActivityRejectsStaleAuthorityAndWorkerLeases(t *testing.T) {
	t.Parallel()
	for _, reason := range []string{"disabled", "reactivated", "grant replaced", "lease replaced"} {
		t.Run(reason, func(t *testing.T) {
			s := admissionTestService(t)
			s.tokenSource = moderationTokens{}
			_, err := s.db.NewInsert().Model(&models.AccountFeature{SocialAccountID: "a", WorkspaceID: "w", Feature: "engagement", Enabled: true, DecidedAt: time.Now().UTC()}).Exec(t.Context())
			require.NoError(t, err)
			provider := &activityProvider{fail: "never", pages: map[string]platform.AccountActivityPage{"": {Items: []platform.AccountActivityItem{activityMention("stale", "Must not commit")}, NextCursor: "later"}}}
			s.SetActivityProvider("bluesky", provider)
			job := accountActivityReceipt(t, s)
			provider.duringRead = func() {
				var err error
				switch reason {
				case "disabled":
					_, err = s.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active=?", false).Where("id='a'").Exec(t.Context())
				case "reactivated":
					_, err = s.db.NewUpdate().Model((*models.AccountFeature)(nil)).Set("decided_at=?", time.Now().UTC().Add(time.Second)).Where("social_account_id='a' AND feature='engagement'").Exec(t.Context())
				case "grant replaced":
					_, err = s.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("oauth_grant_id=?", "replacement").Where("id='a'").Exec(t.Context())
				case "lease replaced":
					_, err = s.db.NewUpdate().Model((*models.Job)(nil)).Set("locked_at=?", time.Now().UTC().Add(time.Second)).Where("id=?", job.ID).Exec(t.Context())
				}
				require.NoError(t, err)
			}
			executeAccountActivity(t, s, job)
			count, err := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Where("kind='mention'").Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count)
			var payload accountActivityJob
			require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
			var state models.EngagementAccountSyncState
			require.NoError(t, s.db.NewSelect().Model(&state).Where("social_account_id=? AND feed=?", payload.AccountID, payload.Feed).Scan(t.Context()))
			require.Empty(t, state.Cursor)
			require.True(t, state.Watermark.IsZero())
		})
	}
}
