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
	"time"
)

const (
	instagramCheckpointPrefix         = "ig1:"
	instagramCheckpointFinalKind      = "f"
	instagramCheckpointPublishKind    = "p"
	instagramCheckpointCarouselKind   = "c"
	instagramCheckpointChildPostKind  = "d"
	instagramCheckpointParentPostKind = "a"
	instagramCheckpointStoryKind      = "s"
	instagramCheckpointStoryMakeKind  = "u"
	instagramCheckpointStoryPostKind  = "t"
	instagramFinalProviderState       = "instagram:v1:final_container"
	instagramPublishProviderState     = "instagram:v1:publish_started"
	instagramCarouselProviderState    = "instagram:v1:carousel_children"
	instagramChildPostProviderState   = "instagram:v1:carousel_child_create_started"
	instagramParentPostProviderState  = "instagram:v1:carousel_parent_create_started"
	instagramStoryProviderState       = "instagram:v1:story_sequence"
	instagramStoryMakeProviderState   = "instagram:v1:story_container_create_started"
	instagramStoryPostProviderState   = "instagram:v1:story_publish_started"
	instagramPublishedProviderState   = "instagram:v1:published"
	instagramCheckpointReconcileDelay = 10 * time.Second
	instagramCheckpointMissingValue   = "-"
	instagramUnknownPublishedIDPrefix = "~"
	instagramCheckpointIDMaxLength    = 48
)

type InstagramAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string
	graphVersion string
}

func NewInstagramAdapter(clientID, clientSecret, redirectURI string) *InstagramAdapter {
	return &InstagramAdapter{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		graphVersion: metaGraphAPIVersion(),
	}
}

func (i *InstagramAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     i.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code", "graph_version": i.graphVersion},
	}
}

func (i *InstagramAdapter) graphURL(path string) string {
	return facebookGraphBaseURL + "/" + i.graphVersion + "/" + strings.TrimPrefix(path, "/")
}

func (i *InstagramAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	if input.Source != "instagram_locations" {
		return PublishingOptionsPage{}, fmt.Errorf("instagram publishing option source %q is not supported", input.Source)
	}
	search := strings.TrimSpace(input.Search)
	if search == "" {
		return PublishingOptionsPage{}, nil
	}
	query := url.Values{
		"q":                   {search},
		"fields":              {"id,name,location"},
		oauthParamAccessToken: {accessToken},
	}
	if input.Cursor != "" {
		query.Set("after", input.Cursor)
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	query.Set("limit", strconv.Itoa(limit))
	body, err := DoRequest(ctx, http.MethodGet, i.graphURL("pages/search")+"?"+query.Encode(), nil, nil)
	if err != nil {
		return PublishingOptionsPage{}, fmt.Errorf("searching Instagram locations: %w", err)
	}
	var response struct {
		Data []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Location *struct {
				City    string `json:"city"`
				Country string `json:"country"`
			} `json:"location"`
		} `json:"data"`
		Paging struct {
			Cursors struct {
				After string `json:"after"`
			} `json:"cursors"`
		} `json:"paging"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return PublishingOptionsPage{}, fmt.Errorf("decoding Instagram locations: %w", err)
	}
	page := PublishingOptionsPage{NextCursor: response.Paging.Cursors.After}
	for _, location := range response.Data {
		if location.Location == nil {
			continue
		}
		detail := strings.Trim(strings.Join([]string{location.Location.City, location.Location.Country}, ", "), ", ")
		label := location.Name
		if detail != "" {
			label += " · " + detail
		}
		page.Options = append(page.Options, DestinationOption{Value: location.ID, Label: label})
	}
	return page, nil
}

func (i *InstagramAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set(oauthParamClientID, i.clientID)
	params.Set(oauthParamRedirectURI, i.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", strings.Join(instagramScopes(), ","))
	params.Set("state", state)
	return facebookOAuthBaseURL + "/" + i.graphVersion + "/dialog/oauth?" + params.Encode(), nil
}

func (i *InstagramAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	token, err := exchangeMetaAuthCode(ctx, i.graphURL, i.clientID, i.clientSecret, i.redirectURI, "instagram", code)
	if err != nil {
		return nil, err
	}
	scopes, err := fetchMetaGrantedScopes(ctx, i.graphURL, token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("instagram granted permissions: %w", err)
	}
	return tokenWithGrantedScopes(token, scopes), nil
}

func (i *InstagramAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{}
}

func (i *InstagramAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("instagram page tokens do not support OpenPost refresh yet")
}

func (i *InstagramAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	respBody, err := DoRequest(ctx, http.MethodGet, i.graphURL("me?fields=id,name&access_token="+url.QueryEscape(accessToken)), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("instagram facebook profile: %w", err)
	}
	var profile struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &profile); err != nil {
		return nil, fmt.Errorf("decoding instagram facebook profile: %w", err)
	}
	if profile.Error.Message != "" {
		return nil, fmt.Errorf("instagram facebook profile: %s", profile.Error.Message)
	}
	return &UserProfile{ID: profile.ID, Username: profile.Name, DisplayName: profile.Name}, nil
}

func (i *InstagramAdapter) ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error) {
	pages, err := i.listInstagramPages(ctx, token)
	if err != nil {
		return nil, err
	}
	options := make([]AccountSelectionOption, 0, len(pages))
	for _, page := range pages {
		ig := page.InstagramBusinessAccount
		options = append(options, AccountSelectionOption{
			ID:          ig.ID,
			Username:    firstNonEmptyString(ig.Username, ig.Name, page.Name),
			DisplayName: firstNonEmptyString(ig.Name, ig.Username, page.Name),
			AvatarURL:   firstNonEmptyString(ig.ProfilePictureURL, page.Picture.Data.URL),
			Kind:        "Instagram professional",
			Description: firstNonEmptyString(ig.AccountType, "Business or Creator account"),
			Extra: map[string]string{
				"page_id":      page.ID,
				"account_type": strings.ToLower(ig.AccountType),
			},
		})
	}
	return options, nil
}

func (i *InstagramAdapter) SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error) {
	pages, err := i.listInstagramPages(ctx, token)
	if err != nil {
		return nil, err
	}
	for _, page := range pages {
		ig := page.InstagramBusinessAccount
		if ig.ID != selectionID {
			continue
		}
		if page.AccessToken == "" {
			return nil, fmt.Errorf("instagram page %s did not include a page access token", page.ID)
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
		pageToken.Extra["instagram_business_account_id"] = ig.ID

		return &SelectedAccount{
			AccountID:        ig.ID,
			AccountUsername:  firstNonEmptyString(ig.Username, ig.Name, page.Name),
			AccountAvatarURL: firstNonEmptyString(ig.ProfilePictureURL, page.Picture.Data.URL),
			Token:            &pageToken,
			CapabilityState: map[string]string{
				"instagram_account_type": strings.ToLower(firstNonEmptyString(ig.AccountType, "professional")),
				"facebook_page_id":       page.ID,
			},
		}, nil
	}
	return nil, fmt.Errorf("instagram account selection %s was not found", selectionID)
}

func (i *InstagramAdapter) listInstagramPages(ctx context.Context, token *TokenResult) ([]instagramPage, error) {
	fields := "id,name,username,access_token,picture.type(square),instagram_business_account{id,username,name,profile_picture_url}"
	managedPages, err := listMetaManagedPages(ctx, i.graphURL, token, fields, "instagram")
	if err != nil {
		return nil, fmt.Errorf("instagram accounts: %w", err)
	}
	pages := make([]instagramPage, 0, len(managedPages))
	for _, page := range managedPages {
		if page.InstagramBusinessAccount.ID != "" {
			pages = append(pages, page)
		}
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("OpenPost could not find a professional Instagram account linked to a Facebook Page this profile manages; Accounts Center profile links do not provide this access")
	}
	return pages, nil
}

func (i *InstagramAdapter) UploadMedia(_ context.Context, _ string, _ string, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("instagram uses publicly accessible HTTPS media URLs for the initial adapter")
}

func (i *InstagramAdapter) Publish(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest) (PublishResult, error) {
	result, err := executePublishWrite(req, "publish_media", func() (string, error) {
		return i.publish(ctx, accessToken, instagramUserID, req)
	})
	return result, normalizeMetaPublishError(err)
}

func (i *InstagramAdapter) publish(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest) (string, error) {
	if req.ReplyToID != "" {
		return i.publishCommentReply(ctx, accessToken, req.ReplyToID, req.Content)
	}
	if len(req.PlatformMediaIDs) == 0 || len(req.PlatformMediaIDs) != len(req.Media) {
		return "", fmt.Errorf("instagram publishing requires media attachment metadata")
	}
	for _, mediaURL := range req.PlatformMediaIDs {
		if !strings.HasPrefix(mediaURL, "https://") {
			return "", fmt.Errorf("instagram requires a publicly-accessible HTTPS media URL. Set OPENPOST_MEDIA_URL to your public media base URL")
		}
	}
	if instagramIsStory(req) {
		return i.publishStories(ctx, accessToken, instagramUserID, req)
	}
	if len(req.PlatformMediaIDs) > 1 {
		return i.publishCarousel(ctx, accessToken, instagramUserID, req)
	}

	containerID, err := i.createMediaContainer(ctx, accessToken, instagramUserID, req.Content, req.PlatformMediaIDs[0], isVideoMime(req.Media[0].MimeType), false, req, mediaSettingsAt(req, 0), mediaAltTextAt(req, 0))
	if err != nil {
		return "", err
	}
	if err := checkpointInstagramFinalContainer(req, containerID); err != nil {
		return "", err
	}
	if err := i.waitForContainer(ctx, accessToken, containerID); err != nil {
		return "", err
	}
	if err := checkpointInstagramPublishIntent(req, containerID); err != nil {
		return "", err
	}
	return i.publishMediaContainer(ctx, accessToken, instagramUserID, containerID)
}

//nolint:gocyclo
func (i *InstagramAdapter) createMediaContainer(ctx context.Context, accessToken, instagramUserID, caption, mediaURL string, video bool, carouselItem bool, req *PublishRequest, mediaSettings map[string]interface{}, altText string) (string, error) {
	values := map[string]string{
		"caption":             strings.TrimSpace(caption),
		oauthParamAccessToken: accessToken,
	}
	if video {
		values["video_url"] = mediaURL
		if instagramIsStory(req) {
			values["media_type"] = "STORIES"
		} else if instagramIsReel(req) {
			values["media_type"] = "REELS"
		}
	} else {
		values["image_url"] = mediaURL
		if instagramIsStory(req) {
			values["media_type"] = "STORIES"
		}
	}
	if carouselItem {
		values["is_carousel_item"] = "true"
		delete(values, "caption")
	}
	if collaborators := settingString(req.Settings, "collaborators"); collaborators != "" && !carouselItem {
		values["collaborators"] = stringListJSON(collaborators)
	}
	if locationID := settingString(req.Settings, "location_id"); locationID != "" && !carouselItem {
		values["location_id"] = locationID
	}
	if settingBool(req.Settings, "is_trial_reel") && !carouselItem {
		graduation := settingString(req.Settings, "graduation_strategy")
		if graduation != "MANUAL" && graduation != "SS_PERFORMANCE" {
			return "", fmt.Errorf("instagram trial reels require a valid graduation strategy")
		}
		trialParams, _ := json.Marshal(map[string]string{"graduation_strategy": graduation})
		values["trial_params"] = string(trialParams)
	}
	if thumb := settingString(req.Settings, "thumbnail_timestamp_ms"); thumb != "" && video && !carouselItem {
		values["thumb_offset"] = thumb
	}
	if coverURL := settingString(req.Settings, "cover_media_id"); strings.HasPrefix(coverURL, "https://") && video && !carouselItem {
		values["cover_url"] = coverURL
	}
	if settingBool(req.Settings, "share_to_feed") && instagramIsReel(req) && !carouselItem {
		values["share_to_feed"] = "true"
	}
	if altText != "" && !video {
		values["alt_text"] = altText
	}
	if userTags := settingString(mediaSettings, "user_tags"); userTags != "" {
		normalized, err := instagramMediaTags(userTags, "username", 20, !instagramIsStory(req))
		if err != nil {
			return "", err
		}
		values["user_tags"] = normalized
	}
	if productTags := settingString(mediaSettings, "product_tags"); productTags != "" {
		normalized, err := instagramMediaTags(productTags, "product_id", 5, false)
		if err != nil {
			return "", err
		}
		values["product_tags"] = normalized
	}

	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, i.graphURL(instagramUserID+"/media"), values, nil)
	if err != nil {
		return "", fmt.Errorf("instagram media container: %w", err)
	}
	return instagramIDFromResponse("instagram media container", respBody)
}

func instagramMediaTags(raw, valueKey string, maximum int, coordinatesRequired bool) (string, error) {
	var tags []map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return "", fmt.Errorf("instagram %s tags must be a JSON array", valueKey)
	}
	if len(tags) > maximum {
		return "", fmt.Errorf("instagram supports at most %d %s tags", maximum, valueKey)
	}
	for _, tag := range tags {
		if strings.TrimSpace(fmt.Sprint(tag[valueKey])) == "" {
			return "", fmt.Errorf("instagram %s tag is missing %s", valueKey, valueKey)
		}
		for _, coordinate := range []string{"x", "y"} {
			rawCoordinate, exists := tag[coordinate]
			if !exists {
				if coordinatesRequired {
					return "", fmt.Errorf("instagram %s tag is missing %s", valueKey, coordinate)
				}
				continue
			}
			coordinateValue, ok := rawCoordinate.(float64)
			if !ok || coordinateValue < 0 || coordinateValue > 1 {
				return "", fmt.Errorf("instagram %s tag %s must be between 0 and 1", valueKey, coordinate)
			}
		}
	}
	encoded, err := json.Marshal(tags)
	if err != nil {
		return "", fmt.Errorf("encoding instagram %s tags: %w", valueKey, err)
	}
	return string(encoded), nil
}

func (i *InstagramAdapter) publishCarousel(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest) (string, error) {
	if len(req.PlatformMediaIDs) < 2 || len(req.PlatformMediaIDs) > 10 {
		return "", fmt.Errorf("instagram carousel requires 2-10 media items")
	}
	childIDs := make([]string, 0, len(req.PlatformMediaIDs))
	for index, mediaURL := range req.PlatformMediaIDs {
		if err := req.Checkpoint(pendingInstagramCarouselCreateResult(childIDs)); err != nil {
			return "", err
		}
		childID, err := i.createMediaContainer(ctx, accessToken, instagramUserID, "", mediaURL, isVideoMime(req.Media[index].MimeType), true, req, mediaSettingsAt(req, index), mediaAltTextAt(req, index))
		if err != nil {
			return "", err
		}
		childIDs = append(childIDs, childID)
		if err := req.Checkpoint(pendingInstagramCarouselResult(childIDs)); err != nil {
			return "", err
		}
		if err := i.waitForContainer(ctx, accessToken, childID); err != nil {
			return "", err
		}
	}
	if err := req.Checkpoint(pendingInstagramCarouselParentResult(childIDs)); err != nil {
		return "", err
	}
	containerID, err := i.createCarouselContainer(ctx, accessToken, instagramUserID, req, childIDs)
	if err != nil {
		return "", err
	}
	if err := checkpointInstagramFinalContainer(req, containerID); err != nil {
		return "", err
	}
	if err := i.waitForContainer(ctx, accessToken, containerID); err != nil {
		return "", err
	}
	if err := checkpointInstagramPublishIntent(req, containerID); err != nil {
		return "", err
	}
	return i.publishMediaContainer(ctx, accessToken, instagramUserID, containerID)
}

func (i *InstagramAdapter) publishStories(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest) (string, error) {
	ids := make([]string, 0, len(req.PlatformMediaIDs))
	for index, mediaURL := range req.PlatformMediaIDs {
		if err := req.Checkpoint(pendingInstagramStoryCreateResult(index, ids)); err != nil {
			return "", err
		}
		containerID, err := i.createMediaContainer(ctx, accessToken, instagramUserID, "", mediaURL, isVideoMime(req.Media[index].MimeType), false, req, mediaSettingsAt(req, index), mediaAltTextAt(req, index))
		if err != nil {
			return "", err
		}
		if err := req.Checkpoint(pendingInstagramStoryResult(index, ids, containerID)); err != nil {
			return "", err
		}
		if err := i.waitForContainer(ctx, accessToken, containerID); err != nil {
			return "", err
		}
		if err := req.Checkpoint(pendingInstagramStoryPublishResult(index, ids, containerID)); err != nil {
			return "", err
		}
		publishedID, err := i.publishMediaContainer(ctx, accessToken, instagramUserID, containerID)
		if err != nil {
			return "", err
		}
		ids = append(ids, publishedID)
		if index+1 < len(req.PlatformMediaIDs) {
			if err := req.Checkpoint(pendingInstagramStoryResult(index+1, ids, "")); err != nil {
				return "", err
			}
		}
	}
	return strings.Join(ids, ","), nil
}

func (i *InstagramAdapter) createCarouselContainer(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest, childIDs []string) (string, error) {
	values := map[string]string{
		"media_type":          "CAROUSEL",
		"children":            strings.Join(childIDs, ","),
		"caption":             strings.TrimSpace(req.Content),
		oauthParamAccessToken: accessToken,
	}
	if collaborators := settingString(req.Settings, "collaborators"); collaborators != "" {
		values["collaborators"] = stringListJSON(collaborators)
	}
	if locationID := settingString(req.Settings, "location_id"); locationID != "" {
		values["location_id"] = locationID
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, i.graphURL(instagramUserID+"/media"), values, nil)
	if err != nil {
		return "", fmt.Errorf("instagram carousel container: %w", err)
	}
	return instagramIDFromResponse("instagram carousel container", respBody)
}

func instagramIsStory(req *PublishRequest) bool {
	return req.Profile == "story" || req.OutputProfile == "instagram.story"
}

func instagramIsReel(req *PublishRequest) bool {
	return req.Profile == "short_video" || req.OutputProfile == "instagram.reel"
}

func mediaSettingsAt(req *PublishRequest, index int) map[string]interface{} {
	if index < 0 || index >= len(req.MediaSettings) {
		return nil
	}
	return req.MediaSettings[index]
}

func mediaAltTextAt(req *PublishRequest, index int) string {
	if index < 0 || index >= len(req.MediaAltTexts) {
		return ""
	}
	return req.MediaAltTexts[index]
}

func stringListJSON(raw string) string {
	values := strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' })
	clean := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			clean = append(clean, value)
		}
	}
	encoded, _ := json.Marshal(clean)
	return string(encoded)
}

func (i *InstagramAdapter) publishCommentReply(ctx context.Context, accessToken, commentID, message string) (string, error) {
	values := map[string]string{
		"message":             strings.TrimSpace(message),
		oauthParamAccessToken: accessToken,
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, i.graphURL(commentID+"/replies"), values, nil)
	if err != nil {
		return "", fmt.Errorf("instagram comment reply: %w", err)
	}
	return instagramIDFromResponse("instagram comment reply", respBody)
}

func (i *InstagramAdapter) ListComments(ctx context.Context, accessToken, _ string, externalID string) ([]Comment, error) {
	fields := "id,text,timestamp,username,hidden"
	endpoint := i.graphURL(externalID+"/comments") + "?fields=" + url.QueryEscape(fields) + "&access_token=" + url.QueryEscape(accessToken)
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("instagram comments: %w", err)
	}

	var result struct {
		Data []struct {
			ID        string `json:"id"`
			Text      string `json:"text"`
			Timestamp string `json:"timestamp"`
			Username  string `json:"username"`
			Hidden    bool   `json:"hidden"`
		} `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding instagram comments: %w", err)
	}
	if result.Error.Message != "" {
		return nil, fmt.Errorf("instagram comments: %s", result.Error.Message)
	}

	comments := make([]Comment, 0, len(result.Data))
	for _, item := range result.Data {
		comments = append(comments, Comment{
			ID:         item.ID,
			AuthorName: item.Username,
			Text:       item.Text,
			CreatedAt:  item.Timestamp,
			Hidden:     item.Hidden,
			CanReply:   true,
			CanHide:    true,
			CanDelete:  true,
		})
	}
	return comments, nil
}

func (i *InstagramAdapter) ResolveContentURL(ctx context.Context, accessToken, _ string, externalID string) (string, error) {
	return resolveMetaContentURL(ctx, i.graphURL, accessToken, externalID, "permalink", "instagram")
}

func (i *InstagramAdapter) ReplyToComment(ctx context.Context, accessToken, _ string, commentID, message string) (string, error) {
	return i.publishCommentReply(ctx, accessToken, commentID, message)
}

func (i *InstagramAdapter) HideComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := DoFormURLEncoded(ctx, http.MethodPost, i.graphURL(commentID), map[string]string{
		"hide":                "true",
		oauthParamAccessToken: accessToken,
	}, nil)
	if err != nil {
		return fmt.Errorf("instagram hide comment: %w", err)
	}
	return nil
}

func (i *InstagramAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	endpoint := i.graphURL(commentID) + "?access_token=" + url.QueryEscape(accessToken)
	if _, err := DoRequest(ctx, http.MethodDelete, endpoint, nil, nil); err != nil {
		return fmt.Errorf("instagram delete comment: %w", err)
	}
	return nil
}

func (i *InstagramAdapter) waitForContainer(ctx context.Context, accessToken, containerID string) error {
	const maxAttempts = 6
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		status, err := i.containerStatus(ctx, accessToken, containerID)
		if err != nil {
			return err
		}
		switch status {
		case "", "FINISHED", "PUBLISHED":
			return nil
		case "ERROR", "EXPIRED":
			return fmt.Errorf("instagram container processing failed: %s", status)
		}
		if attempt < maxAttempts {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(10 * time.Second):
			}
		}
	}
	return fmt.Errorf("instagram container processing timed out")
}

func (i *InstagramAdapter) containerStatus(ctx context.Context, accessToken, containerID string) (string, error) {
	respBody, err := DoRequest(ctx, http.MethodGet, i.graphURL(containerID+"?fields=status_code&access_token="+url.QueryEscape(accessToken)), nil, nil)
	if err != nil {
		return "", fmt.Errorf("instagram container status: %w", err)
	}
	var statusResp struct {
		StatusCode string `json:"status_code"`
		Error      struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &statusResp); err != nil {
		return "", fmt.Errorf("decoding instagram container status: %w", err)
	}
	if statusResp.Error.Message != "" {
		return "", &HTTPError{StatusCode: http.StatusBadRequest, Code: "instagram_processing_error"}
	}
	return strings.ToUpper(strings.TrimSpace(statusResp.StatusCode)), nil
}

type instagramPublishCheckpoint struct {
	kind         string
	containerID  string
	references   []string
	currentIndex int
}

func checkpointInstagramFinalContainer(req *PublishRequest, containerID string) error {
	return req.Checkpoint(pendingInstagramFinalResult(containerID))
}

func checkpointInstagramPublishIntent(req *PublishRequest, containerID string) error {
	return req.Checkpoint(pendingInstagramPublishResult(containerID))
}

func pendingInstagramFinalResult(containerID string) PublishResult {
	return pendingInstagramResult(
		instagramFinalProviderState,
		instagramCheckpointPrefix+instagramCheckpointFinalKind+":"+strings.TrimSpace(containerID),
	)
}

func pendingInstagramPublishResult(containerID string) PublishResult {
	return pendingInstagramResult(
		instagramPublishProviderState,
		instagramCheckpointPrefix+instagramCheckpointPublishKind+":"+strings.TrimSpace(containerID),
	)
}

func pendingInstagramCarouselResult(childIDs []string) PublishResult {
	return pendingInstagramCarouselStageResult(instagramCheckpointCarouselKind, instagramCarouselProviderState, childIDs)
}

func pendingInstagramCarouselCreateResult(childIDs []string) PublishResult {
	return pendingInstagramCarouselStageResult(instagramCheckpointChildPostKind, instagramChildPostProviderState, childIDs)
}

func pendingInstagramCarouselParentResult(childIDs []string) PublishResult {
	return pendingInstagramCarouselStageResult(instagramCheckpointParentPostKind, instagramParentPostProviderState, childIDs)
}

func pendingInstagramCarouselStageResult(kind, providerState string, childIDs []string) PublishResult {
	references := strings.Join(childIDs, ",")
	if references == "" {
		references = instagramCheckpointMissingValue
	}
	return pendingInstagramResult(providerState, instagramCheckpointPrefix+kind+":"+references)
}

func pendingInstagramStoryResult(currentIndex int, publishedIDs []string, containerID string) PublishResult {
	return pendingInstagramStoryStageResult(instagramCheckpointStoryKind, instagramStoryProviderState, currentIndex, publishedIDs, containerID)
}

func pendingInstagramStoryCreateResult(currentIndex int, publishedIDs []string) PublishResult {
	return pendingInstagramStoryStageResult(instagramCheckpointStoryMakeKind, instagramStoryMakeProviderState, currentIndex, publishedIDs, "")
}

func pendingInstagramStoryPublishResult(currentIndex int, publishedIDs []string, containerID string) PublishResult {
	return pendingInstagramStoryStageResult(instagramCheckpointStoryPostKind, instagramStoryPostProviderState, currentIndex, publishedIDs, containerID)
}

func pendingInstagramStoryStageResult(kind, providerState string, currentIndex int, publishedIDs []string, containerID string) PublishResult {
	published := strings.Join(publishedIDs, ",")
	if published == "" {
		published = instagramCheckpointMissingValue
	}
	containerID = strings.TrimSpace(containerID)
	if containerID == "" {
		containerID = instagramCheckpointMissingValue
	}
	return pendingInstagramResult(
		providerState,
		fmt.Sprintf("%s%s:%d:%s:%s", instagramCheckpointPrefix, kind, currentIndex, published, containerID),
	)
}

func pendingInstagramResult(providerState, providerReference string) PublishResult {
	return PublishResult{
		SubmissionState:   PublishSubmissionPending,
		ProviderState:     providerState,
		ProviderReference: providerReference,
		RetrySafety:       PublishRetryReconcileOnly,
		ReconcileAfter:    instagramCheckpointReconcileDelay,
	}
}

func parseInstagramPublishCheckpoint(providerReference string) (instagramPublishCheckpoint, error) {
	providerReference = strings.TrimSpace(providerReference)
	if !strings.HasPrefix(providerReference, instagramCheckpointPrefix) {
		return instagramPublishCheckpoint{}, fmt.Errorf("instagram publish reconciliation requires a versioned checkpoint")
	}
	value := strings.TrimPrefix(providerReference, instagramCheckpointPrefix)
	if !strings.Contains(value, ":") {
		if err := validateInstagramCheckpointID(value); err != nil {
			return instagramPublishCheckpoint{}, err
		}
		return instagramPublishCheckpoint{kind: instagramCheckpointFinalKind, containerID: value}, nil
	}
	kind, payload, _ := strings.Cut(value, ":")
	switch kind {
	case instagramCheckpointFinalKind, instagramCheckpointPublishKind:
		if err := validateInstagramCheckpointID(payload); err != nil {
			return instagramPublishCheckpoint{}, err
		}
		return instagramPublishCheckpoint{kind: kind, containerID: payload}, nil
	case instagramCheckpointCarouselKind, instagramCheckpointChildPostKind, instagramCheckpointParentPostKind:
		return parseInstagramCarouselCheckpoint(kind, payload)
	case instagramCheckpointStoryKind, instagramCheckpointStoryMakeKind, instagramCheckpointStoryPostKind:
		return parseInstagramStoryCheckpoint(kind, payload)
	default:
		return instagramPublishCheckpoint{}, fmt.Errorf("instagram publish checkpoint version or stage is unsupported")
	}
}

func parseInstagramCarouselCheckpoint(kind, payload string) (instagramPublishCheckpoint, error) {
	var references []string
	var err error
	if payload != instagramCheckpointMissingValue {
		references, err = parseInstagramCheckpointIDs(payload)
	}
	if err != nil || (kind == instagramCheckpointCarouselKind && len(references) == 0) || len(references) > 10 {
		return instagramPublishCheckpoint{}, fmt.Errorf("instagram carousel checkpoint is invalid")
	}
	return instagramPublishCheckpoint{kind: kind, references: references}, nil
}

func parseInstagramStoryCheckpoint(kind, payload string) (instagramPublishCheckpoint, error) {
	parts := strings.Split(payload, ":")
	if len(parts) != 3 {
		return instagramPublishCheckpoint{}, fmt.Errorf("instagram story checkpoint is invalid")
	}
	currentIndex, err := strconv.Atoi(parts[0])
	if err != nil || currentIndex < 0 || currentIndex > 9 {
		return instagramPublishCheckpoint{}, fmt.Errorf("instagram story checkpoint index is invalid")
	}
	references, err := parseOptionalInstagramCheckpointIDs(parts[1])
	if err != nil {
		return instagramPublishCheckpoint{}, fmt.Errorf("instagram story checkpoint media ids are invalid")
	}
	containerID := ""
	if parts[2] != instagramCheckpointMissingValue {
		containerID = parts[2]
		if err := validateInstagramCheckpointID(containerID); err != nil {
			return instagramPublishCheckpoint{}, err
		}
	}
	return instagramPublishCheckpoint{kind: kind, references: references, currentIndex: currentIndex, containerID: containerID}, nil
}

func parseOptionalInstagramCheckpointIDs(value string) ([]string, error) {
	if value == instagramCheckpointMissingValue {
		return nil, nil
	}
	return parseInstagramCheckpointIDs(value)
}

func parseInstagramCheckpointIDs(value string) ([]string, error) {
	values := strings.Split(value, ",")
	for _, candidate := range values {
		if err := validateInstagramCheckpointID(candidate); err != nil {
			return nil, err
		}
	}
	return values, nil
}

func validateInstagramCheckpointID(value string) error {
	rawValue := strings.TrimPrefix(value, instagramUnknownPublishedIDPrefix)
	if rawValue == "" || len(rawValue) > instagramCheckpointIDMaxLength || strings.ContainsAny(rawValue, ":,/?#\r\n\t") {
		return fmt.Errorf("instagram publish checkpoint contains an invalid provider id")
	}
	return nil
}

func (i *InstagramAdapter) ResumePublish(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest, providerReference string) (PublishResult, error) {
	checkpoint, err := parseInstagramPublishCheckpoint(providerReference)
	if err != nil {
		return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, err
	}
	switch checkpoint.kind {
	case instagramCheckpointFinalKind, instagramCheckpointPublishKind:
		return i.resumeFinalContainer(ctx, accessToken, instagramUserID, req, checkpoint)
	case instagramCheckpointCarouselKind, instagramCheckpointChildPostKind, instagramCheckpointParentPostKind:
		return i.resumeCarousel(ctx, accessToken, instagramUserID, req, checkpoint)
	case instagramCheckpointStoryKind, instagramCheckpointStoryMakeKind, instagramCheckpointStoryPostKind:
		return i.resumeStorySequence(ctx, accessToken, instagramUserID, req, checkpoint)
	default:
		return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, fmt.Errorf("instagram publish checkpoint stage is unsupported")
	}
}

func (i *InstagramAdapter) resumeFinalContainer(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest, checkpoint instagramPublishCheckpoint) (PublishResult, error) {
	pending := pendingInstagramFinalResult(checkpoint.containerID)
	if checkpoint.kind == instagramCheckpointPublishKind {
		pending = pendingInstagramPublishResult(checkpoint.containerID)
	}
	status, err := i.containerStatus(ctx, accessToken, checkpoint.containerID)
	if err != nil {
		return pending, normalizeMetaPublishError(err)
	}
	switch status {
	case "FINISHED":
		if checkpoint.kind == instagramCheckpointPublishKind {
			return pending, nil
		}
		if err := checkpointInstagramPublishIntent(req, checkpoint.containerID); err != nil {
			return pending, err
		}
		pending = pendingInstagramPublishResult(checkpoint.containerID)
		externalID, publishErr := i.publishMediaContainer(ctx, accessToken, instagramUserID, checkpoint.containerID)
		if publishErr != nil {
			publishErr = normalizeMetaPublishError(publishErr)
			var providerErr *HTTPError
			if errors.As(publishErr, &providerErr) && providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 && providerErr.StatusCode != http.StatusRequestTimeout && providerErr.StatusCode != http.StatusTooManyRequests {
				return PublishResult{SubmissionState: PublishSubmissionRejected, ProviderState: instagramFinalProviderState, ProviderReference: pending.ProviderReference, RetrySafety: PublishRetryNever}, publishErr
			}
			return pending, publishErr
		}
		result := AcceptedPublishResult(externalID)
		result.ProviderState = instagramPublishedProviderState
		result.ProviderReference = pending.ProviderReference
		return result, nil
	case "PUBLISHED":
		result := AcceptedPublishResult("")
		result.ProviderState = instagramPublishedProviderState
		result.ProviderReference = pending.ProviderReference
		return result, nil
	case "ERROR", "EXPIRED":
		return PublishResult{
			SubmissionState:   PublishSubmissionRejected,
			ProviderState:     instagramFinalProviderState,
			ProviderReference: pending.ProviderReference,
			RetrySafety:       PublishRetryNever,
		}, &HTTPError{StatusCode: http.StatusBadRequest, Code: "instagram_processing_error"}
	default:
		return pending, nil
	}
}

func (i *InstagramAdapter) resumeCarousel(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest, checkpoint instagramPublishCheckpoint) (PublishResult, error) {
	pending := pendingInstagramCarouselCheckpoint(checkpoint)
	if err := validateInstagramCarouselCheckpoint(req, checkpoint); err != nil {
		return rejectedInstagramCheckpoint(pending, err.Error())
	}
	for _, childID := range checkpoint.references {
		status, err := i.containerStatus(ctx, accessToken, childID)
		if err != nil {
			return pending, normalizeMetaPublishError(err)
		}
		switch status {
		case "FINISHED":
		case "ERROR", "EXPIRED", "PUBLISHED":
			return rejectedInstagramCheckpoint(pending, "instagram carousel child container is not reusable")
		default:
			return pending, nil
		}
	}
	if checkpoint.kind == instagramCheckpointChildPostKind || checkpoint.kind == instagramCheckpointParentPostKind {
		return pending, nil
	}
	if len(checkpoint.references) < len(req.PlatformMediaIDs) {
		index := len(checkpoint.references)
		if err := req.Checkpoint(pendingInstagramCarouselCreateResult(checkpoint.references)); err != nil {
			return pending, err
		}
		pending = pendingInstagramCarouselCreateResult(checkpoint.references)
		childID, err := i.createMediaContainer(ctx, accessToken, instagramUserID, "", req.PlatformMediaIDs[index], isVideoMime(req.Media[index].MimeType), true, req, mediaSettingsAt(req, index), mediaAltTextAt(req, index))
		if err != nil {
			return instagramPendingOrRejected(pending, err)
		}
		return pendingInstagramCarouselResult(append(append([]string(nil), checkpoint.references...), childID)), nil
	}
	if err := req.Checkpoint(pendingInstagramCarouselParentResult(checkpoint.references)); err != nil {
		return pending, err
	}
	pending = pendingInstagramCarouselParentResult(checkpoint.references)
	containerID, err := i.createCarouselContainer(ctx, accessToken, instagramUserID, req, checkpoint.references)
	if err != nil {
		return instagramPendingOrRejected(pending, err)
	}
	return pendingInstagramFinalResult(containerID), nil
}

func pendingInstagramCarouselCheckpoint(checkpoint instagramPublishCheckpoint) PublishResult {
	switch checkpoint.kind {
	case instagramCheckpointChildPostKind:
		return pendingInstagramCarouselCreateResult(checkpoint.references)
	case instagramCheckpointParentPostKind:
		return pendingInstagramCarouselParentResult(checkpoint.references)
	default:
		return pendingInstagramCarouselResult(checkpoint.references)
	}
}

func validateInstagramCarouselCheckpoint(req *PublishRequest, checkpoint instagramPublishCheckpoint) error {
	if req == nil || instagramIsStory(req) || len(req.PlatformMediaIDs) < 2 || len(req.PlatformMediaIDs) > 10 || len(req.Media) != len(req.PlatformMediaIDs) || len(checkpoint.references) > len(req.PlatformMediaIDs) {
		return fmt.Errorf("instagram carousel checkpoint does not match the publish request")
	}
	if checkpoint.kind == instagramCheckpointChildPostKind && len(checkpoint.references) >= len(req.PlatformMediaIDs) {
		return fmt.Errorf("instagram carousel child checkpoint has no remaining child")
	}
	if checkpoint.kind == instagramCheckpointParentPostKind && len(checkpoint.references) != len(req.PlatformMediaIDs) {
		return fmt.Errorf("instagram carousel parent checkpoint is incomplete")
	}
	return nil
}

func (i *InstagramAdapter) resumeStorySequence(ctx context.Context, accessToken, instagramUserID string, req *PublishRequest, checkpoint instagramPublishCheckpoint) (PublishResult, error) {
	pending := pendingInstagramStoryCheckpoint(checkpoint)
	if err := validateInstagramStoryCheckpoint(req, checkpoint); err != nil {
		return rejectedInstagramCheckpoint(pending, err.Error())
	}
	if checkpoint.kind == instagramCheckpointStoryMakeKind {
		if checkpoint.containerID != "" {
			return rejectedInstagramCheckpoint(pending, "instagram story creation checkpoint contains a container")
		}
		return pending, nil
	}
	if checkpoint.containerID == "" {
		index := checkpoint.currentIndex
		if err := req.Checkpoint(pendingInstagramStoryCreateResult(index, checkpoint.references)); err != nil {
			return pending, err
		}
		pending = pendingInstagramStoryCreateResult(index, checkpoint.references)
		containerID, err := i.createMediaContainer(ctx, accessToken, instagramUserID, "", req.PlatformMediaIDs[index], isVideoMime(req.Media[index].MimeType), false, req, mediaSettingsAt(req, index), mediaAltTextAt(req, index))
		if err != nil {
			return instagramPendingOrRejected(pending, err)
		}
		return pendingInstagramStoryResult(index, checkpoint.references, containerID), nil
	}
	status, err := i.containerStatus(ctx, accessToken, checkpoint.containerID)
	if err != nil {
		return pending, normalizeMetaPublishError(err)
	}
	externalID := ""
	switch status {
	case "FINISHED":
		if checkpoint.kind == instagramCheckpointStoryPostKind {
			return pending, nil
		}
		if err := req.Checkpoint(pendingInstagramStoryPublishResult(checkpoint.currentIndex, checkpoint.references, checkpoint.containerID)); err != nil {
			return pending, err
		}
		pending = pendingInstagramStoryPublishResult(checkpoint.currentIndex, checkpoint.references, checkpoint.containerID)
		externalID, err = i.publishMediaContainer(ctx, accessToken, instagramUserID, checkpoint.containerID)
		if err != nil {
			return instagramPendingOrRejected(pending, err)
		}
	case "PUBLISHED":
		externalID = instagramUnknownPublishedIDPrefix + checkpoint.containerID
	case "ERROR", "EXPIRED":
		return rejectedInstagramCheckpoint(pending, "instagram story container processing failed")
	default:
		return pending, nil
	}
	publishedIDs := append(append([]string(nil), checkpoint.references...), externalID)
	nextIndex := checkpoint.currentIndex + 1
	if nextIndex == len(req.PlatformMediaIDs) {
		return acceptedInstagramStoryResult(publishedIDs, pending.ProviderReference), nil
	}
	return pendingInstagramStoryResult(nextIndex, publishedIDs, ""), nil
}

func pendingInstagramStoryCheckpoint(checkpoint instagramPublishCheckpoint) PublishResult {
	switch checkpoint.kind {
	case instagramCheckpointStoryMakeKind:
		return pendingInstagramStoryCreateResult(checkpoint.currentIndex, checkpoint.references)
	case instagramCheckpointStoryPostKind:
		return pendingInstagramStoryPublishResult(checkpoint.currentIndex, checkpoint.references, checkpoint.containerID)
	default:
		return pendingInstagramStoryResult(checkpoint.currentIndex, checkpoint.references, checkpoint.containerID)
	}
}

func validateInstagramStoryCheckpoint(req *PublishRequest, checkpoint instagramPublishCheckpoint) error {
	if req == nil || !instagramIsStory(req) || len(req.PlatformMediaIDs) == 0 || len(req.PlatformMediaIDs) != len(req.Media) || checkpoint.currentIndex >= len(req.PlatformMediaIDs) || len(checkpoint.references) != checkpoint.currentIndex {
		return fmt.Errorf("instagram story checkpoint does not match the publish request")
	}
	return nil
}

func acceptedInstagramStoryResult(publishedIDs []string, providerReference string) PublishResult {
	knownIDs := make([]string, 0, len(publishedIDs))
	for _, publishedID := range publishedIDs {
		if !strings.HasPrefix(publishedID, instagramUnknownPublishedIDPrefix) {
			knownIDs = append(knownIDs, publishedID)
		}
	}
	result := AcceptedPublishResult(strings.Join(knownIDs, ","))
	result.ProviderState = instagramPublishedProviderState
	result.ProviderReference = providerReference
	return result
}

func instagramPendingOrRejected(pending PublishResult, err error) (PublishResult, error) {
	err = normalizeMetaPublishError(err)
	var providerErr *HTTPError
	if errors.As(err, &providerErr) && providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 && providerErr.StatusCode != http.StatusRequestTimeout && providerErr.StatusCode != http.StatusTooManyRequests {
		pending.SubmissionState = PublishSubmissionRejected
		pending.RetrySafety = PublishRetryNever
	}
	return pending, err
}

func rejectedInstagramCheckpoint(pending PublishResult, message string) (PublishResult, error) {
	pending.SubmissionState = PublishSubmissionRejected
	pending.RetrySafety = PublishRetryNever
	return pending, fmt.Errorf("%s", message)
}

func (i *InstagramAdapter) publishMediaContainer(ctx context.Context, accessToken, instagramUserID, containerID string) (string, error) {
	values := map[string]string{
		"creation_id":         containerID,
		oauthParamAccessToken: accessToken,
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, i.graphURL(instagramUserID+"/media_publish"), values, nil)
	if err != nil {
		return "", fmt.Errorf("instagram media publish: %w", err)
	}
	return instagramIDFromResponse("instagram media publish", respBody)
}

func instagramIDFromResponse(label string, respBody []byte) (string, error) {
	var resp struct {
		ID    string `json:"id"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return "", fmt.Errorf("decoding %s: %w", label, err)
	}
	if resp.Error.Message != "" {
		return "", &HTTPError{StatusCode: http.StatusBadRequest, Code: "instagram_publish_error"}
	}
	if resp.ID == "" {
		return "", fmt.Errorf("%s: missing id", label)
	}
	if err := validateInstagramCheckpointID(resp.ID); err != nil {
		return "", fmt.Errorf("%s: invalid id", label)
	}
	return resp.ID, nil
}

func validateInstagramMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) < 1 || len(media) > 10 {
		return []MediaValidationIssue{{
			Provider: providerInstagram,
			Severity: severityError,
			Message:  "Instagram publishing requires 1-10 image or video attachments.",
		}}
	}
	for _, item := range media {
		if isInstagramImageMime(item.MimeType) || isInstagramVideoMime(item.MimeType) {
			continue
		}
		return []MediaValidationIssue{{
			Provider: providerInstagram,
			MediaID:  item.ID,
			Severity: severityError,
			Message:  "Instagram supports JPEG, PNG, WebP, MP4, or MOV media.",
		}}
	}
	return nil
}

func isInstagramImageMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func isInstagramVideoMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case videoTypeMP4, "video/quicktime":
		return true
	default:
		return false
	}
}

func instagramScopes() []string {
	return []string{
		metaBusinessManagementScope,
		"instagram_basic",
		"instagram_content_publish",
		"instagram_manage_comments",
		"instagram_manage_messages",
		"instagram_manage_insights",
		"pages_show_list",
		"pages_read_engagement",
	}
}
