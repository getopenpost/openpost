package platform

import (
	"context"
	"fmt"
	"io"
	"time"
)

// MastodonAdapter publishes through the Mastodon client API of one instance.
// Transport details shared with other Mastodon-API-compatible software live
// in fediverse.go; this file keeps Mastodon's provider identity,
// validation copy, and capability features.
type MastodonAdapter struct {
	BaseAdapter
	compat mastodonCompatCredentials
}

func NewMastodonAdapter(clientID, clientSecret, redirectURI, instanceURL string) *MastodonAdapter {
	return &MastodonAdapter{
		compat: mastodonCompatCredentials{
			instanceURL:  instanceURL,
			clientID:     clientID,
			clientSecret: clientSecret,
			redirectURI:  redirectURI,
		},
	}
}

func (m *MastodonAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     m.compat.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code", "instance_url": m.compat.instanceURL},
	}
}

func (m *MastodonAdapter) InstanceURL() string {
	return m.compat.instanceURL
}

func (m *MastodonAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return m.compat.authURL(state)
}

func (m *MastodonAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	return m.compat.exchangeCode(ctx, code)
}

func (m *MastodonAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("mastodon tokens do not expire")
}

func (m *MastodonAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	profile, err := compatVerifyCredentials(ctx, m.compat.instanceURL, accessToken)
	if err != nil {
		return nil, err
	}
	return compatUserProfile(profile, FediverseSoftwareUnknown), nil
}

func (m *MastodonAdapter) AccountCapabilityKeyInput(AccountCapabilityInput) string { return "" }

func (m *MastodonAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, _ AccountCapabilityInput) (AccountCapabilityResult, error) {
	return compatPublishingCapabilities(ctx, m.compat.instanceURL, accessToken, "Mastodon", "mastodon", true)
}

func (m *MastodonAdapter) UploadMedia(ctx context.Context, accessToken, _ string, mimeType string, reader io.Reader) (string, error) {
	return compatUploadMedia(ctx, m.compat.instanceURL, accessToken, mimeType, reader)
}

func (m *MastodonAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	if err := m.ValidateMentionTargets(ctx, accessToken, req); err != nil {
		return PublishResult{}, err
	}
	prepared := PublishResult{ProviderState: "create_status", RetrySafety: PublishRetryIdempotent, IdempotencyTTL: time.Hour}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	result, err := compatPostStatus(ctx, m.compat.instanceURL, accessToken, req, "mastodon")
	if err != nil {
		return prepared, err
	}
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

func (m *MastodonAdapter) Repost(ctx context.Context, accessToken, _ string, req RepostRequest) (RepostResult, error) {
	return compatRepost(ctx, m.compat.instanceURL, accessToken, req, "mastodon")
}

func (m *MastodonAdapter) Unrepost(ctx context.Context, accessToken, _ string, req UnrepostRequest) error {
	return compatUnrepost(ctx, m.compat.instanceURL, accessToken, req, "mastodon")
}
