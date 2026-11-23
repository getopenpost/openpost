package engagement

import (
	"context"

	"github.com/openpost/backend/internal/platform"
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
