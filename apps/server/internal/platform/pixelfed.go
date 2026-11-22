package platform

import (
	"context"
	"fmt"
	"io"
	"time"
)

// PixelfedAdapter publishes through the Mastodon-compatible client API of
// one Pixelfed instance. Transport details are shared with Mastodon in
// fediverse.go; this file keeps Pixelfed's provider identity, photo-first
// validation, and capability features.
type PixelfedAdapter struct {
	BaseAdapter
	compat mastodonCompatCredentials
}

func NewPixelfedAdapter(clientID, clientSecret, redirectURI, instanceURL string) *PixelfedAdapter {
	return &PixelfedAdapter{
		compat: mastodonCompatCredentials{
			instanceURL:  instanceURL,
			clientID:     clientID,
			clientSecret: clientSecret,
			redirectURI:  redirectURI,
		},
	}
}

func (p *PixelfedAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     p.compat.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code", "instance_url": p.compat.instanceURL, "software": "pixelfed"},
	}
}

func (p *PixelfedAdapter) InstanceURL() string {
	return p.compat.instanceURL
}

func (p *PixelfedAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return p.compat.authURL(state)
}

func (p *PixelfedAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	return p.compat.exchangeCode(ctx, code)
}

func (p *PixelfedAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("pixelfed tokens do not expire")
}

func (p *PixelfedAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	profile, err := compatVerifyCredentials(ctx, p.compat.instanceURL, accessToken)
	if err != nil {
		return nil, err
	}
	return compatUserProfile(profile, FediverseSoftwarePixelfed), nil
}

func (p *PixelfedAdapter) AccountCapabilityKeyInput(AccountCapabilityInput) string { return "" }

func (p *PixelfedAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, _ AccountCapabilityInput) (AccountCapabilityResult, error) {
	return compatPublishingCapabilities(ctx, p.compat.instanceURL, accessToken, "Pixelfed", "pixelfed", false)
}

func (p *PixelfedAdapter) UploadMedia(ctx context.Context, accessToken, _ string, mimeType string, reader io.Reader) (string, error) {
	return compatUploadMedia(ctx, p.compat.instanceURL, accessToken, mimeType, reader)
}

func (p *PixelfedAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	prepared := PublishResult{ProviderState: "create_status", RetrySafety: PublishRetryIdempotent, IdempotencyTTL: time.Hour}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	result, err := compatPostStatus(ctx, p.compat.instanceURL, accessToken, req, "pixelfed")
	if err != nil {
		return prepared, err
	}
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

func (p *PixelfedAdapter) Repost(ctx context.Context, accessToken, _ string, req RepostRequest) (RepostResult, error) {
	return compatRepost(ctx, p.compat.instanceURL, accessToken, req, "pixelfed")
}

func (p *PixelfedAdapter) Unrepost(ctx context.Context, accessToken, _ string, req UnrepostRequest) error {
	return compatUnrepost(ctx, p.compat.instanceURL, accessToken, req, "pixelfed")
}

func (p *PixelfedAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true, CanLike: true}
}

func (p *PixelfedAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	return compatListComments(ctx, p.compat.instanceURL, accessToken, accountID, externalID, "Pixelfed")
}

func (p *PixelfedAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	result, err := p.Publish(ctx, accessToken, accountID, &PublishRequest{Content: message, ReplyToID: commentID})
	return result.ExternalID, err
}

func (p *PixelfedAdapter) HideComment(_ context.Context, _, _, _ string) error {
	return fmt.Errorf("pixelfed hide reply: %w", ErrUnsupportedCommentAction)
}

func (p *PixelfedAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	return compatDeleteComment(ctx, p.compat.instanceURL, accessToken, commentID, "pixelfed")
}

func (p *PixelfedAdapter) LikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	return compatFavouriteComment(ctx, p.compat.instanceURL, accessToken, commentID, "pixelfed")
}

func (p *PixelfedAdapter) UnlikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	return compatUnfavouriteComment(ctx, p.compat.instanceURL, accessToken, commentID, "pixelfed")
}

func (p *PixelfedAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (p *PixelfedAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	return compatFetchAccountAnalytics(ctx, p.compat.instanceURL, accessToken, "pixelfed", input.AccountID)
}

func (p *PixelfedAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	return compatFetchContentAnalytics(ctx, p.compat.instanceURL, accessToken, "pixelfed", input)
}
