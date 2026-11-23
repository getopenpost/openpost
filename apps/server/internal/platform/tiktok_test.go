package platform

import (
	"bytes"

	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTikTokPhotoPublishRejectsOversizedShortSideBeforeProviderIO(t *testing.T) {
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		t.Fatalf("oversized image reached provider I/O: %s", req.URL)
		return nil, nil
	})}
	_, err := NewTikTokAdapter("", "", "").publishPhotoPost(t.Context(), "token", &PublishRequest{
		PlatformMediaIDs: []string{"https://media.example/photo.jpg"},
		Media:            []MediaItem{{ID: "photo-1", MimeType: "image/jpeg", Width: 1081, Height: 1441}},
	})
	if err == nil || !strings.Contains(err.Error(), "1080 pixels on the shorter side") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func mustParseQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}
	return parsed.Query()
}

func TestTikTokGetProfileStillFailsForDeadToken(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusUnauthorized} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				return jsonResponseWithStatus(req, status, `{"data":{},"error":{"code":"access_token_invalid","message":"invalid token","log_id":"log"}}`), nil
			})}
			_, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").GetProfile(t.Context(), "access")
			require.Error(t, err)
			require.Equal(t, 1, calls, "dead token must not trigger a basic-fields retry")
		})
	}
}

func TestTikTokPublishDoesNotGuessPublicIdentityFromCaption(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	createdAt := time.Now().UTC().Add(-time.Minute).Unix()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokCreatorInfoURL:
			return jsonResponse(req, `{"data":{"privacy_level_options":["PUBLIC_TO_EVERYONE"]},"error":{"code":"ok"}}`), nil
		case tiktokVideoInitURL:
			return jsonResponse(req, `{"data":{"publish_id":"publish-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"PUBLISH_COMPLETE"},"error":{"code":"ok"}}`), nil
		case tiktokVideoListURL:
			return jsonResponse(req, fmt.Sprintf(`{"data":{"videos":[{"id":"7511111111111111111","create_time":%d,"video_description":"Launch   video"}]},"error":{"code":"ok"}}`, createdAt)), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}
	request := &PublishRequest{
		Content: "Launch video", PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:    []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
		Settings: map[string]interface{}{"content_posting_method": "DIRECT_POST", "privacy_level": "PUBLIC_TO_EVERYONE"},
	}
	var checkpoints []PublishResult
	request.SetWriteFence(func(PublishResult) error { return nil }, func(result PublishResult) error {
		checkpoints = append(checkpoints, result)
		return nil
	})
	result, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").Publish(t.Context(), "access", "open-1", request)
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if result.ExternalID != "" || result.ProviderReference != "publish-1" || result.SubmissionState != PublishSubmissionPending {
		t.Fatalf("unconfirmed public identity must stay pending, got %#v", result)
	}
	if len(checkpoints) != 2 || checkpoints[1].ProviderState != "published_unresolved" || checkpoints[1].RetrySafety != PublishRetryReconcileOnly {
		t.Fatalf("expected durable unresolved checkpoint, got %#v", checkpoints)
	}
}

// TikTok's Media Transfer Guide: total_chunk_count is video_size divided by
// chunk_size rounded down, every chunk is 5-64 MB except the final one, which
// carries the trailing bytes (up to 128 MB), and a video over 64 MB must be
// sent in more than one chunk.
func TestTikTokFileUploadSendsTheChunksItDeclares(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const uploadURL = "https://open-upload.tiktokapis.com/video/?upload_id=1"
	const videoSize = tiktokMaxChunkSize + 3
	var chunkSize, totalChunks int64
	var puts []int64
	var next int64
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokVideoInboxInitURL:
			var body struct {
				SourceInfo struct {
					VideoSize       int64 `json:"video_size"`
					ChunkSize       int64 `json:"chunk_size"`
					TotalChunkCount int64 `json:"total_chunk_count"`
				} `json:"source_info"`
			}
			require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
			require.Equal(t, int64(videoSize), body.SourceInfo.VideoSize)
			chunkSize, totalChunks = body.SourceInfo.ChunkSize, body.SourceInfo.TotalChunkCount
			return jsonResponse(req, `{"data":{"publish_id":"publish-1","upload_url":"`+uploadURL+`"},"error":{"code":"ok"}}`), nil
		case uploadURL:
			size, err := io.Copy(io.Discard, req.Body)
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf("bytes %d-%d/%d", next, next+size-1, videoSize), req.Header.Get("Content-Range"))
			next += size
			puts = append(puts, size)
			return jsonResponseWithStatus(req, http.StatusCreated, `{}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	publishID, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").UploadMediaWithMetadata(t.Context(), "access", "open-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Settings: map[string]interface{}{"content_posting_method": "MEDIA_UPLOAD"},
		Reader:   bytes.NewReader(make([]byte, videoSize)),
	})
	require.NoError(t, err)
	require.Equal(t, "publish-1", publishID)
	require.Equal(t, int64(videoSize), next)
	require.Equal(t, videoSize/chunkSize, totalChunks, "total_chunk_count must be video_size / chunk_size rounded down")
	require.Len(t, puts, int(totalChunks))
	require.GreaterOrEqual(t, totalChunks, int64(2), "a video over 64 MB must be sent in several chunks")
	for index, size := range puts[:len(puts)-1] {
		require.Equal(t, chunkSize, size, "chunk %d", index)
	}
	require.GreaterOrEqual(t, chunkSize, int64(5*1024*1024))
	require.LessOrEqual(t, chunkSize, int64(tiktokMaxChunkSize))
	final := puts[len(puts)-1]
	require.GreaterOrEqual(t, final, chunkSize, "the final chunk carries the trailing bytes")
	require.LessOrEqual(t, final, int64(128*1024*1024))
}

func jsonResponse(req *http.Request, body string) *http.Response {
	return jsonResponseWithStatus(req, http.StatusOK, body)
}

func jsonResponseWithStatus(req *http.Request, statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header:     http.Header{"Content-Type": []string{contentTypeJSON}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func TestTikTokInboxWaitsForPublicPublication(t *testing.T) {
	original := httpClient
	defer func() { httpClient = original }()
	complete := false
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if complete {
			return jsonResponse(r, `{"data":{"status":"PUBLISH_COMPLETE","publicly_available_post_id":["741234"]},"error":{"code":"ok"}}`), nil
		}
		return jsonResponse(r, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
	})}
	adapter := NewTikTokAdapter("", "", "")
	result, err := adapter.ReconcilePublishRequest(t.Context(), "token", "account", &PublishRequest{Settings: map[string]interface{}{"content_posting_method": "MEDIA_UPLOAD"}}, "publish-1")
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionPending, result.SubmissionState)
	require.Equal(t, "inbox_delivered", result.ProviderState)
	require.Empty(t, result.ExternalID)
	require.Equal(t, "publish-1", result.ProviderReference)
	complete = true
	result, err = adapter.ReconcilePublish(t.Context(), "token", "account", result.ProviderReference)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionAccepted, result.SubmissionState)
	require.Equal(t, "741234", result.ExternalID)
}
