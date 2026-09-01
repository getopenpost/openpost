package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestYouTubeGenerateAuthURL(t *testing.T) {
	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/api/v1/accounts/youtube/callback")

	authURL, _ := adapter.GenerateAuthURL("state-123")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "accounts.google.com" || parsed.Path != "/o/oauth2/v2/auth" {
		t.Fatalf("unexpected auth url %s", authURL)
	}
	query := parsed.Query()
	if query.Get(oauthParamClientID) != "client-id" {
		t.Fatalf("expected client id, got %q", query.Get(oauthParamClientID))
	}
	if query.Get("access_type") != "offline" || query.Get("prompt") != "consent" {
		t.Fatalf("expected offline consent auth URL, got %s", authURL)
	}
	if !strings.Contains(query.Get("scope"), "youtube.upload") {
		t.Fatalf("expected youtube.upload scope, got %q", query.Get("scope"))
	}
	if !strings.Contains(query.Get("scope"), "https://www.googleapis.com/auth/youtube") {
		t.Fatalf("expected youtube management scope for playlists, got %q", query.Get("scope"))
	}
	if !strings.Contains(query.Get("scope"), youtubeAnalyticsReadScope) {
		t.Fatalf("expected youtube analytics scope, got %q", query.Get("scope"))
	}
}

func TestYouTubeAnalyticsSupportRequiresReconnectForOldGrants(t *testing.T) {
	support := NewYouTubeAdapter("", "", "").AnalyticsSupport()
	oldGrant := "https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.readonly"
	if missing := MissingAnalyticsScopes(oldGrant, support.AccountRequiredScopes); len(missing) != 1 || missing[0] != youtubeAnalyticsReadScope {
		t.Fatalf("old grant should require analytics reconnect, got %v", missing)
	}
	if missing := MissingAnalyticsScopes(oldGrant, support.ContentRequiredScopes); len(missing) != 1 || missing[0] != youtubeAnalyticsReadScope {
		t.Fatalf("old content grant should require analytics reconnect, got %v", missing)
	}
}

func TestYouTubeGetProfileIncludesGooglePicture(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != googleUserInfoURL {
			t.Fatalf("unexpected request %s", req.URL.String())
		}
		return jsonResponse(req, `{"id":"google-1","name":"Creator","email":"creator@example.com","picture":"https://lh3.googleusercontent.com/avatar.jpg"}`), nil
	})}

	profile, err := NewYouTubeAdapter("", "", "").GetProfile(context.Background(), "access-token")
	if err != nil {
		t.Fatalf("GetProfile returned error: %v", err)
	}
	if profile.AvatarURL != "https://lh3.googleusercontent.com/avatar.jpg" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
}

func TestYouTubeExchangeRefreshAndSelectChannel(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	channelsCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/token":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading token body: %v", err)
			}
			values, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing token body: %v", err)
			}
			if values.Get(grantType) == oauthGrantRefresh {
				return jsonResponse(req, `{"access_token":"refreshed-token","expires_in":3600,"token_type":"Bearer"}`), nil
			}
			return jsonResponse(req, `{"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600,"token_type":"Bearer","scope":"https://www.googleapis.com/auth/youtube.upload"}`), nil
		case "/youtube/v3/channels":
			channelsCalls++
			if req.Header.Get(headerAuthorization) != "Bearer access-token" {
				t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
			}
			if req.URL.Query().Get("mine") != "true" {
				t.Fatalf("expected mine=true, got %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"items":[{"id":"channel-1","snippet":{"title":"OpenPost Channel","customUrl":"@openpost","thumbnails":{"default":{"url":"https://yt.example/avatar.jpg"}}},"statistics":{"subscriberCount":"123"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	token, err := adapter.ExchangeCode(context.Background(), "auth-code", nil)
	if err != nil {
		t.Fatalf("ExchangeCode returned error: %v", err)
	}
	if token.AccessToken != "access-token" || token.RefreshToken != "refresh-token" {
		t.Fatalf("unexpected token: %#v", token)
	}

	refreshed, err := adapter.RefreshToken(context.Background(), RefreshTokenInput{RefreshToken: "refresh-token"})
	if err != nil {
		t.Fatalf("RefreshToken returned error: %v", err)
	}
	if refreshed.AccessToken != "refreshed-token" {
		t.Fatalf("unexpected refreshed token: %#v", refreshed)
	}

	options, err := adapter.ListAccountSelections(context.Background(), token)
	if err != nil {
		t.Fatalf("ListAccountSelections returned error: %v", err)
	}
	if len(options) != 1 || options[0].ID != "channel-1" || options[0].Username != "@openpost" {
		t.Fatalf("unexpected options: %#v", options)
	}

	selected, err := adapter.SelectAccount(context.Background(), token, "channel-1")
	if err != nil {
		t.Fatalf("SelectAccount returned error: %v", err)
	}
	if selected.AccountID != "channel-1" || selected.Token.RefreshToken != "refresh-token" {
		t.Fatalf("unexpected selected account: %#v", selected)
	}
	if selected.Token.Extra["channel_id"] != "channel-1" {
		t.Fatalf("expected selected token channel id, got %#v", selected.Token.Extra)
	}
	profile, err := adapter.RefreshAccountMetadata(context.Background(), "access-token", AccountMetadataRequest{AccountID: "channel-1"})
	if err != nil {
		t.Fatalf("RefreshAccountMetadata returned error: %v", err)
	}
	if profile.ID != "channel-1" || profile.Username != "@openpost" || profile.AvatarURL != "https://yt.example/avatar.jpg" {
		t.Fatalf("unexpected refreshed YouTube channel profile: %#v", profile)
	}
	if channelsCalls != 3 {
		t.Fatalf("expected three channels calls, got %d", channelsCalls)
	}
}

func TestYouTubeListsDestinationOptions(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get(headerAuthorization) != "Bearer access-token" {
			t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
		}
		switch req.URL.Path {
		case "/youtube/v3/playlists":
			if req.URL.Query().Get("mine") != "true" || req.URL.Query().Get("maxResults") != "50" {
				t.Fatalf("unexpected playlists query %s", req.URL.RawQuery)
			}
			if req.URL.Query().Get("pageToken") == "" {
				return jsonResponse(req, `{"nextPageToken":"next","items":[{"id":"playlist-1","snippet":{"title":"Product videos"}}]}`), nil
			}
			if req.URL.Query().Get("pageToken") != "next" {
				t.Fatalf("unexpected playlist page token %q", req.URL.Query().Get("pageToken"))
			}
			return jsonResponse(req, `{"items":[{"id":"playlist-2","snippet":{"title":"Tutorials"}}]}`), nil
		case "/youtube/v3/videoCategories":
			if req.URL.Query().Get("regionCode") != "PT" || req.URL.Query().Get("hl") != "pt" {
				t.Fatalf("unexpected categories query %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"items":[{"id":"22","snippet":{"assignable":true,"title":"Pessoas e blogues"}},{"id":"24","snippet":{"assignable":false,"title":"Entertainment"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	options, err := adapter.ListDestinationOptions(context.Background(), "access-token", DestinationOptionsInput{
		RegionCode: "pt",
		Language:   "pt",
	})
	if err != nil {
		t.Fatalf("ListDestinationOptions returned error: %v", err)
	}
	if len(options["youtube_playlists"]) != 2 || options["youtube_playlists"][1].Value != "playlist-2" {
		t.Fatalf("unexpected playlist options: %#v", options["youtube_playlists"])
	}
	if len(options["youtube_categories"]) != 1 || options["youtube_categories"][0].Label != "Pessoas e blogues" {
		t.Fatalf("unexpected category options: %#v", options["youtube_categories"])
	}
}

func TestYouTubeUploadMediaWithMetadata(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var metadata youtubeVideoInsertRequest
	var uploadedBody string
	var playlistBody struct {
		Snippet struct {
			PlaylistID string `json:"playlistId"`
			ResourceID struct {
				Kind    string `json:"kind"`
				VideoID string `json:"videoId"`
			} `json:"resourceId"`
		} `json:"snippet"`
	}
	var thumbnailBody string
	requests := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.Path)
		if req.Header.Get(headerAuthorization) != "Bearer access-token" && req.URL.Path != "/upload/youtube/v3/videos/session" {
			t.Fatalf("unexpected auth header for %s: %q", req.URL.Path, req.Header.Get(headerAuthorization))
		}
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/videos":
			if req.URL.Query().Get("uploadType") != "resumable" || req.URL.Query().Get("part") != "snippet,status,paidProductPlacementDetails" {
				t.Fatalf("unexpected upload query %s", req.URL.RawQuery)
			}
			if req.Header.Get("X-Upload-Content-Length") != "11" {
				t.Fatalf("expected upload length header, got %q", req.Header.Get("X-Upload-Content-Length"))
			}
			if req.Header.Get("X-Upload-Content-Type") != "video/mp4" {
				t.Fatalf("expected upload mime header, got %q", req.Header.Get("X-Upload-Content-Type"))
			}
			metaBytes, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading metadata body: %v", err)
			}
			if err := json.Unmarshal(metaBytes, &metadata); err != nil {
				t.Fatalf("decoding metadata: %v", err)
			}
			resp := jsonResponse(req, `{}`)
			resp.Header.Set("Location", "https://www.googleapis.com/upload/youtube/v3/videos/session")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session":
			if req.Header.Get(headerContentType) != "video/mp4" {
				t.Fatalf("unexpected upload content type %q", req.Header.Get(headerContentType))
			}
			if req.Header.Get("Content-Range") != "bytes 0-10/11" {
				t.Fatalf("unexpected content range %q", req.Header.Get("Content-Range"))
			}
			mediaBytes, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading media body: %v", err)
			}
			uploadedBody = string(mediaBytes)
			return jsonResponseWithStatus(req, http.StatusCreated, `{"id":"youtube-video-1"}`), nil
		case req.Method == http.MethodPost && req.URL.Path == "/youtube/v3/playlistItems":
			if req.URL.Query().Get("part") != "snippet" {
				t.Fatalf("unexpected playlist query %s", req.URL.RawQuery)
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading playlist body: %v", err)
			}
			if err := json.Unmarshal(body, &playlistBody); err != nil {
				t.Fatalf("decoding playlist body: %v", err)
			}
			return jsonResponse(req, `{"id":"playlist-item-1"}`), nil
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/thumbnails/set":
			if req.URL.Query().Get("videoId") != "youtube-video-1" {
				t.Fatalf("unexpected thumbnail query %s", req.URL.RawQuery)
			}
			if req.Header.Get(headerContentType) != "image/jpeg" {
				t.Fatalf("unexpected thumbnail content type %q", req.Header.Get(headerContentType))
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading thumbnail body: %v", err)
			}
			thumbnailBody = string(body)
			return jsonResponse(req, `{"items":[{"default":{"url":"https://img.youtube.test/default.jpg"}}]}`), nil
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/videos":
			if req.URL.Query().Get("id") != "youtube-video-1" || req.URL.Query().Get("part") != "status,processingDetails" {
				t.Fatalf("unexpected videos.list query %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"items":[{"id":"youtube-video-1","processingDetails":{"processingStatus":"succeeded"},"status":{"uploadStatus":"processed"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	videoID, err := adapter.UploadMediaWithMetadata(context.Background(), "access-token", "channel-1", UploadMediaRequest{
		MimeType:    "video/mp4",
		Size:        11,
		Title:       "Launch Short",
		Description: "Launch Short\nDetailed description",
		Settings: map[string]interface{}{
			"playlist_id":              "playlist-1",
			"contains_synthetic_media": true,
			"privacy":                  "private",
			"category_id":              "22",
		},
		Reader:            bytes.NewBufferString("video-bytes"),
		ThumbnailMimeType: "image/jpeg",
		ThumbnailFilename: "cover.jpg",
		ThumbnailSize:     11,
		ThumbnailReader:   bytes.NewBufferString("cover-bytes"),
	})
	if err != nil {
		t.Fatalf("UploadMediaWithMetadata returned error: %v", err)
	}
	if videoID != "youtube-video-1" {
		t.Fatalf("expected video id, got %q", videoID)
	}
	if metadata.Snippet.Title != "Launch Short" || metadata.Status.PrivacyStatus != "private" {
		t.Fatalf("unexpected metadata: %#v", metadata)
	}
	if !metadata.Status.ContainsSyntheticMedia {
		t.Fatal("expected synthetic media disclosure in upload metadata")
	}
	if uploadedBody != "video-bytes" {
		t.Fatalf("unexpected media body %q", uploadedBody)
	}
	if playlistBody.Snippet.PlaylistID != "playlist-1" || playlistBody.Snippet.ResourceID.VideoID != "youtube-video-1" {
		t.Fatalf("unexpected playlist insert body: %#v", playlistBody)
	}
	if thumbnailBody != "cover-bytes" {
		t.Fatalf("unexpected thumbnail body %q", thumbnailBody)
	}
	wantRequests := []string{
		"POST /upload/youtube/v3/videos",
		"PUT /upload/youtube/v3/videos/session",
		"POST /upload/youtube/v3/thumbnails/set",
		"POST /youtube/v3/playlistItems",
		"GET /youtube/v3/videos",
	}
	if strings.Join(requests, "\n") != strings.Join(wantRequests, "\n") {
		t.Fatalf("unexpected request sequence:\n%s", strings.Join(requests, "\n"))
	}
}

func TestYouTubeUploadMediaWithMetadataResumesAfterTransientFailure(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	putAttempts := 0
	statusChecks := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/videos":
			resp := jsonResponse(req, `{}`)
			resp.Header.Set("Location", "https://www.googleapis.com/upload/youtube/v3/videos/session")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session" && req.Header.Get("Content-Range") == "bytes */11":
			statusChecks++
			resp := jsonResponseWithStatus(req, http.StatusPermanentRedirect, "")
			resp.Header.Set("Range", "bytes=0-4")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session":
			putAttempts++
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading upload body: %v", err)
			}
			if putAttempts == 1 {
				if req.Header.Get("Content-Range") != "bytes 0-10/11" || string(body) != "video-bytes" {
					t.Fatalf("unexpected first upload %q body %q", req.Header.Get("Content-Range"), string(body))
				}
				return jsonResponseWithStatus(req, http.StatusServiceUnavailable, `{"error":{"message":"try again"}}`), nil
			}
			if req.Header.Get("Content-Range") != "bytes 5-10/11" || string(body) != "-bytes" {
				t.Fatalf("unexpected resumed upload %q body %q", req.Header.Get("Content-Range"), string(body))
			}
			return jsonResponseWithStatus(req, http.StatusCreated, `{"id":"youtube-video-1"}`), nil
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/videos":
			return jsonResponse(req, `{"items":[{"id":"youtube-video-1","processingDetails":{"processingStatus":"processing"},"status":{"uploadStatus":"uploaded"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	videoID, err := adapter.UploadMediaWithMetadata(context.Background(), "access-token", "channel-1", UploadMediaRequest{
		MimeType:    "video/mp4",
		Size:        11,
		Title:       "Launch Short",
		Description: "Launch Short",
		Settings: map[string]interface{}{
			"privacy":     "private",
			"category_id": "22",
		},
		Reader: bytes.NewBufferString("video-bytes"),
	})
	if err != nil {
		t.Fatalf("UploadMediaWithMetadata returned error: %v", err)
	}
	if videoID != "youtube-video-1" {
		t.Fatalf("expected video id, got %q", videoID)
	}
	if putAttempts != 2 || statusChecks != 1 {
		t.Fatalf("expected upload retry and one status check, got puts=%d status=%d", putAttempts, statusChecks)
	}
}

func TestYouTubeResumableUploadReconcilesAndResumesAcrossInterruptedRuns(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	videoBytes := []byte("video-bytes")
	sessionStarts := 0
	statusChecks := 0
	openedOffsets := []int64{}
	uploadAttempts := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/videos":
			sessionStarts++
			resp := jsonResponse(req, `{}`)
			resp.Header.Set("Location", "https://www.googleapis.com/upload/youtube/v3/videos/session?upload_id=top-secret")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session" && req.Header.Get("Content-Range") == "bytes */11":
			statusChecks++
			resp := jsonResponseWithStatus(req, http.StatusPermanentRedirect, "")
			resp.Header.Set("Range", "bytes=0-4")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session":
			uploadAttempts++
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("read upload body: %v", err)
			}
			if uploadAttempts == 1 {
				if req.Header.Get("Content-Range") != "bytes 0-10/11" || string(body) != string(videoBytes) {
					t.Fatalf("unexpected initial upload %q body %q", req.Header.Get("Content-Range"), string(body))
				}
				return nil, errors.New("connection interrupted after provider accepted a prefix")
			}
			if req.Header.Get("Content-Range") != "bytes 5-10/11" || string(body) != "-bytes" {
				t.Fatalf("unexpected resumed upload %q body %q", req.Header.Get("Content-Range"), string(body))
			}
			return jsonResponseWithStatus(req, http.StatusCreated, `{"id":"youtube-video-resumed"}`), nil
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/videos":
			return jsonResponse(req, `{"items":[{"id":"youtube-video-resumed","processingDetails":{"processingStatus":"processing"},"status":{"uploadStatus":"uploaded"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	req := UploadMediaRequest{
		MimeType:    "video/mp4",
		Size:        int64(len(videoBytes)),
		Title:       "Interrupted upload",
		Description: "Interrupted upload",
		Settings: map[string]interface{}{
			"privacy":     "private",
			"category_id": "22",
		},
		OpenReaderAt: func(offset int64) (io.ReadCloser, error) {
			openedOffsets = append(openedOffsets, offset)
			return io.NopCloser(bytes.NewReader(videoBytes[offset:])), nil
		},
	}
	state := ResumableMediaUploadState{
		TotalBytes:          int64(len(videoBytes)),
		Status:              MediaUploadPending,
		RetryClassification: MediaRetrySafeResume,
	}
	checkpoint := func(next ResumableMediaUploadState) error {
		state = next
		return nil
	}

	_, err := adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", req, state, checkpoint)
	if err == nil || !strings.Contains(err.Error(), "connection interrupted") {
		t.Fatalf("expected interrupted first run, got %v", err)
	}
	if strings.Contains(err.Error(), "top-secret") || strings.Contains(err.Error(), "upload_id") {
		t.Fatalf("resumable session URL leaked through transport error: %v", err)
	}
	if state.OpaqueState == "" || state.Status != MediaUploadUploading {
		t.Fatalf("session must be checkpointed before bytes are sent: %#v", state)
	}
	if state.SessionExpiresAt.IsZero() {
		t.Fatalf("session expiry must be checkpointed with the session: %#v", state)
	}

	videoID, err := adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", req, state, checkpoint)
	if err != nil {
		t.Fatalf("resume returned error: %v", err)
	}
	if videoID != "youtube-video-resumed" {
		t.Fatalf("unexpected resumed video id %q", videoID)
	}
	if sessionStarts != 1 || statusChecks != 1 || uploadAttempts != 2 {
		t.Fatalf("expected one session, one reconciliation probe, and two writes; got starts=%d probes=%d writes=%d", sessionStarts, statusChecks, uploadAttempts)
	}
	if len(openedOffsets) != 2 || openedOffsets[0] != 0 || openedOffsets[1] != 5 {
		t.Fatalf("expected ranged reopen at provider offset, got %v", openedOffsets)
	}
	if strings.Contains(state.OpaqueState, "upload_id") || !state.SessionExpiresAt.IsZero() {
		t.Fatalf("accepted upload must discard its bearer-style session URL: %#v", state)
	}
}

func TestYouTubeResumableUploadRejectsExpiredSessionWithoutProviderMutation(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		t.Fatalf("expired session must not make a provider request: %s", req.URL.String())
		return nil, nil
	})}
	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	_, err := adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     11,
		Title:    "Expired session",
		Settings: map[string]interface{}{"privacy": "private", "category_id": "22"},
		OpenReaderAt: func(int64) (io.ReadCloser, error) {
			t.Fatal("expired session must not reopen media")
			return nil, nil
		},
	}, ResumableMediaUploadState{
		OpaqueState:         `{"session_url":"https://upload.youtube.test/session?upload_id=expired-secret"}`,
		SessionExpiresAt:    time.Now().Add(-time.Minute),
		Status:              MediaUploadUploading,
		RetryClassification: MediaRetrySafeResume,
	}, func(ResumableMediaUploadState) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "session expired") {
		t.Fatalf("expected expired session error, got %v", err)
	}
	if retryClass, ok := MediaRetryClassificationForError(err); !ok || retryClass != MediaRetryTerminal {
		t.Fatalf("expected terminal media classification, got %q, %v", retryClass, ok)
	}
	if requests != 0 {
		t.Fatalf("expected no provider requests, got %d", requests)
	}
}

func TestYouTubeResumableUploadMarksMissingProviderSessionTerminal(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPut || req.Header.Get("Content-Range") != "bytes */11" {
			t.Fatalf("expected a status probe, got %s %s", req.Method, req.Header.Get("Content-Range"))
		}
		return jsonResponseWithStatus(req, http.StatusNotFound, `{"error":{"message":"upload session not found"}}`), nil
	})}
	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	_, err := adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     11,
		Title:    "Missing session",
		Settings: map[string]interface{}{"privacy": "private", "category_id": "22"},
		OpenReaderAt: func(int64) (io.ReadCloser, error) {
			t.Fatal("missing session must not reopen media")
			return nil, nil
		},
	}, ResumableMediaUploadState{
		OpaqueState:         `{"session_url":"https://upload.youtube.test/session?upload_id=missing"}`,
		SessionExpiresAt:    time.Now().Add(time.Hour),
		Status:              MediaUploadUploading,
		RetryClassification: MediaRetrySafeResume,
	}, func(ResumableMediaUploadState) error { return nil })
	if err == nil {
		t.Fatal("expected missing-session error")
	}
	if retryClass, ok := MediaRetryClassificationForError(err); !ok || retryClass != MediaRetryTerminal {
		t.Fatalf("expected terminal missing-session classification, got %q, %v", retryClass, ok)
	}
}

func TestYouTubeCaptionDuplicateResponseIsReconciled(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.Path != "/upload/youtube/v3/captions" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		return jsonResponseWithStatus(req, http.StatusConflict, `{"error":{"errors":[{"reason":"captionExists"}]}}`), nil
	})}
	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	err := adapter.insertYouTubeCaption(context.Background(), "access-token", "video-1", UploadMediaRequest{
		Settings:        map[string]interface{}{"caption_language": "en"},
		CaptionFilename: "captions.vtt",
		CaptionMimeType: "text/vtt",
		CaptionSize:     11,
		CaptionReader:   bytes.NewBufferString("caption-vtt"),
	})
	if err != nil {
		t.Fatalf("stable captionExists response must reconcile, got %v", err)
	}
}

func TestYouTubeResumableUploadReconcilesAcceptedPlaylistAndCaptionWrites(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	videoBytes := []byte("video-bytes")
	playlistInserts := 0
	playlistChecks := 0
	captionInserts := 0
	captionChecks := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/videos":
			resp := jsonResponse(req, `{}`)
			resp.Header.Set("Location", "https://www.googleapis.com/upload/youtube/v3/videos/session")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session":
			return jsonResponseWithStatus(req, http.StatusCreated, `{"id":"youtube-video-finalize"}`), nil
		case req.Method == http.MethodPost && req.URL.Path == "/youtube/v3/playlistItems":
			playlistInserts++
			return nil, errors.New("playlist response lost after provider accepted the item")
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/playlistItems":
			playlistChecks++
			query := req.URL.Query()
			if query.Get("part") != "id" || query.Get("playlistId") != "playlist-1" || query.Get("videoId") != "youtube-video-finalize" || query.Get("maxResults") != "1" {
				t.Fatalf("unexpected playlist reconciliation query %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"items":[{"id":"playlist-item-accepted"}]}`), nil
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/captions":
			captionInserts++
			return nil, errors.New("caption response lost after provider accepted the track")
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/captions":
			captionChecks++
			query := req.URL.Query()
			if query.Get("part") != "snippet" || query.Get("videoId") != "youtube-video-finalize" || query.Get("maxResults") != "50" {
				t.Fatalf("unexpected caption reconciliation query %s", req.URL.RawQuery)
			}
			if captionChecks == 1 {
				return jsonResponse(req, `{"items":[]}`), nil
			}
			if captionChecks == 2 {
				return jsonResponse(req, `{"nextPageToken":"captions-page-2","items":[]}`), nil
			}
			if query.Get("pageToken") != "captions-page-2" {
				t.Fatalf("expected caption page token, got %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"items":[{"id":"caption-accepted","snippet":{"language":"en","name":"captions.vtt"}}]}`), nil
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/videos":
			return jsonResponse(req, `{"items":[{"id":"youtube-video-finalize","processingDetails":{"processingStatus":"processing"},"status":{"uploadStatus":"uploaded"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	state := ResumableMediaUploadState{
		TotalBytes:          int64(len(videoBytes)),
		Status:              MediaUploadPending,
		RetryClassification: MediaRetrySafeResume,
	}
	checkpoint := func(next ResumableMediaUploadState) error {
		state = next
		return nil
	}
	request := func() UploadMediaRequest {
		return UploadMediaRequest{
			MimeType:        "video/mp4",
			Size:            int64(len(videoBytes)),
			Title:           "Ambiguous finalization",
			Description:     "Ambiguous finalization",
			CaptionMimeType: "text/vtt",
			CaptionFilename: "captions.vtt",
			CaptionSize:     11,
			CaptionReader:   bytes.NewBufferString("caption-vtt"),
			Settings: map[string]interface{}{
				"privacy":          "private",
				"category_id":      "22",
				"playlist_id":      "playlist-1",
				"caption_language": "en",
			},
			OpenReaderAt: func(offset int64) (io.ReadCloser, error) {
				return io.NopCloser(bytes.NewReader(videoBytes[offset:])), nil
			},
		}
	}

	_, err := adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", request(), state, checkpoint)
	if err == nil || !strings.Contains(err.Error(), "playlist response lost") {
		t.Fatalf("expected ambiguous playlist result, got %v", err)
	}
	if state.ProviderMediaID != "youtube-video-finalize" {
		t.Fatalf("video id must be durable before playlist finalization: %#v", state)
	}

	_, err = adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", request(), state, checkpoint)
	if err == nil || !strings.Contains(err.Error(), "caption response lost") {
		t.Fatalf("expected ambiguous caption result, got %v", err)
	}

	videoID, err := adapter.UploadMediaResumable(context.Background(), "access-token", "channel-1", request(), state, checkpoint)
	if err != nil {
		t.Fatalf("finalization reconciliation returned error: %v", err)
	}
	if videoID != "youtube-video-finalize" {
		t.Fatalf("unexpected video id %q", videoID)
	}
	if playlistInserts != 1 || playlistChecks != 1 || captionInserts != 1 || captionChecks != 3 {
		t.Fatalf("accepted writes must not be repeated: playlist inserts/checks=%d/%d caption inserts/checks=%d/%d", playlistInserts, playlistChecks, captionInserts, captionChecks)
	}
	providerState, err := decodeYouTubeResumableState(state.OpaqueState)
	if err != nil {
		t.Fatalf("decoding final provider state: %v", err)
	}
	if !providerState.PlaylistApplied || !providerState.CaptionApplied {
		t.Fatalf("expected reconciled finalization checkpoints, got %#v", providerState)
	}
}

func TestYouTubeUploadMediaWithMetadataSurfacesProcessingFailures(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/upload/youtube/v3/videos":
			resp := jsonResponse(req, `{}`)
			resp.Header.Set("Location", "https://www.googleapis.com/upload/youtube/v3/videos/session")
			return resp, nil
		case req.Method == http.MethodPut && req.URL.Path == "/upload/youtube/v3/videos/session":
			return jsonResponseWithStatus(req, http.StatusCreated, `{"id":"youtube-video-1"}`), nil
		case req.Method == http.MethodGet && req.URL.Path == "/youtube/v3/videos":
			return jsonResponse(req, `{"items":[{"id":"youtube-video-1","processingDetails":{"processingStatus":"failed","processingFailureReason":"unsupportedCodec"},"status":{"uploadStatus":"rejected","failureReason":"codec"}}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client-id", "client-secret", "https://app.example/callback")
	_, err := adapter.UploadMediaWithMetadata(context.Background(), "access-token", "channel-1", UploadMediaRequest{
		MimeType:    "video/mp4",
		Size:        11,
		Title:       "Launch Short",
		Description: "Launch Short",
		Settings: map[string]interface{}{
			"privacy":     "private",
			"category_id": "22",
		},
		Reader: bytes.NewBufferString("video-bytes"),
	})
	if err == nil || !strings.Contains(err.Error(), "processing failed") || !strings.Contains(err.Error(), "unsupportedCodec") {
		t.Fatalf("expected processing failure, got %v", err)
	}
	if retryClass, ok := MediaRetryClassificationForError(err); !ok || retryClass != MediaRetryTerminal {
		t.Fatalf("expected terminal processing classification, got %q, %v", retryClass, ok)
	}
}

func TestYouTubeUploadRejectsMissingRequiredChoicesBeforeNetwork(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		t.Fatalf("invalid YouTube metadata must fail before a request: %s %s", req.Method, req.URL.String())
		return nil, nil
	})}

	adapter := NewYouTubeAdapter("", "", "")
	_, err := adapter.UploadMediaWithMetadata(context.Background(), "access-token", "channel-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     5,
		Title:    "Launch",
		Reader:   bytes.NewBufferString("video"),
	})
	if err == nil || !strings.Contains(err.Error(), "privacy") {
		t.Fatalf("expected explicit privacy error, got %v", err)
	}
}

func TestValidateMediaYouTubeRequiresOneVideo(t *testing.T) {
	RegisterAllMediaValidators()

	issues := ValidateMedia(providerYouTube, nil)
	if len(issues) != 1 {
		t.Fatalf("expected one missing-media issue, got %d", len(issues))
	}

	issues = ValidateMedia(providerYouTube, []MediaItem{{ID: "image", MimeType: "image/png"}})
	if len(issues) != 1 {
		t.Fatalf("expected one unsupported-media issue, got %d", len(issues))
	}

	issues = ValidateMedia(providerYouTube, []MediaItem{{ID: "video", MimeType: "video/mp4"}})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for one video, got %#v", issues)
	}
}

func TestYouTubeDiscoversBoundedUploadsPlaylistPages(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	channelCalls := 0
	playlistCalls := 0
	historyStart := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get(headerAuthorization) != "Bearer access-token" {
			t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
		}
		switch req.URL.Path {
		case "/youtube/v3/channels":
			channelCalls++
			if req.URL.Query().Get("part") != "contentDetails" || req.URL.Query().Get("id") != "channel-1" {
				t.Fatalf("unexpected channel query %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"items":[{"contentDetails":{"relatedPlaylists":{"uploads":"uploads-1"}}}]}`), nil
		case "/youtube/v3/playlistItems":
			playlistCalls++
			if req.URL.Query().Get("playlistId") != "uploads-1" || req.URL.Query().Get("maxResults") != "2" {
				t.Fatalf("unexpected uploads query %s", req.URL.RawQuery)
			}
			if req.URL.Query().Get("pageToken") == "" {
				return jsonResponse(req, `{"nextPageToken":"page-2","items":[
					{"snippet":{"title":"  First   upload  ","description":"first","resourceId":{"videoId":"video-a"}},"contentDetails":{"videoId":"video-a","videoPublishedAt":"2026-02-03T12:00:00Z"}},
					{"snippet":{"title":"Second upload","description":"second","publishedAt":"2026-02-02T12:00:00Z","resourceId":{"videoId":"video-b"}},"contentDetails":{"videoId":"video-b"}}
				]}`), nil
			}
			if req.URL.Query().Get("pageToken") != "page-2" {
				t.Fatalf("unexpected page token %q", req.URL.Query().Get("pageToken"))
			}
			return jsonResponse(req, `{"nextPageToken":"page-3","items":[
				{"snippet":{"title":"At bound","description":"third","resourceId":{"videoId":"video-c"}},"contentDetails":{"videoId":"video-c","videoPublishedAt":"2026-01-01T00:00:00Z"}},
				{"snippet":{"title":"Too old","description":"old","resourceId":{"videoId":"video-old"}},"contentDetails":{"videoId":"video-old","videoPublishedAt":"2025-12-31T23:59:59Z"}}
			]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("", "", "")
	if adapter.AccountContentDiscoveryReadRequests(AccountContentDiscoveryRequest{}) != 2 ||
		adapter.AccountContentDiscoveryReadRequests(AccountContentDiscoveryRequest{Cursor: "opaque"}) != 1 {
		t.Fatal("expected channel lookup only on the first discovery page")
	}
	first, err := adapter.DiscoverAccountContent(context.Background(), "access-token", AccountContentDiscoveryRequest{
		AccountID: "channel-1", PublishedAfter: historyStart, PageSize: 2,
	})
	if err != nil {
		t.Fatalf("first discovery page returned error: %v", err)
	}
	if len(first.Items) != 2 || first.Items[0].ProviderContentID != "video-a" || first.Items[0].Title != "First upload" {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Items[0].ExternalURL != "https://www.youtube.com/watch?v=video-a" || first.Items[0].ContentProfile != "long_video" {
		t.Fatalf("unexpected normalized upload: %#v", first.Items[0])
	}
	if first.NextCursor == "" || first.NextCursor == "page-2" || first.Coverage.Status != AccountContentDiscoveryPartial {
		t.Fatalf("expected opaque partial cursor, got %#v", first)
	}

	second, err := adapter.DiscoverAccountContent(context.Background(), "access-token", AccountContentDiscoveryRequest{
		AccountID: "channel-1", Cursor: first.NextCursor, PublishedAfter: historyStart, PageSize: 2,
	})
	if err != nil {
		t.Fatalf("second discovery page returned error: %v", err)
	}
	if len(second.Items) != 1 || second.Items[0].ProviderContentID != "video-c" || !second.Items[0].PublishedAt.Equal(historyStart) {
		t.Fatalf("unexpected bounded second page: %#v", second)
	}
	if second.NextCursor != "" || second.Coverage.Status != AccountContentDiscoveryComplete {
		t.Fatalf("lower history bound must complete pagination: %#v", second)
	}
	if channelCalls != 1 || playlistCalls != 2 {
		t.Fatalf("expected playlist identity to persist in the cursor, calls=%d/%d", channelCalls, playlistCalls)
	}
}

func TestYouTubeAnalyticsReportUsesExplicitDatesAndSemanticUnits(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	start := time.Date(2026, 1, 2, 8, 0, 0, 0, time.UTC)
	end := time.Date(2026, 2, 3, 9, 0, 0, 0, time.UTC)
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Host {
		case "www.googleapis.com":
			return jsonResponse(req, `{"items":[{"statistics":{"subscriberCount":"66","videoCount":"7","viewCount":"900"}}]}`), nil
		case "youtubeanalytics.googleapis.com":
			query := req.URL.Query()
			if query.Get("startDate") != "2026-01-02" || query.Get("endDate") != "2026-02-03" {
				t.Fatalf("report dates were not explicit: %s", req.URL.RawQuery)
			}
			if query.Get("ids") != "channel==MINE" || query.Get("metrics") != strings.Join(youtubeAnalyticsReportMetrics, ",") {
				t.Fatalf("unexpected report query: %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{
				"columnHeaders":[
					{"name":"views"},{"name":"estimatedMinutesWatched"},{"name":"averageViewDuration"},
					{"name":"averageViewPercentage"},{"name":"subscribersGained"},{"name":"subscribersLost"},
					{"name":"likes"},{"name":"comments"},{"name":"shares"}
				],
				"rows":[[120,2.5,12.345,42.125,8,3,10,4,2]]
			}`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, nil
		}
	})}

	measurements, err := NewYouTubeAdapter("", "", "").FetchAccountAnalyticsMeasurements(context.Background(), "token", AccountAnalyticsRequest{
		AccountID: "channel-1", ReportingPeriodStart: start, ReportingPeriodEnd: end,
	})
	if err != nil {
		t.Fatalf("youtube semantic analytics returned error: %v", err)
	}
	if measurements[MetricEstimatedWatchTime].Value != 150_000 || measurements[MetricAverageViewDuration].Value != 12_345 {
		t.Fatalf("watch time and duration were not normalized to milliseconds: %#v", measurements)
	}
	if measurements[MetricAverageViewPercentage].Value != 4_213 {
		t.Fatalf("average percentage was not normalized to basis points: %#v", measurements[MetricAverageViewPercentage])
	}
	if measurements[MetricViews].Aggregation != AnalyticsMetricAggregationLifetimeTotal || measurements[MetricViews].Source != youtubeDataAPIMetricSource {
		t.Fatalf("Data API views lost lifetime semantics: %#v", measurements[MetricViews])
	}
	if measurements[MetricReportViews].Aggregation != AnalyticsMetricAggregationReportingPeriodTotal || measurements[MetricReportViews].Source != youtubeAnalyticsMetricSource {
		t.Fatalf("report views lost period semantics: %#v", measurements[MetricReportViews])
	}
	if !measurements[MetricReportViews].PeriodStart.Equal(start) || !measurements[MetricReportViews].PeriodEnd.Equal(end) {
		t.Fatalf("report period was not preserved: %#v", measurements[MetricReportViews])
	}
}

func TestYouTubeAnalyticsReportPreservesMissingColumns(t *testing.T) {
	body := []byte(`{
		"columnHeaders":[{"name":"views"},{"name":"averageViewPercentage"},{"name":"comments"}],
		"rows":[[0,50.5,null]]
	}`)
	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC)
	measurements, err := decodeYouTubeAnalyticsReport(body, start, end)
	if err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if value, ok := measurements[MetricReportViews]; !ok || value.Value != 0 {
		t.Fatalf("explicit zero report views should remain measured: %#v", measurements)
	}
	if _, ok := measurements[MetricReportComments]; ok {
		t.Fatalf("null report column must remain missing: %#v", measurements)
	}
	for _, absent := range []string{MetricEstimatedWatchTime, MetricAverageViewDuration, MetricSubscribersGained, MetricSubscribersLost, MetricReportLikes, MetricReportShares} {
		if _, ok := measurements[absent]; ok {
			t.Fatalf("absent report column %q became measured: %#v", absent, measurements)
		}
	}
}

func TestYouTubeBatchUploadStatisticsRemainKeyedAndLifetime(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/youtube/v3/videos" || req.URL.Query().Get("part") != "statistics" || req.URL.Query().Get("id") != "video-a,video-b" {
			t.Fatalf("unexpected statistics request %s", req.URL.String())
		}
		return jsonResponse(req, `{"items":[
			{"id":"video-b","statistics":{"viewCount":"200","likeCount":"20","commentCount":"2"}},
			{"id":"video-a","statistics":{"viewCount":"100","likeCount":"10","commentCount":"1"}}
		]}`), nil
	})}

	measurements, err := NewYouTubeAdapter("", "", "").FetchAccountContentBatchMeasurements(context.Background(), "access-token", AccountContentBatchMeasurementRequest{
		AccountID: "channel-1", ProviderContentIDs: []string{"video-a", "video-b", "video-a"},
	})
	if err != nil {
		t.Fatalf("batch statistics returned error: %v", err)
	}
	if measurements["video-a"][MetricViews].Value != 100 || measurements["video-b"][MetricViews].Value != 200 {
		t.Fatalf("video metrics crossed provider IDs: %#v", measurements)
	}
	metadata := measurements["video-b"][MetricLikes].AnalyticsMetricMetadata
	if metadata.Unit != AnalyticsMetricUnitCount || metadata.Aggregation != AnalyticsMetricAggregationLifetimeTotal || metadata.Source != youtubeDataAPIMetricSource {
		t.Fatalf("unexpected lifetime metric semantics: %#v", metadata)
	}
}

func TestYouTubeDiscoveryClassifiesQuotaWithoutPersistingProviderBody(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		response := jsonResponseWithStatus(req, http.StatusForbidden, `{"error":{"errors":[{"reason":"quotaExceeded"}],"message":"secret provider detail"}}`)
		response.Header.Set("Retry-After", "3600")
		return response, nil
	})}
	_, err := NewYouTubeAdapter("", "", "").DiscoverAccountContent(context.Background(), "access-token", AccountContentDiscoveryRequest{
		AccountID: "channel-1", PageSize: 1,
	})
	if err == nil {
		t.Fatal("expected quota error")
	}
	var discoveryErr *AccountContentDiscoveryError
	if !errors.As(err, &discoveryErr) || discoveryErr.Status != AccountContentDiscoveryRateLimited || discoveryErr.Code != "quotaExceeded" || discoveryErr.RetryAfter != time.Hour {
		t.Fatalf("unexpected quota classification: %#v, %v", discoveryErr, err)
	}
	if strings.Contains(err.Error(), "secret provider detail") {
		t.Fatalf("provider response leaked through discovery error: %v", err)
	}
}
