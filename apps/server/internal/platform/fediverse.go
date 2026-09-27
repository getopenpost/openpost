package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// FediverseSoftware identifies the server software behind a Fediverse
// instance. Detection is a hint for capability fallbacks and user-visible
// identity; every publish path still validates against the connected
// instance's advertised configuration.
type FediverseSoftware string

const (
	FediverseSoftwareUnknown    FediverseSoftware = "unknown"
	FediverseSoftwareMastodon   FediverseSoftware = "mastodon"
	FediverseSoftwarePixelfed   FediverseSoftware = "pixelfed"
	FediverseSoftwareGoToSocial FediverseSoftware = "gotosocial"
	FediverseSoftwareAkkoma     FediverseSoftware = "akkoma"
	FediverseSoftwarePleroma    FediverseSoftware = "pleroma"
	FediverseSoftwareFriendica  FediverseSoftware = "friendica"
)

// DisplayName is the user-visible software identity shown next to a
// connected account. It must never claim "Mastodon" for another
// implementation.
func (s FediverseSoftware) DisplayName() string {
	switch s {
	case FediverseSoftwareMastodon:
		return "Mastodon"
	case FediverseSoftwarePixelfed:
		return "Pixelfed"
	case FediverseSoftwareGoToSocial:
		return "GoToSocial"
	case FediverseSoftwareAkkoma:
		return "Akkoma"
	case FediverseSoftwarePleroma:
		return "Pleroma"
	case FediverseSoftwareFriendica:
		return "Friendica"
	default:
		return "Fediverse"
	}
}

// MastodonAPICompatible reports whether the software speaks the Mastodon
// client API surface OpenPost publishes through. Compatibility is a starting
// point for transport reuse, not a promise that every operation behaves
// identically.
func (s FediverseSoftware) MastodonAPICompatible() bool {
	switch s {
	case FediverseSoftwareMastodon,
		FediverseSoftwarePixelfed,
		FediverseSoftwareGoToSocial,
		FediverseSoftwareAkkoma,
		FediverseSoftwarePleroma,
		FediverseSoftwareFriendica:
		return true
	default:
		return false
	}
}

// ParseFediverseSoftware normalizes a nodeinfo software name. Unknown names
// stay unknown so callers fall back to advertised configuration instead of
// guessing.
func ParseFediverseSoftware(name string) FediverseSoftware {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "mastodon":
		return FediverseSoftwareMastodon
	case "pixelfed":
		return FediverseSoftwarePixelfed
	case "gotosocial":
		return FediverseSoftwareGoToSocial
	case "akkoma":
		return FediverseSoftwareAkkoma
	case "pleroma":
		return FediverseSoftwarePleroma
	case "friendica":
		return FediverseSoftwareFriendica
	default:
		return FediverseSoftwareUnknown
	}
}

// SoftwareFromInstanceVersion reads compatibility markers that Fediverse
// servers embed in their /api/v1/instance version string, for example
// "4.2.0 (compatible; Pixelfed 0.11.0)". Mastodon itself carries no marker,
// so an unmarked version resolves to Mastodon only when the caller already
// knows the endpoint speaks the Mastodon API.
func SoftwareFromInstanceVersion(version string, mastodonAPI bool) FediverseSoftware {
	lowered := strings.ToLower(version)
	switch {
	case strings.Contains(lowered, "pixelfed"):
		return FediverseSoftwarePixelfed
	case strings.Contains(lowered, "gotosocial"):
		return FediverseSoftwareGoToSocial
	case strings.Contains(lowered, "akkoma"):
		return FediverseSoftwareAkkoma
	case strings.Contains(lowered, "pleroma"):
		return FediverseSoftwarePleroma
	case strings.Contains(lowered, "friendica"):
		return FediverseSoftwareFriendica
	case mastodonAPI && strings.TrimSpace(version) != "":
		return FediverseSoftwareMastodon
	default:
		return FediverseSoftwareUnknown
	}
}

// IsInstanceScopedProvider reports whether accounts of this provider are
// disambiguated by their instance URL. The same account ID can exist on
// many independent servers, so workspace queries must scope by instance.
func IsInstanceScopedProvider(provider string) bool {
	switch NormalizeProviderKey(provider) {
	case providerMastodon, providerPixelfed, providerPeerTube, providerLemmy, providerPieFed:
		return true
	default:
		return false
	}
}

// NormalizeProviderKey lowercases and trims a provider key for comparison.
func NormalizeProviderKey(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

// DetectFediverseSoftware identifies the software behind an instance URL. It
// prefers nodeinfo metadata and falls back to the v1 instance version
// markers. A network failure returns unknown rather than failing the
// connection flow; publishing validation never depends on detection alone.
func DetectFediverseSoftware(ctx context.Context, instanceURL string) FediverseSoftware {
	base := strings.TrimRight(strings.TrimSpace(instanceURL), "/")
	if base == "" {
		return FediverseSoftwareUnknown
	}
	if software := detectViaNodeInfo(ctx, base); software != FediverseSoftwareUnknown {
		return software
	}
	body, err := DoRequest(ctx, http.MethodGet, base+"/api/v1/instance", nil, nil)
	if err != nil {
		return FediverseSoftwareUnknown
	}
	var instance struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(body, &instance); err != nil {
		return FediverseSoftwareUnknown
	}
	return SoftwareFromInstanceVersion(instance.Version, true)
}

func detectViaNodeInfo(ctx context.Context, base string) FediverseSoftware {
	body, err := DoRequest(ctx, http.MethodGet, base+"/.well-known/nodeinfo", nil, nil)
	if err != nil {
		return FediverseSoftwareUnknown
	}
	var discovery struct {
		Links []struct {
			Rel  string `json:"rel"`
			Href string `json:"href"`
		} `json:"links"`
	}
	if err := json.Unmarshal(body, &discovery); err != nil {
		return FediverseSoftwareUnknown
	}
	for _, link := range discovery.Links {
		if !strings.Contains(strings.ToLower(link.Rel), "nodeinfo") || strings.TrimSpace(link.Href) == "" {
			continue
		}
		doc, err := DoRequest(ctx, http.MethodGet, strings.TrimSpace(link.Href), nil, nil)
		if err != nil {
			continue
		}
		var nodeinfo struct {
			Software struct {
				Name string `json:"name"`
			} `json:"software"`
		}
		if err := json.Unmarshal(doc, &nodeinfo); err != nil {
			continue
		}
		if software := ParseFediverseSoftware(nodeinfo.Software.Name); software != FediverseSoftwareUnknown {
			return software
		}
	}
	return FediverseSoftwareUnknown
}

// mastodonCompatCredentials carries the OAuth client material shared by every
// adapter that publishes through the Mastodon client API.
type mastodonCompatCredentials struct {
	instanceURL  string
	clientID     string
	clientSecret string
	redirectURI  string
}

func (c mastodonCompatCredentials) authURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set(oauthParamClientID, c.clientID)
	params.Set(oauthParamRedirectURI, c.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", "read write")
	params.Set("state", state)
	return c.instanceURL + "/oauth/authorize?" + params.Encode(), nil
}

func (c mastodonCompatCredentials) exchangeCode(ctx context.Context, code string) (*TokenResult, error) {
	values := map[string]string{
		grantType:              oauthGrantAuthCode,
		oauthParamCode:         code,
		oauthParamRedirectURI:  c.redirectURI,
		oauthParamClientID:     c.clientID,
		oauthParamClientSecret: c.clientSecret,
	}
	respBody, err := DoFormURLEncoded(ctx, "POST", c.instanceURL+"/oauth/token", values, nil)
	if err != nil {
		return nil, fmt.Errorf("fediverse token exchange: %w", err)
	}
	var tokenResp TokenResult
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding fediverse token: %w", err)
	}
	return &tokenResp, nil
}

type compatProfile struct {
	ID           string `json:"id"`
	Acct         string `json:"acct"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Avatar       string `json:"avatar"`
	AvatarStatic string `json:"avatar_static"`
}

func compatVerifyCredentials(ctx context.Context, instanceURL, accessToken string) (compatProfile, error) {
	profile, err := DoBearerJSON[compatProfile](ctx, "GET", instanceURL+"/api/v1/accounts/verify_credentials", accessToken, nil, "fediverse profile")
	if err != nil {
		return compatProfile{}, err
	}
	if profile == nil {
		return compatProfile{}, fmt.Errorf("empty fediverse profile response")
	}
	return *profile, nil
}

func compatUserProfile(profile compatProfile, software FediverseSoftware) *UserProfile {
	result := &UserProfile{
		ID:          profile.ID,
		Username:    firstNonEmptyString(profile.Acct, profile.Username),
		DisplayName: profile.DisplayName,
		AvatarURL:   firstNonEmptyString(profile.AvatarStatic, profile.Avatar),
	}
	if software != FediverseSoftwareUnknown {
		result.CapabilityState = map[string]string{"fediverse_software": string(software)}
	}
	return result
}

func compatPublishingCapabilities(ctx context.Context, instanceURL, accessToken, provider, revisionPrefix string, focalPoint bool) (AccountCapabilityResult, error) {
	result, err := compatInstanceCapabilities(ctx, instanceURL, accessToken, provider)
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	version := strings.TrimPrefix(result.Revision, "compat-v1:")
	version = strings.TrimPrefix(version, "compat:")
	if version == "" || version == result.Revision {
		version = "unknown"
	}
	result.Revision = revisionPrefix + ":" + version
	if result.AvailableFeatures == nil {
		result.AvailableFeatures = map[string]bool{}
	}
	result.AvailableFeatures["quote_url"] = false
	result.AvailableFeatures["interaction_policy"] = false
	result.AvailableFeatures["focal_point"] = focalPoint
	return result, nil
}

func compatUploadMedia(ctx context.Context, instanceURL, accessToken, mimeType string, reader io.Reader) (string, error) {
	ext := ".bin"
	if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
		ext = exts[0]
	}
	respBody, err := DoMultipart(
		ctx,
		instanceURL+"/api/v2/media",
		"file",
		reader,
		"upload"+ext,
		nil,
		map[string]string{headerAuthorization: bearerPrefix + accessToken},
	)
	if err != nil {
		return "", fmt.Errorf("fediverse media upload: %w", err)
	}
	var mediaResp struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := json.Unmarshal(respBody, &mediaResp); err != nil {
		return "", fmt.Errorf("decoding fediverse media: %w", err)
	}
	if mediaResp.URL == "" {
		var waitErr error
		mediaResp.ID, waitErr = compatWaitForMediaProcessing(ctx, instanceURL, accessToken, mediaResp.ID)
		if waitErr != nil {
			return "", waitErr
		}
	}
	return mediaResp.ID, nil
}

func compatWaitForMediaProcessing(ctx context.Context, instanceURL, accessToken, mediaID string) (string, error) {
	for i := 0; i < 30; i++ {
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", fmt.Errorf("fediverse media processing: %w", ctx.Err())
		case <-timer.C:
		}
		respBody, err := DoJSON(ctx, "GET", instanceURL+"/api/v1/media/"+mediaID, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return "", fmt.Errorf("fediverse media status: %w", err)
		}
		var statusResp struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		}
		if err := json.Unmarshal(respBody, &statusResp); err != nil {
			return "", fmt.Errorf("decoding fediverse media status: %w", err)
		}
		if statusResp.URL != "" {
			return statusResp.ID, nil
		}
	}
	return "", fmt.Errorf("fediverse media processing timed out")
}

func compatUpdateMedia(ctx context.Context, instanceURL, accessToken, mediaID, description, focus string) error {
	if description == "" && focus == "" {
		return nil
	}
	_, err := DoFormURLEncoded(ctx, "PUT", instanceURL+"/api/v1/media/"+mediaID, map[string]string{
		"description": description,
		"focus":       focus,
	}, map[string]string{headerAuthorization: bearerPrefix + accessToken})
	if err != nil {
		return fmt.Errorf("updating fediverse media alt text: %w", err)
	}
	return nil
}

func buildCompatStatusForm(req *PublishRequest) (url.Values, error) {
	formValues := url.Values{}
	formValues.Set("status", ContentWithSettingURL(req.Content, req.Settings))

	visibility := firstNonEmptyString(settingString(req.Settings, "visibility"), "public")
	if !validCompatVisibility(visibility) {
		return nil, fmt.Errorf("fediverse visibility %q is not supported", visibility)
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
	pollOptions := compatPollOptions(req.Settings)
	if len(pollOptions) > 0 {
		if len(req.PlatformMediaIDs) > 0 {
			return nil, fmt.Errorf("fediverse polls cannot be combined with media attachments")
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

func validCompatVisibility(value string) bool {
	switch value {
	case "public", "unlisted", "private", "direct":
		return true
	default:
		return false
	}
}

func compatPollOptions(settings map[string]interface{}) []string {
	raw := settingString(settings, "poll_options")
	if raw == "" {
		return nil
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n'
	})
	options := []string{}
	for _, part := range parts {
		if option := strings.TrimSpace(part); option != "" {
			options = append(options, option)
		}
	}
	return options
}

func compatPostStatus(ctx context.Context, instanceURL, accessToken string, req *PublishRequest, provider string) (PublishResult, error) {
	for i, mediaID := range req.PlatformMediaIDs {
		altText := ""
		if i < len(req.MediaAltTexts) {
			altText = req.MediaAltTexts[i]
		}
		focalPoint := ""
		if i < len(req.MediaSettings) {
			focalPoint = settingString(req.MediaSettings[i], "focal_point")
		}
		if err := compatUpdateMedia(ctx, instanceURL, accessToken, mediaID, altText, focalPoint); err != nil {
			return PublishResult{}, err
		}
	}

	formValues, err := buildCompatStatusForm(req)
	if err != nil {
		if strings.Contains(err.Error(), "visibility") {
			return PublishResult{}, fmt.Errorf("%s visibility %q is not supported", provider, settingString(req.Settings, "visibility"))
		}
		if strings.Contains(err.Error(), "polls cannot be combined") {
			return PublishResult{}, fmt.Errorf("%s %w", provider, err)
		}
		return PublishResult{}, err
	}
	headers := map[string]string{headerAuthorization: bearerPrefix + accessToken}
	if req.IdempotencyKey != "" {
		headers["Idempotency-Key"] = req.IdempotencyKey
	}
	respBody, err := DoFormURLEncodedValues(ctx, "POST", instanceURL+"/api/v1/statuses", formValues, headers)
	if err != nil {
		return PublishResult{}, fmt.Errorf("posting to %s: %w", provider, err)
	}
	var statusResp struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := json.Unmarshal(respBody, &statusResp); err != nil {
		return PublishResult{}, fmt.Errorf("decoding %s post: %w", provider, err)
	}
	result := AcceptedPublishResult(statusResp.ID)
	result.ExternalURL = statusResp.URL
	result.ProviderState = "create_status"
	return result, nil
}

// compatInstanceCapabilities resolves publishing constraints from the
// connected instance's advertised configuration. It prefers /api/v2/instance
// and falls back to the v1 shape that older and compatible servers expose.
func compatInstanceCapabilities(ctx context.Context, instanceURL, accessToken, provider string) (AccountCapabilityResult, error) {
	result, err := compatV2InstanceCapabilities(ctx, instanceURL, accessToken)
	if err == nil {
		return result, nil
	}
	// The v1 shape is a safe fallback for older and compatible servers,
	// whether v2 is missing or transiently failing.
	if fallback, fallbackErr := compatV1InstanceCapabilities(ctx, instanceURL, accessToken); fallbackErr == nil {
		return fallback, nil
	}
	return AccountCapabilityResult{}, fmt.Errorf("loading %s instance configuration: %w", provider, err)
}

func compatV2InstanceCapabilities(ctx context.Context, instanceURL, accessToken string) (AccountCapabilityResult, error) {
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
	response, err := DoRequest(ctx, http.MethodGet, instanceURL+"/api/v2/instance", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	if err := json.Unmarshal(response, &instance); err != nil {
		return AccountCapabilityResult{}, fmt.Errorf("decoding instance configuration: %w", err)
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
		Revision:    "compat:" + firstNonEmptyString(instance.Version, "unknown"),
		Constraints: constraints,
	}, nil
}

func compatV1InstanceCapabilities(ctx context.Context, instanceURL, accessToken string) (AccountCapabilityResult, error) {
	var instance struct {
		Version      string `json:"version"`
		MaxTootChars int    `json:"max_toot_chars"`
		PollLimits   *struct {
			MaxOptions             int `json:"max_options"`
			MaxCharactersPerOption int `json:"max_characters_per_option"`
			MinExpiration          int `json:"min_expiration"`
			MaxExpiration          int `json:"max_expiration"`
		} `json:"poll_limits"`
		UploadLimit *int64 `json:"upload_limit"`
	}
	response, err := DoRequest(ctx, http.MethodGet, instanceURL+"/api/v1/instance", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	if err := json.Unmarshal(response, &instance); err != nil {
		return AccountCapabilityResult{}, fmt.Errorf("decoding instance configuration: %w", err)
	}
	constraints := map[string]interface{}{}
	if instance.MaxTootChars > 0 {
		constraints["text_limit"] = instance.MaxTootChars
	}
	if instance.UploadLimit != nil && *instance.UploadLimit > 0 {
		constraints["max_video_size_bytes"] = *instance.UploadLimit
	}
	if instance.PollLimits != nil {
		if instance.PollLimits.MaxOptions > 0 {
			constraints["poll_max_options"] = instance.PollLimits.MaxOptions
		}
		if instance.PollLimits.MaxCharactersPerOption > 0 {
			constraints["poll_option_max_length"] = instance.PollLimits.MaxCharactersPerOption
		}
	}
	return AccountCapabilityResult{
		Revision:    "compat-v1:" + firstNonEmptyString(instance.Version, "unknown"),
		Constraints: constraints,
	}, nil
}

func compatFetchAccountAnalytics(ctx context.Context, instanceURL, accessToken, provider, accountID string) (AnalyticsValues, error) {
	var response struct {
		FollowersCount *int64 `json:"followers_count"`
		FollowingCount *int64 `json:"following_count"`
		StatusesCount  *int64 `json:"statuses_count"`
	}
	body, err := DoRequest(ctx, http.MethodGet, instanceURL+"/api/v1/accounts/"+url.PathEscape(accountID), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("%s account analytics: %w", provider, err)
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding %s account analytics: %w", provider, err)
	}
	values := AnalyticsValues{}
	addOptionalMetric(values, MetricFollowers, response.FollowersCount)
	addOptionalMetric(values, MetricFollowing, response.FollowingCount)
	addOptionalMetric(values, MetricPosts, response.StatusesCount)
	return values, nil
}

func compatFetchContentAnalytics(ctx context.Context, instanceURL, accessToken, provider string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		var response struct {
			FavouritesCount *int64 `json:"favourites_count"`
			ReblogsCount    *int64 `json:"reblogs_count"`
			RepliesCount    *int64 `json:"replies_count"`
		}
		body, err := DoRequest(ctx, http.MethodGet, instanceURL+"/api/v1/statuses/"+url.PathEscape(externalID), nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return nil, fmt.Errorf("%s content analytics: %w", provider, err)
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decoding %s content analytics: %w", provider, err)
		}
		addOptionalMetric(total, MetricLikes, response.FavouritesCount)
		addOptionalMetric(total, MetricReposts, response.ReblogsCount)
		addOptionalMetric(total, MetricComments, response.RepliesCount)
	}
	subtractOwnReplies(total, input.OwnReplyCount)
	return total, nil
}

func compatResolveStatusID(ctx context.Context, instanceURL, accessToken, sourceInstanceURL, externalID, externalURL, provider string) (string, error) {
	statusID := strings.TrimSpace(externalID)
	if strings.TrimSpace(sourceInstanceURL) != "" && strings.TrimRight(sourceInstanceURL, "/") != strings.TrimRight(instanceURL, "/") {
		if strings.TrimSpace(externalURL) == "" {
			return "", fmt.Errorf("%s cross-instance repost requires the source status url", provider)
		}
		endpoint := instanceURL + "/api/v2/search?q=" + url.QueryEscape(externalURL) + "&type=statuses&resolve=true&limit=1"
		body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return "", fmt.Errorf("resolving %s status: %w", provider, err)
		}
		var result struct {
			Statuses []struct {
				ID string `json:"id"`
			} `json:"statuses"`
		}
		if err := json.Unmarshal(body, &result); err != nil || len(result.Statuses) == 0 {
			return "", fmt.Errorf("%s source status was not found on the target instance", provider)
		}
		statusID = result.Statuses[0].ID
	}
	if statusID == "" {
		return "", fmt.Errorf("%s repost requires a source status id", provider)
	}
	return statusID, nil
}

func compatRepost(ctx context.Context, instanceURL, accessToken string, req RepostRequest, provider string) (RepostResult, error) {
	statusID, err := compatResolveStatusID(ctx, instanceURL, accessToken, req.SourceInstanceURL, req.ExternalID, req.ExternalURL, provider)
	if err != nil {
		return RepostResult{}, err
	}
	body, err := DoRequest(ctx, http.MethodPost, instanceURL+"/api/v1/statuses/"+url.PathEscape(statusID)+"/reblog", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return RepostResult{}, fmt.Errorf("reposting on %s: %w", provider, err)
	}
	var result struct {
		Reblog *struct {
			ID string `json:"id"`
		} `json:"reblog"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return RepostResult{}, fmt.Errorf("decoding %s repost: %w", provider, err)
	}
	if result.Reblog != nil && strings.TrimSpace(result.Reblog.ID) != "" {
		statusID = result.Reblog.ID
	}
	return RepostResult{ExternalID: statusID, ExternalURL: req.ExternalURL}, nil
}

func compatUnrepost(ctx context.Context, instanceURL, accessToken string, req UnrepostRequest, provider string) error {
	statusID := strings.TrimSpace(req.RepostExternalID)
	if statusID == "" {
		return fmt.Errorf("%s unrepost requires the target-local source status id", provider)
	}
	_, err := DoRequest(ctx, http.MethodPost, instanceURL+"/api/v1/statuses/"+url.PathEscape(statusID)+"/unreblog", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err == nil {
		return nil
	}
	var httpErr *HTTPError
	if errors.As(err, &httpErr) && (httpErr.StatusCode == http.StatusNotFound || httpErr.StatusCode == http.StatusGone) {
		return nil
	}
	return fmt.Errorf("unreposting on %s: %w", provider, err)
}

// compatListComments reads replies through the Mastodon status-context API
// shared by compatible servers.
func compatListComments(ctx context.Context, instanceURL, accessToken, accountID, externalID, provider string) ([]Comment, error) {
	body, err := DoRequest(ctx, http.MethodGet, instanceURL+"/api/v1/statuses/"+url.PathEscape(externalID)+"/context", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("fetching %s replies: %w", provider, err)
	}
	var response struct {
		Descendants []mastodonMessageStatus `json:"descendants"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding %s replies: %w", provider, err)
	}
	comments := make([]Comment, 0, len(response.Descendants))
	for _, status := range response.Descendants {
		attachments := make([]CommentAttachment, 0, len(status.MediaAttachments))
		for _, attachment := range status.MediaAttachments {
			attachments = append(attachments, CommentAttachment{
				Type:      attachment.Type,
				URL:       attachment.URL,
				Thumbnail: attachment.PreviewURL,
				AltText:   attachment.Description,
			})
		}
		comments = append(comments, Comment{
			ID: status.ID, ParentID: status.InReplyToID, AuthorID: status.Account.ID, AuthorName: status.Account.DisplayName,
			AuthorHandle: prefixHandle(status.Account.Acct), AuthorAvatarURL: status.Account.Avatar,
			Text: mastodonPlainText(status.Content), CreatedAt: status.CreatedAt, UpdatedAt: status.EditedAt,
			Attachments: attachments, IsOurs: status.Account.ID == accountID, CanReply: true,
			CanDelete: status.Account.ID == accountID, CanLike: !status.Favourited,
			CanUnlike: status.Favourited, Liked: status.Favourited, LikeStateKnown: true,
		})
	}
	return comments, nil
}

func compatDeleteComment(ctx context.Context, instanceURL, accessToken, commentID, provider string) error {
	_, err := DoRequest(ctx, http.MethodDelete, instanceURL+"/api/v1/statuses/"+url.PathEscape(commentID), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return fmt.Errorf("deleting %s reply: %w", provider, err)
	}
	return nil
}

func compatFavouriteComment(ctx context.Context, instanceURL, accessToken, commentID, provider string) error {
	_, err := DoRequest(ctx, http.MethodPost, instanceURL+"/api/v1/statuses/"+url.PathEscape(commentID)+"/favourite", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return fmt.Errorf("liking %s reply: %w", provider, err)
	}
	return nil
}

func compatUnfavouriteComment(ctx context.Context, instanceURL, accessToken, commentID, provider string) error {
	_, err := DoRequest(ctx, http.MethodPost, instanceURL+"/api/v1/statuses/"+url.PathEscape(commentID)+"/unfavourite", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return fmt.Errorf("unliking %s reply: %w", provider, err)
	}
	return nil
}
