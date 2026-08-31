package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type MastodonAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string
	instanceURL  string
}

func NewMastodonAdapter(clientID, clientSecret, redirectURI, instanceURL string) *MastodonAdapter {
	return &MastodonAdapter{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		instanceURL:  instanceURL,
	}
}

func (m *MastodonAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     m.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code", "instance_url": m.instanceURL},
	}
}

func validateMastodonMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	for _, item := range media {
		if isVideoMime(item.MimeType) && !isMastodonLikelyVideoMime(item.MimeType) {
			return []MediaValidationIssue{{
				Provider: providerMastodon,
				MediaID:  item.ID,
				Severity: severityWarning,
				Message:  "Mastodon video support depends on the instance; MP4, MOV, and WebM are the safest formats.",
			}}
		}
	}
	return nil
}

func isMastodonLikelyVideoMime(mimeType string) bool {
	mimeType = strings.ToLower(mimeType)
	return mimeType == videoTypeMP4 || mimeType == "video/quicktime" || mimeType == "video/webm" || mimeType == "image/gif"
}

func (m *MastodonAdapter) InstanceURL() string {
	return m.instanceURL
}

func (m *MastodonAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set(oauthParamClientID, m.clientID)
	params.Set(oauthParamRedirectURI, m.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", "read write")
	params.Set("state", state)

	return m.instanceURL + "/oauth/authorize?" + params.Encode(), nil
}

func (m *MastodonAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	values := map[string]string{
		grantType:              oauthGrantAuthCode,
		oauthParamCode:         code,
		oauthParamRedirectURI:  m.redirectURI,
		oauthParamClientID:     m.clientID,
		oauthParamClientSecret: m.clientSecret,
	}

	respBody, err := DoFormURLEncoded(ctx, "POST", m.instanceURL+"/oauth/token", values, nil)
	if err != nil {
		return nil, fmt.Errorf("mastodon token exchange: %w", err)
	}

	var tokenResp TokenResult
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding mastodon token: %w", err)
	}

	return &tokenResp, nil
}

func (m *MastodonAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        false,
		CredentialSource: RefreshCredentialNone,
	}
}

func (m *MastodonAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("mastodon tokens do not expire")
}

func (m *MastodonAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	type mastodonProfile struct {
		ID           string `json:"id"`
		Acct         string `json:"acct"`
		DisplayName  string `json:"display_name"`
		Avatar       string `json:"avatar"`
		AvatarStatic string `json:"avatar_static"`
	}

	profile, err := DoBearerJSON[mastodonProfile](ctx, "GET", m.instanceURL+"/api/v1/accounts/verify_credentials", accessToken, nil, "mastodon profile")
	if err != nil {
		return nil, err
	}

	return &UserProfile{
		ID:          profile.ID,
		Username:    profile.Acct,
		DisplayName: profile.DisplayName,
		AvatarURL:   firstNonEmptyString(profile.AvatarStatic, profile.Avatar),
	}, nil
}

func (m *MastodonAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, _ AccountCapabilityInput) (AccountCapabilityResult, error) {
	var instance struct {
		Version       string `json:"version"`
		Configuration struct {
			Statuses struct {
				MaxCharacters       int `json:"max_characters"`
				MaxMediaAttachments int `json:"max_media_attachments"`
			} `json:"statuses"`
			Polls struct {
				MaxOptions             int `json:"max_options"`
				MaxCharactersPerOption int `json:"max_characters_per_option"`
				MinExpiration          int `json:"min_expiration"`
				MaxExpiration          int `json:"max_expiration"`
			} `json:"polls"`
			MediaAttachments struct {
				ImageSizeLimit     int64    `json:"image_size_limit"`
				VideoSizeLimit     int64    `json:"video_size_limit"`
				SupportedMIMETypes []string `json:"supported_mime_types"`
			} `json:"media_attachments"`
		} `json:"configuration"`
	}
	response, err := DoRequest(ctx, http.MethodGet, m.instanceURL+"/api/v2/instance", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return AccountCapabilityResult{}, fmt.Errorf("loading Mastodon instance configuration: %w", err)
	}
	if err := json.Unmarshal(response, &instance); err != nil {
		return AccountCapabilityResult{}, fmt.Errorf("decoding Mastodon instance configuration: %w", err)
	}
	constraints := map[string]interface{}{}
	if instance.Configuration.Statuses.MaxCharacters > 0 {
		constraints["text_limit"] = instance.Configuration.Statuses.MaxCharacters
	}
	if instance.Configuration.Statuses.MaxMediaAttachments > 0 {
		constraints["media_max_count"] = instance.Configuration.Statuses.MaxMediaAttachments
	}
	if instance.Configuration.MediaAttachments.VideoSizeLimit > 0 {
		constraints["max_video_size_bytes"] = instance.Configuration.MediaAttachments.VideoSizeLimit
	}
	if len(instance.Configuration.MediaAttachments.SupportedMIMETypes) > 0 {
		constraints["allowed_mimes"] = instance.Configuration.MediaAttachments.SupportedMIMETypes
	}
	if instance.Configuration.Polls.MaxOptions > 0 {
		constraints["poll_max_options"] = instance.Configuration.Polls.MaxOptions
	}
	if instance.Configuration.Polls.MaxCharactersPerOption > 0 {
		constraints["poll_option_max_length"] = instance.Configuration.Polls.MaxCharactersPerOption
	}
	if instance.Configuration.Polls.MinExpiration > 0 {
		constraints["poll_min_expiration_seconds"] = instance.Configuration.Polls.MinExpiration
	}
	if instance.Configuration.Polls.MaxExpiration > 0 {
		constraints["poll_max_expiration_seconds"] = instance.Configuration.Polls.MaxExpiration
	}
	return AccountCapabilityResult{
		Revision:    "mastodon:" + firstNonEmptyString(instance.Version, "unknown"),
		Constraints: constraints,
		AvailableFeatures: map[string]bool{
			"quote_url":          false,
			"interaction_policy": false,
			"focal_point":        true,
		},
	}, nil
}

func (m *MastodonAdapter) UploadMedia(ctx context.Context, accessToken, _ string, mimeType string, reader io.Reader) (string, error) {
	ext := ".bin"
	if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
		ext = exts[0]
	}

	respBody, err := DoMultipart(
		ctx,
		m.instanceURL+"/api/v2/media",
		"file",
		reader,
		"upload"+ext,
		nil,
		map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		},
	)
	if err != nil {
		return "", fmt.Errorf("mastodon media upload: %w", err)
	}

	var mediaResp struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if unmarshalErr := json.Unmarshal(respBody, &mediaResp); unmarshalErr != nil {
		return "", fmt.Errorf("decoding mastodon media: %w", unmarshalErr)
	}

	if mediaResp.URL == "" {
		mediaResp.ID, err = m.waitForMediaProcessing(ctx, accessToken, mediaResp.ID)
		if err != nil {
			return "", err
		}
	}

	return mediaResp.ID, nil
}

func (m *MastodonAdapter) waitForMediaProcessing(ctx context.Context, accessToken, mediaID string) (string, error) {
	for i := 0; i < 30; i++ {
		time.Sleep(2 * time.Second)

		respBody, err := DoJSON(ctx, "GET", m.instanceURL+"/api/v1/media/"+mediaID, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return "", fmt.Errorf("mastodon media status: %w", err)
		}

		var statusResp struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		}
		if err := json.Unmarshal(respBody, &statusResp); err != nil {
			return "", fmt.Errorf("decoding mastodon media status: %w", err)
		}

		if statusResp.URL != "" {
			return statusResp.ID, nil
		}
	}

	return "", fmt.Errorf("mastodon media processing timed out")
}

func (m *MastodonAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	return executePreparedPublishWrite(req, PublishResult{
		ProviderState: "create_status", RetrySafety: PublishRetryIdempotent,
		IdempotencyTTL: time.Hour,
	}, func() (string, error) {
		return m.publish(ctx, accessToken, req)
	})
}

func (m *MastodonAdapter) publish(ctx context.Context, accessToken string, req *PublishRequest) (string, error) {
	// Update alt text for each uploaded media before attaching to the status
	for i, mediaID := range req.PlatformMediaIDs {
		altText := ""
		if i < len(req.MediaAltTexts) {
			altText = req.MediaAltTexts[i]
		}
		values := map[string]string{}
		if altText != "" {
			values["description"] = altText
		}
		if i < len(req.MediaSettings) {
			if focalPoint := settingString(req.MediaSettings[i], "focal_point"); focalPoint != "" {
				values["focus"] = focalPoint
			}
		}
		if len(values) > 0 {
			_, err := DoFormURLEncoded(ctx, "PUT", m.instanceURL+"/api/v1/media/"+mediaID, map[string]string{
				"description": values["description"],
				"focus":       values["focus"],
			}, map[string]string{
				headerAuthorization: bearerPrefix + accessToken,
			})
			if err != nil {
				return "", fmt.Errorf("updating mastodon media alt text: %w", err)
			}
		}
	}

	formValues, err := buildMastodonStatusForm(req)
	if err != nil {
		return "", err
	}
	headers := map[string]string{headerAuthorization: bearerPrefix + accessToken}
	if req.IdempotencyKey != "" {
		headers["Idempotency-Key"] = req.IdempotencyKey
	}
	respBody, err := DoFormURLEncodedValues(ctx, "POST", m.instanceURL+"/api/v1/statuses", formValues, headers)
	if err != nil {
		return "", fmt.Errorf("posting to mastodon: %w", err)
	}

	var statusResp struct {
		ID string `json:"id"`
	}
	if unmarshalErr := json.Unmarshal(respBody, &statusResp); unmarshalErr != nil {
		return "", fmt.Errorf("decoding mastodon post: %w", unmarshalErr)
	}

	return statusResp.ID, nil
}

func (m *MastodonAdapter) Repost(ctx context.Context, accessToken, _ string, req RepostRequest) (RepostResult, error) {
	statusID := strings.TrimSpace(req.ExternalID)
	if req.SourceInstanceURL != "" && strings.TrimRight(req.SourceInstanceURL, "/") != strings.TrimRight(m.instanceURL, "/") {
		if strings.TrimSpace(req.ExternalURL) == "" {
			return RepostResult{}, fmt.Errorf("mastodon cross-instance repost requires the source status url")
		}
		endpoint := m.instanceURL + "/api/v2/search?q=" + url.QueryEscape(req.ExternalURL) + "&type=statuses&resolve=true&limit=1"
		body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return RepostResult{}, fmt.Errorf("resolving mastodon status: %w", err)
		}
		var result struct {
			Statuses []struct {
				ID string `json:"id"`
			} `json:"statuses"`
		}
		if err := json.Unmarshal(body, &result); err != nil || len(result.Statuses) == 0 {
			return RepostResult{}, fmt.Errorf("mastodon source status was not found on the target instance")
		}
		statusID = result.Statuses[0].ID
	}
	if statusID == "" {
		return RepostResult{}, fmt.Errorf("mastodon repost requires a source status id")
	}
	body, err := DoRequest(ctx, http.MethodPost, m.instanceURL+"/api/v1/statuses/"+url.PathEscape(statusID)+"/reblog", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return RepostResult{}, fmt.Errorf("reposting on mastodon: %w", err)
	}
	var result struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return RepostResult{}, fmt.Errorf("decoding mastodon repost: %w", err)
	}
	return RepostResult{ExternalID: result.ID, ExternalURL: result.URL}, nil
}

func buildMastodonStatusForm(req *PublishRequest) (url.Values, error) {
	formValues := url.Values{}
	formValues.Set("status", ContentWithSettingURL(req.Content, req.Settings))

	visibility := firstNonEmptyString(settingString(req.Settings, "visibility"), "public")
	if !validMastodonVisibility(visibility) {
		return nil, fmt.Errorf("mastodon visibility %q is not supported", visibility)
	}
	formValues.Set("visibility", visibility)

	if spoilerText := settingString(req.Settings, "spoiler_text"); spoilerText != "" {
		formValues.Set("spoiler_text", spoilerText)
	}
	if settingBool(req.Settings, "sensitive") {
		formValues.Set("sensitive", "true")
	}
	if language := settingString(req.Settings, "language"); language != "" {
		formValues.Set("language", language)
	}
	pollOptions := mastodonPollOptions(req.Settings)
	if len(pollOptions) > 0 {
		if len(req.PlatformMediaIDs) > 0 {
			return nil, fmt.Errorf("mastodon polls cannot be combined with media attachments")
		}
		for _, option := range pollOptions {
			formValues.Add("poll[options][]", option)
		}
		expiresIn := settingInt(req.Settings, "poll_expires_in_seconds")
		if expiresIn <= 0 {
			expiresIn = 86400
		}
		formValues.Set("poll[expires_in]", strconv.Itoa(expiresIn))
		if settingBool(req.Settings, "poll_multiple") {
			formValues.Set("poll[multiple]", "true")
		}
		if settingBool(req.Settings, "poll_hide_totals") {
			formValues.Set("poll[hide_totals]", "true")
		}
	}

	for _, mediaID := range req.PlatformMediaIDs {
		formValues.Add("media_ids[]", mediaID)
	}

	if req.ReplyToID != "" {
		formValues.Set("in_reply_to_id", req.ReplyToID)
	}
	return formValues, nil
}

func validMastodonVisibility(value string) bool {
	switch value {
	case "public", "unlisted", "private", "direct":
		return true
	default:
		return false
	}
}

func mastodonPollOptions(settings map[string]interface{}) []string {
	raw := settingString(settings, "poll_options")
	if raw == "" {
		return nil
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == ','
	})
	options := []string{}
	for _, part := range parts {
		if option := strings.TrimSpace(part); option != "" {
			options = append(options, option)
		}
	}
	return options
}
