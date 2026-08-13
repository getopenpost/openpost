package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dghubble/oauth1"
)

type XAdapter struct {
	consumerKey    string
	consumerSecret string
	redirectURI    string
	apiBaseURL     string
	uploadBaseURL  string
	requestStore   XRequestStore
	requestMeta    sync.Map
	cleanupDone    chan struct{}
}

const (
	xDefaultAPIBaseURL               = "https://api.twitter.com"
	xDefaultUploadBaseURL            = "https://upload.twitter.com"
	XCapabilityStateSubscriptionType = "x_subscription_type"
	XSubscriptionTypeUnknown         = "Unknown"
	XSubscriptionTypeNone            = "None"
	XSubscriptionTypeBasic           = "Basic"
	XSubscriptionTypePremium         = "Premium"
	XSubscriptionTypePremiumPlus     = "PremiumPlus"
	XStandardTextLimit               = 280
	XPremiumTextLimit                = 25_000
	XStandardVideoDurationSeconds    = 140
	XPremiumVideoDurationSeconds     = 4 * 60 * 60
	XStandardVideoSizeBytes          = 512 * 1024 * 1024
	XPremiumVideoSizeBytes           = 16 * 1024 * 1024 * 1024
	XCapabilityStateFreshness        = 24 * time.Hour
	xAccountCapabilityRevision       = "x-subscription-type.2026-07-26"
	xMediaUploadChunkSize            = 5 * 1024 * 1024
)

type XRequestStore interface {
	Save(requestToken, requestSecret, workspaceID, userID, executionIntent string, createdAt time.Time) error
	Consume(requestToken string, maxAge time.Duration) (XRequestMeta, bool, error)
}

type XRequestMeta struct {
	Secret          string
	WorkspaceID     string
	UserID          string
	ExecutionIntent string
	CreatedAt       time.Time
}

func NewXAdapter(clientID, clientSecret, redirectURI string) *XAdapter {
	x := &XAdapter{
		consumerKey:    clientID,
		consumerSecret: clientSecret,
		redirectURI:    redirectURI,
		apiBaseURL:     xDefaultAPIBaseURL,
		uploadBaseURL:  xDefaultUploadBaseURL,
		cleanupDone:    make(chan struct{}),
	}
	go x.cleanupLoop()
	return x
}

func (x *XAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     x.consumerKey,
		ExecutionMode: "oauth1",
		Evidence:      map[string]string{"protocol": "oauth1", "exchange": "request_token_verifier"},
	}
}

func (x *XAdapter) SetRequestStore(store XRequestStore) {
	x.requestStore = store
}

func (x *XAdapter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-x.cleanupDone:
			return
		case <-ticker.C:
			x.purgeOldEntries()
		}
	}
}

func (x *XAdapter) purgeOldEntries() {
	const maxAge = 10 * time.Minute
	now := time.Now()

	x.requestMeta.Range(func(key, value any) bool {
		meta, ok := value.(XRequestMeta)
		if !ok {
			return true
		}
		if now.Sub(meta.CreatedAt) > maxAge {
			x.requestMeta.Delete(key)
		}
		return true
	})
}

func (x *XAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	authURL, err := x.GenerateAuthURLWithError("", state)
	if err != nil {
		return "", nil
	}
	return authURL, nil
}

func (x *XAdapter) GenerateAuthURLWithError(userID, workspaceID string) (string, error) {
	return x.GenerateAuthURLWithIntent(userID, workspaceID, "production")
}

func (x *XAdapter) GenerateAuthURLWithIntent(userID, workspaceID, executionIntent string) (string, error) {
	callback := x.redirectURI

	config := oauth1.Config{
		ConsumerKey:    x.consumerKey,
		ConsumerSecret: x.consumerSecret,
		CallbackURL:    callback,
		Endpoint: oauth1.Endpoint{
			RequestTokenURL: "https://api.twitter.com/oauth/request_token",
			AuthorizeURL:    "https://api.twitter.com/oauth/authorize",
			AccessTokenURL:  "https://api.twitter.com/oauth/access_token",
		},
	}

	requestToken, requestSecret, err := config.RequestToken()
	if err != nil {
		return "", fmt.Errorf("x oauth1 request token failed: %w", err)
	}
	meta := XRequestMeta{
		Secret:          requestSecret,
		WorkspaceID:     workspaceID,
		UserID:          userID,
		ExecutionIntent: executionIntent,
		CreatedAt:       time.Now().UTC(),
	}
	if x.requestStore != nil {
		if saveErr := x.requestStore.Save(requestToken, meta.Secret, meta.WorkspaceID, meta.UserID, meta.ExecutionIntent, meta.CreatedAt); saveErr != nil {
			return "", fmt.Errorf("x oauth1 request token persist failed: %w", saveErr)
		}
	} else {
		x.requestMeta.Store(requestToken, meta)
	}

	authURL, err := config.AuthorizationURL(requestToken)
	if err != nil {
		return "", fmt.Errorf("x oauth1 authorization url failed: %w", err)
	}

	return authURL.String(), nil
}

func (x *XAdapter) GetWorkspaceIDForRequestToken(requestToken string) (string, bool) {
	meta, ok := x.GetRequestMetaForRequestToken(requestToken)
	return meta.WorkspaceID, ok
}

func (x *XAdapter) GetRequestMetaForRequestToken(requestToken string) (XRequestMeta, bool) {
	if x.requestStore != nil {
		meta, ok, err := x.requestStore.Consume(requestToken, 10*time.Minute)
		if err != nil || !ok {
			return XRequestMeta{}, false
		}
		// Re-store for subsequent token exchange call in same request path.
		x.requestMeta.Store(requestToken, meta)
		return meta, true
	}

	metaRaw, ok := x.requestMeta.Load(requestToken)
	if !ok {
		return XRequestMeta{}, false
	}
	meta := metaRaw.(XRequestMeta)
	return meta, true
}

func (x *XAdapter) ExchangeCode(_ context.Context, _ string, extra map[string]string) (*TokenResult, error) {
	oauthToken := extra["oauth_token"]
	oauthVerifier := extra["oauth_verifier"]
	if oauthToken == "" || oauthVerifier == "" {
		return nil, fmt.Errorf("missing oauth_token or oauth_verifier for X token exchange")
	}

	var (
		meta XRequestMeta
		ok   bool
	)

	if x.requestStore != nil {
		consumed, found, err := x.requestStore.Consume(oauthToken, 10*time.Minute)
		if err != nil {
			return nil, fmt.Errorf("x oauth1 request token lookup failed: %w", err)
		}
		if found {
			meta = consumed
			ok = true
		} else if metaRaw, found := x.requestMeta.Load(oauthToken); found {
			meta = metaRaw.(XRequestMeta)
			x.requestMeta.Delete(oauthToken)
			ok = true
		}
	} else {
		metaRaw, found := x.requestMeta.Load(oauthToken)
		if !found {
			return nil, fmt.Errorf("missing request token secret for oauth_token")
		}
		meta = metaRaw.(XRequestMeta)
		x.requestMeta.Delete(oauthToken)
		ok = true
	}

	if !ok {
		return nil, fmt.Errorf("missing request token secret for oauth_token")
	}
	requestSecret := meta.Secret

	config := oauth1.Config{
		ConsumerKey:    x.consumerKey,
		ConsumerSecret: x.consumerSecret,
		Endpoint: oauth1.Endpoint{
			RequestTokenURL: "https://api.twitter.com/oauth/request_token",
			AuthorizeURL:    "https://api.twitter.com/oauth/authorize",
			AccessTokenURL:  "https://api.twitter.com/oauth/access_token",
		},
	}

	accessToken, accessSecret, err := config.AccessToken(oauthToken, requestSecret, oauthVerifier)
	if err != nil {
		return nil, fmt.Errorf("x oauth1 access token exchange failed: %w", err)
	}

	combined := accessToken + "|" + accessSecret
	resultExtra := map[string]string{}
	if meta.WorkspaceID != "" {
		resultExtra["_workspace_id"] = meta.WorkspaceID
	}
	if meta.UserID != "" {
		resultExtra["_user_id"] = meta.UserID
	}

	return &TokenResult{
		AccessToken: combined,
		TokenType:   "OAuth1",
		Extra:       resultExtra,
	}, nil
}

func (x *XAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        false,
		CredentialSource: RefreshCredentialNone,
	}
}

func (x *XAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("x oauth1 tokens do not support refresh")
}

func (x *XAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	user, err := x.getAuthenticatedUser(ctx, accessToken, true)
	if err != nil {
		// Keep account connection compatible with X API plans that do not
		// return subscription_type. Capability resolution will fail closed.
		user, err = x.getAuthenticatedUser(ctx, accessToken, false)
	}
	if err != nil {
		return nil, err
	}

	return &UserProfile{
		ID:          user.ID,
		Username:    user.Username,
		DisplayName: user.Name,
		CapabilityState: map[string]string{
			XCapabilityStateSubscriptionType: normalizeXSubscriptionType(user.SubscriptionType),
		},
	}, nil
}

type xAuthenticatedUser struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Username         string `json:"username"`
	SubscriptionType string `json:"subscription_type"`
}

func (x *XAdapter) getAuthenticatedUser(ctx context.Context, accessToken string, includeSubscription bool) (xAuthenticatedUser, error) {
	fields := "id,name,username"
	if includeSubscription {
		fields += ",subscription_type"
	}
	endpoint := x.apiURL("/2/users/me") + "?user.fields=" + url.QueryEscape(fields)
	respBody, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return xAuthenticatedUser{}, err
	}

	var userResp struct {
		Data xAuthenticatedUser `json:"data"`
	}
	if err := json.Unmarshal(respBody, &userResp); err != nil {
		return xAuthenticatedUser{}, fmt.Errorf("decoding X profile: %w", err)
	}
	if strings.TrimSpace(userResp.Data.ID) == "" {
		return xAuthenticatedUser{}, fmt.Errorf("x profile response did not include an account id")
	}
	return userResp.Data, nil
}

func (x *XAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, _ AccountCapabilityInput) (AccountCapabilityResult, error) {
	user, err := x.getAuthenticatedUser(ctx, accessToken, true)
	if err != nil {
		return AccountCapabilityResult{}, fmt.Errorf("checking X subscription: %w", err)
	}
	return XPublishingCapabilities(user.SubscriptionType), nil
}

func XPublishingCapabilities(subscriptionType string) AccountCapabilityResult {
	subscriptionType = normalizeXSubscriptionType(subscriptionType)
	textLimit := XStandardTextLimit
	videoDurationSeconds := XStandardVideoDurationSeconds
	videoSizeBytes := int64(XStandardVideoSizeBytes)
	if XSubscriptionHasPremiumLimits(subscriptionType) {
		textLimit = XPremiumTextLimit
		videoDurationSeconds = XPremiumVideoDurationSeconds
		videoSizeBytes = XPremiumVideoSizeBytes
	}
	return AccountCapabilityResult{
		Revision: xAccountCapabilityRevision,
		Constraints: map[string]interface{}{
			"text_limit":                 textLimit,
			"max_video_duration_seconds": videoDurationSeconds,
			"max_video_size_bytes":       videoSizeBytes,
		},
		State: map[string]string{
			XCapabilityStateSubscriptionType: subscriptionType,
		},
	}
}

func XSubscriptionHasPremiumLimits(subscriptionType string) bool {
	switch normalizeXSubscriptionType(subscriptionType) {
	case XSubscriptionTypeBasic, XSubscriptionTypePremium, XSubscriptionTypePremiumPlus:
		return true
	default:
		return false
	}
}

func XStoredCapabilityHasPremiumLimits(stateJSON string, checkedAt, now time.Time) bool {
	age := now.Sub(checkedAt)
	if checkedAt.IsZero() || age < -5*time.Minute || age > XCapabilityStateFreshness {
		return false
	}
	state := map[string]string{}
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return false
	}
	return XSubscriptionHasPremiumLimits(state[XCapabilityStateSubscriptionType])
}

func normalizeXSubscriptionType(subscriptionType string) string {
	switch strings.ToLower(strings.TrimSpace(subscriptionType)) {
	case "none":
		return XSubscriptionTypeNone
	case "basic":
		return XSubscriptionTypeBasic
	case "premium":
		return XSubscriptionTypePremium
	case "premiumplus", "premium_plus", "premium+":
		return XSubscriptionTypePremiumPlus
	default:
		return XSubscriptionTypeUnknown
	}
}

func (x *XAdapter) apiURL(path string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(x.apiBaseURL), "/")
	if baseURL == "" {
		baseURL = xDefaultAPIBaseURL
	}
	return baseURL + "/" + strings.TrimLeft(path, "/")
}

func (x *XAdapter) uploadURL(path string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(x.uploadBaseURL), "/")
	if baseURL == "" {
		baseURL = xDefaultUploadBaseURL
	}
	return baseURL + "/" + strings.TrimLeft(path, "/")
}

func (x *XAdapter) UploadMedia(ctx context.Context, accessToken, _ string, mimeType string, reader io.Reader) (string, error) {
	tempFile, err := os.CreateTemp("", "openpost-x-media-*")
	if err != nil {
		return "", fmt.Errorf("creating temporary X media file: %w", err)
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}()

	totalBytes, err := io.Copy(tempFile, reader)
	if err != nil {
		return "", fmt.Errorf("buffering X media upload: %w", err)
	}
	if _, err := tempFile.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("rewinding X media upload: %w", err)
	}
	return x.UploadMediaWithMetadata(ctx, accessToken, "", UploadMediaRequest{
		MimeType: mimeType,
		Size:     totalBytes,
		Reader:   tempFile,
	})
}

func (x *XAdapter) UploadMediaWithMetadata(ctx context.Context, accessToken, _ string, req UploadMediaRequest) (string, error) {
	if req.Reader == nil {
		return "", fmt.Errorf("x media reader is required")
	}
	if req.Size <= 0 {
		return "", fmt.Errorf("x media size must be known before upload")
	}

	mimeType := strings.TrimSpace(req.MimeType)
	normalizedMIMEType := strings.ToLower(mimeType)
	isVideo := strings.Contains(normalizedMIMEType, "video")
	isGIF := strings.Contains(normalizedMIMEType, "gif")

	mediaCategory := "tweet_image"
	if isVideo {
		mediaCategory = "tweet_video"
	} else if isGIF {
		mediaCategory = "tweet_gif"
	}

	if req.Size <= xMediaUploadChunkSize && !isVideo && !isGIF {
		data, err := io.ReadAll(io.LimitReader(req.Reader, req.Size+1))
		if err != nil {
			return "", fmt.Errorf("reading X image: %w", err)
		}
		if int64(len(data)) != req.Size {
			return "", fmt.Errorf("x image size changed before upload")
		}
		return x.uploadMediaSimple(ctx, accessToken, data, mediaCategory)
	}

	return x.uploadMediaChunked(ctx, accessToken, mimeType, mediaCategory, req.Reader, req.Size)
}

func (x *XAdapter) uploadMediaSimple(ctx context.Context, accessToken string, data []byte, mediaCategory string) (string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("media_category", mediaCategory); err != nil {
		return "", fmt.Errorf("writing media_category: %w", err)
	}
	part, err := writer.CreateFormFile("media", "upload.bin")
	if err != nil {
		return "", fmt.Errorf("creating media form file: %w", err)
	}
	if _, writeErr := part.Write(data); writeErr != nil {
		return "", fmt.Errorf("writing media content: %w", writeErr)
	}
	if closeErr := writer.Close(); closeErr != nil {
		return "", fmt.Errorf("closing multipart writer: %w", closeErr)
	}

	respBody, err := x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/upload.json"), &body, map[string]string{
		headerContentType: writer.FormDataContentType(),
	})
	if err != nil {
		return "", err
	}

	var result struct {
		MediaIDString string `json:"media_id_string"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decoding X media response: %w", err)
	}
	if result.MediaIDString == "" {
		return "", fmt.Errorf("missing media_id_string in X response")
	}
	return result.MediaIDString, nil
}

func (x *XAdapter) uploadMediaChunked(ctx context.Context, accessToken, mimeType, mediaCategory string, reader io.Reader, totalBytes int64) (string, error) {
	initValues := url.Values{}
	initValues.Set("command", "INIT")
	initValues.Set("total_bytes", strconv.FormatInt(totalBytes, 10))
	initValues.Set("media_type", mimeType)
	initValues.Set("media_category", mediaCategory)

	respBody, err := x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/upload.json"), strings.NewReader(initValues.Encode()), map[string]string{
		headerContentType: contentTypeForm,
	})
	if err != nil {
		return "", fmt.Errorf("x INIT failed: %w", err)
	}

	var initResp struct {
		MediaIDString  string                `json:"media_id_string"`
		ProcessingInfo *xMediaProcessingInfo `json:"processing_info"`
	}
	if unmarshalErr := json.Unmarshal(respBody, &initResp); unmarshalErr != nil {
		return "", fmt.Errorf("decoding X INIT: %w", unmarshalErr)
	}
	if initResp.MediaIDString == "" {
		return "", fmt.Errorf("missing media_id_string in X INIT")
	}
	mediaID := initResp.MediaIDString

	segmentIndex := 0
	remaining := totalBytes
	chunk := make([]byte, xMediaUploadChunkSize)
	for remaining > 0 {
		chunkBytes := int64(len(chunk))
		if remaining < chunkBytes {
			chunkBytes = remaining
		}
		n, readErr := io.ReadFull(reader, chunk[:chunkBytes])
		if readErr != nil {
			return "", fmt.Errorf("reading X media segment %d: %w", segmentIndex, readErr)
		}

		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("command", "APPEND")
		_ = writer.WriteField("media_id", mediaID)
		_ = writer.WriteField("segment_index", strconv.Itoa(segmentIndex))
		part, createErr := writer.CreateFormFile("media", "chunk.bin")
		if createErr != nil {
			return "", fmt.Errorf("x APPEND create form file: %w", createErr)
		}
		if _, writeErr := part.Write(chunk[:n]); writeErr != nil {
			return "", fmt.Errorf("x APPEND write segment %d: %w", segmentIndex, writeErr)
		}
		if closeErr := writer.Close(); closeErr != nil {
			return "", fmt.Errorf("x APPEND close writer: %w", closeErr)
		}

		_, err = x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/upload.json"), &body, map[string]string{
			headerContentType: writer.FormDataContentType(),
		})
		if err != nil {
			return "", fmt.Errorf("x APPEND segment %d: %w", segmentIndex, err)
		}
		segmentIndex++
		remaining -= int64(n)
	}

	finalizeValues := url.Values{}
	finalizeValues.Set("command", "FINALIZE")
	finalizeValues.Set("media_id", mediaID)

	respBody, err = x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/upload.json"), strings.NewReader(finalizeValues.Encode()), map[string]string{
		headerContentType: contentTypeForm,
	})
	if err != nil {
		return "", fmt.Errorf("x FINALIZE: %w", err)
	}

	var finalizeResp struct {
		ProcessingInfo *xMediaProcessingInfo `json:"processing_info"`
	}
	if err := json.Unmarshal(respBody, &finalizeResp); err != nil {
		return "", fmt.Errorf("decoding X FINALIZE: %w", err)
	}

	if finalizeResp.ProcessingInfo != nil {
		if err := x.waitForMediaProcessing(ctx, accessToken, mediaID, finalizeResp.ProcessingInfo); err != nil {
			return "", err
		}
	}

	return mediaID, nil
}

type xMediaProcessingInfo struct {
	State           string `json:"state"`
	CheckAfterSecs  int    `json:"check_after_secs"`
	ProgressPercent int    `json:"progress_percent"`
}

func (x *XAdapter) waitForMediaProcessing(ctx context.Context, accessToken, mediaID string, info *xMediaProcessingInfo) error {
	for info.State == "pending" || info.State == "in_progress" {
		if info.CheckAfterSecs > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(info.CheckAfterSecs) * time.Second):
			}
		}

		statusURL := x.uploadURL("/1.1/media/upload.json") + "?command=STATUS&media_id=" + url.QueryEscape(mediaID)
		respBody, err := x.doSignedRequest(ctx, accessToken, "GET", statusURL, nil, nil)
		if err != nil {
			return fmt.Errorf("x STATUS check: %w", err)
		}

		var statusResp struct {
			ProcessingInfo *xMediaProcessingInfo `json:"processing_info"`
		}
		if err := json.Unmarshal(respBody, &statusResp); err != nil {
			return fmt.Errorf("decoding X STATUS: %w", err)
		}

		if statusResp.ProcessingInfo == nil {
			return nil
		}
		*info = *statusResp.ProcessingInfo

		if info.State == "failed" {
			return fmt.Errorf("x media processing failed")
		}
	}

	if info.State == "succeeded" {
		return nil
	}
	return fmt.Errorf("x media processing unexpected state: %s", info.State)
}

func (x *XAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	return executePublishWrite(req, "create_tweet", func() (string, error) {
		return x.publish(ctx, accessToken, req)
	})
}

func (x *XAdapter) publish(ctx context.Context, accessToken string, req *PublishRequest) (string, error) {
	// Set alt text for each media before posting
	for i, mediaID := range req.PlatformMediaIDs {
		altText := ""
		if i < len(req.MediaAltTexts) {
			altText = req.MediaAltTexts[i]
		}
		if altText != "" {
			metaPayload := map[string]interface{}{
				"media_id": mediaID,
				"alt_text": map[string]string{
					jsonFieldText: altText,
				},
			}
			metaBody, err := jsonMarshal(metaPayload)
			if err != nil {
				return "", fmt.Errorf("marshaling X media metadata: %w", err)
			}
			_, err = x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/metadata/create.json"), bytes.NewReader(metaBody), map[string]string{
				headerContentType: contentTypeJSON,
			})
			if err != nil {
				return "", fmt.Errorf("setting X media alt text: %w", err)
			}
		}
	}

	payload, err := buildXTweetPayload(req)
	if err != nil {
		return "", err
	}
	body, err := jsonMarshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshaling X tweet payload: %w", err)
	}

	respBody, err := x.doSignedRequest(ctx, accessToken, "POST", x.apiURL("/2/tweets"), bytes.NewReader(body), map[string]string{
		headerContentType: contentTypeJSON,
	})
	if err != nil {
		return "", fmt.Errorf("posting to X: %w", err)
	}

	var result struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decoding X post response: %w", err)
	}

	return result.Data.ID, nil
}

func (x *XAdapter) Repost(ctx context.Context, accessToken, targetAccountID string, req RepostRequest) (RepostResult, error) {
	if strings.TrimSpace(targetAccountID) == "" || strings.TrimSpace(req.ExternalID) == "" {
		return RepostResult{}, fmt.Errorf("x repost requires a target account and source post id")
	}
	body, err := jsonMarshal(map[string]string{"tweet_id": req.ExternalID})
	if err != nil {
		return RepostResult{}, fmt.Errorf("marshaling X repost: %w", err)
	}
	_, err = x.doSignedRequest(
		ctx,
		accessToken,
		http.MethodPost,
		x.apiURL("/2/users/"+url.PathEscape(targetAccountID)+"/retweets"),
		bytes.NewReader(body),
		map[string]string{headerContentType: contentTypeJSON},
	)
	if err != nil {
		return RepostResult{}, fmt.Errorf("reposting on X: %w", err)
	}
	return RepostResult{ExternalID: req.ExternalID, ExternalURL: req.ExternalURL}, nil
}

func buildXTweetPayload(req *PublishRequest) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		jsonFieldText: ContentWithSettingURL(req.Content, req.Settings),
	}

	attachmentKinds := 0
	if len(req.PlatformMediaIDs) > 0 {
		attachmentKinds++
		payload["media"] = map[string]interface{}{
			"media_ids": req.PlatformMediaIDs,
		}
	}
	quoteTweetID, err := xQuoteTweetID(req.Settings)
	if err != nil {
		return nil, err
	}
	if quoteTweetID != "" {
		attachmentKinds++
		payload["quote_tweet_id"] = quoteTweetID
	}
	if poll := xPollPayload(req.Settings); poll != nil {
		attachmentKinds++
		payload["poll"] = poll
	}
	if attachmentKinds > 1 {
		return nil, fmt.Errorf("x post can include only one of media, poll, or quote tweet")
	}

	if req.ReplyToID != "" {
		payload["reply"] = map[string]interface{}{
			"in_reply_to_tweet_id": req.ReplyToID,
		}
	}
	if replySettings := settingString(req.Settings, "reply_settings"); replySettings != "" {
		if !validXReplySettings(replySettings) {
			return nil, fmt.Errorf("x reply_settings %q is not supported", replySettings)
		}
		payload["reply_settings"] = replySettings
	}
	if communityID := settingString(req.Settings, "community_id"); communityID != "" {
		payload["community_id"] = communityID
	}
	if locationID := settingString(req.Settings, "location_id"); locationID != "" {
		payload["geo"] = map[string]interface{}{"place_id": locationID}
	}
	if taggedUserIDs := xTaggedUserIDs(req.MediaSettings); len(taggedUserIDs) > 0 {
		mediaPayload, ok := payload["media"].(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("x tagged users require media")
		}
		mediaPayload["tagged_user_ids"] = taggedUserIDs
	}
	if settingBool(req.Settings, "paid_partnership") {
		payload["paid_partnership"] = true
	}
	if settingBool(req.Settings, "made_with_ai") {
		payload["made_with_ai"] = true
	}
	return payload, nil
}

func xQuoteTweetID(settings map[string]interface{}) (string, error) {
	if legacyID := settingString(settings, "quote_tweet_id"); legacyID != "" {
		return legacyID, nil
	}
	raw := settingString(settings, "quote_url")
	if raw == "" {
		return "", nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("x quote_url is invalid")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "x.com" && host != "twitter.com" && host != "www.x.com" && host != "www.twitter.com" {
		return "", fmt.Errorf("x quote_url must be an X post URL")
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for index := 0; index+1 < len(parts); index++ {
		if parts[index] != "status" {
			continue
		}
		if _, err := strconv.ParseUint(parts[index+1], 10, 64); err != nil {
			return "", fmt.Errorf("x quote_url contains an invalid post id")
		}
		return parts[index+1], nil
	}
	return "", fmt.Errorf("x quote_url must contain a status id")
}

func xTaggedUserIDs(mediaSettings []map[string]interface{}) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, settings := range mediaSettings {
		raw := settingString(settings, "tagged_users")
		for _, value := range strings.FieldsFunc(raw, func(r rune) bool {
			return r == ',' || r == '\n' || r == ' '
		}) {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			result = append(result, value)
		}
	}
	return result
}

func xPollPayload(settings map[string]interface{}) map[string]interface{} {
	options := xPollOptions(settings)
	if len(options) == 0 {
		return nil
	}
	duration := settingInt(settings, "poll_duration_minutes")
	if duration <= 0 {
		duration = 1440
	}
	return map[string]interface{}{
		"options":          options,
		"duration_minutes": duration,
	}
}

func xPollOptions(settings map[string]interface{}) []string {
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

func validXReplySettings(value string) bool {
	switch value {
	case "following", "mentionedUsers", "subscribers", "verified":
		return true
	default:
		return false
	}
}

func (x *XAdapter) doSignedRequest(ctx context.Context, combinedAccessToken, method, requestURL string, body io.Reader, headers map[string]string) ([]byte, error) {
	accessToken, accessSecret, err := splitXCombinedToken(combinedAccessToken)
	if err != nil {
		return nil, err
	}

	config := oauth1.NewConfig(x.consumerKey, x.consumerSecret)
	token := oauth1.NewToken(accessToken, accessSecret)
	client := config.Client(ctx, token)

	req, err := http.NewRequestWithContext(ctx, method, requestURL, body)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, NewHTTPError(resp.StatusCode, resp.Header, respBody)
	}

	return respBody, nil
}

func splitXCombinedToken(combined string) (string, string, error) {
	parts := strings.SplitN(combined, "|", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("x account requires OAuth 1.0a reconnect for media support")
	}
	return parts[0], parts[1], nil
}

func validateXMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}

	var videos int
	for _, item := range media {
		if isVideoMime(item.MimeType) {
			videos++
		}
	}

	if videos == 0 {
		if len(media) > 4 {
			return []MediaValidationIssue{{
				Provider: providerX,
				Severity: severityError,
				Message:  "X supports up to 4 images per post.",
			}}
		}
		return nil
	}

	if videos > 1 || len(media) > 1 {
		return []MediaValidationIssue{{
			Provider: providerX,
			Severity: severityError,
			Message:  "X supports one video per post and cannot mix video with images.",
		}}
	}
	if !strings.EqualFold(media[0].MimeType, videoTypeMP4) {
		return []MediaValidationIssue{{
			Provider: providerX,
			MediaID:  media[0].ID,
			Severity: severityWarning,
			Message:  "X video publishing is most reliable with MP4 video.",
		}}
	}
	return nil
}
