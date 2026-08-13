package platform

import (
	"bytes"
	"context"
	"encoding/json"
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
	tiktokCreatorInfoURL    = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
	tiktokVideoInitURL      = "https://open.tiktokapis.com/v2/post/publish/video/init/"
	tiktokVideoInboxInitURL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
	tiktokContentInitURL    = "https://open.tiktokapis.com/v2/post/publish/content/init/"
	tiktokPublishStatusURL  = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
	tiktokTitleMaxUnits     = 2200
	tiktokMaxChunkSize      = 64 * 1024 * 1024
)

type TikTokAdapter struct {
	clientKey    string
	clientSecret string
	redirectURI  string
}

func NewTikTokAdapter(clientKey, clientSecret, redirectURI string) *TikTokAdapter {
	return &TikTokAdapter{
		clientKey:    clientKey,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
	}
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
	params.Set("scope", strings.Join(tiktokScopes(), ","))
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
		return nil, fmt.Errorf("%s: %s", label, firstNonEmptyString(tokenResp.Description, tokenResp.Error))
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
	respBody, err := DoRequest(ctx, "GET", tiktokUserInfoURL, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("tiktok profile: %w", err)
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
		return nil, fmt.Errorf("decoding tiktok profile: %w", err)
	}
	if err := profileResp.Error.err("tiktok profile"); err != nil {
		return nil, err
	}
	if profileResp.Data.User.OpenID == "" {
		return nil, fmt.Errorf("tiktok profile: missing open_id")
	}

	username := firstNonEmptyString(profileResp.Data.User.Username, profileResp.Data.User.DisplayName)
	return &UserProfile{
		ID:          profileResp.Data.User.OpenID,
		Username:    username,
		DisplayName: profileResp.Data.User.DisplayName,
	}, nil
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
	return executePublishWrite(req, "submit_post", func() (string, error) {
		return t.publish(ctx, accessToken, req)
	})
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
	if coverTimestamp := settingInt(req.Settings, "cover_timestamp_ms"); coverTimestamp > 0 {
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

	return t.waitForPublishID(ctx, accessToken, initResp.Data.PublishID)
}

func validateTikTokPublicMediaURLs(mediaURLs []string) error {
	for _, mediaURL := range mediaURLs {
		if !strings.HasPrefix(mediaURL, "https://") {
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
	chunkSize := videoSize
	if chunkSize > tiktokMaxChunkSize {
		chunkSize = tiktokMaxChunkSize
	}
	totalChunks := (videoSize + chunkSize - 1) / chunkSize
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
	for start := int64(0); start < videoSize; start += chunkSize {
		end := start + chunkSize
		if end > videoSize {
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
	return t.waitForPublishID(ctx, accessToken, publishID)
}

func (t *TikTokAdapter) initInboxVideo(ctx context.Context, accessToken string, payload map[string]any, req *PublishRequest) (string, error) {
	publishID, _, err := t.initInboxVideoUpload(ctx, accessToken, payload)
	if err != nil {
		return "", err
	}
	if err := checkpointTikTokSubmission(req, publishID); err != nil {
		return "", err
	}
	return t.waitForPublishID(ctx, accessToken, publishID)
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
	return t.waitForPublishID(ctx, accessToken, initResp.Data.PublishID)
}

func checkpointTikTokSubmission(req *PublishRequest, publishID string) error {
	return req.Checkpoint(PublishResult{
		SubmissionState: PublishSubmissionPending,
		ProviderState:   "processing", ProviderReference: publishID,
		RetrySafety: PublishRetryReconcileOnly, ReconcileAfter: 30 * time.Second,
	})
}

func (t *TikTokAdapter) ReconcilePublish(ctx context.Context, accessToken, _ string, providerReference string) (PublishResult, error) {
	providerReference = strings.TrimSpace(providerReference)
	if providerReference == "" {
		return PublishResult{}, fmt.Errorf("tiktok publish reconciliation requires a publish id")
	}
	externalID, err := t.waitForPublishID(ctx, accessToken, providerReference)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "publish failed") {
			return PublishResult{
				SubmissionState: PublishSubmissionRejected,
				ProviderState:   "failed", ProviderReference: providerReference,
				RetrySafety: PublishRetryNever,
			}, err
		}
		return PublishResult{
			SubmissionState: PublishSubmissionPending,
			ProviderState:   "processing", ProviderReference: providerReference,
			RetrySafety: PublishRetryReconcileOnly, ReconcileAfter: time.Minute,
		}, err
	}
	result := AcceptedPublishResult(externalID)
	result.ProviderState = "complete"
	result.ProviderReference = providerReference
	return result, nil
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

func (t *TikTokAdapter) waitForPublishID(ctx context.Context, accessToken, publishID string) (string, error) {
	const maxAttempts = 6
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		respBody, err := DoJSON(ctx, "POST", tiktokPublishStatusURL, map[string]any{
			"publish_id": publishID,
		}, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return "", fmt.Errorf("tiktok publish status: %w", err)
		}

		var statusResp struct {
			Data struct {
				Status                   string   `json:"status"`
				PubliclyAvailablePostID  []string `json:"publicly_available_post_id"`
				PublicalyAvailablePostID []string `json:"publicaly_available_post_id"` //nolint:misspell
				FailReason               string   `json:"fail_reason"`
			} `json:"data"`
			Error tiktokAPIError `json:"error"`
		}
		if err := json.Unmarshal(respBody, &statusResp); err != nil {
			return "", fmt.Errorf("decoding tiktok publish status: %w", err)
		}
		if err := statusResp.Error.err("tiktok publish status"); err != nil {
			return "", err
		}

		switch statusResp.Data.Status {
		case "PUBLISH_COMPLETE":
			if ids := firstNonEmptyStringSlice(statusResp.Data.PubliclyAvailablePostID, statusResp.Data.PublicalyAvailablePostID); len(ids) > 0 {
				return ids[0], nil
			}
			return publishID, nil
		case "SEND_TO_USER_INBOX":
			return publishID, nil
		case platformStatusFailed:
			return "", fmt.Errorf("tiktok publish failed: %s", firstNonEmptyString(statusResp.Data.FailReason, "unknown reason"))
		}

		if attempt < maxAttempts {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(10 * time.Second):
			}
		}
	}

	return publishID, nil
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
			Message:  "TikTok video publishing supports MP4 or MOV video.",
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
		Message:  "TikTok publishing supports one MP4 or MOV video, or 1-35 JPEG or WebP images.",
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
	case videoTypeMP4, "video/quicktime":
		return true
	default:
		return false
	}
}

func tiktokScopes() []string {
	return []string{
		"user.info.basic",
		"user.info.profile",
		"user.info.stats",
		"video.list",
		"video.publish",
		"video.upload",
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
	message := firstNonEmptyString(e.Message, e.Code)
	if e.LogID != "" {
		return fmt.Errorf("%s: %s (log_id=%s)", label, message, e.LogID)
	}
	return fmt.Errorf("%s: %s", label, message)
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
