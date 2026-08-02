package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
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
	if channelsCalls != 2 {
		t.Fatalf("expected two channels calls, got %d", channelsCalls)
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
