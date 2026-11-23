package platform

import (
	"bytes"
	"context"

	"errors"

	"io"
	"net/http"

	"strings"
	"testing"
)

func TestYouTubeGetProfileRejectsAccountsWithoutChannels(t *testing.T) {
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.URL.Path != "/youtube/v3/channels" {
			t.Fatalf("unexpected profile endpoint %s", req.URL)
		}
		return jsonResponse(req, `{"items":[]}`), nil
	})}

	profile, err := NewYouTubeAdapter("client", "secret", "https://app.example/callback").GetProfile(t.Context(), "channel-token")
	if err == nil || !strings.Contains(err.Error(), "no YouTube channels") {
		t.Fatalf("GetProfile error = %v, want no-channels error", err)
	}
	if profile != nil || requests != 1 {
		t.Fatalf("GetProfile returned profile %#v after %d requests, want nil after one channel lookup", profile, requests)
	}
}

func TestYouTubeThumbnailPhoneVerificationUsesStableError(t *testing.T) {
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponseWithStatus(req, http.StatusForbidden, `{"error":{"errors":[{"domain":"youtube.thumbnail","reason":"forbidden"}],"message":"private provider detail"}}`), nil
	})}
	err := NewYouTubeAdapter("client", "secret", "https://app.example/callback").setYouTubeThumbnail(t.Context(), "token", "video-1", UploadMediaRequest{
		ThumbnailMimeType: "image/jpeg", ThumbnailSize: 5, ThumbnailReader: strings.NewReader("cover"),
	})
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.Code != "youtube:thumbnail_channel_verification_required" || strings.Contains(err.Error(), "private provider detail") {
		t.Fatalf("unexpected thumbnail error: %v", err)
	}
}

func TestYouTubeCaptionDuplicateResponseIsReconciled(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
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
	if requests != 1 {
		t.Fatalf("expected one native request, got %d", requests)
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
