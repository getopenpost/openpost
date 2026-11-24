package engagement

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type moderationProvider struct{ calls int }

func (*moderationProvider) EngagementSupport() platform.EngagementSupport {
	return platform.EngagementSupport{Enabled: true, CanHide: true, CanDelete: true, CanLike: true}
}
func (*moderationProvider) ListComments(context.Context, string, string, string) ([]platform.Comment, error) {
	panic("unexpected collection")
}
func (*moderationProvider) ReplyToComment(context.Context, string, string, string, string) (string, error) {
	panic("unexpected reply")
}
func (p *moderationProvider) HideComment(context.Context, string, string, string) error {
	p.calls++
	return nil
}
func (p *moderationProvider) DeleteComment(context.Context, string, string, string) error {
	p.calls++
	return nil
}
func (p *moderationProvider) LikeComment(context.Context, string, string, string) error {
	p.calls++
	return nil
}
func (p *moderationProvider) UnlikeComment(context.Context, string, string, string) error {
	p.calls++
	return nil
}

type moderationTokens struct{}

func (moderationTokens) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type mentionReplyProvider struct{ moderationProvider }

func (p *mentionReplyProvider) ReplyToComment(context.Context, string, string, string, string) (string, error) {
	p.calls++
	return "reply", nil
}
func TestQueuedMentionReplyHonorsRoleRevocationBeforeSend(t *testing.T) {
	t.Parallel()
	s := admissionTestService(t)
	s.tokenSource = moderationTokens{}
	provider := &mentionReplyProvider{}
	s.SetProvider("bluesky", provider)
	_, err := s.db.NewUpdate().Model((*models.EngagementItem)(nil)).Set("kind='mention'").Where("id='c'").Exec(t.Context())
	require.NoError(t, err)
	jobID, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "c", "reply", "Queued reply", "revoke")
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role=?", models.WorkspaceRoleViewer).Where("workspace_id='w' AND user_id='u'").Exec(t.Context())
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).Where("id=?", jobID).Scan(t.Context()))
	require.ErrorIs(t, s.HandleJob(t.Context(), job.Type, job.Payload), ErrAccessDenied)
	require.Zero(t, provider.calls)
}
