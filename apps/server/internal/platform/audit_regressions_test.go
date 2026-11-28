package platform

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTikTokChunkUploadRetriesTransient5xxAnd429WithoutRestarting(t *testing.T) {
	originalClient := httpClient
	originalDelay := tiktokChunkRetryDelay
	defer func() {
		httpClient = originalClient
		tiktokChunkRetryDelay = originalDelay
	}()
	tiktokChunkRetryDelay = 0

	initCalls := 0
	var seenRanges []string
	chunkAttempts := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokVideoInboxInitURL:
			initCalls++
			return jsonResponse(req, `{"data":{"publish_id":"v_pub_chunk_retry","upload_url":"https://upload.tiktok.example/part"}}`), nil
		case "https://upload.tiktok.example/part":
			chunkAttempts++
			seenRanges = append(seenRanges, req.Header.Get("Content-Range"))
			body, err := io.ReadAll(req.Body)
			require.NoError(t, err)
			require.Equal(t, []byte("video-bytes"), body, "each chunk retry must send a fresh reader with identical bytes")
			switch chunkAttempts {
			case 1:
				resp := &http.Response{StatusCode: http.StatusServiceUnavailable, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("<html>503</html>")), Request: req}
				return resp, nil
			case 2:
				headers := make(http.Header)
				headers.Set("Retry-After", "0")
				resp := &http.Response{StatusCode: http.StatusTooManyRequests, Header: headers, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"rate_limit"}}`)), Request: req}
				return resp, nil
			default:
				return &http.Response{StatusCode: http.StatusCreated, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
			}
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	publishID, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").UploadMediaWithMetadata(t.Context(), "access", "open-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     int64(len("video-bytes")),
		Reader:   strings.NewReader("video-bytes"),
		Settings: map[string]interface{}{"content_posting_method": "MEDIA_UPLOAD"},
	})
	require.NoError(t, err)
	require.Equal(t, "v_pub_chunk_retry", publishID)
	require.Equal(t, 1, initCalls, "transient chunk failures must not re-initialize the upload")
	require.Equal(t, 3, chunkAttempts)
	require.Equal(t, []string{"bytes 0-10/11", "bytes 0-10/11", "bytes 0-10/11"}, seenRanges)
}

func TestTikTokChunkUploadDoesNotRetryClient400(t *testing.T) {
	originalClient := httpClient
	originalDelay := tiktokChunkRetryDelay
	defer func() {
		httpClient = originalClient
		tiktokChunkRetryDelay = originalDelay
	}()
	tiktokChunkRetryDelay = 0

	chunkAttempts := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokVideoInboxInitURL:
			return jsonResponse(req, `{"data":{"publish_id":"v_pub_400","upload_url":"https://upload.tiktok.example/part"}}`), nil
		case "https://upload.tiktok.example/part":
			chunkAttempts++
			return &http.Response{StatusCode: http.StatusBadRequest, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":{"code":"invalid_range"}}`)), Request: req}, nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	_, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").UploadMediaWithMetadata(t.Context(), "access", "open-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     4,
		Reader:   strings.NewReader("abcd"),
		Settings: map[string]interface{}{"content_posting_method": "MEDIA_UPLOAD"},
	})
	require.Error(t, err)
	require.Equal(t, 1, chunkAttempts, "non-429 4xx chunk rejections must not retry")
}

func TestInstagramRejectsZeroSentinelContainerID(t *testing.T) {
	_, err := instagramIDFromResponse("instagram carousel container", []byte(`{"id":"0"}`))
	require.Error(t, err)
	require.Error(t, validateInstagramCheckpointID("0"))
	require.Error(t, validateInstagramCheckpointID("00"))
	require.Error(t, validateInstagramCheckpointID(instagramUnknownPublishedIDPrefix+"0"))
	require.NoError(t, validateInstagramCheckpointID("179876543210"))
}

func TestInstagramCarouselAllows11And20ItemsAndRejects21(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	makeRequest := func(count int) *PublishRequest {
		urls := make([]string, count)
		media := make([]MediaItem, count)
		for idx := range count {
			urls[idx] = fmt.Sprintf("https://media.example/photo-%d.jpg", idx+1)
			media[idx] = MediaItem{ID: fmt.Sprintf("m-%d", idx+1), MimeType: "image/jpeg"}
		}
		return &PublishRequest{
			Profile:          "carousel",
			Content:          "Carousel test",
			PlatformMediaIDs: urls,
			Media:            media,
		}
	}

	adapter := NewInstagramAdapter("client", "secret", "https://app.example/callback")

	for _, count := range []int{11, 20} {
		t.Run(fmt.Sprintf("%d_items", count), func(t *testing.T) {
			childSeq := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/v25.0/ig-1/media":
					require.NoError(t, req.ParseForm())
					if req.PostForm.Get("media_type") == "CAROUSEL" {
						children := strings.Split(req.PostForm.Get("children"), ",")
						require.Len(t, children, count)
						return jsonResponse(req, `{"id":"parent-carousel-1"}`), nil
					}
					childSeq++
					return jsonResponse(req, fmt.Sprintf(`{"id":"child-%d"}`, childSeq)), nil
				case "/v25.0/ig-1/media_publish":
					return jsonResponse(req, `{"id":"published-carousel-1"}`), nil
				default:
					return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
				}
			})}

			result, err := adapter.Publish(t.Context(), "page-token", "ig-1", makeRequest(count))
			require.NoError(t, err)
			require.Equal(t, "published-carousel-1", result.ExternalID)
			require.Equal(t, count, childSeq)
		})
	}

	_, err := adapter.Publish(t.Context(), "page-token", "ig-1", makeRequest(21))
	require.ErrorContains(t, err, "2-20")
}

func TestInstagramGrantDescriptorSeparatesFacebookAndInstagramLogin(t *testing.T) {
	fbAdapter := NewInstagramAdapter("shared-app", "secret", "https://app.example/cb")
	igLoginAdapter := NewInstagramLoginAdapter("shared-app", "secret", "https://app.example/cb")

	fbDesc := fbAdapter.AuthorizationGrantDescriptor()
	igDesc := igLoginAdapter.AuthorizationGrantDescriptor()
	require.Equal(t, "oauth2", fbDesc.ExecutionMode)
	require.Equal(t, "oauth2:instagram_login", igDesc.ExecutionMode)
	require.NotEqual(t, fbDesc.ExecutionMode, igDesc.ExecutionMode)
	require.Equal(t, "instagram_login", igDesc.Evidence["connection_type"])
}

func TestMetaNormalizesThreadsInvalidLinkAttachment4279047(t *testing.T) {
	err := normalizeMetaPublishError(&HTTPError{
		StatusCode: http.StatusBadRequest,
		Code:       "100",
		Subcode:    "4279047",
	})
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, http.StatusBadRequest, providerErr.StatusCode)
	require.Equal(t, "meta:invalid_link_attachment:4279047", providerErr.Code)
	require.Contains(t, MetaFailureMessage(providerErr.Code), "invalid link attachment")
}

func TestFacebookRuploadMapsRobotsTxtCrawlerBlock(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/page-1/video_reels"):
			return jsonResponse(req, `{"video_id":"video-1","upload_url":"https://rupload.facebook.com/video-1"}`), nil
		case req.URL.Host == "rupload.facebook.com":
			resp := jsonResponse(req, `{"debug_info":{"type":"FileUrlProcessingError","message":"403 Restricted by robots.txt"}}`)
			resp.StatusCode = http.StatusBadRequest
			return resp, nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, nil
		}
	})}

	_, err := NewFacebookAdapter("", "", "").Publish(t.Context(), "page-token", "page-1", &PublishRequest{
		Profile:          "short_video",
		OutputProfile:    "facebook.reel",
		PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
	})
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, "meta:media_url_blocked_by_robots", providerErr.Code)
	require.NotContains(t, err.Error(), "FileUrlProcessingError")
	require.Contains(t, MetaFailureMessage(providerErr.Code), "meta-externalfetcher")
}

func TestFacebookExchangeCodeFailsWhenLongLivedExchangeFails(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.NoError(t, req.ParseForm())
		if req.PostForm.Get(grantType) == "fb_exchange_token" {
			resp := jsonResponse(req, `{"error":{"code":190,"message":"invalid"}}`)
			resp.StatusCode = http.StatusBadRequest
			return resp, nil
		}
		return jsonResponse(req, `{"access_token":"short-user-token","token_type":"bearer","expires_in":3600}`), nil
	})}

	_, err := NewFacebookAdapter("client", "secret", "https://app.example/cb").ExchangeCode(t.Context(), "code", nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "long-lived token exchange")
}

func TestPinterestNormalizesCode21TimeoutAndCode1Refusal(t *testing.T) {
	timeoutErr := normalizePinterestPinCreateError(&HTTPError{StatusCode: http.StatusBadRequest, Code: "21"})
	var providerErr *HTTPError
	require.ErrorAs(t, timeoutErr, &providerErr)
	require.Equal(t, "pinterest:create_timeout:21", providerErr.Code)

	refusedErr := normalizePinterestPinCreateError(&HTTPError{StatusCode: http.StatusBadRequest, Code: "1"})
	require.ErrorAs(t, refusedErr, &providerErr)
	require.Equal(t, "pinterest:temporarily_refused:1", providerErr.Code)

	// Non-400 code 1 must not be rewritten as the 400 temporary refusal.
	otherErr := normalizePinterestPinCreateError(&HTTPError{StatusCode: http.StatusInternalServerError, Code: "1"})
	require.ErrorAs(t, otherErr, &providerErr)
	require.Equal(t, "1", providerErr.Code)
}

func TestYouTubeShortsWaitsForProcessingBeforeSettingThumbnail(t *testing.T) {
	originalClient := httpClient
	originalInterval := youtubeShortsThumbnailPollInterval
	originalMaxPolls := youtubeShortsThumbnailMaxPolls
	defer func() {
		httpClient = originalClient
		youtubeShortsThumbnailPollInterval = originalInterval
		youtubeShortsThumbnailMaxPolls = originalMaxPolls
	}()
	youtubeShortsThumbnailPollInterval = 0
	youtubeShortsThumbnailMaxPolls = 3

	var callOrder []string
	statusChecks := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodGet && strings.Contains(req.URL.Path, "/videos"):
			statusChecks++
			callOrder = append(callOrder, fmt.Sprintf("status-%d", statusChecks))
			if statusChecks == 1 {
				return jsonResponse(req, `{"items":[{"id":"short-1","status":{"uploadStatus":"uploaded"},"processingDetails":{"processingStatus":"processing"}}]}`), nil
			}
			return jsonResponse(req, `{"items":[{"id":"short-1","status":{"uploadStatus":"processed"},"processingDetails":{"processingStatus":"succeeded"}}]}`), nil
		case req.Method == http.MethodPost && strings.Contains(req.URL.Path, "/thumbnails/set"):
			callOrder = append(callOrder, "thumbnail")
			return jsonResponse(req, `{"items":[{}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewYouTubeAdapter("client", "secret", "https://app.example/cb")
	state := ResumableMediaUploadState{
		ProviderMediaID: "short-1",
		TotalBytes:      10,
		Status:          MediaUploadUploaded,
	}
	videoID, err := adapter.UploadMediaResumable(t.Context(), "token", "channel-1", UploadMediaRequest{
		Profile:           "short_video",
		OutputProfile:     "youtube.short",
		MimeType:          "video/mp4",
		Size:              10,
		Title:             "My Short",
		Settings:          map[string]interface{}{"privacy": "public", "category_id": "22"},
		OpenReaderAt:      func(int64) (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(make([]byte, 10))), nil },
		ThumbnailMimeType: "image/jpeg",
		ThumbnailReader:   strings.NewReader("thumb-bytes"),
	}, state, func(ResumableMediaUploadState) error { return nil })
	require.NoError(t, err)
	require.Equal(t, "short-1", videoID)
	require.Equal(t, []string{"status-1", "status-2", "thumbnail", "status-3"}, callOrder)
}

func TestYouTubeShortsDefersThumbnailSafelyWhileStillProcessing(t *testing.T) {
	originalClient := httpClient
	originalInterval := youtubeShortsThumbnailPollInterval
	originalMaxPolls := youtubeShortsThumbnailMaxPolls
	defer func() {
		httpClient = originalClient
		youtubeShortsThumbnailPollInterval = originalInterval
		youtubeShortsThumbnailMaxPolls = originalMaxPolls
	}()
	youtubeShortsThumbnailPollInterval = 0
	youtubeShortsThumbnailMaxPolls = 2

	thumbnailCalled := false
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPost && strings.Contains(req.URL.Path, "/thumbnails/set") {
			thumbnailCalled = true
		}
		return jsonResponse(req, `{"items":[{"id":"short-2","status":{"uploadStatus":"uploaded"},"processingDetails":{"processingStatus":"processing"}}]}`), nil
	})}

	adapter := NewYouTubeAdapter("client", "secret", "https://app.example/cb")
	_, err := adapter.UploadMediaResumable(t.Context(), "token", "channel-1", UploadMediaRequest{
		Profile:           "short_video",
		MimeType:          "video/mp4",
		Size:              10,
		Title:             "My Short",
		Settings:          map[string]interface{}{"privacy": "public", "category_id": "22"},
		OpenReaderAt:      func(int64) (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(make([]byte, 10))), nil },
		ThumbnailMimeType: "image/jpeg",
		ThumbnailReader:   strings.NewReader("thumb-bytes"),
	}, ResumableMediaUploadState{ProviderMediaID: "short-2", TotalBytes: 10}, func(ResumableMediaUploadState) error { return nil })
	require.Error(t, err)
	require.False(t, thumbnailCalled, "thumbnail must not be applied before Short finishes processing")
	classification, ok := MediaRetryClassificationForError(err)
	require.True(t, ok)
	require.Equal(t, MediaRetrySafeResume, classification)
}

func TestYouTubeRevokeAuthorizationCallsGoogleRevokeEndpoint(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var revokedToken string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, googleOAuthRevokeURL, req.URL.String())
		body, err := io.ReadAll(req.Body)
		require.NoError(t, err)
		values, err := url.ParseQuery(string(body))
		require.NoError(t, err)
		revokedToken = values.Get("token")
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	})}

	var revoker AuthorizationRevoker = NewYouTubeAdapter("client", "secret", "https://app.example/cb")
	require.NoError(t, revoker.RevokeAuthorization(t.Context(), "yt-access-token"))
	require.Equal(t, "yt-access-token", revokedToken)
}

func TestLinkedInFirstCommentRetriesTransient404Propagation(t *testing.T) {
	originalClient := httpClient
	originalDelay := linkedInFirstCommentRetryDelay
	defer func() {
		httpClient = originalClient
		linkedInFirstCommentRetryDelay = originalDelay
	}()
	linkedInFirstCommentRetryDelay = 0

	attempts := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		attempts++
		if attempts < 3 {
			return &http.Response{StatusCode: http.StatusNotFound, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"status":404}`)), Request: req}, nil
		}
		return jsonResponse(req, `{"commentUrn":"urn:li:comment:(urn:li:share:1,2)"}`), nil
	})}

	commentID, err := NewLinkedInAdapter("client", "secret", "https://app.example/cb", false).PostFirstComment(
		t.Context(), "access", "person-1", "urn:li:share:1", "First comment!",
	)
	require.NoError(t, err)
	require.Equal(t, "urn:li:comment:(urn:li:share:1,2)", commentID)
	require.Equal(t, 3, attempts)
}

func TestLinkedInCreatePostClassifies422DuplicateContent(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		resp := jsonResponse(req, `{"status":422,"message":"Content is a duplicate of urn:li:share:7391234567890123456"}`)
		resp.StatusCode = http.StatusUnprocessableEntity
		return resp, nil
	})}

	_, err := NewLinkedInAdapter("client", "secret", "https://app.example/cb", false).Publish(t.Context(), "access", "person-1", &PublishRequest{
		Content: "Launch announcement",
	})
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, http.StatusUnprocessableEntity, providerErr.StatusCode)
	require.Equal(t, "linkedin:duplicate_content", providerErr.Code)
	require.NotContains(t, err.Error(), "7391234567890123456")
}

func TestDiscordBotReadAndReconcileNormalize401AsBotTokenInvalid(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusUnauthorized, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"message":"401: Unauthorized"}`)), Request: req}, nil
	})}

	adapter := NewDiscordBotAdapter("client", "secret", "https://app.example/cb", "bad-bot-token")

	_, err := adapter.RefreshAccountMetadata(t.Context(), "", AccountMetadataRequest{AccountID: "guild-1"})
	var providerErr *HTTPError
	require.True(t, errors.As(err, &providerErr))
	require.Equal(t, discordBotTokenInvalidCode, providerErr.Code)

	_, err = adapter.FetchAccountAnalyticsMeasurements(t.Context(), "", AccountAnalyticsRequest{AccountID: "guild-1"})
	require.True(t, errors.As(err, &providerErr))
	require.Equal(t, discordBotTokenInvalidCode, providerErr.Code)

	_, err = adapter.FetchContentAnalyticsMeasurements(t.Context(), "", ContentAnalyticsRequest{
		ExternalIDs:        []string{"msg-1"},
		ProviderReferences: []string{"discord:chan-1:msg-1:0"},
	})
	require.True(t, errors.As(err, &providerErr))
	require.Equal(t, discordBotTokenInvalidCode, providerErr.Code)
}

func TestGoogleBusinessScheduleRejectsEndBeforeStart(t *testing.T) {
	_, err := googleBusinessSchedulePayload(map[string]interface{}{
		"event_start_date": "2026-12-10",
		"event_end_date":   "2026-12-01",
	})
	require.ErrorContains(t, err, "on or after")

	schedule, err := googleBusinessSchedulePayload(map[string]interface{}{
		"event_start_date": "2026-12-10",
		"event_end_date":   "2026-12-10",
	})
	require.NoError(t, err)
	require.NotNil(t, schedule.EndDate)
}

// Keep context import used across platform test helpers if needed.
var _ context.Context
