package platform

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestXUnrepostUsesSourcePostID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodDelete || req.URL.Path != "/2/users/target-user/retweets/source-post" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"retweeted":false}}`))
	}))
	defer server.Close()

	adapter := NewXAdapter("", "", "")
	adapter.apiBaseURL = server.URL
	if err := adapter.Unrepost(context.Background(), "access|secret", "target-user", UnrepostRequest{
		SourceExternalID: "source-post", RepostExternalID: "ignored-repost-id",
	}); err != nil {
		t.Fatalf("unrepost failed: %v", err)
	}
}

func TestXIncrementalCommentsSendSinceIDAndBoundedNextToken(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.URL.Path != "/2/tweets/search/recent" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		query := r.URL.Query()
		requireQuery := func(key, want string) {
			if got := query.Get(key); got != want {
				t.Fatalf("%s: got %q, want %q", key, got, want)
			}
		}
		requireQuery("query", "conversation_id:post-1")
		requireQuery("max_results", "25")
		if requestCount == 1 {
			requireQuery("since_id", "100")
			requireQuery("next_token", "")
		} else {
			requireQuery("since_id", "100")
			requireQuery("next_token", "opaque-page-2")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"101","text":"Reply","author_id":"reader","conversation_id":"post-1"}],"meta":{"newest_id":"101","next_token":"opaque-page-2"}}`))
	}))
	defer server.Close()
	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	page, err := adapter.ListCommentPage(t.Context(), "access-token|access-secret", "account-1", "post-1", IncrementalCommentRequest{SinceID: "100", Limit: 25})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if page.HighestID != "101" || page.NextToken != "opaque-page-2" || len(page.Comments) != 1 {
		t.Fatalf("unexpected page: %#v", page)
	}
	_, err = adapter.ListCommentPage(t.Context(), "access-token|access-secret", "account-1", "post-1", IncrementalCommentRequest{SinceID: "100", NextToken: page.NextToken, Limit: 25})
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
}

func TestXIncrementalCommentsClassifyDepletedCreditsWithoutResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"title":"private provider response"}`))
	}))
	defer server.Close()
	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	_, err := adapter.ListCommentPage(t.Context(), "access-token|access-secret", "account-1", "post-1", IncrementalCommentRequest{})
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) {
		t.Fatalf("expected HTTPError, got %v", err)
	}
	if providerErr.Code != "credits_depleted" || providerErr.RetryAfter != 24*time.Hour {
		t.Fatalf("unexpected depleted-credit classification: %#v", providerErr)
	}
	if strings.Contains(err.Error(), "private provider response") || strings.Contains(err.Error(), "access-token") {
		t.Fatalf("error retained provider body or credential: %v", err)
	}
}

func TestBuildXTweetPayloadRejectsMutuallyExclusiveAttachments(t *testing.T) {
	_, err := buildXTweetPayload(&PublishRequest{
		Content:          "Pick one",
		PlatformMediaIDs: []string{"media-1"},
		Settings: map[string]interface{}{
			"poll_options": "One\nTwo",
		},
	})
	if err == nil {
		t.Fatal("expected media and poll conflict")
	}

	_, err = buildXTweetPayload(&PublishRequest{
		Content:          "Quote with media",
		PlatformMediaIDs: []string{"media-1"},
		Settings: map[string]interface{}{
			"quote_tweet_id": "1346889436626259968",
		},
	})
	if err == nil {
		t.Fatal("expected media and quote conflict")
	}
}

func TestXResolveAccountPublishingCapabilitiesReadsAuthenticatedSubscription(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/2/users/me" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if !strings.Contains(r.URL.Query().Get("user.fields"), "subscription_type") {
			t.Fatalf("subscription_type was not requested: %q", r.URL.RawQuery)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "OAuth ") {
			t.Fatalf("expected OAuth 1.0a authorization header")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"id":"42","name":"Ada","username":"ada","subscription_type":"PremiumPlus"}}`)
	}))
	defer server.Close()

	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	result, err := adapter.ResolveAccountPublishingCapabilities(t.Context(), "access-token|access-secret", AccountCapabilityInput{})
	if err != nil {
		t.Fatalf("ResolveAccountPublishingCapabilities returned error: %v", err)
	}
	if result.State[XCapabilityStateSubscriptionType] != XSubscriptionTypePremiumPlus {
		t.Fatalf("unexpected capability state: %#v", result.State)
	}
	if result.Constraints["text_limit"] != XPremiumTextLimit {
		t.Fatalf("unexpected constraints: %#v", result.Constraints)
	}
}

func TestXChunkedUploadStreamsBoundedSegments(t *testing.T) {
	appendSizes := []int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType := r.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "multipart/form-data") {
			if err := r.ParseMultipartForm(xMediaUploadChunkSize + 1024); err != nil {
				t.Fatalf("parse APPEND request: %v", err)
			}
			segmentIndex, err := strconv.Atoi(r.FormValue("segment_index"))
			if err != nil {
				t.Fatalf("parse segment index: %v", err)
			}
			file, _, err := r.FormFile("media")
			if err != nil {
				t.Fatalf("read APPEND media: %v", err)
			}
			defer file.Close()
			data, err := io.ReadAll(file)
			if err != nil {
				t.Fatalf("read APPEND segment: %v", err)
			}
			if segmentIndex != len(appendSizes) {
				t.Fatalf("unexpected segment order %d", segmentIndex)
			}
			appendSizes = append(appendSizes, len(data))
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse upload command: %v", err)
		}
		switch r.FormValue("command") {
		case "INIT":
			_, _ = io.WriteString(w, `{"media_id_string":"media-1"}`)
		case "FINALIZE":
			_, _ = io.WriteString(w, `{}`)
		default:
			t.Fatalf("unexpected upload command %q", r.FormValue("command"))
		}
	}))
	defer server.Close()

	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)
	adapter.uploadBaseURL = server.URL
	media := bytes.Repeat([]byte("x"), xMediaUploadChunkSize+37)

	mediaID, err := adapter.UploadMediaWithMetadata(t.Context(), "access-token|access-secret", "", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     int64(len(media)),
		Reader:   bytes.NewReader(media),
	})
	if err != nil {
		t.Fatalf("UploadMediaWithMetadata returned error: %v", err)
	}
	if mediaID != "media-1" {
		t.Fatalf("unexpected media id %q", mediaID)
	}
	want := []int{xMediaUploadChunkSize, 37}
	if !reflect.DeepEqual(appendSizes, want) {
		t.Fatalf("unexpected APPEND sizes: got %v want %v", appendSizes, want)
	}
}

func TestXMediaProcessingFailureIsTerminal(t *testing.T) {
	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)

	err := adapter.waitForMediaProcessing(
		t.Context(),
		"access-token|access-secret",
		"media-1",
		&xMediaProcessingInfo{
			State: "failed",
			Error: &xMediaProcessingError{Message: "unsupported resolution"},
		},
	)
	if err == nil {
		t.Fatal("expected failed X processing to return an error")
	}
	if !strings.Contains(err.Error(), "unsupported resolution") {
		t.Fatalf("expected provider processing error, got %v", err)
	}
	classification, ok := MediaRetryClassificationForError(err)
	if !ok || classification != MediaRetryTerminal {
		t.Fatalf("expected terminal media failure, got %q, %v", classification, ok)
	}
}
