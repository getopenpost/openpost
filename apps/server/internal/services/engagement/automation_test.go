package engagement

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"

	"github.com/openpost/backend/internal/services/workflows"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

type campaignProvider struct {
	moderationProvider
	private, public int
	onPrivate       func()
}

func (*campaignProvider) EngagementSupport() platform.EngagementSupport {
	return platform.EngagementSupport{Enabled: true, CanReply: true, RequiredScopes: []string{"instagram_manage_comments"}}
}
func (p *campaignProvider) ReplyPrivatelyToComment(context.Context, string, string, string, string) (string, error) {
	p.private++
	if p.onPrivate != nil {
		p.onPrivate()
	}
	return "dm-1", nil
}
func (p *campaignProvider) ReplyToComment(context.Context, string, string, string, string) (string, error) {
	p.public++
	return "ack-1", nil
}
func campaignTest(t *testing.T) (*Service, AutomationReplyRequest) {
	t.Helper()
	s := admissionTestService(t)
	s.SetAutomationRunStopper(workflows.NewService(s.db, nil, nil).CancelCommentReplyRuns)
	now := time.Now().UTC()
	_, featureErr := s.db.NewInsert().Model(&models.AccountFeature{SocialAccountID: "a", WorkspaceID: "w", Feature: "engagement", Enabled: true, DecidedAt: now}).Exec(t.Context())
	require.NoError(t, featureErr)
	_, err := s.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform='instagram', granted_scopes='instagram_manage_comments'").Where("id='a'").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.EngagementItem)(nil)).Set("platform='instagram', kind='comment', author_remote_id='reader',conversation_remote_id='sample-reel',remote_created_at=?", now).Where("id='c'").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewRaw(`INSERT INTO workflows(id,workspace_id,name,draft_json,created_at,updated_at) VALUES('wf','w','Playbook','{}',?,?)`, now, now).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewRaw(`INSERT INTO workflow_runs(id,workflow_id,workspace_id,workflow_name,workflow_revision,mode,state,definition_json,authority_json,source_json,remaining_json,created_at,updated_at) VALUES('run','wf','w','Playbook',1,'live','running','{}','{}','{}','[]',?,?)`, now, now).Exec(t.Context())
	require.NoError(t, err)
	provider := &campaignProvider{}
	s.SetProvider("instagram", provider)
	s.tokenSource = moderationTokens{}
	return s, AutomationReplyRequest{Authority: workspaceaccess.StoredAuthority{UserID: "u", WorkspaceID: "w", OrganizationID: "o", AssuredAt: now}, WorkflowID: "wf", RunID: "run", StepID: "send", ItemID: "c", Channel: "private", Body: "Your playbook: https://example.test/book", Delivery: "automatic"}
}
func completeCampaignJob(t *testing.T, s *Service, id string) {
	t.Helper()
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).Where("id=?", id).Scan(t.Context()))
	var input engagementActionJob
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &input))
	require.NoError(t, s.performEngagementAction(t.Context(), input))
	_, err := s.db.NewUpdate().Model(&job).Set("status='completed'").WherePK().Exec(t.Context())
	require.NoError(t, err)
}

type campaignWebhookProvider struct {
	campaignProvider
	beforeReturn func()
}

func (p *campaignWebhookProvider) ReadWebhookComment(_ context.Context, _, _, commentID, mediaID string) (platform.Comment, string, error) {
	if p.beforeReturn != nil {
		p.beforeReturn()
	}
	return platform.Comment{ID: commentID, ConversationID: mediaID, AuthorID: "reader", Text: "GRIND please", CanReply: true, CreatedAt: time.Now().UTC().Format(time.RFC3339)}, "https://www.instagram.com/reel/sample/", nil
}
func TestExternalReelCommentUsesCanonicalInboxIdentityAndCurrentGrantFence(t *testing.T) {
	t.Parallel()
	s, _ := campaignTest(t)
	provider := &campaignWebhookProvider{}
	s.SetProvider("instagram", provider)
	event := json.RawMessage(`{"field":"comments","value":{"id":"outside-comment","media":{"id":"outside-reel"}}}`)
	require.NoError(t, s.RefreshFromWebhook(t.Context(), "a", event))
	require.NoError(t, s.RefreshFromWebhook(t.Context(), "a", event))
	var rows []models.EngagementItem
	require.NoError(t, s.db.NewSelect().Model(&rows).Where("remote_id='outside-comment'").Scan(t.Context()))
	require.Len(t, rows, 1)
	require.Empty(t, rows[0].RenditionID)
	require.Equal(t, "outside-reel", rows[0].ConversationRemoteID)
	require.Contains(t, rows[0].SubjectJSON, "https://www.instagram.com/reel/sample/")
	provider.beforeReturn = func() {
		_, err := s.db.NewUpdate().Model((*models.AccountFeature)(nil)).Set("decided_at=?", time.Now().UTC().Add(time.Minute)).Where("social_account_id='a' AND feature='engagement'").Exec(t.Context())
		require.NoError(t, err)
	}
	err := s.RefreshFromWebhook(t.Context(), "a", json.RawMessage(`{"field":"comments","value":{"id":"changed-grant-comment","media":{"id":"outside-reel"}}}`))
	require.ErrorIs(t, err, errActivityChanged)
	count, err := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Where("remote_id='changed-grant-comment'").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestTakeoverAfterPrivateAcceptanceCancelsRemainingWorkflow(t *testing.T) {
	t.Parallel()
	s, in := campaignTest(t)
	reply, err := s.AdvanceAutomationReply(t.Context(), in)
	require.NoError(t, err)
	completeCampaignJob(t, s, reply.JobID)
	require.NoError(t, s.StopAutomation(t.Context(), Actor{UserID: "u"}, "w", "c"))
	var state string
	require.NoError(t, s.db.NewSelect().Table("workflow_runs").Column("state").Where("id='run'").Scan(t.Context(), &state))
	require.Equal(t, "cancelled", state)
	receipts, err := s.AutomationReplies(t.Context(), Actor{UserID: "u"}, "w", "c")
	require.NoError(t, err)
	require.Equal(t, "sent", receipts[0].State)
}
