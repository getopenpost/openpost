package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultMetaGraphAPIVersion  = "v25.0"
	facebookOAuthBaseURL        = "https://www.facebook.com"
	facebookGraphBaseURL        = "https://graph.facebook.com"
	metaBusinessManagementScope = "business_management"
	facebookRuploadHost         = "rupload.facebook.com"
	facebookVideoUploadMaxPolls = 60
)

var facebookVideoUploadPollDelay = 5 * time.Second

type FacebookAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string
	graphVersion string
}

func NewFacebookAdapter(clientID, clientSecret, redirectURI string) *FacebookAdapter {
	return &FacebookAdapter{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		graphVersion: metaGraphAPIVersion(),
	}
}

func (f *FacebookAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     f.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code", "graph_version": f.graphVersion},
	}
}

func metaGraphAPIVersion() string {
	if version := strings.TrimSpace(os.Getenv("META_GRAPH_API_VERSION")); version != "" {
		return strings.TrimPrefix(version, "/")
	}
	return defaultMetaGraphAPIVersion
}

func (f *FacebookAdapter) graphURL(path string) string {
	return facebookGraphBaseURL + "/" + f.graphVersion + "/" + strings.TrimPrefix(path, "/")
}

func (f *FacebookAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set(oauthParamClientID, f.clientID)
	params.Set(oauthParamRedirectURI, f.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", strings.Join(facebookScopes(), ","))
	params.Set("state", state)
	params.Set("auth_type", "rerequest")
	return facebookOAuthBaseURL + "/" + f.graphVersion + "/dialog/oauth?" + params.Encode(), nil
}

func (f *FacebookAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	token, err := exchangeMetaAuthCode(ctx, f.graphURL, f.clientID, f.clientSecret, f.redirectURI, "facebook", code)
	if err != nil {
		return nil, err
	}
	scopes, err := fetchMetaGrantedScopes(ctx, f.graphURL, token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("facebook granted permissions: %w", err)
	}
	return tokenWithGrantedScopes(token, scopes), nil
}

func exchangeMetaAuthCode(ctx context.Context, graphURL func(string) string, clientID, clientSecret, redirectURI, providerName, code string) (*TokenResult, error) {
	params := url.Values{}
	params.Set(oauthParamClientID, clientID)
	params.Set(oauthParamClientSecret, clientSecret)
	params.Set(oauthParamRedirectURI, redirectURI)
	params.Set(oauthParamCode, code)

	label := providerName + " token exchange"
	respBody, err := DoRequest(ctx, http.MethodGet, graphURL("oauth/access_token")+"?"+params.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}

	tokenResp, err := decodeFacebookToken(label, respBody)
	if err != nil {
		return nil, err
	}

	longLived, err := exchangeMetaLongLivedToken(ctx, graphURL, clientID, clientSecret, providerName, tokenResp.AccessToken)
	if err != nil {
		return tokenResp, nil
	}
	return longLived, nil
}

func exchangeMetaLongLivedToken(ctx context.Context, graphURL func(string) string, clientID, clientSecret, providerName, accessToken string) (*TokenResult, error) {
	params := url.Values{}
	params.Set(grantType, "fb_exchange_token")
	params.Set(oauthParamClientID, clientID)
	params.Set(oauthParamClientSecret, clientSecret)
	params.Set("fb_exchange_token", accessToken)

	label := providerName + " long-lived token exchange"
	respBody, err := DoRequest(ctx, http.MethodGet, graphURL("oauth/access_token")+"?"+params.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	return decodeFacebookToken(label, respBody)
}

func decodeFacebookToken(label string, respBody []byte) (*TokenResult, error) {
	var tokenResp struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
		Error       struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    int    `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}
	if tokenResp.Error.Message != "" {
		return nil, fmt.Errorf("%s: %s", label, tokenResp.Error.Message)
	}
	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("%s: missing access token", label)
	}
	return &TokenResult{
		AccessToken: tokenResp.AccessToken,
		ExpiresIn:   tokenResp.ExpiresIn,
		TokenType:   firstNonEmptyString(tokenResp.TokenType, tokenTypeBearer),
	}, nil
}

func tokenWithGrantedScopes(token *TokenResult, scopes []string) *TokenResult {
	if token == nil {
		return nil
	}
	if token.Extra == nil {
		token.Extra = map[string]string{}
	}
	token.Extra["scope"] = strings.Join(scopes, " ")
	return token
}

func fetchMetaGrantedScopes(ctx context.Context, graphURL func(string) string, accessToken string) ([]string, error) {
	endpoint := graphURL("me/permissions") + "?" + url.Values{
		oauthParamAccessToken: {accessToken},
	}.Encode()
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			Permission string `json:"permission"`
			Status     string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding granted permissions: %w", err)
	}
	scopes := make([]string, 0, len(response.Data))
	for _, permission := range response.Data {
		if permission.Status == "granted" && permission.Permission != "" {
			scopes = append(scopes, permission.Permission)
		}
	}
	return scopes, nil
}

func (f *FacebookAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{}
}

func (f *FacebookAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("facebook page tokens do not support OpenPost refresh yet")
}

func (f *FacebookAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	respBody, err := DoRequest(ctx, http.MethodGet, f.graphURL("me?fields=id,name&access_token="+url.QueryEscape(accessToken)), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("facebook profile: %w", err)
	}

	var profile struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &profile); err != nil {
		return nil, fmt.Errorf("decoding facebook profile: %w", err)
	}
	if profile.Error.Message != "" {
		return nil, fmt.Errorf("facebook profile: %s", profile.Error.Message)
	}
	if profile.ID == "" {
		return nil, fmt.Errorf("facebook profile: missing id")
	}

	return &UserProfile{
		ID:          profile.ID,
		Username:    profile.Name,
		DisplayName: profile.Name,
	}, nil
}

func (f *FacebookAdapter) RefreshAccountMetadata(ctx context.Context, accessToken string, _ AccountMetadataRequest) (*UserProfile, error) {
	endpoint := f.graphURL("me?fields=id,name,username,picture.type(square)&access_token=" + url.QueryEscape(accessToken))
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("facebook page profile: %w", err)
	}
	var page facebookPage
	if err := json.Unmarshal(respBody, &page); err != nil {
		return nil, fmt.Errorf("decoding facebook page profile: %w", err)
	}
	if strings.TrimSpace(page.ID) == "" {
		return nil, fmt.Errorf("facebook page profile returned no id")
	}
	return &UserProfile{
		ID: page.ID, Username: firstNonEmptyString(page.Username, page.Name),
		DisplayName: page.Name, AvatarURL: page.Picture.Data.URL,
	}, nil
}

func (f *FacebookAdapter) ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error) {
	pages, err := f.listPages(ctx, token)
	if err != nil {
		return nil, err
	}
	options := make([]AccountSelectionOption, 0, len(pages))
	for _, page := range pages {
		options = append(options, AccountSelectionOption{
			ID:          page.ID,
			Username:    firstNonEmptyString(page.Username, page.Name),
			DisplayName: page.Name,
			AvatarURL:   page.Picture.Data.URL,
			Kind:        "page",
			Extra: map[string]string{
				"page_id": page.ID,
			},
		})
	}
	return options, nil
}

func (f *FacebookAdapter) SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error) {
	pages, err := f.listPages(ctx, token)
	if err != nil {
		return nil, err
	}
	for _, page := range pages {
		if page.ID != selectionID {
			continue
		}
		if page.AccessToken == "" {
			return nil, fmt.Errorf("facebook page %s did not include a page access token", page.ID)
		}
		pageToken := *token
		pageToken.AccessToken = page.AccessToken
		pageToken.RefreshToken = ""
		pageToken.ExpiresIn = 0
		pageToken.Extra = map[string]string{}
		for key, value := range token.Extra {
			pageToken.Extra[key] = value
		}
		pageToken.Extra["page_id"] = page.ID
		pageToken.Extra["page_name"] = page.Name

		return &SelectedAccount{
			AccountID:        page.ID,
			AccountUsername:  firstNonEmptyString(page.Username, page.Name),
			AccountAvatarURL: page.Picture.Data.URL,
			Token:            &pageToken,
		}, nil
	}
	return nil, fmt.Errorf("facebook page selection %s was not found", selectionID)
}

func (f *FacebookAdapter) listPages(ctx context.Context, token *TokenResult) ([]facebookPage, error) {
	fields := "id,name,username,access_token,picture.type(square)"
	pages, err := listMetaManagedPages(ctx, f.graphURL, token, fields, "facebook")
	if err != nil {
		return nil, fmt.Errorf("facebook pages: %w", err)
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("OpenPost could not find any Facebook Pages this profile can manage; create a Page or give this profile full control of one, then try again")
	}
	return pages, nil
}

func (f *FacebookAdapter) UploadMedia(_ context.Context, _ string, _ string, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("facebook uses publicly accessible HTTPS media URLs for the initial adapter")
}

func (f *FacebookAdapter) Publish(ctx context.Context, accessToken, pageID string, req *PublishRequest) (PublishResult, error) {
	result, err := executePublishWrite(req, "publish_graph_object", func() (string, error) {
		return f.publish(ctx, accessToken, pageID, req)
	})
	return result, normalizeMetaPublishError(err)
}

func (f *FacebookAdapter) publish(ctx context.Context, accessToken, pageID string, req *PublishRequest) (string, error) {
	if req.ReplyToID != "" {
		return f.publishCommentReply(ctx, accessToken, req.ReplyToID, req.Content)
	}
	if req.Profile == "story" || req.OutputProfile == "facebook.story" {
		return f.publishStory(ctx, accessToken, pageID, req)
	}
	switch len(req.PlatformMediaIDs) {
	case 0:
		return f.publishFeedPost(ctx, accessToken, pageID, req)
	default:
		if len(req.Media) != len(req.PlatformMediaIDs) {
			return "", fmt.Errorf("facebook media publishing requires media metadata")
		}
		if len(req.PlatformMediaIDs) == 1 && isVideoMime(req.Media[0].MimeType) {
			if req.OutputProfile == "facebook.reel" || req.Profile == "short_video" {
				return f.publishReel(ctx, accessToken, pageID, req, req.PlatformMediaIDs[0])
			}
			return f.publishVideo(ctx, accessToken, pageID, req, req.PlatformMediaIDs[0])
		}
		for _, mediaURL := range req.PlatformMediaIDs {
			if !strings.HasPrefix(mediaURL, "https://") {
				return "", fmt.Errorf("facebook requires a publicly-accessible HTTPS media URL. Set OPENPOST_MEDIA_URL to your public media base URL")
			}
		}
		if len(req.PlatformMediaIDs) == 1 {
			return f.publishPhoto(ctx, accessToken, pageID, req.Content, req.PlatformMediaIDs[0])
		}
		return f.publishMultiPhoto(ctx, accessToken, pageID, req.Content, req.PlatformMediaIDs)
	}
}

func (f *FacebookAdapter) publishReel(ctx context.Context, accessToken, pageID string, req *PublishRequest, mediaURL string) (string, error) {
	finishValues := map[string]string{
		"video_state": "PUBLISHED",
		"description": strings.TrimSpace(firstNonEmptyString(settingString(req.Settings, "video_description"), req.Description, req.Content)),
	}
	if title := firstNonEmptyString(settingString(req.Settings, "video_title"), req.Title); title != "" {
		finishValues["title"] = title
	}
	if _, exists := req.Settings["share_to_feed"]; exists {
		finishValues["share_to_feed"] = strconv.FormatBool(settingBool(req.Settings, "share_to_feed"))
	}
	return f.publishHostedVideo(ctx, accessToken, pageID, "video_reels", "facebook reel", mediaURL, finishValues)
}

func (f *FacebookAdapter) publishHostedVideo(
	ctx context.Context,
	accessToken string,
	pageID string,
	edge string,
	label string,
	mediaURL string,
	finishValues map[string]string,
) (string, error) {
	startResponse, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/"+edge), map[string]string{
		"upload_phase":        "start",
		oauthParamAccessToken: accessToken,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("%s upload start: %w", label, err)
	}
	var start struct {
		VideoID   string `json:"video_id"`
		UploadURL string `json:"upload_url"`
	}
	if err := json.Unmarshal(startResponse, &start); err != nil {
		return "", fmt.Errorf("decoding %s upload start: %w", label, err)
	}
	if start.VideoID == "" || start.UploadURL == "" {
		return "", fmt.Errorf("%s upload start did not return a video id and upload URL", label)
	}
	if err := validateFacebookUploadURL(start.UploadURL); err != nil {
		return "", err
	}
	uploadResponse, err := DoRequestNoRedirect(ctx, http.MethodPost, start.UploadURL, nil, map[string]string{
		headerAuthorization: "OAuth " + accessToken,
		"file_url":          mediaURL,
	})
	if err != nil {
		return "", fmt.Errorf("%s transfer: %w", label, err)
	}
	var uploaded struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(uploadResponse, &uploaded); err != nil || !uploaded.Success {
		return "", fmt.Errorf("%s transfer was not accepted", label)
	}
	if err := f.waitForFacebookVideoUpload(ctx, accessToken, start.VideoID); err != nil {
		return "", fmt.Errorf("%s processing: %w", label, err)
	}
	finishValues["upload_phase"] = "finish"
	finishValues["video_id"] = start.VideoID
	finishValues[oauthParamAccessToken] = accessToken
	finishResponse, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/"+edge), finishValues, nil)
	if err != nil {
		return "", fmt.Errorf("%s publish: %w", label, err)
	}
	finishedID, err := facebookPublishedID(label+" publish", finishResponse)
	if err != nil {
		if strings.Contains(err.Error(), "missing published id") {
			return start.VideoID, nil
		}
		return "", err
	}
	return finishedID, nil
}

func validateFacebookUploadURL(rawURL string) error {
	uploadURL, err := url.Parse(rawURL)
	if err != nil || uploadURL.Scheme != "https" || uploadURL.Hostname() != facebookRuploadHost ||
		uploadURL.Port() != "" || uploadURL.User != nil {
		return fmt.Errorf("facebook returned an invalid upload URL")
	}
	return nil
}

func (f *FacebookAdapter) waitForFacebookVideoUpload(ctx context.Context, accessToken, videoID string) error {
	for attempt := 0; attempt < facebookVideoUploadMaxPolls; attempt++ {
		if attempt > 0 && facebookVideoUploadPollDelay > 0 {
			timer := time.NewTimer(facebookVideoUploadPollDelay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		query := url.Values{
			"fields":              {"status"},
			oauthParamAccessToken: {accessToken},
		}
		response, err := DoRequest(ctx, http.MethodGet, f.graphURL(videoID)+"?"+query.Encode(), nil, nil)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if isTransientFacebookVideoPollError(err) {
				continue
			}
			return err
		}
		var statusResponse struct {
			Status facebookVideoStatus `json:"status"`
		}
		if err := json.Unmarshal(response, &statusResponse); err != nil {
			return fmt.Errorf("decoding Facebook video status: %w", err)
		}
		if statusResponse.Status.failed() {
			return fmt.Errorf("facebook could not process the video")
		}
		if statusResponse.Status.complete() {
			return nil
		}
	}
	return fmt.Errorf("facebook timed out while processing the video")
}

type facebookVideoStatus struct {
	VideoStatus     string             `json:"video_status"`
	UploadingPhase  facebookVideoPhase `json:"uploading_phase"`
	ProcessingPhase facebookVideoPhase `json:"processing_phase"`
}

type facebookVideoPhase struct {
	Status string `json:"status"`
	Error  struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (s facebookVideoStatus) failed() bool {
	return s.UploadingPhase.Error.Message != "" || s.ProcessingPhase.Error.Message != "" ||
		s.UploadingPhase.Status == "error" || s.ProcessingPhase.Status == "error" ||
		s.VideoStatus == "error" || s.VideoStatus == "expired"
}

func (s facebookVideoStatus) complete() bool {
	return s.UploadingPhase.Status == "complete" || s.VideoStatus == "ready" || s.VideoStatus == "upload_complete"
}

func isTransientFacebookVideoPollError(err error) bool {
	var transportErr *TransportError
	if errors.As(err, &transportErr) {
		return transportErr.Kind != TransportFailureCanceled
	}
	var providerErr *HTTPError
	return errors.As(err, &providerErr) && (providerErr.StatusCode == http.StatusRequestTimeout ||
		providerErr.StatusCode == http.StatusTooManyRequests || providerErr.StatusCode >= http.StatusInternalServerError)
}

func (f *FacebookAdapter) publishFeedPost(ctx context.Context, accessToken, pageID string, req *PublishRequest) (string, error) {
	values := map[string]string{
		"message":             strings.TrimSpace(req.Content),
		oauthParamAccessToken: accessToken,
	}
	if linkURL := settingString(req.Settings, "url"); linkURL != "" {
		values["link"] = linkURL
	}
	if preset := settingString(req.Settings, "text_format_preset_id"); preset != "" {
		values["text_format_preset_id"] = preset
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/feed"), values, nil)
	if err != nil {
		return "", fmt.Errorf("facebook feed publish: %w", err)
	}
	id, err := facebookPublishedID("facebook feed publish", respBody)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (f *FacebookAdapter) publishPhoto(ctx context.Context, accessToken, pageID, caption, mediaURL string) (string, error) {
	values := map[string]string{
		"url":                 mediaURL,
		"caption":             strings.TrimSpace(caption),
		"published":           "true",
		oauthParamAccessToken: accessToken,
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/photos"), values, nil)
	if err != nil {
		return "", fmt.Errorf("facebook photo publish: %w", err)
	}
	return facebookPublishedID("facebook photo publish", respBody)
}

func (f *FacebookAdapter) publishVideo(ctx context.Context, accessToken, pageID string, req *PublishRequest, mediaURL string) (string, error) {
	values := map[string]string{
		"file_url":            mediaURL,
		"description":         strings.TrimSpace(firstNonEmptyString(settingString(req.Settings, "video_description"), req.Description, req.Content)),
		oauthParamAccessToken: accessToken,
	}
	if title := firstNonEmptyString(settingString(req.Settings, "video_title"), req.Title); title != "" {
		values["title"] = title
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/videos"), values, nil)
	if err != nil {
		return "", fmt.Errorf("facebook video publish: %w", err)
	}
	return facebookPublishedID("facebook video publish", respBody)
}

func (f *FacebookAdapter) publishMultiPhoto(ctx context.Context, accessToken, pageID, message string, mediaURLs []string) (string, error) {
	attached := make([]string, 0, len(mediaURLs))
	for _, mediaURL := range mediaURLs {
		photoID, err := f.uploadUnpublishedPhoto(ctx, accessToken, pageID, mediaURL)
		if err != nil {
			return "", err
		}
		attached = append(attached, fmt.Sprintf(`{"media_fbid":"%s"}`, photoID))
	}
	values := map[string]string{
		"message":             strings.TrimSpace(message),
		oauthParamAccessToken: accessToken,
	}
	for index, item := range attached {
		values[fmt.Sprintf("attached_media[%d]", index)] = item
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/feed"), values, nil)
	if err != nil {
		return "", fmt.Errorf("facebook multi-photo publish: %w", err)
	}
	return facebookPublishedID("facebook multi-photo publish", respBody)
}

func (f *FacebookAdapter) uploadUnpublishedPhoto(ctx context.Context, accessToken, pageID, mediaURL string) (string, error) {
	values := map[string]string{
		"url":                 mediaURL,
		"published":           "false",
		oauthParamAccessToken: accessToken,
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/photos"), values, nil)
	if err != nil {
		return "", fmt.Errorf("facebook unpublished photo: %w", err)
	}
	return facebookPublishedID("facebook unpublished photo", respBody)
}

func (f *FacebookAdapter) publishStory(ctx context.Context, accessToken, pageID string, req *PublishRequest) (string, error) {
	if len(req.PlatformMediaIDs) != 1 || len(req.Media) != 1 {
		return "", fmt.Errorf("facebook stories require exactly one media item per rendition")
	}
	mediaURL := req.PlatformMediaIDs[0]
	if !strings.HasPrefix(mediaURL, "https://") {
		return "", fmt.Errorf("facebook stories require a publicly-accessible HTTPS media URL")
	}
	if isVideoMime(req.Media[0].MimeType) {
		return f.publishHostedVideo(ctx, accessToken, pageID, "video_stories", "facebook story", mediaURL, map[string]string{})
	}
	photoID, err := f.uploadUnpublishedPhoto(ctx, accessToken, pageID, mediaURL)
	if err != nil {
		return "", err
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(pageID+"/photo_stories"), map[string]string{
		"photo_id": photoID, oauthParamAccessToken: accessToken,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("facebook story publish: %w", err)
	}
	return facebookPublishedID("facebook story publish", respBody)
}

func (f *FacebookAdapter) publishCommentReply(ctx context.Context, accessToken, objectID, message string) (string, error) {
	values := map[string]string{
		"message":             strings.TrimSpace(message),
		oauthParamAccessToken: accessToken,
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(objectID+"/comments"), values, nil)
	if err != nil {
		return "", fmt.Errorf("facebook comment reply: %w", err)
	}
	return facebookPublishedID("facebook comment reply", respBody)
}

type facebookGraphComment struct {
	ID          string `json:"id"`
	Message     string `json:"message"`
	CreatedTime string `json:"created_time"`
	IsHidden    bool   `json:"is_hidden"`
	CanHide     bool   `json:"can_hide"`
	CanComment  bool   `json:"can_comment"`
	From        struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"from"`
	Parent struct {
		ID string `json:"id"`
	} `json:"parent"`
	Comments struct {
		Data []facebookGraphComment `json:"data"`
	} `json:"comments"`
}

func facebookCommentFromGraph(item facebookGraphComment, pageID, parentID string) Comment {
	if parentID == "" {
		parentID = item.Parent.ID
	}
	return Comment{
		ID:         item.ID,
		ParentID:   parentID,
		AuthorID:   item.From.ID,
		AuthorName: item.From.Name,
		Text:       item.Message,
		CreatedAt:  item.CreatedTime,
		Hidden:     item.IsHidden,
		IsOurs:     pageID != "" && item.From.ID == pageID,
		CanReply:   item.CanComment,
		CanHide:    item.CanHide,
		CanDelete:  true,
	}
}

func collectFacebookComments(items []facebookGraphComment, pageID, fallbackParent string) []Comment {
	comments := make([]Comment, 0, len(items))
	for _, item := range items {
		parentID := item.Parent.ID
		if parentID == "" {
			parentID = fallbackParent
		}
		comments = append(comments, facebookCommentFromGraph(item, pageID, parentID))
		if len(item.Comments.Data) > 0 {
			comments = append(comments, collectFacebookComments(item.Comments.Data, pageID, item.ID)...)
		}
	}
	return comments
}

func (f *FacebookAdapter) ListComments(ctx context.Context, accessToken, pageID string, externalID string) ([]Comment, error) {
	const facebookCommentFields = "id,from,message,created_time,is_hidden,can_hide,can_comment"
	// The comments edge lists top-level comments only. Replies live on each
	// comment's comments edge; nest that expansion two levels so one poll
	// also requests a reply-to-a-reply. Keep reverse_chronological so a busy
	// post still shows its newest comments.
	replyFields := facebookCommentFields + ",parent"
	fields := facebookCommentFields + ",comments.order(reverse_chronological){" + replyFields + ",comments.order(reverse_chronological){" + replyFields + "}}"
	endpoint := f.graphURL(externalID+"/comments") + "?fields=" + url.QueryEscape(fields) + "&order=reverse_chronological&access_token=" + url.QueryEscape(accessToken)
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("facebook comments: %w", err)
	}

	var result struct {
		Data  []facebookGraphComment `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding facebook comments: %w", err)
	}
	if result.Error.Message != "" {
		return nil, fmt.Errorf("facebook comments: %s", result.Error.Message)
	}
	return collectFacebookComments(result.Data, pageID, ""), nil
}

func resolveMetaContentURL(
	ctx context.Context,
	graphURL func(string) string,
	accessToken string,
	externalID string,
	field string,
	providerName string,
) (string, error) {
	query := url.Values{
		"fields":              {field},
		oauthParamAccessToken: {accessToken},
	}
	body, err := DoRequest(ctx, http.MethodGet, graphURL(externalID)+"?"+query.Encode(), nil, nil)
	if err != nil {
		return "", fmt.Errorf("%s post permalink: %w", providerName, err)
	}
	var response map[string]string
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decoding %s post permalink: %w", providerName, err)
	}
	permalink := strings.TrimSpace(response[field])
	if permalink == "" {
		return "", fmt.Errorf("%s post permalink is missing", providerName)
	}
	return permalink, nil
}

func (f *FacebookAdapter) ResolveContentURL(ctx context.Context, accessToken, _ string, externalID string) (string, error) {
	return resolveMetaContentURL(ctx, f.graphURL, accessToken, externalID, "permalink_url", "facebook")
}

func (f *FacebookAdapter) ReplyToComment(ctx context.Context, accessToken, _ string, commentID, message string) (string, error) {
	return f.publishCommentReply(ctx, accessToken, commentID, message)
}

func (f *FacebookAdapter) HideComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := DoFormURLEncoded(ctx, http.MethodPost, f.graphURL(commentID), map[string]string{
		"is_hidden":           "true",
		oauthParamAccessToken: accessToken,
	}, nil)
	if err != nil {
		return fmt.Errorf("facebook hide comment: %w", err)
	}
	return nil
}

func (f *FacebookAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	endpoint := f.graphURL(commentID) + "?access_token=" + url.QueryEscape(accessToken)
	if _, err := DoRequest(ctx, http.MethodDelete, endpoint, nil, nil); err != nil {
		return fmt.Errorf("facebook delete comment: %w", err)
	}
	return nil
}

func facebookPublishedID(label string, respBody []byte) (string, error) {
	var publishResp struct {
		ID     string `json:"id"`
		PostID string `json:"post_id"`
		Error  struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &publishResp); err != nil {
		return "", fmt.Errorf("decoding %s: %w", label, err)
	}
	if publishResp.Error.Message != "" {
		return "", &HTTPError{StatusCode: http.StatusBadRequest, Code: "facebook_publish_error"}
	}
	id := firstNonEmptyString(publishResp.PostID, publishResp.ID)
	if id == "" {
		return "", fmt.Errorf("%s: missing published id", label)
	}
	return id, nil
}

func validateFacebookMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	if len(media) > 10 {
		return []MediaValidationIssue{{
			Provider: providerFacebook,
			Severity: severityError,
			Message:  "Facebook photo posts support up to 10 media attachments.",
		}}
	}
	if len(media) > 1 {
		for _, item := range media {
			if isFacebookPhotoMime(item.MimeType) {
				continue
			}
			return []MediaValidationIssue{{
				Provider: providerFacebook,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "Facebook multi-photo posts support JPEG, PNG, or WebP images only.",
			}}
		}
		return nil
	}
	if isFacebookPhotoMime(media[0].MimeType) || isFacebookVideoMime(media[0].MimeType) {
		return nil
	}
	return []MediaValidationIssue{{
		Provider: providerFacebook,
		MediaID:  media[0].ID,
		Severity: severityError,
		Message:  "Facebook supports one JPEG, PNG, WebP, MP4, or MOV attachment.",
	}}
}

func isFacebookPhotoMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func isFacebookVideoMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case videoTypeMP4, "video/quicktime":
		return true
	default:
		return false
	}
}

func facebookScopes() []string {
	return []string{
		metaBusinessManagementScope,
		"pages_show_list",
		"pages_read_engagement",
		"pages_read_user_content",
		"pages_manage_engagement",
		"pages_manage_metadata",
		"pages_manage_posts",
		"pages_messaging",
	}
}
