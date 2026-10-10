package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

const (
	tiktokAuthURL           = "https://www.tiktok.com/v2/auth/authorize/"
	tiktokTokenURL          = "https://open.tiktokapis.com/v2/oauth/token/"
	tiktokUserInfoURL       = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username"
	tiktokUserInfoBasicURL  = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name"
	tiktokCreatorInfoURL    = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
	tiktokVideoInitURL      = "https://open.tiktokapis.com/v2/post/publish/video/init/"
	tiktokVideoInboxInitURL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
	tiktokContentInitURL    = "https://open.tiktokapis.com/v2/post/publish/content/init/"
	tiktokPublishStatusURL  = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
	tiktokTitleMaxUnits     = 2200
	tiktokVideoListURL      = "https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,title,video_description,share_url,like_count,comment_count,share_count,view_count"
	tiktokMaxChunkSize      = 64 * 1024 * 1024
)

type TikTokAdapter struct {
	clientKey    string
	clientSecret string
	redirectURI  string
	scopes       []string
	capabilities TikTokScopeCapabilities
}

func NewTikTokAdapter(clientKey, clientSecret, redirectURI string) *TikTokAdapter {
	return NewTikTokAdapterWithCapabilities(clientKey, clientSecret, redirectURI, TikTokDefaultScopeCapabilities())
}

func NewTikTokAdapterWithCapabilities(clientKey, clientSecret, redirectURI string, capabilities TikTokScopeCapabilities) *TikTokAdapter {
	if !capabilities.DirectPost || !capabilities.InboxUpload {
		capabilities.DirectPost = true
		capabilities.InboxUpload = true
	}
	return &TikTokAdapter{
		clientKey:    clientKey,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		scopes:       capabilities.Scopes(),
		capabilities: capabilities,
	}
}

// RequestedScopes returns the installation-enabled OAuth scope set this
// adapter requests. It is built from TikTokScopeCapabilities, never from a
// free-form scope string.
func (t *TikTokAdapter) RequestedScopes() []string {
	return append([]string(nil), t.scopes...)
}

// ScopeCapabilities returns the capability set backing RequestedScopes.
func (t *TikTokAdapter) ScopeCapabilities() TikTokScopeCapabilities {
	return t.capabilities
}

func (t *TikTokAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     t.clientKey,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code"},
	}
}

func (t *TikTokAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set("client_key", t.clientKey)
	params.Set(oauthParamRedirectURI, t.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", strings.Join(t.RequestedScopes(), ","))
	params.Set("state", state)
	return tiktokAuthURL + "?" + params.Encode(), nil
}

// GenerateAuthURLWithCapabilities builds the OAuth authorization URL from a
// capability set instead of a fixed scope union, so installations whose
// TikTok app lacks Display API approval request only what TikTok can grant.
func (t *TikTokAdapter) GenerateAuthURLWithCapabilities(state string, capabilities TikTokScopeCapabilities) (string, map[string]string) {
	params := url.Values{}
	params.Set("client_key", t.clientKey)
	params.Set(oauthParamRedirectURI, t.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", strings.Join(capabilities.Scopes(), ","))
	params.Set("state", state)
	return tiktokAuthURL + "?" + params.Encode(), nil
}

func (t *TikTokAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	values := map[string]string{
		"client_key":           t.clientKey,
		oauthParamClientSecret: t.clientSecret,
		oauthParamCode:         code,
		grantType:              oauthGrantAuthCode,
		oauthParamRedirectURI:  t.redirectURI,
	}
	tokenResp, err := t.exchangeToken(ctx, values, "tiktok token exchange")
	if err != nil {
		return nil, err
	}
	return tokenResp, nil
}

func (t *TikTokAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        true,
		CredentialSource: RefreshCredentialRefreshToken,
	}
}

func (t *TikTokAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if input.RefreshToken == "" {
		return nil, fmt.Errorf("tiktok refresh requires a refresh token")
	}
	values := map[string]string{
		"client_key":                          t.clientKey,
		oauthParamClientSecret:                t.clientSecret,
		grantType:                             oauthGrantRefresh,
		string(RefreshCredentialRefreshToken): input.RefreshToken,
	}
	return t.exchangeToken(ctx, values, "tiktok token refresh")
}

func (t *TikTokAdapter) exchangeToken(ctx context.Context, values map[string]string, label string) (*TokenResult, error) {
	respBody, err := DoFormURLEncoded(ctx, "POST", tiktokTokenURL, values, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}

	var tokenResp struct {
		AccessToken      string `json:"access_token"`
		RefreshToken     string `json:"refresh_token"`
		ExpiresIn        int    `json:"expires_in"`
		RefreshExpiresIn int    `json:"refresh_expires_in"`
		TokenType        string `json:"token_type"`
		Scope            string `json:"scope"`
		OpenID           string `json:"open_id"`
		Error            string `json:"error"`
		Description      string `json:"error_description"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}
	if tokenResp.Error != "" {
		return nil, tiktokAPIError{Code: tokenResp.Error}.err(label)
	}
	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("%s: missing access token", label)
	}

	extra := map[string]string{}
	if tokenResp.OpenID != "" {
		extra["open_id"] = tokenResp.OpenID
	}
	if tokenResp.Scope != "" {
		extra["scope"] = tokenResp.Scope
	}

	return &TokenResult{
		AccessToken:      tokenResp.AccessToken,
		RefreshToken:     tokenResp.RefreshToken,
		ExpiresIn:        tokenResp.ExpiresIn,
		RefreshExpiresIn: tokenResp.RefreshExpiresIn,
		TokenType:        firstNonEmptyString(tokenResp.TokenType, tokenTypeBearer),
		Extra:            extra,
	}, nil
}

func (t *TikTokAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	profile, apiCode, err := t.fetchTikTokProfile(ctx, accessToken, tiktokUserInfoURL)
	if err == nil {
		return profile, nil
	}
	// The username field needs the Display API profile scope, which TikTok
	// no longer offers to new apps. A scope-denied full lookup must not
	// block connect: retry with the always-granted Login Kit identity
	// fields and leave the username empty.
	if isTikTokScopeDeniedCode(apiCode) {
		if degraded, _, fallbackErr := t.fetchTikTokProfile(ctx, accessToken, tiktokUserInfoBasicURL); fallbackErr == nil {
			if degraded.CapabilityState == nil {
				degraded.CapabilityState = map[string]string{}
			}
			degraded.CapabilityState[tiktokCapabilityStateDisplayProfile] = "unavailable"
			return degraded, nil
		}
	}
	return nil, err
}

func (t *TikTokAdapter) fetchTikTokProfile(ctx context.Context, accessToken, endpoint string) (*UserProfile, string, error) {
	respBody, err := DoRequest(ctx, "GET", endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, "", fmt.Errorf("tiktok profile: %w", err)
	}

	var profileResp struct {
		Data struct {
			User struct {
				OpenID      string `json:"open_id"`
				DisplayName string `json:"display_name"`
				Username    string `json:"username"`
				AvatarURL   string `json:"avatar_url"`
			} `json:"user"`
		} `json:"data"`
		Error tiktokAPIError `json:"error"`
	}
	if err := json.Unmarshal(respBody, &profileResp); err != nil {
		return nil, "", fmt.Errorf("decoding tiktok profile: %w", err)
	}
	if code := strings.TrimSpace(profileResp.Error.Code); code != "" && code != "ok" {
		return nil, code, profileResp.Error.err("tiktok profile")
	}
	if profileResp.Data.User.OpenID == "" {
		return nil, "", fmt.Errorf("tiktok profile: missing open_id")
	}

	username := firstNonEmptyString(profileResp.Data.User.Username, profileResp.Data.User.DisplayName)
	return &UserProfile{
		ID:          profileResp.Data.User.OpenID,
		Username:    username,
		DisplayName: profileResp.Data.User.DisplayName,
		AvatarURL:   profileResp.Data.User.AvatarURL,
	}, "", nil
}

func (t *TikTokAdapter) UploadMedia(_ context.Context, _ string, _ string, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("tiktok direct post requires publicly accessible HTTPS media URLs")
}

func (t *TikTokAdapter) UploadMediaWithMetadata(ctx context.Context, accessToken, _ string, req UploadMediaRequest) (string, error) {
	if !isTikTokUploadMode(req.Settings) {
		return "", fmt.Errorf("tiktok file upload is available for Upload/Inbox mode only")
	}
	if !isVideoMime(req.MimeType) {
		return "", fmt.Errorf("tiktok file upload supports video attachments only")
	}
	data, err := io.ReadAll(req.Reader)
	if err != nil {
		return "", fmt.Errorf("reading tiktok upload media: %w", err)
	}
	if len(data) == 0 {
		return "", fmt.Errorf("tiktok file upload requires non-empty media")
	}
	return t.uploadVideoFileToInbox(ctx, accessToken, req.MimeType, data)
}

func (t *TikTokAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	result, err := executePublishWrite(req, "submit_post", func() (string, error) {
		return t.publish(ctx, accessToken, req)
	})
	var pending *tiktokPendingError
	if errors.As(err, &pending) {
		return pending.result, nil
	}
	return result, err
}

func (t *TikTokAdapter) publish(ctx context.Context, accessToken string, req *PublishRequest) (string, error) {
	if len(req.PlatformMediaIDs) == 0 || len(req.PlatformMediaIDs) != len(req.Media) {
		return "", fmt.Errorf("tiktok publishing requires media URLs and metadata")
	}
	if err := validateTikTokPublicMediaURLs(req.PlatformMediaIDs); err != nil {
		return "", err
	}
	if req.Profile == "carousel" || allTikTokMediaImages(req.Media) {
		return t.publishPhotoPost(ctx, accessToken, req)
	}
	if len(req.Media) != 1 || !isVideoMime(req.Media[0].MimeType) {
		return "", fmt.Errorf("tiktok video publishing requires exactly one video attachment")
	}
	postingMethod, err := tiktokPostingMethod(req.Settings)
	if err != nil {
		return "", err
	}
	if postingMethod == "UPLOAD" {
		return t.publishInboxVideoFromURL(ctx, accessToken, req.PlatformMediaIDs[0], req)
	}
	return t.publishDirectVideoFromURL(ctx, accessToken, req)
}

func (t *TikTokAdapter) publishDirectVideoFromURL(ctx context.Context, accessToken string, req *PublishRequest) (string, error) {
	if settingInt(req.Settings, "cover_timestamp_ms") < 0 {
		return "", fmt.Errorf("tiktok cover timestamp must be non-negative")
	}
	privacyLevel, err := t.privacyLevel(ctx, accessToken, req.Settings)
	if err != nil {
		return "", err
	}

	payload := map[string]any{
		"post_info": map[string]any{
			"title":                tiktokTitle(req.Content),
			"privacy_level":        privacyLevel,
			"disable_duet":         !settingBool(req.Settings, "duet"),
			"disable_comment":      !settingBool(req.Settings, "comment"),
			"disable_stitch":       !settingBool(req.Settings, "stitch"),
			"brand_content_toggle": settingBool(req.Settings, "brand_content_toggle"),
			"brand_organic_toggle": settingBool(req.Settings, "brand_organic_toggle"),
			"is_aigc":              settingBool(req.Settings, "is_aigc"),
		},
		"source_info": map[string]any{
			"source":    "PULL_FROM_URL",
			"video_url": req.PlatformMediaIDs[0],
		},
		"post_mode": "DIRECT_POST",
	}
	if settingString(req.Settings, "cover_timestamp_ms") != "" {
		coverTimestamp := settingInt(req.Settings, "cover_timestamp_ms")
		payload["post_info"].(map[string]any)["video_cover_timestamp_ms"] = coverTimestamp
	}

	respBody, err := DoJSON(ctx, "POST", tiktokVideoInitURL, payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return "", fmt.Errorf("tiktok video init: %w", err)
	}

	var initResp struct {
		Data struct {
			PublishID string `json:"publish_id"`
		} `json:"data"`
		Error tiktokAPIError `json:"error"`
	}
	if err := json.Unmarshal(respBody, &initResp); err != nil {
		return "", fmt.Errorf("decoding tiktok video init: %w", err)
	}
	if err := initResp.Error.err("tiktok video init"); err != nil {
		return "", err
	}
	if initResp.Data.PublishID == "" {
		return "", fmt.Errorf("tiktok video init: missing publish_id")
	}
	if err := checkpointTikTokSubmission(req, initResp.Data.PublishID); err != nil {
		return "", err
	}

	return t.waitForPublishID(ctx, accessToken, initResp.Data.PublishID, req)
}

func validateTikTokPublicMediaURLs(mediaURLs []string) error {
	for _, mediaURL := range mediaURLs {
		parsed, err := url.Parse(mediaURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
			return fmt.Errorf("tiktok requires a publicly-accessible HTTPS media URL. Set OPENPOST_MEDIA_URL to your public media base URL")
		}
	}
	return nil
}

func (t *TikTokAdapter) publishInboxVideoFromURL(ctx context.Context, accessToken, mediaURL string, req *PublishRequest) (string, error) {
	payload := map[string]any{
		"source_info": map[string]any{
			"source":    "PULL_FROM_URL",
			"video_url": mediaURL,
		},
	}
	return t.initInboxVideo(ctx, accessToken, payload, req)
}

func (t *TikTokAdapter) uploadVideoFileToInbox(ctx context.Context, accessToken, mimeType string, data []byte) (string, error) {
	videoSize := int64(len(data))
	chunkSize, totalChunks := tiktokUploadChunks(videoSize)
	payload := map[string]any{
		"source_info": map[string]any{
			"source":            "FILE_UPLOAD",
			"video_size":        videoSize,
			"chunk_size":        chunkSize,
			"total_chunk_count": totalChunks,
		},
	}

	publishID, uploadURL, err := t.initInboxVideoUpload(ctx, accessToken, payload)
	if err != nil {
		return "", err
	}
	if uploadURL == "" {
		return "", fmt.Errorf("tiktok inbox video init: missing upload_url")
	}
	for index := range totalChunks {
		start := index * chunkSize
		end := start + chunkSize
		if index == totalChunks-1 {
			end = videoSize
		}
		chunk := data[start:end]
		headers := map[string]string{
			headerContentType: mimeType,
			"Content-Length":  strconv.FormatInt(int64(len(chunk)), 10),
			"Content-Range":   fmt.Sprintf("bytes %d-%d/%d", start, end-1, videoSize),
		}
		if _, err := DoRequest(ctx, http.MethodPut, uploadURL, bytes.NewReader(chunk), headers); err != nil {
			return "", fmt.Errorf("tiktok video chunk upload: %w", err)
		}
	}
	id, err := t.waitForPublishID(ctx, accessToken, publishID, nil)
	var pending *tiktokPendingError
	if errors.As(err, &pending) && pending.result.ProviderState == "inbox_delivered" {
		return publishID, nil
	}
	return id, err
}

// tiktokUploadChunks splits a FILE_UPLOAD the way TikTok's Media Transfer
// Guide requires: total_chunk_count is video_size / chunk_size rounded down,
// the final chunk carries the trailing bytes, and a video over the chunk
// limit goes in several chunks. Spreading the bytes evenly over the fewest
// chunks keeps every chunk within the limit and the remainder smaller than
// the chunk count, so it never forms a chunk of its own.
func tiktokUploadChunks(videoSize int64) (chunkSize, totalChunks int64) {
	totalChunks = (videoSize + tiktokMaxChunkSize - 1) / tiktokMaxChunkSize
	return videoSize / totalChunks, totalChunks
}

func (t *TikTokAdapter) initInboxVideo(ctx context.Context, accessToken string, payload map[string]any, req *PublishRequest) (string, error) {
	publishID, _, err := t.initInboxVideoUpload(ctx, accessToken, payload)
	if err != nil {
		return "", err
	}
	if err := checkpointTikTokSubmission(req, publishID); err != nil {
		return "", err
	}
	return t.waitForPublishID(ctx, accessToken, publishID, req)
}

func (t *TikTokAdapter) initInboxVideoUpload(ctx context.Context, accessToken string, payload map[string]any) (string, string, error) {
	respBody, err := DoJSON(ctx, http.MethodPost, tiktokVideoInboxInitURL, payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return "", "", fmt.Errorf("tiktok inbox video init: %w", err)
	}
	var initResp struct {
		Data struct {
			PublishID string `json:"publish_id"`
			UploadURL string `json:"upload_url"`
		} `json:"data"`
		Error tiktokAPIError `json:"error"`
	}
	if err := json.Unmarshal(respBody, &initResp); err != nil {
		return "", "", fmt.Errorf("decoding tiktok inbox video init: %w", err)
	}
	if err := initResp.Error.err("tiktok inbox video init"); err != nil {
		return "", "", err
	}
	if initResp.Data.PublishID == "" {
		return "", "", fmt.Errorf("tiktok inbox video init: missing publish_id")
	}
	return initResp.Data.PublishID, initResp.Data.UploadURL, nil
}

func (t *TikTokAdapter) publishPhotoPost(ctx context.Context, accessToken string, req *PublishRequest) (string, error) {
	if len(req.PlatformMediaIDs) < 1 || len(req.PlatformMediaIDs) > 35 {
		return "", fmt.Errorf("tiktok photo posts require 1-35 images")
	}
	if !allTikTokPhotoImages(req.Media) {
		return "", fmt.Errorf("tiktok photo posts support JPEG or WebP images only")
	}
	postingMethod, err := tiktokPostingMethod(req.Settings)
	if err != nil {
		return "", err
	}
	title := settingString(req.Settings, "photo_title")
	description := strings.TrimSpace(req.Content)
	if utf16Length(title) > 90 {
		return "", fmt.Errorf("tiktok photo titles support at most 90 UTF-16 code units")
	}
	if utf16Length(description) > 4000 {
		return "", fmt.Errorf("tiktok photo descriptions support at most 4000 UTF-16 code units")
	}
	postInfo := map[string]any{
		"title":       title,
		"description": description,
	}
	payload := map[string]any{
		"post_info": postInfo,
		"source_info": map[string]any{
			"source":       "PULL_FROM_URL",
			"photo_images": req.PlatformMediaIDs,
		},
		"post_mode":  "DIRECT_POST",
		"media_type": "PHOTO",
	}
	if coverIndex := settingInt(req.Settings, "cover_index"); coverIndex >= 0 {
		payload["source_info"].(map[string]any)["photo_cover_index"] = coverIndex
	}
	if postingMethod == "UPLOAD" {
		payload["post_mode"] = "MEDIA_UPLOAD"
	} else {
		privacyLevel, err := t.privacyLevel(ctx, accessToken, req.Settings)
		if err != nil {
			return "", err
		}
		postInfo["privacy_level"] = privacyLevel
		postInfo["disable_comment"] = !settingBool(req.Settings, "comment")
		postInfo["auto_add_music"] = settingBool(req.Settings, "auto_add_music")
		postInfo["brand_content_toggle"] = settingBool(req.Settings, "brand_content_toggle")
		postInfo["brand_organic_toggle"] = settingBool(req.Settings, "brand_organic_toggle")
	}
	respBody, err := DoJSON(ctx, "POST", tiktokContentInitURL, payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return "", fmt.Errorf("tiktok photo init: %w", err)
	}
	var initResp struct {
		Data struct {
			PublishID string `json:"publish_id"`
		} `json:"data"`
		Error tiktokAPIError `json:"error"`
	}
	if err := json.Unmarshal(respBody, &initResp); err != nil {
		return "", fmt.Errorf("decoding tiktok photo init: %w", err)
	}
	if err := initResp.Error.err("tiktok photo init"); err != nil {
		return "", err
	}
	if initResp.Data.PublishID == "" {
		return "", fmt.Errorf("tiktok photo init: missing publish_id")
	}
	if err := checkpointTikTokSubmission(req, initResp.Data.PublishID); err != nil {
		return "", err
	}
	return t.waitForPublishID(ctx, accessToken, initResp.Data.PublishID, req)
}

func checkpointTikTokSubmission(req *PublishRequest, publishID string) error {
	return req.Checkpoint(PublishResult{
		SubmissionState: PublishSubmissionPending,
		ProviderState:   "processing", ProviderReference: publishID,
		RetrySafety: PublishRetryReconcileOnly, ReconcileAfter: 30 * time.Second,
	})
}

func (t *TikTokAdapter) ReconcilePublish(ctx context.Context, accessToken, accountID, reference string) (PublishResult, error) {
	return t.ReconcilePublishRequest(ctx, accessToken, accountID, nil, reference)
}

func (t *TikTokAdapter) ReconcilePublishRequest(ctx context.Context, accessToken, _ string, req *PublishRequest, reference string) (PublishResult, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return PublishResult{}, fmt.Errorf("tiktok publish reconciliation requires a publish id")
	}
	id, err := t.waitForPublishID(ctx, accessToken, reference, req)
	var pending *tiktokPendingError
	if errors.As(err, &pending) {
		return pending.result, nil
	}
	if err != nil {
		result := pendingTikTokResult(reference, "processing")
		var providerErr *HTTPError
		if errors.As(err, &providerErr) && strings.HasPrefix(providerErr.Code, "tiktok_publish_failed:") {
			result.SubmissionState = PublishSubmissionRejected
			result.RetrySafety = PublishRetryNever
			result.ProviderState = "failed"
		}
		return result, err
	}
	result := AcceptedPublishResult(id)
	result.ProviderState = "complete"
	result.ProviderReference = reference
	return result, nil
}

type tiktokPendingError struct{ result PublishResult }

func (e *tiktokPendingError) Error() string {
	return "TikTok publication awaits " + e.result.ProviderState
}
func pendingTikTokResult(reference, state string) PublishResult {
	delay := time.Minute
	if state == "inbox_delivered" {
		delay = 15 * time.Minute
	}
	return PublishResult{SubmissionState: PublishSubmissionPending, ProviderState: state, ProviderReference: reference, RetrySafety: PublishRetryReconcileOnly, ReconcileAfter: delay}
}
func pendingTikTokPublication(req *PublishRequest, reference, state string) (string, error) {
	result := pendingTikTokResult(reference, state)
	if err := req.Checkpoint(result); err != nil {
		return "", err
	}
	return "", &tiktokPendingError{result: result}
}

func (t *TikTokAdapter) privacyLevel(ctx context.Context, accessToken string, settings map[string]interface{}) (string, error) {
	requested := settingString(settings, "privacy_level")
	if requested == "" {
		return "", fmt.Errorf("tiktok creator info: privacy_level must be selected explicitly")
	}
	creatorInfo, err := t.loadCreatorInfo(ctx, accessToken)
	if err != nil {
		return "", err
	}
	for _, option := range creatorInfo.PrivacyLevelOptions {
		if option == requested {
			return requested, nil
		}
	}
	return "", fmt.Errorf("tiktok creator info: privacy level %s is not available for this creator", requested)
}

type tiktokCreatorInfo struct {
	PrivacyLevelOptions []string `json:"privacy_level_options"`
	MaxVideoDurationSec int      `json:"max_video_post_duration_sec"`
	DuetDisabled        bool     `json:"duet_disabled"`
	StitchDisabled      bool     `json:"stitch_disabled"`
	CommentDisabled     bool     `json:"comment_disabled"`
}

func (t *TikTokAdapter) loadCreatorInfo(ctx context.Context, accessToken string) (tiktokCreatorInfo, error) {
	respBody, err := DoJSON(ctx, "POST", tiktokCreatorInfoURL, map[string]any{}, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return tiktokCreatorInfo{}, fmt.Errorf("tiktok creator info: %w", err)
	}

	var creatorResp struct {
		Data  tiktokCreatorInfo `json:"data"`
		Error tiktokAPIError    `json:"error"`
	}
	if err := json.Unmarshal(respBody, &creatorResp); err != nil {
		return tiktokCreatorInfo{}, fmt.Errorf("decoding tiktok creator info: %w", err)
	}
	if err := creatorResp.Error.err("tiktok creator info"); err != nil {
		return tiktokCreatorInfo{}, err
	}
	return creatorResp.Data, nil
}

func (t *TikTokAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, input AccountCapabilityInput) (AccountCapabilityResult, error) {
	if isTikTokUploadMode(input.Settings) {
		return AccountCapabilityResult{
			Revision: "tiktok-upload-v1",
		}, nil
	}
	info, err := t.loadCreatorInfo(ctx, accessToken)
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	privacy := make([]DestinationOption, 0, len(info.PrivacyLevelOptions))
	for _, option := range info.PrivacyLevelOptions {
		privacy = append(privacy, DestinationOption{Value: option, Label: strings.ReplaceAll(strings.ToLower(option), "_", " ")})
	}
	return AccountCapabilityResult{
		Revision: "tiktok-creator-info-v1",
		Options: map[string][]DestinationOption{
			"tiktok_privacy_levels": privacy,
		},
		CompleteOptionSources: []string{"tiktok_privacy_levels"},
		Constraints: map[string]interface{}{
			"max_video_duration_seconds": info.MaxVideoDurationSec,
		},
		AvailableFeatures: map[string]bool{
			"duet":    !info.DuetDisabled,
			"stitch":  !info.StitchDisabled,
			"comment": !info.CommentDisabled,
		},
	}, nil
}

func allTikTokMediaImages(media []MediaItem) bool {
	if len(media) == 0 {
		return false
	}
	for _, item := range media {
		if !strings.HasPrefix(strings.ToLower(item.MimeType), "image/") {
			return false
		}
	}
	return true
}

func (t *TikTokAdapter) waitForPublishID(ctx context.Context, accessToken, publishID string, req *PublishRequest) (string, error) {
	body, err := DoJSON(ctx, http.MethodPost, tiktokPublishStatusURL, map[string]any{"publish_id": publishID}, map[string]string{headerAuthorization: bearerPrefix + accessToken})
	if err != nil {
		return "", fmt.Errorf("tiktok publish status: %w", err)
	}
	var response tiktokPublishStatusResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decoding tiktok publish status: %w", err)
	}
	if err := response.Error.err("tiktok publish status"); err != nil {
		return "", err
	}
	switch response.Data.Status {
	case "PUBLISH_COMPLETE":
		return t.completedPublishID(publishID, req, response)
	case "SEND_TO_USER_INBOX":
		return pendingTikTokPublication(req, publishID, "inbox_delivered")
	case platformStatusFailed:
		code := firstSafeProviderCode([]any{response.Data.FailReason})
		if code == "" {
			code = "unknown"
		}
		return "", &HTTPError{StatusCode: http.StatusBadRequest, Code: "tiktok_publish_failed:" + code}
	default:
		return pendingTikTokPublication(req, publishID, "processing")
	}
}

// TikTok documents numeric int64 IDs but also returns string IDs. Decode each
// directly, without a floating-point conversion that could change the post ID.
type tiktokPostIDs []string

func (ids *tiktokPostIDs) UnmarshalJSON(data []byte) error {
	var values []json.RawMessage
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	decoded := make(tiktokPostIDs, 0, len(values))
	for _, value := range values {
		var id string
		if len(value) > 0 && value[0] == '"' {
			if err := json.Unmarshal(value, &id); err != nil {
				return err
			}
		} else {
			if string(value) == "null" {
				return fmt.Errorf("tiktok public post ID cannot be null")
			}
			var number int64
			if err := json.Unmarshal(value, &number); err != nil {
				return err
			}
			id = strconv.FormatInt(number, 10)
		}
		decoded = append(decoded, id)
	}
	*ids = decoded
	return nil
}

type tiktokPublishStatusResponse struct {
	Data struct {
		Status                   string        `json:"status"`
		PubliclyAvailablePostID  tiktokPostIDs `json:"publicly_available_post_id"`
		PublicalyAvailablePostID tiktokPostIDs `json:"publicaly_available_post_id"` //nolint:misspell
		FailReason               string        `json:"fail_reason"`
	} `json:"data"`
	Error tiktokAPIError `json:"error"`
}

// Public identities must come from TikTok's publish-status receipt. Captions
// and nearby timestamps cannot prove which public post belongs to this upload.
func (t *TikTokAdapter) completedPublishID(publishID string, req *PublishRequest, statusResp tiktokPublishStatusResponse) (string, error) {
	if ids := firstNonEmptyStringSlice(statusResp.Data.PubliclyAvailablePostID, statusResp.Data.PublicalyAvailablePostID); len(ids) > 0 {
		return ids[0], nil
	}
	if req != nil && settingString(req.Settings, "privacy_level") == "SELF_ONLY" {
		return publishID, nil
	}
	return pendingTikTokPublication(req, publishID, "published_unresolved")
}

func validateTikTokMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return []MediaValidationIssue{{
			Provider: providerTikTok,
			Severity: severityError,
			Message:  "TikTok publishing requires media.",
		}}
	}
	if len(media) == 1 && isVideoMime(media[0].MimeType) {
		if isTikTokVideoMime(media[0].MimeType) {
			return nil
		}
		return []MediaValidationIssue{{
			Provider: providerTikTok,
			MediaID:  media[0].ID,
			Severity: severityError,
			Message:  "TikTok video publishing supports MP4, MOV, or WebM video.",
		}}
	}
	if allTikTokMediaImages(media) {
		if len(media) > 35 {
			return []MediaValidationIssue{{
				Provider: providerTikTok,
				Severity: severityError,
				Message:  "TikTok photo posts support 1-35 images.",
			}}
		}
		for _, item := range media {
			if isTikTokPhotoMime(item.MimeType) {
				continue
			}
			return []MediaValidationIssue{{
				Provider: providerTikTok,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "TikTok photo posts support JPEG or WebP images only.",
			}}
		}
		return nil
	}
	if !isVideoMime(media[0].MimeType) {
		return []MediaValidationIssue{{
			Provider: providerTikTok,
			MediaID:  media[0].ID,
			Severity: severityError,
			Message:  "TikTok publishing supports one video or an image photo post.",
		}}
	}
	return []MediaValidationIssue{{
		Provider: providerTikTok,
		Severity: severityError,
		Message:  "TikTok publishing supports one MP4, MOV, or WebM video, or 1-35 JPEG or WebP images.",
	}}
}

func allTikTokPhotoImages(media []MediaItem) bool {
	if len(media) == 0 {
		return false
	}
	for _, item := range media {
		if !isTikTokPhotoMime(item.MimeType) {
			return false
		}
	}
	return true
}

func isTikTokPhotoMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/webp":
		return true
	default:
		return false
	}
}

func isTikTokVideoMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case videoTypeMP4, "video/quicktime", "video/webm":
		return true
	default:
		return false
	}
}

// TikTok OAuth scope names. The Login Kit identity scope and the Content
// Posting scopes are required for publishing; the Display API scopes are
// optional and degrade gracefully when the TikTok app lacks approval.
const (
	tiktokScopeUserInfoBasic   = "user.info.basic"
	tiktokScopeUserInfoProfile = "user.info.profile"
	tiktokScopeUserInfoStats   = "user.info.stats"
	tiktokScopeVideoList       = "video.list"
	tiktokScopeVideoPublish    = "video.publish"
	tiktokScopeVideoUpload     = "video.upload"
)

// TikTokScopeCapabilities selects which TikTok capability families an
// installation authorizes. Publishing needs the identity scope plus the
// Content Posting scope of every enabled posting mode; the Display API
// families (profile enrichment, analytics, discovery) are optional. TikTok
// no longer offers Display API to new apps, so the minimal publishing set
// must keep connect and publish working on its own.
type TikTokScopeCapabilities struct {
	DirectPost  bool
	InboxUpload bool
	Profile     bool
	Analytics   bool
	Discovery   bool
}

// TikTokDefaultScopeCapabilities enables every TikTok capability family. It
// preserves the historical authorization request for installations whose
// TikTok app already holds Display API approval.
func TikTokDefaultScopeCapabilities() TikTokScopeCapabilities {
	return TikTokScopeCapabilities{
		DirectPost:  true,
		InboxUpload: true,
		Profile:     true,
		Analytics:   true,
		Discovery:   true,
	}
}

// TikTokMinimalScopeCapabilities enables publishing only: the Login Kit
// identity scope plus both Content Posting scopes. The posting method is
// chosen per post at publish time, so the installation must authorize both
// Direct Post and inbox upload up front.
func TikTokMinimalScopeCapabilities() TikTokScopeCapabilities {
	return TikTokScopeCapabilities{
		DirectPost:  true,
		InboxUpload: true,
	}
}

// WithoutDisplayAPI clears the Display API families while keeping
// publishing intact, for TikTok apps without Display API approval.
func (c TikTokScopeCapabilities) WithoutDisplayAPI() TikTokScopeCapabilities {
	c.Profile = false
	c.Analytics = false
	c.Discovery = false
	return c
}

// Scopes builds the deterministic OAuth scope list for the capability set.
func (c TikTokScopeCapabilities) Scopes() []string {
	scopes := []string{tiktokScopeUserInfoBasic}
	if c.Profile {
		scopes = append(scopes, tiktokScopeUserInfoProfile)
	}
	if c.Analytics {
		scopes = append(scopes, tiktokScopeUserInfoStats)
	}
	if c.Analytics || c.Discovery {
		scopes = append(scopes, tiktokScopeVideoList)
	}
	if c.DirectPost {
		scopes = append(scopes, tiktokScopeVideoPublish)
	}
	if c.InboxUpload {
		scopes = append(scopes, tiktokScopeVideoUpload)
	}
	return scopes
}

// TikTokRequiredPublishingScopes is the minimal scope set that keeps TikTok
// connect and publish working without Display API approval.
func TikTokRequiredPublishingScopes() []string {
	return TikTokMinimalScopeCapabilities().Scopes()
}

// TikTokOptionalDisplayScopes lists the Display API scopes that enrich the
// profile (username), account analytics, and video discovery/reconciliation.
// Their absence degrades those features instead of blocking connect.
func TikTokOptionalDisplayScopes() []string {
	return []string{
		tiktokScopeUserInfoProfile,
		tiktokScopeUserInfoStats,
		tiktokScopeVideoList,
	}
}

type tiktokAPIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	LogID   string `json:"log_id"`
}

func (e tiktokAPIError) err(label string) error {
	if e.Code == "" || e.Code == "ok" {
		return nil
	}
	status := http.StatusBadRequest
	switch e.Code {
	case "server_error", "temporarily_unavailable", "internal_error":
		status = http.StatusServiceUnavailable
	case "rate_limit_exceeded":
		status = http.StatusTooManyRequests
	case "invalid_grant", "access_token_invalid", "invalid_token":
		status = http.StatusUnauthorized
	case "scope_not_authorized", "scope_permission_missed", "invalid_client":
		status = http.StatusForbidden
	}
	code := firstSafeProviderCode([]any{e.Code})
	if code == "" {
		code = "tiktok_error"
	}
	return fmt.Errorf("%s: %w", label, &HTTPError{StatusCode: status, Code: code, TraceID: firstSafeProviderCode([]any{e.LogID})})
}

// tiktokCapabilityStateDisplayProfile marks a connected account whose TikTok
// grant lacks the Display API profile scope. The username stays empty while
// connect, publish, and preflight continue on the Login Kit identity scope.
const tiktokCapabilityStateDisplayProfile = "tiktok_display_profile"

// TikTokScopeError reports a TikTok request rejected for a missing grant,
// such as the Display API video.list scope on an app without approval.
// Callers degrade the dependent feature instead of failing the operation.
type TikTokScopeError struct {
	Code      string
	Operation string
}

func (e *TikTokScopeError) Error() string {
	return fmt.Sprintf("tiktok %s: missing authorized scope (%s)", e.Operation, e.Code)
}

// isTikTokScopeDeniedCode reports the TikTok Content Posting API codes for a
// missing grant. A publish-time 401 with these codes is a scope gap, not a
// dead token, and must stay a degradable failure.
func isTikTokScopeDeniedCode(code string) bool {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "scope_not_authorized", "scope_permission_missed":
		return true
	default:
		return false
	}
}

func tiktokTitle(content string) string {
	title := strings.TrimSpace(content)
	return truncateUTF16(title, tiktokTitleMaxUnits)
}

func utf16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}

func truncateUTF16(value string, limit int) string {
	if limit <= 0 || value == "" {
		return ""
	}
	units := 0
	runes := []rune(value)
	for index, character := range runes {
		next := utf16.RuneLen(character)
		if next < 0 {
			next = 1
		}
		if units+next > limit {
			return string(runes[:index])
		}
		units += next
	}
	return value
}

func isTikTokUploadMode(settings map[string]interface{}) bool {
	mode := strings.ToUpper(strings.TrimSpace(settingString(settings, "content_posting_method")))
	return mode == "UPLOAD" || mode == "MEDIA_UPLOAD"
}

func tiktokPostingMethod(settings map[string]interface{}) (string, error) {
	mode := strings.ToUpper(strings.TrimSpace(settingString(settings, "content_posting_method")))
	switch mode {
	case "DIRECT_POST":
		return mode, nil
	case "UPLOAD", "MEDIA_UPLOAD":
		return "UPLOAD", nil
	default:
		return "", fmt.Errorf("tiktok publishing requires an explicit posting method")
	}
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstNonEmptyStringSlice(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}
