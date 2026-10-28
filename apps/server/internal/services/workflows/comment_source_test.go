package workflows

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCommentCampaignAdmitsOnlyNewMatchingCommentsOnce(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, actor := workflowTestServiceWithDB(t, nil, workflowRunListTestDB(t, backend))
			now := time.Now().UTC()
			_, err := s.db.NewInsert().Model(&models.SocialAccount{ID: "ig", WorkspaceID: "ws", Platform: "instagram", AccountID: "owner", AccessTokenEnc: []byte("test"), CreatedAt: now}).Exec(t.Context())
			require.NoError(t, err)
			var def Definition
			require.NoError(t, json.Unmarshal([]byte(`{"schema":1,"source":{"kind":"comment_received","account_ids":["ig"],"keywords":["GRIND"],"match_mode":"word","daily_limit":20},"steps":[{"id":"wait","kind":"wait","inputs":{"minutes":{"literal":0}}}]}`), &def))
			workflow, err := s.Save(t.Context(), actor, "ws", "", SaveRequest{Name: "Playbook", Definition: def})
			require.NoError(t, err)
			workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
			require.NoError(t, err)
			for _, item := range []models.EngagementItem{
				{ID: "match", Body: "GRIND please!", RemoteCreatedAt: now.Add(time.Minute)},
				{ID: "substring", Body: "grinding", RemoteCreatedAt: now.Add(time.Minute)},
				{ID: "old", Body: "GRIND", RemoteCreatedAt: now.Add(-time.Hour)},
				{ID: "own", Body: "GRIND", IsOurs: true, RemoteCreatedAt: now.Add(time.Minute)},
			} {
				item.WorkspaceID = "ws"
				item.SocialAccountID = "ig"
				item.Platform = "instagram"
				item.Kind = "comment"
				item.RemoteID = item.ID
				item.CanReply = true
				item.CreatedAt = now.Add(time.Minute)
				item.LastSeenAt = now
				_, err := s.db.NewInsert().Model(&item).Exec(t.Context())
				require.NoError(t, err)
			}
			require.NoError(t, s.poll(t.Context(), workflow.ID))
			require.NoError(t, s.poll(t.Context(), workflow.ID))
			runs, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
			require.NoError(t, err)
			require.Len(t, runs, 1)
			require.Equal(t, "match", runs[0].Source["engagement_id"])
		})
	}
}

func TestPrivateReplyReviewPreservesItsTargetKind(t *testing.T) {
	var kinds []string
	actions := actionFunc(func(_ context.Context, in EffectRequest) (EffectResult, error) {
		kinds = append(kinds, in.Kind)
		return EffectResult{Review: true, Output: map[string]any{"text": "Playbook link", "channel": "private"}}, nil
	})
	s, actor := workflowTestService(t, actions)
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "private", Kind: KindPrivateReply, Name: "Send privately", Inputs: map[string]Value{"engagement_id": literal("comment"), "text": literal("Playbook link"), "delivery": literal("review")}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	run, err = s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateApproval, run.State)
	_, err = s.Approve(t.Context(), actor, "ws", run.ID, run.Revision, 0, "Approved private link")
	require.NoError(t, err)
	require.Equal(t, []string{KindPrivateReply, KindPrivateReply}, kinds)
}

func TestCommentPreviewUsesRecentInventoryBeyondOldNonmatches(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	now := time.Now().UTC()
	_, err := s.db.NewInsert().Model(&models.SocialAccount{ID: "ig", WorkspaceID: "ws", Platform: "instagram", AccountID: "owner", AccessTokenEnc: []byte("test"), CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	rows := make([]models.EngagementItem, 501)
	for index := range rows {
		id := fmt.Sprintf("comment-%04d", index)
		body := "Hello"
		if index == 500 {
			body = "GRIND"
		}
		rows[index] = models.EngagementItem{ID: id, WorkspaceID: "ws", SocialAccountID: "ig", Platform: "instagram", Kind: "comment", RemoteID: id, Body: body, CreatedAt: now.Add(time.Duration(index) * time.Second), RemoteCreatedAt: now, LastSeenAt: now}
	}
	_, err = s.db.NewInsert().Model(&rows).Exec(t.Context())
	require.NoError(t, err)
	items, err := s.Sample(t.Context(), actor, "ws", Source{Kind: "comment_received", AccountIDs: []string{"ig"}, Keywords: []string{"GRIND"}, DailyLimit: 20})
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "comment-0500", items[0].ID)
}

func TestStopRepliesUsesPublishedCampaignAfterDraftSourceChanges(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(1)}}})
	// A saved draft can differ from the still-active published definition.
	published := Definition{Schema: 1, Source: Source{Kind: "comment_received", AccountIDs: []string{"ig"}, DailyLimit: 20}, Steps: workflow.Definition.Steps}
	raw, err := json.Marshal(published)
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*workflowRecord)(nil)).Set("published_json=?,enabled=?", string(raw), true).Where("id=?", workflow.ID).Exec(t.Context())
	require.NoError(t, err)
	current, err := s.Get(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.True(t, current.HasCommentReplies)
	stopped, err := s.StopReplies(t.Context(), actor, "ws", workflow.ID, current.Revision)
	require.NoError(t, err)
	require.False(t, stopped.Enabled)
}
