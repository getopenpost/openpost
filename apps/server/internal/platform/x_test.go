package platform

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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

func TestXResumableProcessingStopsAtPersistedExpiry(t *testing.T) {
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Query().Get("command") != "STATUS" {
			t.Error("processing resume must only read the existing upload")
		}
		polls++
		w.Header().Set("Content-Type", "application/json")
		if polls == 1 {
			_, _ = io.WriteString(w, `{"processing_info":{"state":"pending","check_after_secs":1}}`)
			return
		}
		_, _ = io.WriteString(w, `{"processing_info":{"state":"succeeded"}}`)
	}))
	defer server.Close()
	adapter := NewXAdapter("", "", "")
	defer close(adapter.cleanupDone)
	adapter.uploadBaseURL = server.URL
	state := ResumableMediaUploadState{ProviderMediaID: "media-1", Status: MediaUploadUploaded, OpaqueState: "processing", TotalBytes: 3, UploadedBytes: 3, SessionExpiresAt: time.Now().UTC().Add(200 * time.Millisecond)}
	req := UploadMediaRequest{MimeType: "video/mp4", Size: 3, OpenReaderAt: func(int64) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("abc")), nil }}
	_, err := adapter.UploadMediaResumable(t.Context(), "access|secret", "account", req, state, func(ResumableMediaUploadState) error { return nil })
	classification, ok := MediaRetryClassificationForError(err)
	if !ok || classification != MediaRetryTerminal || polls > 1 {
		t.Fatalf("expired media must stop before another status poll: %v polls=%d", err, polls)
	}
}

func TestXPublicationMapsDeveloperCredits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(402)
		_, _ = w.Write([]byte(`{"title":"CreditsDepleted","detail":"private account"}`))
	}))
	defer server.Close()
	adapter := NewXAdapter("", "", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL
	_, err := adapter.Publish(t.Context(), "access|secret", "account", &PublishRequest{Content: "Hello"})
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.Code != "x:credits_depleted" {
		t.Fatalf("X billing should identify developer credits: %v", err)
	}
}

func TestXResumableUploadReadsLazyStoredMedia(t *testing.T) {
	for _, mimeType := range []string{"image/png", "video/mp4"} {
		t.Run(mimeType, func(t *testing.T) {
			var uploaded []byte
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
					file, _, err := r.FormFile("media")
					if err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					defer file.Close()
					data, err := io.ReadAll(file)
					if err != nil {
						t.Error(err)
					}
					uploaded = append(uploaded, data...)
					if r.FormValue("command") == "APPEND" {
						w.WriteHeader(http.StatusNoContent)
						return
					}
				}
				_, _ = io.WriteString(w, `{"media_id_string":"media-1","expires_after_secs":3600}`)
			}))
			defer server.Close()
			adapter := NewXAdapter("", "", "")
			defer close(adapter.cleanupDone)
			adapter.uploadBaseURL = server.URL
			media := "stored-media"
			var saved ResumableMediaUploadState
			id, err := adapter.UploadMediaResumable(t.Context(), "access|secret", "account", UploadMediaRequest{
				MimeType: mimeType,
				Size:     int64(len(media)),
				OpenReaderAt: func(offset int64) (io.ReadCloser, error) {
					return io.NopCloser(strings.NewReader(media[offset:])), nil
				},
			}, ResumableMediaUploadState{}, func(next ResumableMediaUploadState) error { saved = next; return nil })
			if err != nil {
				t.Fatalf("stored media upload failed: %v", err)
			}
			if id != "media-1" || saved.ProviderMediaID != id || string(uploaded) != media {
				t.Fatalf("upload lost media or receipt: id=%s state=%+v uploaded=%q", id, saved, uploaded)
			}
		})
	}
}

func xTaggedUsersRequest(mediaSettings string, media []MediaItem) *PublishRequest {
	req := &PublishRequest{
		Content:          "Tagged",
		PlatformMediaIDs: []string{"media-1"},
		MediaSettings: []map[string]interface{}{
			{"tagged_users": mediaSettings},
		},
	}
	if media == nil {
		req.Media = []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}}
	} else {
		req.Media = media
	}
	return req
}

func TestXTweetTaggedUsersRequirePhotoAttachment(t *testing.T) {
	_, err := buildXTweetPayload(xTaggedUsersRequest("123456789", []MediaItem{{ID: "media-1", MimeType: "video/mp4"}}))
	if err == nil || !strings.Contains(err.Error(), "x tagged users require a photo attachment") {
		t.Fatalf("expected tagged users without photo rejection, got %v", err)
	}

	if _, err := buildXTweetPayload(xTaggedUsersRequest("123456789", []MediaItem{{ID: "media-1", MimeType: "image/gif"}})); err == nil {
		t.Fatal("expected tagged users on GIF-only media to be rejected")
	}
}

func TestXResolveTaggedUsernamesUsesBatchLookupAndNamesMissingHandle(t *testing.T) {
	var lookupPaths []string
	var lookupQueries []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lookupPaths = append(lookupPaths, r.URL.Path)
		lookupQueries = append(lookupQueries, r.URL.Query().Get("usernames"))
		switch r.URL.Query().Get("usernames") {
		case "openposthq,otheruser":
			_, _ = io.WriteString(w, `{"data":[{"id":"2244996801","username":"OpenPostHQ"},{"id":"1001","username":"OtherUser"}]}`)
		default:
			_, _ = io.WriteString(w, `{"data":[]}`)
		}
	}))
	defer server.Close()
	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	resolved, err := adapter.ResolveTaggedUsernames(t.Context(), "access-token|access-secret", []string{"@openposthq", "OtherUser"})
	if err != nil {
		t.Fatalf("handle resolution failed: %v", err)
	}
	if len(lookupPaths) != 1 || lookupPaths[0] != "/2/users/by" {
		t.Fatalf("expected one batch lookup at /2/users/by, got %v", lookupPaths)
	}
	if len(lookupQueries) != 1 || lookupQueries[0] != "openposthq,otheruser" {
		t.Fatalf("expected normalized batch usernames, got %v", lookupQueries)
	}
	if id := resolved["openposthq"]; id != "2244996801" {
		t.Fatalf("expected openposthq resolved to user id, got %#v", resolved)
	}

	_, err = adapter.ResolveTaggedUsernames(t.Context(), "access-token|access-secret", []string{"missinguser"})
	if err == nil || !strings.Contains(err.Error(), "@missinguser could not be found") {
		t.Fatalf("expected missing handle named in error, got %v", err)
	}
}
