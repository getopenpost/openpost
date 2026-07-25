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
	"os"
	"slices"
	"strings"
	"time"
)

const defaultLinkedInVersionLagMonths = 1
const linkedInVideoAvailabilityPolls = 30
const linkedInDocumentAvailabilityPolls = 30

func linkedInAPIVersion() string {
	if version := os.Getenv("LINKEDIN_API_VERSION"); version != "" {
		return version
	}

	// LinkedIn monthly versions are sometimes not active at the start of a month.
	// Default to previous month to avoid NONEXISTENT_VERSION failures.
	return time.Now().UTC().AddDate(0, -defaultLinkedInVersionLagMonths, 0).Format("200601")
}

type LinkedInAdapter struct {
	clientID             string
	clientSecret         string
	redirectURI          string
	disableThreadReplies bool
}

func NewLinkedInAdapter(clientID, clientSecret, redirectURI string, disableThreadReplies bool) *LinkedInAdapter {
	return &LinkedInAdapter{
		clientID:             clientID,
		clientSecret:         clientSecret,
		redirectURI:          redirectURI,
		disableThreadReplies: disableThreadReplies,
	}
}

func (l *LinkedInAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	scope := "openid profile w_member_social w_member_social_feed"
	if l.disableThreadReplies {
		scope = "openid profile w_member_social"
	}

	params := map[string]string{
		"response_type":       oauthResponseType,
		oauthParamClientID:    l.clientID,
		oauthParamRedirectURI: l.redirectURI,
		"scope":               scope,
		"state":               state,
	}
	return "https://www.linkedin.com/oauth/v2/authorization?" + encodeLinkedInAuthQuery(params), nil
}

func (l *LinkedInAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	values := map[string]string{
		grantType:              oauthGrantAuthCode,
		oauthParamCode:         code,
		oauthParamRedirectURI:  l.redirectURI,
		oauthParamClientID:     l.clientID,
		oauthParamClientSecret: l.clientSecret,
	}

	respBody, err := DoFormURLEncoded(ctx, "POST", "https://www.linkedin.com/oauth/v2/accessToken", values, nil)
	if err != nil {
		return nil, fmt.Errorf("linkedin token exchange: %w", err)
	}

	var tokenResp struct {
		AccessToken           string `json:"access_token"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshToken          string `json:"refresh_token"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding linkedin token: %w", err)
	}

	return &TokenResult{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresIn:    tokenResp.ExpiresIn,
		TokenType:    tokenTypeBearer,
	}, nil
}

func (l *LinkedInAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        true,
		CredentialSource: RefreshCredentialRefreshToken,
	}
}

func (l *LinkedInAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if input.RefreshToken == "" {
		return nil, fmt.Errorf("linkedin refresh requires a refresh token")
	}

	values := map[string]string{
		grantType:                             oauthGrantRefresh,
		string(RefreshCredentialRefreshToken): input.RefreshToken,
		oauthParamClientID:                    l.clientID,
		oauthParamClientSecret:                l.clientSecret,
	}

	respBody, err := DoFormURLEncoded(ctx, "POST", "https://www.linkedin.com/oauth/v2/accessToken", values, nil)
	if err != nil {
		return nil, fmt.Errorf("linkedin token refresh: %w", err)
	}

	var tokenResp struct {
		AccessToken           string `json:"access_token"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshToken          string `json:"refresh_token"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding linkedin refresh: %w", err)
	}

	return &TokenResult{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresIn:    tokenResp.ExpiresIn,
		TokenType:    tokenTypeBearer,
	}, nil
}

func (l *LinkedInAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	respBody, err := DoJSON(ctx, "GET", "https://api.linkedin.com/v2/userinfo", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, err
	}

	var profile struct {
		Sub       string `json:"sub"`
		Name      string `json:"name"`
		GivenName string `json:"given_name"`
	}
	if err := json.Unmarshal(respBody, &profile); err != nil {
		return nil, fmt.Errorf("decoding linkedin profile: %w", err)
	}

	return &UserProfile{
		ID:          profile.Sub,
		Username:    profile.GivenName,
		DisplayName: profile.Name,
	}, nil
}

func (l *LinkedInAdapter) UploadMedia(ctx context.Context, accessToken, personID, mimeType string, reader io.Reader) (string, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("reading media: %w", err)
	}

	isVideo := strings.Contains(mimeType, "video")

	if isVideo {
		return l.uploadVideo(ctx, accessToken, personID, mimeType, data)
	}
	if isLinkedInDocumentMime(mimeType) {
		return l.uploadDocument(ctx, accessToken, personID, data)
	}
	return l.uploadImage(ctx, accessToken, personID, mimeType, data)
}

func (l *LinkedInAdapter) uploadImage(ctx context.Context, accessToken, personID, _ string, data []byte) (string, error) {
	apiVersion := linkedInAPIVersion()

	registerPayload := map[string]interface{}{
		"initializeUploadRequest": map[string]interface{}{
			"owner": "urn:li:person:" + personID,
		},
	}

	respBody, err := DoJSON(ctx, "POST", "https://api.linkedin.com/rest/images?action=initializeUpload", registerPayload, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return "", fmt.Errorf("linkedin image register: %w", err)
	}

	return l.completeImageUpload(ctx, accessToken, respBody, data)
}

func (l *LinkedInAdapter) uploadVideo(ctx context.Context, accessToken, personID, _ string, data []byte) (string, error) {
	apiVersion := linkedInAPIVersion()

	registerPayload := map[string]interface{}{
		"initializeUploadRequest": map[string]interface{}{
			"owner":           "urn:li:person:" + personID,
			"fileSizeBytes":   int64(len(data)),
			"uploadCaptions":  false,
			"uploadThumbnail": false,
		},
	}

	respBody, err := DoJSON(ctx, "POST", "https://api.linkedin.com/rest/videos?action=initializeUpload", registerPayload, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return "", fmt.Errorf("linkedin video register: %w", err)
	}

	return l.completeVideoUpload(ctx, accessToken, apiVersion, respBody, data)
}

func (l *LinkedInAdapter) uploadDocument(ctx context.Context, accessToken, personID string, data []byte) (string, error) {
	apiVersion := linkedInAPIVersion()

	registerPayload := map[string]interface{}{
		"initializeUploadRequest": map[string]interface{}{
			"owner": "urn:li:person:" + personID,
		},
	}

	respBody, err := DoJSON(ctx, "POST", "https://api.linkedin.com/rest/documents?action=initializeUpload", registerPayload, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return "", fmt.Errorf("linkedin document register: %w", err)
	}

	documentURN, err := l.completeDocumentUpload(ctx, accessToken, respBody, data)
	if err != nil {
		return "", err
	}
	if err := l.waitForDocumentAvailable(ctx, accessToken, apiVersion, documentURN); err != nil {
		return "", err
	}
	return documentURN, nil
}

func (l *LinkedInAdapter) completeImageUpload(ctx context.Context, accessToken string, registerResp []byte, data []byte) (string, error) {
	var registerResult struct {
		Value struct {
			Image              string `json:"image"`
			DigitalmediaAsset  string `json:"digitalmediaAsset"`
			UploadURL          string `json:"uploadUrl"`
			UploadInstructions struct {
				UploadURL       string `json:"uploadUrl"`
				UploadMechanism struct {
					MediaUploadHTTPRequest struct {
						Headers map[string]string `json:"headers"`
					} `json:"com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"`
				} `json:"uploadMechanism"`
			} `json:"uploadInstructions"`
		} `json:"value"`
	}
	if err := json.Unmarshal(registerResp, &registerResult); err != nil {
		return "", fmt.Errorf("decoding linkedin register: %w", err)
	}

	uploadURL := registerResult.Value.UploadURL
	if uploadURL == "" {
		uploadURL = registerResult.Value.UploadInstructions.UploadURL
	}
	if uploadURL == "" {
		return "", errors.New("linkedin response did not include an upload URL")
	}

	headers := map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   contentTypeOctet,
	}
	extraHeaders := registerResult.Value.UploadInstructions.UploadMechanism.MediaUploadHTTPRequest.Headers
	if auth, ok := extraHeaders[headerAuthorization]; ok {
		headers[headerAuthorization] = auth
	}

	_, err := DoRequest(ctx, "PUT", uploadURL, bytes.NewReader(data), headers)
	if err != nil {
		return "", fmt.Errorf("linkedin media PUT upload: %w", err)
	}

	assetURN := registerResult.Value.Image
	if assetURN == "" {
		assetURN = registerResult.Value.DigitalmediaAsset
	}

	if assetURN == "" {
		return "", fmt.Errorf("no asset URN in linkedin response")
	}

	return assetURN, nil
}

func (l *LinkedInAdapter) completeVideoUpload(ctx context.Context, accessToken, apiVersion string, registerResp []byte, data []byte) (string, error) {
	var registerResult struct {
		Value struct {
			Video              string `json:"video"`
			UploadToken        string `json:"uploadToken"`
			UploadInstructions []struct {
				UploadURL string `json:"uploadUrl"`
				FirstByte int64  `json:"firstByte"`
				LastByte  int64  `json:"lastByte"`
			} `json:"uploadInstructions"`
		} `json:"value"`
	}
	if err := json.Unmarshal(registerResp, &registerResult); err != nil {
		return "", fmt.Errorf("decoding linkedin video register: %w", err)
	}
	if registerResult.Value.Video == "" {
		return "", fmt.Errorf("no video URN in linkedin response")
	}
	if len(registerResult.Value.UploadInstructions) == 0 {
		return "", errors.New("linkedin response did not include video upload instructions")
	}

	uploadedPartIDs := make([]string, 0, len(registerResult.Value.UploadInstructions))
	for _, instruction := range registerResult.Value.UploadInstructions {
		if instruction.UploadURL == "" {
			return "", fmt.Errorf("linkedin video upload instruction missing upload URL")
		}
		if instruction.FirstByte < 0 || instruction.LastByte < instruction.FirstByte || instruction.LastByte >= int64(len(data)) {
			return "", fmt.Errorf("linkedin video upload instruction has invalid byte range %d-%d for file size %d", instruction.FirstByte, instruction.LastByte, len(data))
		}
		part := data[instruction.FirstByte : instruction.LastByte+1]
		headers, err := doRequestWithHeaders(ctx, "PUT", instruction.UploadURL, bytes.NewReader(part), map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
			headerContentType:   contentTypeOctet,
		})
		if err != nil {
			return "", fmt.Errorf("linkedin video PUT upload: %w", err)
		}
		partID := headers.Get("ETag")
		if partID == "" {
			return "", fmt.Errorf("linkedin video PUT upload missing ETag")
		}
		uploadedPartIDs = append(uploadedPartIDs, strings.Trim(partID, `"`))
	}

	payload := map[string]interface{}{
		"finalizeUploadRequest": map[string]interface{}{
			jsonFieldVideo:    registerResult.Value.Video,
			"uploadToken":     registerResult.Value.UploadToken,
			"uploadedPartIds": uploadedPartIDs,
		},
	}
	if _, err := DoJSONWithHeaders(ctx, "POST", "https://api.linkedin.com/rest/videos?action=finalizeUpload", payload, linkedinHeaders(accessToken, apiVersion)); err != nil {
		return "", fmt.Errorf("linkedin video finalize: %w", err)
	}

	if err := l.waitForVideoAvailable(ctx, accessToken, apiVersion, registerResult.Value.Video); err != nil {
		return "", err
	}

	return registerResult.Value.Video, nil
}

func (l *LinkedInAdapter) completeDocumentUpload(ctx context.Context, accessToken string, registerResp []byte, data []byte) (string, error) {
	var registerResult struct {
		Value struct {
			Document  string `json:"document"`
			UploadURL string `json:"uploadUrl"`
		} `json:"value"`
	}
	if err := json.Unmarshal(registerResp, &registerResult); err != nil {
		return "", fmt.Errorf("decoding linkedin document register: %w", err)
	}
	if registerResult.Value.Document == "" {
		return "", fmt.Errorf("no document URN in linkedin response")
	}
	if registerResult.Value.UploadURL == "" {
		return "", errors.New("linkedin response did not include a document upload URL")
	}

	if _, err := DoRequest(ctx, "PUT", registerResult.Value.UploadURL, bytes.NewReader(data), map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   contentTypeOctet,
	}); err != nil {
		return "", fmt.Errorf("linkedin document PUT upload: %w", err)
	}

	return registerResult.Value.Document, nil
}

func (l *LinkedInAdapter) Publish(ctx context.Context, accessToken, personID string, req *PublishRequest) (string, error) {
	apiVersion := linkedInAPIVersion()
	authorURN := "urn:li:person:" + personID

	if req.ReplyToID != "" {
		return l.postComment(ctx, accessToken, authorURN, req.ReplyToID, req.Content)
	}

	return l.createPost(ctx, accessToken, authorURN, apiVersion, req)
}

//nolint:gocyclo
func (l *LinkedInAdapter) createPost(ctx context.Context, accessToken, authorURN, apiVersion string, req *PublishRequest) (string, error) {
	visibility := firstNonEmptyString(settingString(req.Settings, "visibility"), "PUBLIC")
	if visibility != "PUBLIC" && visibility != "CONNECTIONS" {
		return "", fmt.Errorf("linkedin visibility %q is not supported", visibility)
	}
	payload := map[string]interface{}{
		"author":     authorURN,
		"commentary": req.Content,
		"visibility": visibility,
		"distribution": map[string]interface{}{
			"feedDistribution":               "MAIN_FEED",
			"targetEntities":                 []interface{}{},
			"thirdPartyDistributionChannels": []interface{}{},
		},
		"lifecycleState":            "PUBLISHED",
		"isReshareDisabledByAuthor": settingBool(req.Settings, "reshare_disabled"),
	}

	if pollOptions := separatedSettingValues(req.Settings, "poll_options"); len(pollOptions) > 0 {
		if len(req.PlatformMediaIDs) > 0 {
			return "", fmt.Errorf("linkedin polls cannot be combined with media")
		}
		options := make([]map[string]string, 0, len(pollOptions))
		for _, option := range pollOptions {
			options = append(options, map[string]string{"text": option})
		}
		duration := firstNonEmptyString(settingString(req.Settings, "poll_duration"), "ONE_DAY")
		payload["content"] = map[string]interface{}{
			"poll": map[string]interface{}{
				"question": strings.TrimSpace(req.Content),
				"options":  options,
				"settings": map[string]string{"duration": duration},
			},
		}
	} else if len(req.PlatformMediaIDs) > 1 {
		if len(req.PlatformMediaIDs) > 20 {
			return "", fmt.Errorf("linkedin multi-image posts support up to 20 images")
		}
		images := make([]map[string]interface{}, 0, len(req.PlatformMediaIDs))
		for index, mediaID := range req.PlatformMediaIDs {
			image := map[string]interface{}{"id": mediaID}
			if altText := mediaAltTextAt(req, index); altText != "" {
				image["altText"] = altText
			}
			images = append(images, image)
		}
		payload["content"] = map[string]interface{}{
			"multiImage": map[string]interface{}{"images": images},
		}
	} else if len(req.PlatformMediaIDs) > 0 {
		mediaItem := map[string]interface{}{
			"id": req.PlatformMediaIDs[0],
		}
		if title := linkedInMediaTitle(req); title != "" {
			mediaItem["title"] = title
		}
		if !isLinkedInVideoURN(req.PlatformMediaIDs[0]) && len(req.MediaAltTexts) > 0 && req.MediaAltTexts[0] != "" {
			mediaItem["altText"] = req.MediaAltTexts[0]
		}
		payload["content"] = map[string]interface{}{
			"media": mediaItem,
		}
	} else if articleURL := firstNonEmptyString(settingString(req.Settings, "url"), settingString(req.Settings, "link_url")); articleURL != "" {
		payload["content"] = map[string]interface{}{
			"article": map[string]interface{}{
				"source":      articleURL,
				"title":       settingString(req.Settings, "article_title"),
				"description": settingString(req.Settings, "article_description"),
			},
		}
	}

	respHeaders, err := DoJSONWithHeaders(ctx, "POST", "https://api.linkedin.com/rest/posts", payload, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return "", fmt.Errorf("posting to linkedin: %w", err)
	}

	postID := respHeaders.Get("x-restli-id")
	if postID == "" {
		return "", nil
	}

	return postID, nil
}

func (l *LinkedInAdapter) postComment(ctx context.Context, accessToken, actorURN, activityURN, content string) (string, error) {
	apiVersion := linkedInAPIVersion()
	encodedActivityURN := url.QueryEscape(activityURN)

	payload := map[string]interface{}{
		"actor":  actorURN,
		"object": activityURN,
		"message": map[string]interface{}{
			jsonFieldText: content,
		},
	}

	respBody, err := DoJSON(ctx, "POST", "https://api.linkedin.com/rest/socialActions/"+encodedActivityURN+"/comments", payload, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return "", fmt.Errorf("posting linkedin comment: %w", err)
	}

	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decoding linkedin comment: %w", err)
	}

	return result.ID, nil
}

func (l *LinkedInAdapter) ListComments(ctx context.Context, accessToken, _ string, externalID string) ([]Comment, error) {
	apiVersion := linkedInAPIVersion()
	endpoint := "https://api.linkedin.com/rest/socialActions/" + url.QueryEscape(externalID) + "/comments"
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return nil, fmt.Errorf("linkedin comments: %w", err)
	}

	var result struct {
		Elements []struct {
			ID         string `json:"id"`
			CommentURN string `json:"commentUrn"`
			Actor      string `json:"actor"`
			Created    struct {
				Time int64 `json:"time"`
			} `json:"created"`
			Message struct {
				Text string `json:"text"`
			} `json:"message"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding linkedin comments: %w", err)
	}

	comments := make([]Comment, 0, len(result.Elements))
	for _, item := range result.Elements {
		id := firstNonEmptyString(item.CommentURN, item.ID)
		comments = append(comments, Comment{
			ID:        id,
			AuthorID:  item.Actor,
			Text:      item.Message.Text,
			CreatedAt: linkedInTimestamp(item.Created.Time),
			CanReply:  true,
			CanDelete: true,
		})
	}
	return comments, nil
}

func (l *LinkedInAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	actorURN := linkedInAuthorURN(accountID)
	objectURN, err := linkedInCommentObjectURN(commentID)
	if err != nil {
		return "", err
	}
	apiVersion := linkedInAPIVersion()
	endpoint := "https://api.linkedin.com/rest/socialActions/" + url.QueryEscape(commentID) + "/comments"
	payload := map[string]interface{}{
		"actor":         actorURN,
		"object":        objectURN,
		"parentComment": commentID,
		"message": map[string]interface{}{
			jsonFieldText: strings.TrimSpace(message),
		},
	}
	respBody, err := DoJSON(ctx, http.MethodPost, endpoint, payload, linkedinHeaders(accessToken, apiVersion))
	if err != nil {
		return "", fmt.Errorf("posting linkedin comment reply: %w", err)
	}
	var result struct {
		ID         string `json:"id"`
		CommentURN string `json:"commentUrn"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decoding linkedin comment reply: %w", err)
	}
	return firstNonEmptyString(result.ID, result.CommentURN), nil
}

func (l *LinkedInAdapter) HideComment(context.Context, string, string, string) error {
	return fmt.Errorf("linkedin hide comment: %w", ErrUnsupportedCommentAction)
}

func (l *LinkedInAdapter) DeleteComment(ctx context.Context, accessToken, accountID, commentID string) error {
	objectURN, shortCommentID, err := linkedInCommentTarget(commentID)
	if err != nil {
		return err
	}
	endpoint := "https://api.linkedin.com/rest/socialActions/" + url.QueryEscape(objectURN) + "/comments/" + url.PathEscape(shortCommentID)
	if actorURN := linkedInAuthorURN(accountID); actorURN != "" {
		endpoint += "?actor=" + url.QueryEscape(actorURN)
	}
	if _, err := DoRequest(ctx, http.MethodDelete, endpoint, nil, linkedinHeaders(accessToken, linkedInAPIVersion())); err != nil {
		return fmt.Errorf("deleting linkedin comment: %w", err)
	}
	return nil
}

func linkedInAuthorURN(accountID string) string {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return ""
	}
	if strings.HasPrefix(accountID, "urn:li:") {
		return accountID
	}
	return "urn:li:person:" + accountID
}

func linkedInTimestamp(milliseconds int64) string {
	if milliseconds <= 0 {
		return ""
	}
	return time.UnixMilli(milliseconds).UTC().Format(time.RFC3339)
}

func linkedInCommentObjectURN(commentURN string) (string, error) {
	objectURN, _, err := linkedInCommentTarget(commentURN)
	return objectURN, err
}

func linkedInCommentTarget(commentURN string) (string, string, error) {
	commentURN = strings.TrimSpace(commentURN)
	if commentURN == "" {
		return "", "", fmt.Errorf("linkedin comment reference is required")
	}
	if !strings.HasPrefix(commentURN, "urn:li:comment:(") || !strings.HasSuffix(commentURN, ")") {
		return "", "", fmt.Errorf("linkedin comment reference must be a comment URN")
	}
	inner := strings.TrimSuffix(strings.TrimPrefix(commentURN, "urn:li:comment:("), ")")
	index := strings.LastIndex(inner, ",")
	if index < 0 {
		return "", "", fmt.Errorf("linkedin comment reference is malformed")
	}
	objectURN := strings.TrimSpace(inner[:index])
	commentID := strings.TrimSpace(inner[index+1:])
	if objectURN == "" || commentID == "" {
		return "", "", fmt.Errorf("linkedin comment reference is malformed")
	}
	return objectURN, commentID, nil
}

func (l *LinkedInAdapter) waitForVideoAvailable(ctx context.Context, accessToken, apiVersion, videoURN string) error {
	encodedVideoURN := url.QueryEscape(videoURN)
	statusURL := "https://api.linkedin.com/rest/videos/" + encodedVideoURN

	for i := 0; i < linkedInVideoAvailabilityPolls; i++ {
		respBody, err := DoRequest(ctx, "GET", statusURL, nil, linkedinHeaders(accessToken, apiVersion))
		if err != nil {
			return fmt.Errorf("linkedin video status: %w", err)
		}

		var result struct {
			Status                  string `json:"status"`
			ProcessingFailureReason string `json:"processingFailureReason"`
		}
		if err := json.Unmarshal(respBody, &result); err != nil {
			return fmt.Errorf("decoding linkedin video status: %w", err)
		}

		switch result.Status {
		case "AVAILABLE":
			return nil
		case "PROCESSING", "WAITING_UPLOAD":
		case "PROCESSING_FAILED", platformStatusFailed:
			if result.ProcessingFailureReason != "" {
				return fmt.Errorf("linkedin video processing failed: %s", result.ProcessingFailureReason)
			}
			return fmt.Errorf("linkedin video processing failed")
		default:
			if result.Status == "" {
				return fmt.Errorf("linkedin video status response missing status")
			}
			if !slices.Contains([]string{"PROCESSING", "WAITING_UPLOAD"}, result.Status) {
				return fmt.Errorf("linkedin video is not available: %s", result.Status)
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	return fmt.Errorf("linkedin video processing timed out")
}

func (l *LinkedInAdapter) waitForDocumentAvailable(ctx context.Context, accessToken, apiVersion, documentURN string) error {
	encodedDocumentURN := url.QueryEscape(documentURN)
	statusURL := "https://api.linkedin.com/rest/documents/" + encodedDocumentURN

	for i := 0; i < linkedInDocumentAvailabilityPolls; i++ {
		respBody, err := DoRequest(ctx, "GET", statusURL, nil, linkedinHeaders(accessToken, apiVersion))
		if err != nil {
			return fmt.Errorf("linkedin document status: %w", err)
		}

		var result struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(respBody, &result); err != nil {
			return fmt.Errorf("decoding linkedin document status: %w", err)
		}

		switch result.Status {
		case "AVAILABLE":
			return nil
		case "PROCESSING", "WAITING_UPLOAD":
		case "PROCESSING_FAILED", platformStatusFailed:
			return fmt.Errorf("linkedin document processing failed")
		default:
			if result.Status == "" {
				return fmt.Errorf("linkedin document status response missing status")
			}
			return fmt.Errorf("linkedin document is not available: %s", result.Status)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	return fmt.Errorf("linkedin document processing timed out")
}

func isLinkedInVideoURN(urn string) bool {
	return strings.HasPrefix(urn, "urn:li:video:")
}

func isLinkedInDocumentMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "application/pdf",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return true
	default:
		return false
	}
}

func linkedInMediaTitle(req *PublishRequest) string {
	if title := settingString(req.Settings, "document_title"); title != "" {
		return title
	}
	if strings.TrimSpace(req.Title) != "" {
		return strings.TrimSpace(req.Title)
	}
	if len(req.Media) > 0 && strings.TrimSpace(req.Media[0].OriginalFilename) != "" {
		return strings.TrimSpace(req.Media[0].OriginalFilename)
	}
	return settingString(req.Settings, "title")
}

func linkedinHeaders(accessToken, apiVersion string) map[string]string {
	return map[string]string{
		headerAuthorization:         bearerPrefix + accessToken,
		headerContentType:           contentTypeJSON,
		"X-Restli-Protocol-Version": "2.0.0",
		"Linkedin-Version":          apiVersion,
	}
}

func encodeLinkedInAuthQuery(params map[string]string) string {
	parts := make([]string, 0, len(params))
	for k, v := range params {
		encodedValue := url.QueryEscape(v)
		if k == "scope" {
			encodedValue = strings.ReplaceAll(encodedValue, "+", "%20")
		}
		parts = append(parts, url.QueryEscape(k)+"="+encodedValue)
	}
	return strings.Join(parts, "&")
}

func DoJSONWithHeaders(ctx context.Context, method, url string, payload any, headers map[string]string) (http.Header, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, err := jsonMarshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshaling JSON: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeJSON
	}

	return doRequestWithHeaders(ctx, method, url, bodyReader, headers)
}

func doRequestWithHeaders(ctx context.Context, method, url string, body io.Reader, headers map[string]string) (http.Header, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := httpClient.Do(req)
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

	return resp.Header, nil
}

func validateLinkedInMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	if len(media) > 1 {
		return []MediaValidationIssue{{
			Provider: providerLinkedIn,
			Severity: severityWarning,
			Message:  "OpenPost currently publishes only the first LinkedIn attachment.",
		}}
	}
	item := media[0]
	if isVideoMime(item.MimeType) && !isLinkedInVideoMime(item.MimeType) {
		return []MediaValidationIssue{{
			Provider: providerLinkedIn,
			MediaID:  item.ID,
			Severity: severityWarning,
			Message:  "LinkedIn video publishing is most reliable with MP4 video.",
		}}
	}
	return nil
}

func isLinkedInVideoMime(mimeType string) bool {
	return strings.EqualFold(mimeType, videoTypeMP4)
}
