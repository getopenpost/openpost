package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

type ThreadsAdapter struct {
	config     *oauth2.Config
	stateStore sync.Map
}

func NewThreadsAdapter(clientID, clientSecret, redirectURI string) *ThreadsAdapter {
	return &ThreadsAdapter{
		config: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURI,
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://www.threads.com/oauth/authorize",
				TokenURL: "https://graph.threads.net/oauth/access_token",
			},
			Scopes: []string{
				"threads_basic",
				"threads_content_publish",
				"threads_manage_replies",
				"threads_manage_insights",
				"threads_location_tagging",
			},
		},
	}
}

func (t *ThreadsAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     t.config.ClientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code"},
	}
}

func (t *ThreadsAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	authURL := t.config.AuthCodeURL(state)

	parsedURL, err := url.Parse(authURL)
	if err == nil {
		generatedState := parsedURL.Query().Get("state")
		if generatedState != "" {
			t.stateStore.Store(generatedState, state)
		}
	}

	return authURL, nil
}

func (t *ThreadsAdapter) GetWorkspaceID(state string) (string, bool) {
	value, ok := t.stateStore.Load(state)
	if !ok {
		return "", false
	}
	return value.(string), true
}

func (t *ThreadsAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	values := map[string]string{
		oauthParamClientID:     t.config.ClientID,
		oauthParamClientSecret: t.config.ClientSecret,
		oauthParamRedirectURI:  t.config.RedirectURL,
		oauthParamCode:         code,
		grantType:              oauthGrantAuthCode,
	}

	respBody, err := DoFormURLEncoded(ctx, "POST", t.config.Endpoint.TokenURL, values, nil)
	if err != nil {
		return nil, fmt.Errorf("threads token exchange: %w", err)
	}

	var tokenResp struct {
		AccessToken string      `json:"access_token"`
		UserID      json.Number `json:"user_id"`
	}
	if unmarshalErr := json.Unmarshal(respBody, &tokenResp); unmarshalErr != nil {
		return nil, fmt.Errorf("decoding threads token: %w", unmarshalErr)
	}

	userID := tokenResp.UserID.String()

	longLived, err := t.exchangeLongLivedToken(ctx, tokenResp.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("threads long-lived exchange: %w", err)
	}
	longLived.Extra["user_id"] = userID

	return longLived, nil
}

func (t *ThreadsAdapter) exchangeLongLivedToken(ctx context.Context, shortLivedToken string) (*TokenResult, error) {
	params := url.Values{
		grantType:                            {"th_exchange_token"},
		oauthParamClientSecret:               {t.config.ClientSecret},
		string(RefreshCredentialAccessToken): {shortLivedToken},
	}

	respBody, err := DoRequest(ctx, "GET", "https://graph.threads.net/access_token?"+params.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("threads long-lived token: %w", err)
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding threads long-lived: %w", err)
	}

	return &TokenResult{
		AccessToken: tokenResp.AccessToken,
		ExpiresIn:   tokenResp.ExpiresIn,
		TokenType:   tokenTypeBearer,
		Extra: map[string]string{
			"scope": strings.Join(t.config.Scopes, " "),
		},
	}, nil
}

func (t *ThreadsAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        true,
		CredentialSource: RefreshCredentialAccessToken,
	}
}

func (t *ThreadsAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if input.AccessToken == "" {
		return nil, fmt.Errorf("threads refresh requires an access token")
	}

	params := url.Values{
		grantType:                            {"th_refresh_token"},
		string(RefreshCredentialAccessToken): {input.AccessToken},
	}

	respBody, err := DoRequest(ctx, "GET", "https://graph.threads.net/refresh_access_token?"+params.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("threads refresh: %w", err)
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding threads refresh: %w", err)
	}

	return &TokenResult{
		AccessToken: tokenResp.AccessToken,
		ExpiresIn:   tokenResp.ExpiresIn,
		TokenType:   tokenTypeBearer,
	}, nil
}

func (t *ThreadsAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	endpoint := "https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url"

	respBody, err := DoRequest(ctx, "GET", endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, err
	}

	var profile struct {
		ID                       string `json:"id"`
		Username                 string `json:"username"`
		Name                     string `json:"name"`
		ThreadsProfilePictureURL string `json:"threads_profile_picture_url"`
	}
	if err := json.Unmarshal(respBody, &profile); err != nil {
		return nil, fmt.Errorf("decoding threads profile: %w", err)
	}

	return &UserProfile{
		ID:          profile.ID,
		Username:    profile.Username,
		DisplayName: profile.Name,
		AvatarURL:   profile.ThreadsProfilePictureURL,
	}, nil
}

func (t *ThreadsAdapter) UploadMedia(_ context.Context, _ string, _ string, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("threads requires publicly accessible URLs, use the media serve URL directly")
}

func (t *ThreadsAdapter) Publish(ctx context.Context, accessToken, userID string, req *PublishRequest) (PublishResult, error) {
	return executePublishWrite(req, "publish_container", func() (string, error) {
		return t.publish(ctx, accessToken, userID, req)
	})
}

func (t *ThreadsAdapter) publish(ctx context.Context, accessToken, userID string, req *PublishRequest) (string, error) {
	if len(req.PlatformMediaIDs) != len(req.Media) {
		return "", fmt.Errorf("threads media publishing requires media metadata")
	}
	if len(req.PlatformMediaIDs) > 1 {
		if len(req.PlatformMediaIDs) > 20 {
			return "", fmt.Errorf("threads carousel requires 2-20 media items")
		}
		containerID, err := t.createCarouselContainer(ctx, accessToken, userID, req)
		if err != nil {
			return "", err
		}
		if err := t.waitForContainerReady(ctx, accessToken, containerID); err != nil {
			return "", err
		}
		return t.publishContainer(ctx, accessToken, userID, containerID)
	}

	isVideo := false
	var mediaURL string

	if len(req.PlatformMediaIDs) > 0 {
		mediaURL = req.PlatformMediaIDs[0]
		if len(req.Media) > 0 && isVideoMime(req.Media[0].MimeType) {
			isVideo = true
		}
	}

	containerID, err := t.createContainer(ctx, accessToken, userID, req.Content, mediaURL, isVideo, req)
	if err != nil {
		return "", err
	}

	if err := t.waitForContainerReady(ctx, accessToken, containerID); err != nil {
		return "", err
	}

	return t.publishContainer(ctx, accessToken, userID, containerID)
}

func (t *ThreadsAdapter) createCarouselContainer(ctx context.Context, accessToken, userID string, req *PublishRequest) (string, error) {
	childIDs := make([]string, 0, len(req.PlatformMediaIDs))
	for index, mediaURL := range req.PlatformMediaIDs {
		if !strings.HasPrefix(mediaURL, "https://") {
			return "", fmt.Errorf("threads requires a publicly-accessible HTTPS URL for media. Set OPENPOST_MEDIA_URL to your server's public HTTPS URL. Current url: %s", mediaURL)
		}
		payload := map[string]string{
			oauthParamAccessToken: accessToken,
			"is_carousel_item":    "true",
		}
		if settingBool(req.Settings, "spoiler") {
			payload["is_spoiler_media"] = "true"
		}
		if altText := mediaAltTextAt(req, index); altText != "" {
			payload["alt_text"] = altText
		}
		if isVideoMime(req.Media[index].MimeType) {
			payload["media_type"] = "VIDEO"
			payload["video_url"] = mediaURL
		} else {
			payload["media_type"] = "IMAGE"
			payload["image_url"] = mediaURL
		}
		childID, err := t.postContainer(ctx, userID, payload)
		if err != nil {
			return "", fmt.Errorf("threads carousel item %d: %w", index+1, err)
		}
		if err := t.waitForContainerReady(ctx, accessToken, childID); err != nil {
			return "", fmt.Errorf("threads carousel item %d: %w", index+1, err)
		}
		childIDs = append(childIDs, childID)
	}

	payload := map[string]string{
		jsonFieldText:         ContentWithSettingURL(req.Content, req.Settings),
		"media_type":          "CAROUSEL",
		"children":            strings.Join(childIDs, ","),
		oauthParamAccessToken: accessToken,
	}
	if req.ReplyToID != "" {
		payload["reply_to_id"] = req.ReplyToID
	}
	if err := applyThreadsSettings(payload, req); err != nil {
		return "", err
	}
	containerID, err := t.postContainer(ctx, userID, payload)
	if err != nil {
		return "", fmt.Errorf("threads carousel container: %w", err)
	}
	return containerID, nil
}

func (t *ThreadsAdapter) ListComments(ctx context.Context, accessToken, _ string, externalID string) ([]Comment, error) {
	fields := "id,text,username,timestamp,hide_status"
	endpoint := "https://graph.threads.net/v1.0/" + externalID + "/replies?fields=" + url.QueryEscape(fields) + "&access_token=" + url.QueryEscape(accessToken)
	respBody, err := DoRequest(ctx, "GET", endpoint, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("threads replies: %w", err)
	}
	var result struct {
		Data []struct {
			ID         string `json:"id"`
			Text       string `json:"text"`
			Username   string `json:"username"`
			Timestamp  string `json:"timestamp"`
			HideStatus string `json:"hide_status"`
		} `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding threads replies: %w", err)
	}
	if result.Error.Message != "" {
		return nil, fmt.Errorf("threads replies: %s", result.Error.Message)
	}

	comments := make([]Comment, 0, len(result.Data))
	for _, item := range result.Data {
		comments = append(comments, Comment{
			ID:         item.ID,
			AuthorName: item.Username,
			Text:       item.Text,
			CreatedAt:  item.Timestamp,
			Hidden:     strings.EqualFold(item.HideStatus, "HIDDEN"),
			CanReply:   true,
			CanHide:    true,
		})
	}
	return comments, nil
}

func (t *ThreadsAdapter) ResolveContentURL(ctx context.Context, accessToken, _ string, externalID string) (string, error) {
	query := url.Values{
		"fields":              {"permalink"},
		oauthParamAccessToken: {accessToken},
	}
	endpoint := "https://graph.threads.net/v1.0/" + url.PathEscape(externalID) + "?" + query.Encode()
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return "", fmt.Errorf("threads post permalink: %w", err)
	}
	var response struct {
		Permalink string `json:"permalink"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decoding threads post permalink: %w", err)
	}
	if strings.TrimSpace(response.Permalink) == "" {
		return "", fmt.Errorf("threads post permalink is missing")
	}
	return response.Permalink, nil
}

func (t *ThreadsAdapter) ReplyToComment(ctx context.Context, accessToken, userID, commentID, message string) (string, error) {
	req := &PublishRequest{Content: strings.TrimSpace(message), ReplyToID: commentID}
	containerID, err := t.createContainer(ctx, accessToken, userID, req.Content, "", false, req)
	if err != nil {
		return "", err
	}
	if err := t.waitForContainerReady(ctx, accessToken, containerID); err != nil {
		return "", err
	}
	return t.publishContainer(ctx, accessToken, userID, containerID)
}

func (t *ThreadsAdapter) HideComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := DoFormURLEncoded(ctx, "POST", "https://graph.threads.net/v1.0/"+commentID+"/manage_reply", map[string]string{
		"hide":                "true",
		oauthParamAccessToken: accessToken,
	}, nil)
	if err != nil {
		return fmt.Errorf("threads hide reply: %w", err)
	}
	return nil
}

func (t *ThreadsAdapter) DeleteComment(context.Context, string, string, string) error {
	return fmt.Errorf("threads delete reply: %w", ErrUnsupportedCommentAction)
}

func (t *ThreadsAdapter) waitForContainerReady(ctx context.Context, accessToken, containerID string) error {
	const (
		maxAttempts = 10
		pollDelay   = 3 * time.Second
	)

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		statusURL := "https://graph.threads.net/v1.0/" + containerID + "?fields=status,error_message"

		respBody, err := DoRequest(ctx, "GET", statusURL, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			if attempt == maxAttempts {
				return fmt.Errorf("threads container status check: %w", err)
			}
		} else {
			var statusResp struct {
				Status       string `json:"status"`
				ErrorMessage string `json:"error_message"`
			}
			if unmarshalErr := json.Unmarshal(respBody, &statusResp); unmarshalErr == nil {
				switch statusResp.Status {
				case "FINISHED", "PUBLISHED":
					return nil
				case "ERROR", "EXPIRED", platformStatusFailed:
					if statusResp.ErrorMessage != "" {
						return fmt.Errorf("threads container not publishable: %s", statusResp.ErrorMessage)
					}
					return fmt.Errorf("threads container not publishable: status=%s", statusResp.Status)
				}
			}
		}

		if attempt < maxAttempts {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(pollDelay):
			}
		}
	}

	return fmt.Errorf("threads container not ready after %d attempts", maxAttempts)
}

func (t *ThreadsAdapter) createContainer(ctx context.Context, accessToken, userID, content, mediaURL string, isVideo bool, req *PublishRequest) (string, error) {
	payload := map[string]string{
		jsonFieldText:         content,
		oauthParamAccessToken: accessToken,
	}

	if mediaURL != "" {
		if !strings.HasPrefix(mediaURL, "https://") {
			return "", fmt.Errorf("threads requires a publicly-accessible HTTPS URL for media. "+
				"Set OPENPOST_MEDIA_URL to your server's public HTTPS URL (e.g. https://yourdomain.com/media). "+
				"Current url: %s", mediaURL)
		}
		if isVideo {
			payload["media_type"] = "VIDEO"
			payload["video_url"] = mediaURL
		} else {
			payload["media_type"] = "IMAGE"
			payload["image_url"] = mediaURL
		}
	} else {
		payload["media_type"] = "TEXT"
	}

	if req.ReplyToID != "" {
		payload["reply_to_id"] = req.ReplyToID
	}
	if settingBool(req.Settings, "spoiler") {
		payload["is_spoiler_media"] = "true"
	}
	if altText := mediaAltTextAt(req, 0); altText != "" {
		payload["alt_text"] = altText
	}
	if err := applyThreadsSettings(payload, req); err != nil {
		return "", err
	}

	containerID, err := t.postContainer(ctx, userID, payload)
	if err != nil {
		if req.ReplyToID != "" && strings.Contains(err.Error(), `"code":10`) {
			return "", fmt.Errorf("threads container creation (reply permission/check root ownership): %w", err)
		}
		return "", fmt.Errorf("threads container creation: %w", err)
	}
	return containerID, nil
}

func applyThreadsSettings(payload map[string]string, req *PublishRequest) error {
	if err := applyThreadsReplyControl(payload, req.Settings); err != nil {
		return err
	}
	if topicTag := settingString(req.Settings, "topic_tag"); topicTag != "" {
		payload["topic_tag"] = topicTag
	}
	if locationID := settingString(req.Settings, "location_id"); locationID != "" {
		payload["location_id"] = locationID
	}
	if linkAttachment := firstNonEmptyString(settingString(req.Settings, "url"), settingString(req.Settings, "link_attachment")); linkAttachment != "" {
		if len(req.PlatformMediaIDs) > 0 {
			return fmt.Errorf("threads link attachments require a text post")
		}
		payload["link_attachment"] = linkAttachment
	}
	if settingBool(req.Settings, "ghost_post") {
		payload["is_ghost_post"] = "true"
	}
	if settingBool(req.Settings, "reply_approvals") {
		payload["enable_reply_approvals"] = "true"
	}

	options := separatedSettingValues(req.Settings, "poll_options")
	textAttachment := settingString(req.Settings, "text_attachment_plaintext")
	textAttachmentLink := settingString(req.Settings, "text_attachment_link_url")
	gifID := settingString(req.Settings, "gif_id")
	if err := applyThreadsTextAttachment(payload, req, options, textAttachment, textAttachmentLink, gifID); err != nil {
		return err
	}
	if err := applyThreadsGIFAttachment(payload, req, options, textAttachment, gifID); err != nil {
		return err
	}
	return applyThreadsPollAttachment(payload, req, options)
}

func applyThreadsReplyControl(payload map[string]string, settings map[string]any) error {
	replyControl := settingString(settings, "reply_control")
	if replyControl == "" {
		return nil
	}
	switch replyControl {
	case "everyone", "accounts_you_follow", "mentioned_only", "parent_post_author_only", "followers_only":
		payload["reply_control"] = replyControl
		return nil
	default:
		return fmt.Errorf("threads reply_control %q is not supported", replyControl)
	}
}

func applyThreadsTextAttachment(
	payload map[string]string,
	req *PublishRequest,
	options []string,
	textAttachment string,
	textAttachmentLink string,
	gifID string,
) error {
	if textAttachmentLink != "" && textAttachment == "" {
		return fmt.Errorf("threads text attachment links require text attachment content")
	}
	if textAttachment == "" {
		return nil
	}
	if len([]rune(textAttachment)) > 10000 {
		return fmt.Errorf("threads text attachments support at most 10000 characters")
	}
	if len(req.PlatformMediaIDs) > 0 {
		return fmt.Errorf("threads text attachments require a text-only post")
	}
	if len(options) > 0 || payload["link_attachment"] != "" || gifID != "" {
		return fmt.Errorf("threads text attachments cannot be combined with polls, link attachments, or GIFs")
	}
	attachment := map[string]string{"plaintext": textAttachment}
	if textAttachmentLink != "" {
		attachment["link_attachment_url"] = textAttachmentLink
	}
	encoded, err := json.Marshal(attachment)
	if err != nil {
		return fmt.Errorf("encoding threads text attachment: %w", err)
	}
	payload["text_attachment"] = string(encoded)
	return nil
}

func applyThreadsGIFAttachment(
	payload map[string]string,
	req *PublishRequest,
	options []string,
	textAttachment string,
	gifID string,
) error {
	if gifID == "" {
		return nil
	}
	if len(req.PlatformMediaIDs) > 0 {
		return fmt.Errorf("threads GIF attachments require a text-only post")
	}
	if len(options) > 0 || payload["link_attachment"] != "" || textAttachment != "" {
		return fmt.Errorf("threads GIF attachments cannot be combined with polls, link attachments, or text attachments")
	}
	encoded, err := json.Marshal(map[string]string{"gif_id": gifID, "provider": "GIPHY"})
	if err != nil {
		return fmt.Errorf("encoding threads GIF attachment: %w", err)
	}
	payload["gif_attachment"] = string(encoded)
	return nil
}

func applyThreadsPollAttachment(payload map[string]string, req *PublishRequest, options []string) error {
	if len(options) == 0 {
		return nil
	}
	if len(req.PlatformMediaIDs) > 0 {
		return fmt.Errorf("threads polls cannot be combined with media")
	}
	if payload["link_attachment"] != "" {
		return fmt.Errorf("threads polls cannot be combined with a link attachment")
	}
	if len(options) < 2 || len(options) > 4 {
		return fmt.Errorf("threads polls require 2-4 options")
	}
	poll := map[string]string{}
	keys := []string{"option_a", "option_b", "option_c", "option_d"}
	for index, option := range options {
		if len([]rune(option)) > 25 {
			return fmt.Errorf("threads poll options support at most 25 characters")
		}
		poll[keys[index]] = option
	}
	encoded, err := json.Marshal(poll)
	if err != nil {
		return fmt.Errorf("encoding threads poll: %w", err)
	}
	payload["poll_attachment"] = string(encoded)
	return nil
}

func (t *ThreadsAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	if input.Source != "threads_locations" {
		return PublishingOptionsPage{}, fmt.Errorf("threads publishing option source %q is not supported", input.Source)
	}
	search := strings.TrimSpace(input.Search)
	if search == "" {
		return PublishingOptionsPage{}, nil
	}
	query := url.Values{
		oauthParamAccessToken: {accessToken},
		"fields":              {"id,name,address,city,country"},
		"q":                   {search},
	}
	if input.Cursor != "" {
		query.Set("after", input.Cursor)
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	query.Set("limit", strconv.Itoa(limit))
	body, err := DoRequest(ctx, http.MethodGet, "https://graph.threads.net/v1.0/location_search?"+query.Encode(), nil, nil)
	if err != nil {
		return PublishingOptionsPage{}, fmt.Errorf("searching Threads locations: %w", err)
	}
	var response struct {
		Data []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Address string `json:"address"`
			City    string `json:"city"`
			Country string `json:"country"`
		} `json:"data"`
		Paging struct {
			Cursors struct {
				After string `json:"after"`
			} `json:"cursors"`
		} `json:"paging"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return PublishingOptionsPage{}, fmt.Errorf("decoding Threads locations: %w", err)
	}
	page := PublishingOptionsPage{NextCursor: response.Paging.Cursors.After}
	for _, location := range response.Data {
		detail := strings.Trim(strings.Join([]string{location.City, location.Country}, ", "), ", ")
		label := location.Name
		if detail != "" {
			label += " · " + detail
		}
		page.Options = append(page.Options, DestinationOption{Value: location.ID, Label: label})
	}
	return page, nil
}

func separatedSettingValues(settings map[string]interface{}, key string) []string {
	raw := settingString(settings, key)
	values := strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' })
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func (t *ThreadsAdapter) postContainer(ctx context.Context, userID string, payload map[string]string) (string, error) {
	containerURL := "https://graph.threads.net/v1.0/" + userID + "/threads"
	respBody, err := DoFormURLEncoded(ctx, "POST", containerURL, payload, nil)
	if err != nil {
		return "", err
	}

	var containerResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &containerResp); err != nil {
		return "", fmt.Errorf("decoding threads container: %w", err)
	}
	if containerResp.ID == "" {
		return "", fmt.Errorf("decoding threads container: missing id")
	}
	return containerResp.ID, nil
}

func (t *ThreadsAdapter) publishContainer(ctx context.Context, accessToken, userID, creationID string) (string, error) {
	publishURL := "https://graph.threads.net/v1.0/" + userID + "/threads_publish"

	payload := map[string]string{
		"creation_id":         creationID,
		oauthParamAccessToken: accessToken,
	}

	var respBody []byte
	var err error
	const maxPublishAttempts = 5
	for attempt := 1; attempt <= maxPublishAttempts; attempt++ {
		respBody, err = DoFormURLEncoded(ctx, "POST", publishURL, payload, nil)
		if err == nil {
			break
		}

		// Threads may return code 24 briefly right after container creation/status=FINISHED.
		// Retry a few times with short backoff to handle propagation lag.
		if isThreadsPublishPropagationError(err) && attempt < maxPublishAttempts {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			}
			continue
		}

		return "", fmt.Errorf("threads publish: %w", err)
	}

	if err != nil {
		return "", fmt.Errorf("threads publish: %w", err)
	}

	var publishResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &publishResp); err != nil {
		return "", fmt.Errorf("decoding threads publish: %w", err)
	}

	return publishResp.ID, nil
}

func isThreadsPublishPropagationError(err error) bool {
	var providerErr *HTTPError
	return errors.As(err, &providerErr) && providerErr.Code == "24"
}

func validateThreadsMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	if len(media) > 20 {
		return []MediaValidationIssue{{
			Provider: providerThreads,
			Severity: severityError,
			Message:  "Threads supports up to 20 media attachments per post.",
		}}
	}

	var issues []MediaValidationIssue
	for _, item := range media {
		if isThreadsImageMime(item.MimeType) || isThreadsVideoMime(item.MimeType) {
			continue
		}
		if isVideoMime(item.MimeType) {
			issues = append(issues, MediaValidationIssue{
				Provider: providerThreads,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "Threads supports MP4 or MOV video.",
			})
			continue
		}
		issues = append(issues, MediaValidationIssue{
			Provider: providerThreads,
			MediaID:  item.ID,
			Severity: severityError,
			Message:  "Threads supports JPEG, PNG, WebP, MP4, or MOV media.",
		})
	}
	return issues
}

func isThreadsVideoMime(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	return mimeType == videoTypeMP4 || mimeType == "video/quicktime"
}

func isThreadsImageMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}
