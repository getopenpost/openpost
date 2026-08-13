package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	googleOAuthURL       = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL       = "https://oauth2.googleapis.com/token"
	googleUserInfoURL    = "https://www.googleapis.com/oauth2/v2/userinfo"
	youtubeAPIBaseURL    = "https://www.googleapis.com/youtube/v3"
	youtubeUploadBaseURL = "https://www.googleapis.com/upload/youtube/v3"
	youtubeTitleMaxRunes = 100
	youtubeUploadTimeout = 10 * time.Minute
	// YouTube documents a finite but unspecified session lifetime. Stop
	// automatic writes before the provider may forget the reconciliation URI.
	youtubeResumableSessionLifetime = 6 * 24 * time.Hour
)

type YouTubeAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string
}

func NewYouTubeAdapter(clientID, clientSecret, redirectURI string) *YouTubeAdapter {
	return &YouTubeAdapter{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
	}
}

func (y *YouTubeAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     y.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code"},
	}
}

func (y *YouTubeAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set(oauthParamClientID, y.clientID)
	params.Set(oauthParamRedirectURI, y.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", strings.Join(youtubeScopes(), " "))
	params.Set("state", state)
	params.Set("access_type", "offline")
	params.Set("prompt", "consent")
	params.Set("include_granted_scopes", "true")
	return googleOAuthURL + "?" + params.Encode(), nil
}

func (y *YouTubeAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	values := map[string]string{
		oauthParamClientID:     y.clientID,
		oauthParamClientSecret: y.clientSecret,
		oauthParamCode:         code,
		oauthParamRedirectURI:  y.redirectURI,
		grantType:              oauthGrantAuthCode,
	}
	return y.exchangeToken(ctx, values, "youtube token exchange")
}

func (y *YouTubeAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        true,
		CredentialSource: RefreshCredentialRefreshToken,
	}
}

func (y *YouTubeAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if input.RefreshToken == "" {
		return nil, fmt.Errorf("youtube refresh requires a refresh token")
	}
	values := map[string]string{
		oauthParamClientID:                    y.clientID,
		oauthParamClientSecret:                y.clientSecret,
		grantType:                             oauthGrantRefresh,
		string(RefreshCredentialRefreshToken): input.RefreshToken,
	}
	return y.exchangeToken(ctx, values, "youtube token refresh")
}

func (y *YouTubeAdapter) exchangeToken(ctx context.Context, values map[string]string, label string) (*TokenResult, error) {
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, googleTokenURL, values, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
		Scope        string `json:"scope"`
		Error        string `json:"error"`
		Description  string `json:"error_description"`
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
	if tokenResp.Scope != "" {
		extra["scope"] = tokenResp.Scope
	}
	return &TokenResult{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresIn:    tokenResp.ExpiresIn,
		TokenType:    firstNonEmptyString(tokenResp.TokenType, tokenTypeBearer),
		Extra:        extra,
	}, nil
}

func (y *YouTubeAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	respBody, err := DoRequest(ctx, http.MethodGet, googleUserInfoURL, nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("youtube google profile: %w", err)
	}

	var profile struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
		Email   string `json:"email"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &profile); err != nil {
		return nil, fmt.Errorf("decoding youtube google profile: %w", err)
	}
	if profile.Error.Message != "" {
		return nil, fmt.Errorf("youtube google profile: %s", profile.Error.Message)
	}
	return &UserProfile{
		ID:          profile.ID,
		Username:    firstNonEmptyString(profile.Email, profile.Name, profile.ID),
		DisplayName: firstNonEmptyString(profile.Name, profile.Email, profile.ID),
	}, nil
}

func (y *YouTubeAdapter) ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error) {
	channels, err := y.listChannels(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	options := make([]AccountSelectionOption, 0, len(channels))
	for _, channel := range channels {
		options = append(options, AccountSelectionOption{
			ID:          channel.ID,
			Username:    firstNonEmptyString(channel.Snippet.CustomURL, channel.Snippet.Title, channel.ID),
			DisplayName: channel.Snippet.Title,
			AvatarURL:   channel.Snippet.Thumbnails.Default.URL,
			Description: youtubeSubscriberDescription(channel.Statistics.SubscriberCount),
			Kind:        "channel",
		})
	}
	return options, nil
}

func (y *YouTubeAdapter) SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error) {
	channels, err := y.listChannels(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	for _, channel := range channels {
		if channel.ID != selectionID {
			continue
		}
		selectedToken := *token
		selectedToken.Extra = map[string]string{}
		for key, value := range token.Extra {
			selectedToken.Extra[key] = value
		}
		selectedToken.Extra["channel_id"] = channel.ID

		return &SelectedAccount{
			AccountID:        channel.ID,
			AccountUsername:  firstNonEmptyString(channel.Snippet.CustomURL, channel.Snippet.Title, channel.ID),
			AccountAvatarURL: channel.Snippet.Thumbnails.Default.URL,
			Token:            &selectedToken,
		}, nil
	}
	return nil, fmt.Errorf("youtube channel selection %s was not found", selectionID)
}

func (y *YouTubeAdapter) listChannels(ctx context.Context, accessToken string) ([]youtubeChannel, error) {
	params := url.Values{}
	params.Set("part", "snippet,statistics")
	params.Set("mine", "true")
	params.Set("maxResults", "50")
	endpoint := youtubeAPIBaseURL + "/channels?" + params.Encode()
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("youtube channels: %w", err)
	}

	var channelsResp struct {
		Items []youtubeChannel `json:"items"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &channelsResp); err != nil {
		return nil, fmt.Errorf("decoding youtube channels: %w", err)
	}
	if channelsResp.Error.Message != "" {
		return nil, fmt.Errorf("youtube channels: %s", channelsResp.Error.Message)
	}
	if len(channelsResp.Items) == 0 {
		return nil, fmt.Errorf("google account has no YouTube channels")
	}
	return channelsResp.Items, nil
}

func (y *YouTubeAdapter) ListDestinationOptions(ctx context.Context, accessToken string, input DestinationOptionsInput) (map[string][]DestinationOption, error) {
	playlists, err := y.listYouTubePlaylists(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	categories, err := y.listYouTubeVideoCategories(ctx, accessToken, input)
	if err != nil {
		return nil, err
	}
	return map[string][]DestinationOption{
		"youtube_playlists":  playlists,
		"youtube_categories": categories,
	}, nil
}

func (y *YouTubeAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, input AccountCapabilityInput) (AccountCapabilityResult, error) {
	options, err := y.ListDestinationOptions(ctx, accessToken, DestinationOptionsInput{
		RegionCode: input.RegionCode,
		Language:   localeLanguageCode(input.Locale),
	})
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	return AccountCapabilityResult{
		Revision: "youtube-account-options-v1",
		Options:  options,
		AvailableFeatures: map[string]bool{
			"thumbnail_media_id": true,
			"caption_media_id":   true,
		},
	}, nil
}

func localeLanguageCode(locale string) string {
	locale = strings.TrimSpace(locale)
	if index := strings.IndexAny(locale, "-_"); index >= 0 {
		return locale[:index]
	}
	return locale
}

func (y *YouTubeAdapter) listYouTubePlaylists(ctx context.Context, accessToken string) ([]DestinationOption, error) {
	options := []DestinationOption{}
	pageToken := ""
	for {
		params := url.Values{}
		params.Set("part", "snippet")
		params.Set("mine", "true")
		params.Set("maxResults", "50")
		if pageToken != "" {
			params.Set("pageToken", pageToken)
		}
		endpoint := youtubeAPIBaseURL + "/playlists?" + params.Encode()
		respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
		if err != nil {
			return nil, fmt.Errorf("youtube playlists: %w", err)
		}

		var response struct {
			NextPageToken string `json:"nextPageToken"`
			Items         []struct {
				ID      string `json:"id"`
				Snippet struct {
					Title string `json:"title"`
				} `json:"snippet"`
			} `json:"items"`
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(respBody, &response); err != nil {
			return nil, fmt.Errorf("decoding youtube playlists: %w", err)
		}
		if response.Error.Message != "" {
			return nil, fmt.Errorf("youtube playlists: %s", response.Error.Message)
		}
		for _, item := range response.Items {
			if item.ID == "" || strings.TrimSpace(item.Snippet.Title) == "" {
				continue
			}
			options = append(options, DestinationOption{Value: item.ID, Label: item.Snippet.Title})
		}
		if response.NextPageToken == "" || response.NextPageToken == pageToken {
			return options, nil
		}
		pageToken = response.NextPageToken
	}
}

func (y *YouTubeAdapter) listYouTubeVideoCategories(ctx context.Context, accessToken string, input DestinationOptionsInput) ([]DestinationOption, error) {
	regionCode := strings.ToUpper(strings.TrimSpace(input.RegionCode))
	if len(regionCode) != 2 {
		regionCode = "US"
	}
	language := strings.TrimSpace(input.Language)
	if language == "" {
		language = "en"
	}

	params := url.Values{}
	params.Set("part", "snippet")
	params.Set("regionCode", regionCode)
	params.Set("hl", language)
	endpoint := youtubeAPIBaseURL + "/videoCategories?" + params.Encode()
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("youtube video categories: %w", err)
	}

	var response struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Assignable bool   `json:"assignable"`
				Title      string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &response); err != nil {
		return nil, fmt.Errorf("decoding youtube video categories: %w", err)
	}
	if response.Error.Message != "" {
		return nil, fmt.Errorf("youtube video categories: %s", response.Error.Message)
	}

	options := make([]DestinationOption, 0, len(response.Items))
	for _, item := range response.Items {
		if !item.Snippet.Assignable || item.ID == "" || strings.TrimSpace(item.Snippet.Title) == "" {
			continue
		}
		options = append(options, DestinationOption{Value: item.ID, Label: item.Snippet.Title})
	}
	return options, nil
}

func (y *YouTubeAdapter) UploadMedia(_ context.Context, _ string, _ string, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("youtube video upload requires post metadata")
}

func (y *YouTubeAdapter) UploadMediaWithMetadata(ctx context.Context, accessToken, _ string, req UploadMediaRequest) (string, error) {
	if req.Reader == nil {
		return "", fmt.Errorf("youtube upload requires a video reader")
	}
	mediaBytes, err := io.ReadAll(req.Reader)
	if err != nil {
		return "", fmt.Errorf("reading youtube media: %w", err)
	}
	if len(mediaBytes) == 0 {
		return "", fmt.Errorf("youtube upload requires a non-empty video")
	}
	mediaSize := req.Size
	if mediaSize <= 0 {
		mediaSize = int64(len(mediaBytes))
	}
	if mediaSize != int64(len(mediaBytes)) {
		return "", fmt.Errorf("youtube upload size mismatch: expected %d bytes, read %d", mediaSize, len(mediaBytes))
	}
	req.Size = mediaSize
	req.OpenReaderAt = func(offset int64) (io.ReadCloser, error) {
		if offset < 0 || offset > int64(len(mediaBytes)) {
			return nil, fmt.Errorf("invalid youtube media offset %d", offset)
		}
		return io.NopCloser(bytes.NewReader(mediaBytes[offset:])), nil
	}
	return y.UploadMediaResumable(ctx, accessToken, "", req, ResumableMediaUploadState{
		TotalBytes:          mediaSize,
		Status:              MediaUploadPending,
		RetryClassification: MediaRetrySafeResume,
	}, func(ResumableMediaUploadState) error { return nil })
}

type youtubeResumableUploadState struct {
	SessionURL       string `json:"session_url"`
	ThumbnailApplied bool   `json:"thumbnail_applied,omitempty"`
	PlaylistApplied  bool   `json:"playlist_applied,omitempty"`
	CaptionApplied   bool   `json:"caption_applied,omitempty"`
}

func (y *YouTubeAdapter) UploadMediaResumable(
	ctx context.Context,
	accessToken, _ string,
	req UploadMediaRequest,
	state ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	metadata, err := prepareYouTubeUpload(req)
	if err != nil {
		return "", err
	}
	providerState, err := decodeYouTubeResumableState(state.OpaqueState)
	if err != nil {
		return "", err
	}
	if state.ProviderMediaID == "" && state.OpaqueState != "" && !state.SessionExpiresAt.IsZero() && !time.Now().UTC().Before(state.SessionExpiresAt) {
		return "", &MediaUploadError{
			RetryClassification: MediaRetryTerminal,
			Err:                 errors.New("youtube resumable upload session expired; manual reconciliation is required"),
		}
	}
	resumingFinalization := state.ProviderMediaID != ""
	state.TotalBytes = req.Size
	newSession, err := y.ensureYouTubeUploadSession(ctx, accessToken, req, metadata, &providerState, &state, checkpoint)
	if err != nil {
		return "", err
	}
	videoID, err := y.ensureYouTubeVideoUploaded(ctx, accessToken, req, &providerState, newSession, &state, checkpoint)
	if err != nil {
		return "", err
	}
	if err := y.finalizeYouTubeUpload(ctx, accessToken, videoID, req, resumingFinalization, &providerState, &state, checkpoint); err != nil {
		return "", err
	}
	return videoID, nil
}

func prepareYouTubeUpload(req UploadMediaRequest) (youtubeVideoInsertRequest, error) {
	if !isVideoMime(req.MimeType) {
		return youtubeVideoInsertRequest{}, fmt.Errorf("youtube upload requires a video attachment")
	}
	if req.Size <= 0 {
		return youtubeVideoInsertRequest{}, fmt.Errorf("youtube upload requires a known non-empty video size")
	}
	if req.OpenReaderAt == nil {
		return youtubeVideoInsertRequest{}, fmt.Errorf("youtube resumable upload requires a ranged media reader")
	}
	title := youtubeTitle(req)
	if title == "" {
		return youtubeVideoInsertRequest{}, fmt.Errorf("youtube upload requires an explicit title")
	}
	privacy := settingString(req.Settings, "privacy")
	switch privacy {
	case "public", "unlisted", "private":
	default:
		return youtubeVideoInsertRequest{}, fmt.Errorf("youtube upload requires an explicit supported privacy setting")
	}
	categoryID := settingString(req.Settings, "category_id")
	if categoryID == "" {
		return youtubeVideoInsertRequest{}, fmt.Errorf("youtube upload requires a category selected for this region")
	}
	return youtubeVideoInsertRequest{
		Snippet: youtubeVideoSnippet{
			Title:       title,
			Description: strings.TrimSpace(req.Description),
			Tags:        youtubeTags(req.Settings),
			CategoryID:  categoryID,
		},
		Status: youtubeVideoStatus{
			PrivacyStatus:           privacy,
			License:                 firstNonEmptyString(settingString(req.Settings, "license"), "youtube"),
			Embeddable:              settingBoolDefault(req.Settings, "embeddable", true),
			SelfDeclaredMadeForKids: settingBool(req.Settings, "self_declared_made_for_kids"),
			ContainsSyntheticMedia:  settingBool(req.Settings, "contains_synthetic_media"),
		},
		PaidProductPlacementDetails: youtubePaidProductPlacementDetails{
			HasPaidProductPlacement: settingBool(req.Settings, "paid_placement"),
		},
	}, nil
}

func (y *YouTubeAdapter) ensureYouTubeUploadSession(
	ctx context.Context,
	accessToken string,
	req UploadMediaRequest,
	metadata youtubeVideoInsertRequest,
	providerState *youtubeResumableUploadState,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (bool, error) {
	newSession := providerState.SessionURL == ""
	if newSession && state.ProviderMediaID == "" {
		sessionURL, err := y.startYouTubeResumableUpload(ctx, accessToken, req, metadata, req.Size)
		if err != nil {
			return false, err
		}
		providerState.SessionURL = sessionURL
		state.Status = MediaUploadUploading
		state.RetryClassification = MediaRetrySafeResume
		state.SessionExpiresAt = time.Now().UTC().Add(youtubeResumableSessionLifetime)
		opaqueState, err := encodeYouTubeResumableState(*providerState)
		if err != nil {
			return false, err
		}
		state.OpaqueState = opaqueState
		if err := checkpoint(*state); err != nil {
			return false, fmt.Errorf("checkpointing youtube upload session: %w", err)
		}
	}
	return newSession, nil
}

func (y *YouTubeAdapter) ensureYouTubeVideoUploaded(
	ctx context.Context,
	accessToken string,
	req UploadMediaRequest,
	providerState *youtubeResumableUploadState,
	newSession bool,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	videoID := state.ProviderMediaID
	if videoID == "" {
		var err error
		videoID, err = y.uploadYouTubeVideoStream(ctx, accessToken, req, providerState.SessionURL, !newSession, state, checkpoint)
		if err != nil {
			return "", err
		}
		state.ProviderMediaID = videoID
		state.UploadedBytes = state.TotalBytes
		state.Status = MediaUploadUploaded
		state.RetryClassification = MediaRetryReconcile
		state.LastCheckedAt = time.Now().UTC()
	}
	if providerState.SessionURL != "" || state.OpaqueState != "" {
		providerState.SessionURL = ""
		state.SessionExpiresAt = time.Time{}
		if err := checkpointYouTubeProviderState(state, *providerState, checkpoint); err != nil {
			return "", fmt.Errorf("checkpointing uploaded youtube video: %w", err)
		}
	}
	return videoID, nil
}

func (y *YouTubeAdapter) finalizeYouTubeUpload(
	ctx context.Context,
	accessToken string,
	videoID string,
	req UploadMediaRequest,
	resuming bool,
	providerState *youtubeResumableUploadState,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) error {
	if req.ThumbnailReader != nil && !providerState.ThumbnailApplied {
		if err := y.setYouTubeThumbnail(ctx, accessToken, videoID, req); err != nil {
			return err
		}
		providerState.ThumbnailApplied = true
		if err := checkpointYouTubeProviderState(state, *providerState, checkpoint); err != nil {
			return err
		}
	}
	if err := y.finalizeYouTubePlaylist(ctx, accessToken, videoID, settingString(req.Settings, "playlist_id"), resuming, providerState, state, checkpoint); err != nil {
		return err
	}
	if err := y.finalizeYouTubeCaption(ctx, accessToken, videoID, req, resuming, providerState, state, checkpoint); err != nil {
		return err
	}
	return y.checkYouTubeProcessingStatus(ctx, accessToken, videoID)
}

func (y *YouTubeAdapter) finalizeYouTubePlaylist(
	ctx context.Context,
	accessToken, videoID, playlistID string,
	resuming bool,
	providerState *youtubeResumableUploadState,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) error {
	if playlistID == "" || providerState.PlaylistApplied {
		return nil
	}
	if resuming {
		exists, err := y.youtubePlaylistItemExists(ctx, accessToken, playlistID, videoID)
		if err != nil {
			return err
		}
		if exists {
			providerState.PlaylistApplied = true
			return checkpointYouTubeProviderState(state, *providerState, checkpoint)
		}
	}
	if err := y.insertYouTubePlaylistItem(ctx, accessToken, playlistID, videoID); err != nil {
		return err
	}
	providerState.PlaylistApplied = true
	return checkpointYouTubeProviderState(state, *providerState, checkpoint)
}

func (y *YouTubeAdapter) finalizeYouTubeCaption(
	ctx context.Context,
	accessToken, videoID string,
	req UploadMediaRequest,
	resuming bool,
	providerState *youtubeResumableUploadState,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) error {
	if req.CaptionReader == nil || providerState.CaptionApplied {
		return nil
	}
	if resuming {
		exists, err := y.youtubeCaptionExists(ctx, accessToken, videoID, req)
		if err != nil {
			return err
		}
		if exists {
			providerState.CaptionApplied = true
			return checkpointYouTubeProviderState(state, *providerState, checkpoint)
		}
	}
	if err := y.insertYouTubeCaption(ctx, accessToken, videoID, req); err != nil {
		return err
	}
	providerState.CaptionApplied = true
	return checkpointYouTubeProviderState(state, *providerState, checkpoint)
}

func decodeYouTubeResumableState(raw string) (youtubeResumableUploadState, error) {
	if strings.TrimSpace(raw) == "" {
		return youtubeResumableUploadState{}, nil
	}
	var state youtubeResumableUploadState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return youtubeResumableUploadState{}, fmt.Errorf("decoding youtube resumable state: %w", err)
	}
	return state, nil
}

func encodeYouTubeResumableState(state youtubeResumableUploadState) (string, error) {
	encoded, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("encoding youtube resumable state: %w", err)
	}
	return string(encoded), nil
}

func checkpointYouTubeProviderState(state *ResumableMediaUploadState, providerState youtubeResumableUploadState, checkpoint MediaUploadCheckpoint) error {
	encoded, err := encodeYouTubeResumableState(providerState)
	if err != nil {
		return err
	}
	state.OpaqueState = encoded
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(*state); err != nil {
		return fmt.Errorf("checkpointing youtube upload state: %w", err)
	}
	return nil
}

func (y *YouTubeAdapter) youtubeCaptionExists(ctx context.Context, accessToken, videoID string, req UploadMediaRequest) (bool, error) {
	language := strings.TrimSpace(settingString(req.Settings, "caption_language"))
	if language == "" {
		return false, fmt.Errorf("youtube caption_language is required when a caption file is attached")
	}
	name := firstNonEmptyString(req.CaptionFilename, language)
	pageToken := ""
	for {
		params := url.Values{}
		params.Set("part", "snippet")
		params.Set("videoId", videoID)
		params.Set("maxResults", "50")
		if pageToken != "" {
			params.Set("pageToken", pageToken)
		}
		endpoint := youtubeAPIBaseURL + "/captions?" + params.Encode()
		response, err := doYouTubeRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
		if err != nil {
			return false, fmt.Errorf("youtube caption reconciliation: %w", err)
		}
		if err := youtubeAPIError(response); err != nil {
			return false, fmt.Errorf("youtube caption reconciliation: %w", err)
		}
		var captions youtubeCaptionsListResponse
		if err := json.Unmarshal(response.body, &captions); err != nil {
			return false, fmt.Errorf("decoding youtube captions: %w", err)
		}
		for _, item := range captions.Items {
			if strings.EqualFold(strings.TrimSpace(item.Snippet.Language), language) && strings.TrimSpace(item.Snippet.Name) == name {
				return true, nil
			}
		}
		if captions.NextPageToken == "" {
			return false, nil
		}
		pageToken = captions.NextPageToken
	}
}

func (y *YouTubeAdapter) insertYouTubeCaption(ctx context.Context, accessToken, videoID string, req UploadMediaRequest) error {
	body, contentType, err := buildYouTubeCaptionRequest(videoID, req)
	if err != nil {
		return err
	}
	endpoint := youtubeUploadBaseURL + "/captions?part=snippet&uploadType=multipart"
	response, err := doYouTubeRequest(ctx, http.MethodPost, endpoint, body, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   contentType,
	})
	if err != nil {
		return fmt.Errorf("youtube caption upload: %w", err)
	}
	if response.statusCode == http.StatusConflict && strings.EqualFold(youtubeErrorReason(response.body), "captionExists") {
		return nil
	}
	return youtubeAPIError(response)
}

func buildYouTubeCaptionRequest(videoID string, req UploadMediaRequest) (*bytes.Buffer, string, error) {
	language := strings.TrimSpace(settingString(req.Settings, "caption_language"))
	if language == "" {
		return nil, "", fmt.Errorf("youtube caption_language is required when a caption file is attached")
	}
	captionBytes, err := io.ReadAll(req.CaptionReader)
	if err != nil {
		return nil, "", fmt.Errorf("reading youtube caption file: %w", err)
	}
	if len(captionBytes) == 0 {
		return nil, "", fmt.Errorf("youtube caption file cannot be empty")
	}
	if req.CaptionSize > 0 && req.CaptionSize != int64(len(captionBytes)) {
		return nil, "", fmt.Errorf("youtube caption size mismatch: expected %d bytes, read %d", req.CaptionSize, len(captionBytes))
	}

	metadata := map[string]interface{}{
		"snippet": map[string]interface{}{
			"videoId":  videoID,
			"language": language,
			"name":     firstNonEmptyString(req.CaptionFilename, language),
			"isDraft":  false,
		},
	}
	metadataBytes, err := jsonMarshal(metadata)
	if err != nil {
		return nil, "", fmt.Errorf("marshaling youtube caption metadata: %w", err)
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	metadataHeader := textproto.MIMEHeader{}
	metadataHeader.Set(headerContentType, contentTypeJSON+"; charset=UTF-8")
	metadataPart, err := writer.CreatePart(metadataHeader)
	if err != nil {
		return nil, "", fmt.Errorf("creating youtube caption metadata part: %w", err)
	}
	if _, err := metadataPart.Write(metadataBytes); err != nil {
		return nil, "", fmt.Errorf("writing youtube caption metadata: %w", err)
	}
	captionHeader := textproto.MIMEHeader{}
	captionHeader.Set(headerContentType, firstNonEmptyString(req.CaptionMimeType, "text/vtt"))
	captionPart, err := writer.CreatePart(captionHeader)
	if err != nil {
		return nil, "", fmt.Errorf("creating youtube caption media part: %w", err)
	}
	if _, err := captionPart.Write(captionBytes); err != nil {
		return nil, "", fmt.Errorf("writing youtube caption media: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("closing youtube caption request: %w", err)
	}
	return body, "multipart/related; boundary=" + writer.Boundary(), nil
}

func youtubeErrorReason(body []byte) string {
	var payload struct {
		Error struct {
			Errors []struct {
				Reason string `json:"reason"`
			} `json:"errors"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &payload) != nil || len(payload.Error.Errors) == 0 {
		return ""
	}
	return strings.TrimSpace(payload.Error.Errors[0].Reason)
}

func (y *YouTubeAdapter) setYouTubeThumbnail(ctx context.Context, accessToken, videoID string, req UploadMediaRequest) error {
	thumbnailBytes, err := io.ReadAll(req.ThumbnailReader)
	if err != nil {
		return fmt.Errorf("reading youtube thumbnail: %w", err)
	}
	if len(thumbnailBytes) == 0 {
		return fmt.Errorf("youtube thumbnail upload requires a non-empty image")
	}
	if req.ThumbnailSize > 0 && req.ThumbnailSize != int64(len(thumbnailBytes)) {
		return fmt.Errorf("youtube thumbnail size mismatch: expected %d bytes, read %d", req.ThumbnailSize, len(thumbnailBytes))
	}
	params := url.Values{}
	params.Set("videoId", videoID)
	endpoint := youtubeUploadBaseURL + "/thumbnails/set?" + params.Encode()
	resp, err := doYouTubeRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(thumbnailBytes), map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   firstNonEmptyString(req.ThumbnailMimeType, "image/jpeg"),
	})
	if err != nil {
		return fmt.Errorf("youtube thumbnail upload: %w", err)
	}
	return youtubeAPIError(resp)
}

func (y *YouTubeAdapter) startYouTubeResumableUpload(ctx context.Context, accessToken string, req UploadMediaRequest, metadata youtubeVideoInsertRequest, mediaSize int64) (string, error) {
	metaBytes, err := jsonMarshal(metadata)
	if err != nil {
		return "", fmt.Errorf("marshaling youtube metadata: %w", err)
	}

	params := url.Values{}
	params.Set("part", "snippet,status,paidProductPlacementDetails")
	params.Set("uploadType", "resumable")
	params.Set("notifySubscribers", fmt.Sprint(settingBool(req.Settings, "notify_subscribers")))
	endpoint := youtubeUploadBaseURL + "/videos?" + params.Encode()
	resp, err := doYouTubeRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(metaBytes), map[string]string{
		headerAuthorization:       bearerPrefix + accessToken,
		headerContentType:         contentTypeJSON + "; charset=UTF-8",
		"X-Upload-Content-Length": strconv.FormatInt(mediaSize, 10),
		"X-Upload-Content-Type":   firstNonEmptyString(req.MimeType, videoTypeMP4),
	})
	if err != nil {
		return "", fmt.Errorf("youtube resumable upload session: %w", err)
	}
	if err := youtubeAPIError(resp); err != nil {
		return "", err
	}
	sessionURL := resp.header.Get("Location")
	if sessionURL == "" {
		return "", fmt.Errorf("youtube resumable upload session: missing session location")
	}
	return sessionURL, nil
}

func (y *YouTubeAdapter) Publish(_ context.Context, _ string, _ string, req *PublishRequest) (PublishResult, error) {
	return executePublishWrite(req, "finalize_resumable_upload", func() (string, error) {
		return y.publish(req)
	})
}

func (y *YouTubeAdapter) publish(req *PublishRequest) (string, error) {
	if req.ReplyToID != "" {
		return "", fmt.Errorf("youtube thread replies are not supported")
	}
	if len(req.PlatformMediaIDs) != 1 || len(req.Media) != 1 {
		return "", fmt.Errorf("youtube publishing requires exactly one video attachment")
	}
	if !isVideoMime(req.Media[0].MimeType) {
		return "", fmt.Errorf("youtube publishing requires a video attachment")
	}
	return req.PlatformMediaIDs[0], nil
}

const youtubeUploadChunkSize int64 = 8 * 1024 * 1024

type youtubeUploadProbe struct {
	providerMediaID string
	uploadedBytes   int64
}

type youtubeUploadChunkOutcome struct {
	providerMediaID string
	nextOffset      int64
}

func (y *YouTubeAdapter) uploadYouTubeVideoStream(
	ctx context.Context,
	accessToken string,
	req UploadMediaRequest,
	sessionURL string,
	probeBeforeUpload bool,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	if sessionURL == "" {
		return "", fmt.Errorf("youtube resumable upload session is missing")
	}
	offset := state.UploadedBytes
	if probeBeforeUpload {
		probe, err := y.reconcileYouTubeUploadState(ctx, accessToken, sessionURL, req.Size, state, checkpoint)
		if err != nil {
			return "", err
		}
		if probe.providerMediaID != "" {
			return probe.providerMediaID, nil
		}
		offset = probe.uploadedBytes
	}

	transientFailures := 0
	for offset < req.Size {
		response, err := y.uploadYouTubeChunk(ctx, accessToken, req, sessionURL, offset)
		if err != nil {
			return "", err
		}
		if response.statusCode == http.StatusTooManyRequests || response.statusCode >= 500 {
			transientFailures++
		}
		outcome, err := y.handleYouTubeUploadResponse(ctx, accessToken, sessionURL, req.Size, offset, transientFailures, response, state, checkpoint)
		if err != nil {
			return "", err
		}
		if outcome.providerMediaID != "" {
			return outcome.providerMediaID, nil
		}
		offset = outcome.nextOffset
	}
	return "", fmt.Errorf("youtube upload reached the declared size without a provider media id")
}

func (y *YouTubeAdapter) uploadYouTubeChunk(
	ctx context.Context,
	accessToken string,
	req UploadMediaRequest,
	sessionURL string,
	offset int64,
) (*youtubeHTTPResponse, error) {
	end := min(offset+youtubeUploadChunkSize-1, req.Size-1)
	reader, err := req.OpenReaderAt(offset)
	if err != nil {
		return nil, fmt.Errorf("opening youtube media at byte %d: %w", offset, err)
	}
	defer reader.Close()
	chunkLength := end - offset + 1
	response, err := doYouTubeUploadRequest(ctx, http.MethodPut, sessionURL, io.LimitReader(reader, chunkLength), map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   firstNonEmptyString(req.MimeType, videoTypeMP4),
		"Content-Length":    strconv.FormatInt(chunkLength, 10),
		"Content-Range":     fmt.Sprintf("bytes %d-%d/%d", offset, end, req.Size),
	})
	if err != nil {
		return nil, fmt.Errorf("youtube video upload: %w", err)
	}
	return response, nil
}

func (y *YouTubeAdapter) handleYouTubeUploadResponse(
	ctx context.Context,
	accessToken, sessionURL string,
	mediaSize, offset int64,
	transientFailures int,
	response *youtubeHTTPResponse,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (youtubeUploadChunkOutcome, error) {
	switch {
	case response.statusCode == http.StatusOK || response.statusCode == http.StatusCreated:
		providerMediaID, err := youtubeVideoIDFromResponse("youtube video upload", response.body)
		return youtubeUploadChunkOutcome{providerMediaID: providerMediaID}, err
	case response.statusCode == http.StatusPermanentRedirect:
		nextOffset := youtubeNextUploadOffset(response.header.Get("Range"))
		if nextOffset <= offset || nextOffset > mediaSize {
			return youtubeUploadChunkOutcome{}, fmt.Errorf("youtube video upload: provider returned an invalid resume offset")
		}
		if err := checkpointYouTubeUploadProgress(state, nextOffset, checkpoint); err != nil {
			return youtubeUploadChunkOutcome{}, err
		}
		return youtubeUploadChunkOutcome{nextOffset: nextOffset}, nil
	case response.statusCode == http.StatusTooManyRequests || response.statusCode >= 500:
		probe, err := y.reconcileYouTubeUploadState(ctx, accessToken, sessionURL, mediaSize, state, checkpoint)
		if err != nil {
			return youtubeUploadChunkOutcome{}, err
		}
		if probe.providerMediaID != "" {
			return youtubeUploadChunkOutcome{providerMediaID: probe.providerMediaID}, nil
		}
		if probe.uploadedBytes <= offset || transientFailures >= 3 {
			return youtubeUploadChunkOutcome{}, youtubeAPIError(response)
		}
		return youtubeUploadChunkOutcome{nextOffset: probe.uploadedBytes}, nil
	default:
		return youtubeUploadChunkOutcome{}, youtubeAPIError(response)
	}
}

func (y *YouTubeAdapter) reconcileYouTubeUploadState(
	ctx context.Context,
	accessToken, sessionURL string,
	mediaSize int64,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (youtubeUploadProbe, error) {
	probe, err := y.queryYouTubeUploadState(ctx, accessToken, sessionURL, mediaSize)
	if err != nil {
		return youtubeUploadProbe{}, err
	}
	state.LastCheckedAt = time.Now().UTC()
	if probe.providerMediaID != "" {
		state.ProviderMediaID = probe.providerMediaID
		state.UploadedBytes = mediaSize
		state.Status = MediaUploadUploaded
		state.RetryClassification = MediaRetryReconcile
		return probe, nil
	}
	state.UploadedBytes = probe.uploadedBytes
	state.Status = MediaUploadUploading
	state.RetryClassification = MediaRetrySafeResume
	if err := checkpoint(*state); err != nil {
		return youtubeUploadProbe{}, fmt.Errorf("checkpointing reconciled youtube upload: %w", err)
	}
	return probe, nil
}

func checkpointYouTubeUploadProgress(state *ResumableMediaUploadState, uploadedBytes int64, checkpoint MediaUploadCheckpoint) error {
	state.UploadedBytes = uploadedBytes
	state.Status = MediaUploadUploading
	state.RetryClassification = MediaRetrySafeResume
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(*state); err != nil {
		return fmt.Errorf("checkpointing youtube upload progress: %w", err)
	}
	return nil
}

func (y *YouTubeAdapter) queryYouTubeUploadState(ctx context.Context, accessToken, sessionURL string, mediaSize int64) (youtubeUploadProbe, error) {
	resp, err := doYouTubeUploadRequest(ctx, http.MethodPut, sessionURL, http.NoBody, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		"Content-Length":    "0",
		"Content-Range":     fmt.Sprintf("bytes */%d", mediaSize),
	})
	if err != nil {
		return youtubeUploadProbe{}, fmt.Errorf("youtube video upload status: %w", err)
	}
	if resp.statusCode == http.StatusPermanentRedirect {
		return youtubeUploadProbe{uploadedBytes: youtubeNextUploadOffset(resp.header.Get("Range"))}, nil
	}
	if resp.statusCode == http.StatusOK || resp.statusCode == http.StatusCreated {
		providerMediaID, err := youtubeVideoIDFromResponse("youtube video upload status", resp.body)
		if err != nil {
			return youtubeUploadProbe{}, err
		}
		return youtubeUploadProbe{providerMediaID: providerMediaID, uploadedBytes: mediaSize}, nil
	}
	err = youtubeAPIError(resp)
	if resp.statusCode == http.StatusNotFound || resp.statusCode == http.StatusGone {
		err = &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: err}
	}
	return youtubeUploadProbe{}, err
}

func (y *YouTubeAdapter) insertYouTubePlaylistItem(ctx context.Context, accessToken, playlistID, videoID string) error {
	body, err := jsonMarshal(youtubePlaylistItemInsertRequest{
		Snippet: youtubePlaylistItemSnippet{
			PlaylistID: playlistID,
			ResourceID: youtubePlaylistItemResourceID{
				Kind:    "youtube#video",
				VideoID: videoID,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("marshaling youtube playlist item: %w", err)
	}
	params := url.Values{}
	params.Set("part", "snippet")
	endpoint := youtubeAPIBaseURL + "/playlistItems?" + params.Encode()
	resp, err := doYouTubeRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body), map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   contentTypeJSON,
	})
	if err != nil {
		return fmt.Errorf("youtube playlist insert: %w", err)
	}
	return youtubeAPIError(resp)
}

func (y *YouTubeAdapter) youtubePlaylistItemExists(ctx context.Context, accessToken, playlistID, videoID string) (bool, error) {
	params := url.Values{}
	params.Set("part", "id")
	params.Set("playlistId", playlistID)
	params.Set("videoId", videoID)
	params.Set("maxResults", "1")
	endpoint := youtubeAPIBaseURL + "/playlistItems?" + params.Encode()
	response, err := doYouTubeRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return false, fmt.Errorf("youtube playlist reconciliation: %w", err)
	}
	if err := youtubeAPIError(response); err != nil {
		return false, fmt.Errorf("youtube playlist reconciliation: %w", err)
	}
	var items youtubePlaylistItemsListResponse
	if err := json.Unmarshal(response.body, &items); err != nil {
		return false, fmt.Errorf("decoding youtube playlist items: %w", err)
	}
	return len(items.Items) > 0, nil
}

func (y *YouTubeAdapter) checkYouTubeProcessingStatus(ctx context.Context, accessToken, videoID string) error {
	params := url.Values{}
	params.Set("part", "status,processingDetails")
	params.Set("id", videoID)
	endpoint := youtubeAPIBaseURL + "/videos?" + params.Encode()
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return fmt.Errorf("youtube processing status: %w", err)
	}
	var statusResp youtubeVideosListResponse
	if err := json.Unmarshal(respBody, &statusResp); err != nil {
		return fmt.Errorf("decoding youtube processing status: %w", err)
	}
	if statusResp.Error.Message != "" {
		return &HTTPError{StatusCode: http.StatusBadRequest, Code: "youtube_processing_error"}
	}
	if len(statusResp.Items) == 0 {
		return &MediaUploadError{
			RetryClassification: MediaRetryReconcile,
			Err:                 errors.New("youtube processing status is not available yet"),
		}
	}
	item := statusResp.Items[0]
	if item.ProcessingDetails.ProcessingStatus == "failed" || item.Status.UploadStatus == "rejected" || item.Status.UploadStatus == "failed" {
		return &MediaUploadError{
			RetryClassification: MediaRetryTerminal,
			Err: fmt.Errorf("youtube processing failed: %s", firstNonEmptyString(
				item.ProcessingDetails.ProcessingFailureReason,
				item.Status.FailureReason,
				item.Status.RejectionReason,
				"unknown",
			)),
		}
	}
	return nil
}

func youtubeVideoIDFromResponse(label string, respBody []byte) (string, error) {
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
		return "", &HTTPError{StatusCode: http.StatusBadRequest, Code: "youtube_publish_error"}
	}
	if resp.ID == "" {
		return "", fmt.Errorf("%s: missing video id", label)
	}
	return resp.ID, nil
}

type youtubeHTTPResponse struct {
	statusCode int
	header     http.Header
	body       []byte
}

func doYouTubeRequest(ctx context.Context, method, endpoint string, body io.Reader, headers map[string]string) (*youtubeHTTPResponse, error) {
	return doYouTubeRequestWithClient(ctx, httpClient, method, endpoint, body, headers)
}

func doYouTubeUploadRequest(ctx context.Context, method, endpoint string, body io.Reader, headers map[string]string) (*youtubeHTTPResponse, error) {
	client := *httpClient
	client.Timeout = youtubeUploadTimeout
	return doYouTubeRequestWithClient(ctx, &client, method, endpoint, body, headers)
}

func doYouTubeRequestWithClient(ctx context.Context, client *http.Client, method, endpoint string, body io.Reader, headers map[string]string) (*youtubeHTTPResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		if value != "" {
			if strings.EqualFold(key, "Content-Length") {
				contentLength, parseErr := strconv.ParseInt(value, 10, 64)
				if parseErr != nil || contentLength < 0 {
					return nil, fmt.Errorf("invalid Content-Length %q", value)
				}
				req.ContentLength = contentLength
				continue
			}
			req.Header.Set(key, value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, safeYouTubeTransportError(err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return &youtubeHTTPResponse{statusCode: resp.StatusCode, header: resp.Header, body: respBody}, nil
}

func safeYouTubeTransportError(err error) error {
	cause := err
	foundRequestError := false
	for {
		var requestErr *url.Error
		if !errors.As(cause, &requestErr) {
			break
		}
		foundRequestError = true
		if requestErr.Err == nil || requestErr.Err == cause {
			cause = errors.New("provider request failed")
			break
		}
		cause = requestErr.Err
	}
	if !foundRequestError {
		return err
	}
	return fmt.Errorf("provider request failed: %w", cause)
}

func youtubeAPIError(response *youtubeHTTPResponse) error {
	if response.statusCode >= 200 && response.statusCode < 300 {
		return nil
	}
	return NewHTTPError(response.statusCode, response.header, response.body)
}

func youtubeNextUploadOffset(rangeHeader string) int64 {
	if !strings.HasPrefix(rangeHeader, "bytes=0-") {
		return 0
	}
	uploadedEnd, err := strconv.ParseInt(strings.TrimPrefix(rangeHeader, "bytes=0-"), 10, 64)
	if err != nil {
		return 0
	}
	return uploadedEnd + 1
}

func validateYouTubeMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) != 1 {
		return []MediaValidationIssue{{
			Provider: providerYouTube,
			Severity: severityError,
			Message:  "YouTube publishing currently requires exactly one video attachment.",
		}}
	}
	if !isVideoMime(media[0].MimeType) {
		return []MediaValidationIssue{{
			Provider: providerYouTube,
			MediaID:  media[0].ID,
			Severity: severityError,
			Message:  "YouTube publishing supports video attachments only.",
		}}
	}
	return nil
}

func youtubeTitle(req UploadMediaRequest) string {
	title := firstNonEmptyString(settingString(req.Settings, "title"), strings.TrimSpace(req.Title))
	return truncateRunes(title, youtubeTitleMaxRunes)
}

func youtubeTags(settings map[string]interface{}) []string {
	raw := settingString(settings, "tags")
	if raw == "" {
		return nil
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n'
	})
	tags := make([]string, 0, len(parts))
	for _, part := range parts {
		if tag := strings.TrimSpace(part); tag != "" {
			tags = append(tags, tag)
		}
	}
	return tags
}

func youtubeSubscriberDescription(count string) string {
	if strings.TrimSpace(count) == "" {
		return ""
	}
	return count + " subscribers"
}

func youtubeScopes() []string {
	return []string{
		"https://www.googleapis.com/auth/userinfo.profile",
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/youtube.readonly",
		"https://www.googleapis.com/auth/youtube.upload",
		"https://www.googleapis.com/auth/youtube",
	}
}

func bearerHeaders(accessToken string) map[string]string {
	return map[string]string{headerAuthorization: bearerPrefix + accessToken}
}

type youtubeVideoInsertRequest struct {
	Snippet                     youtubeVideoSnippet                `json:"snippet"`
	Status                      youtubeVideoStatus                 `json:"status"`
	PaidProductPlacementDetails youtubePaidProductPlacementDetails `json:"paidProductPlacementDetails,omitempty"`
}

type youtubeVideoSnippet struct {
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	CategoryID  string   `json:"categoryId,omitempty"`
}

type youtubeVideoStatus struct {
	PrivacyStatus           string `json:"privacyStatus"`
	License                 string `json:"license,omitempty"`
	Embeddable              bool   `json:"embeddable"`
	SelfDeclaredMadeForKids bool   `json:"selfDeclaredMadeForKids,omitempty"`
	ContainsSyntheticMedia  bool   `json:"containsSyntheticMedia,omitempty"`
}

type youtubePaidProductPlacementDetails struct {
	HasPaidProductPlacement bool `json:"hasPaidProductPlacement"`
}

type youtubePlaylistItemInsertRequest struct {
	Snippet youtubePlaylistItemSnippet `json:"snippet"`
}

type youtubePlaylistItemSnippet struct {
	PlaylistID string                        `json:"playlistId"`
	ResourceID youtubePlaylistItemResourceID `json:"resourceId"`
}

type youtubePlaylistItemResourceID struct {
	Kind    string `json:"kind"`
	VideoID string `json:"videoId"`
}

type youtubePlaylistItemsListResponse struct {
	Items []struct {
		ID string `json:"id"`
	} `json:"items"`
}

type youtubeCaptionsListResponse struct {
	NextPageToken string `json:"nextPageToken"`
	Items         []struct {
		ID      string `json:"id"`
		Snippet struct {
			Language string `json:"language"`
			Name     string `json:"name"`
		} `json:"snippet"`
	} `json:"items"`
}

type youtubeVideosListResponse struct {
	Items []struct {
		ID                string `json:"id"`
		ProcessingDetails struct {
			ProcessingStatus        string `json:"processingStatus"`
			ProcessingFailureReason string `json:"processingFailureReason"`
		} `json:"processingDetails"`
		Status struct {
			UploadStatus    string `json:"uploadStatus"`
			FailureReason   string `json:"failureReason"`
			RejectionReason string `json:"rejectionReason"`
		} `json:"status"`
	} `json:"items"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

type youtubeChannel struct {
	ID      string `json:"id"`
	Snippet struct {
		Title      string `json:"title"`
		CustomURL  string `json:"customUrl"`
		Thumbnails struct {
			Default struct {
				URL string `json:"url"`
			} `json:"default"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	Statistics struct {
		SubscriberCount string `json:"subscriberCount"`
	} `json:"statistics"`
}
