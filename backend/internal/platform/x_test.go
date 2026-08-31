package platform

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

type consumeOnceXRequestStore struct {
	meta     XRequestMeta
	consume  int
	consumed bool
}

func (s *consumeOnceXRequestStore) Save(_, _, _, _, _ string, _ time.Time) error {
	return nil
}

func (s *consumeOnceXRequestStore) Consume(_ string, _ time.Duration) (XRequestMeta, bool, error) {
	s.consume++
	if s.consumed {
		return XRequestMeta{}, false, nil
	}
	s.consumed = true
	return s.meta, true, nil
}

func TestXWorkspaceLookupRetainsRequestMetaForTokenExchange(t *testing.T) {
	adapter := NewXAdapter("client-id", "client-secret", "https://app.example/api/v1/accounts/x/callback")
	close(adapter.cleanupDone)

	store := &consumeOnceXRequestStore{meta: XRequestMeta{
		Secret:          "request-secret",
		WorkspaceID:     "workspace-1",
		UserID:          "user-1",
		ExecutionIntent: "certification_test",
		CreatedAt:       time.Now().UTC(),
	}}
	adapter.SetRequestStore(store)

	workspaceID, ok := adapter.GetWorkspaceIDForRequestToken("request-token")
	if !ok {
		t.Fatal("expected workspace lookup to succeed")
	}
	if workspaceID != "workspace-1" {
		t.Fatalf("expected workspace-1, got %q", workspaceID)
	}

	metaRaw, ok := adapter.requestMeta.Load("request-token")
	if !ok {
		t.Fatal("expected consumed request token metadata to be retained for exchange")
	}
	meta := metaRaw.(XRequestMeta)
	if meta.Secret != "request-secret" || meta.UserID != "user-1" || meta.ExecutionIntent != "certification_test" {
		t.Fatalf("unexpected retained metadata: %#v", meta)
	}
}

func TestBuildXTweetPayloadIncludesQuoteDisclosureAndReplySettings(t *testing.T) {
	payload, err := buildXTweetPayload(&PublishRequest{
		Content: "Launch post",
		Settings: map[string]interface{}{
			"quote_tweet_id":   "1346889436626259968",
			"reply_settings":   "verified",
			"paid_partnership": true,
			"made_with_ai":     true,
		},
	})
	if err != nil {
		t.Fatalf("buildXTweetPayload returned error: %v", err)
	}

	if payload[jsonFieldText] != "Launch post" {
		t.Fatalf("unexpected text payload: %#v", payload)
	}
	if payload["quote_tweet_id"] != "1346889436626259968" {
		t.Fatalf("expected quote_tweet_id, got %#v", payload)
	}
	if payload["reply_settings"] != "verified" {
		t.Fatalf("expected reply settings, got %#v", payload)
	}
	if payload["paid_partnership"] != true || payload["made_with_ai"] != true {
		t.Fatalf("expected disclosure flags, got %#v", payload)
	}
}

func TestBuildXTweetPayloadIncludesPoll(t *testing.T) {
	payload, err := buildXTweetPayload(&PublishRequest{
		Content: "Pick one",
		Settings: map[string]interface{}{
			"poll_options":          "One\nTwo\nThree",
			"poll_duration_minutes": float64(120),
		},
	})
	if err != nil {
		t.Fatalf("buildXTweetPayload returned error: %v", err)
	}

	poll, ok := payload["poll"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected poll payload, got %#v", payload)
	}
	if !reflect.DeepEqual(poll["options"], []string{"One", "Two", "Three"}) {
		t.Fatalf("unexpected poll options: %#v", poll["options"])
	}
	if poll["duration_minutes"] != 120 {
		t.Fatalf("unexpected poll duration: %#v", poll["duration_minutes"])
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

func TestXPublishingCapabilitiesUseSubscriptionType(t *testing.T) {
	tests := []struct {
		subscriptionType string
		textLimit        int
		videoSeconds     int
		videoSizeBytes   int64
		premium          bool
	}{
		{subscriptionType: XSubscriptionTypeNone, textLimit: XStandardTextLimit, videoSeconds: XStandardVideoDurationSeconds, videoSizeBytes: XStandardVideoSizeBytes},
		{subscriptionType: XSubscriptionTypeUnknown, textLimit: XStandardTextLimit, videoSeconds: XStandardVideoDurationSeconds, videoSizeBytes: XStandardVideoSizeBytes},
		{subscriptionType: XSubscriptionTypeBasic, textLimit: XPremiumTextLimit, videoSeconds: XPremiumVideoDurationSeconds, videoSizeBytes: XPremiumVideoSizeBytes, premium: true},
		{subscriptionType: XSubscriptionTypePremium, textLimit: XPremiumTextLimit, videoSeconds: XPremiumVideoDurationSeconds, videoSizeBytes: XPremiumVideoSizeBytes, premium: true},
		{subscriptionType: XSubscriptionTypePremiumPlus, textLimit: XPremiumTextLimit, videoSeconds: XPremiumVideoDurationSeconds, videoSizeBytes: XPremiumVideoSizeBytes, premium: true},
	}

	for _, test := range tests {
		t.Run(test.subscriptionType, func(t *testing.T) {
			result := XPublishingCapabilities(test.subscriptionType)
			if result.Constraints["text_limit"] != test.textLimit {
				t.Fatalf("unexpected text limit: %#v", result.Constraints)
			}
			if result.Constraints["max_video_duration_seconds"] != test.videoSeconds {
				t.Fatalf("unexpected video duration: %#v", result.Constraints)
			}
			if result.Constraints["max_video_size_bytes"] != test.videoSizeBytes {
				t.Fatalf("unexpected video size: %#v", result.Constraints)
			}
			if XSubscriptionHasPremiumLimits(test.subscriptionType) != test.premium {
				t.Fatalf("unexpected premium classification for %q", test.subscriptionType)
			}
		})
	}
}

func TestXStoredCapabilityPremiumLimitsRequireFreshNormalizedState(t *testing.T) {
	now := time.Now().UTC()
	state := `{"x_subscription_type":"PremiumPlus"}`

	if !XStoredCapabilityHasPremiumLimits(state, now, now) {
		t.Fatal("expected fresh PremiumPlus state to enable subscribed limits")
	}
	if XStoredCapabilityHasPremiumLimits(state, now.Add(-XCapabilityStateFreshness-time.Minute), now) {
		t.Fatal("expected stale state to fail closed")
	}
	if XStoredCapabilityHasPremiumLimits(`{"x_subscription_type":"unexpected"}`, now, now) {
		t.Fatal("expected unknown state to fail closed")
	}
	if XStoredCapabilityHasPremiumLimits(`not-json`, now, now) {
		t.Fatal("expected invalid state to fail closed")
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

func TestXGetProfileFallsBackWhenSubscriptionFieldIsUnavailable(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		fields := r.URL.Query().Get("user.fields")
		if strings.Contains(fields, "subscription_type") {
			http.Error(w, `{"detail":"field unavailable"}`, http.StatusBadRequest)
			return
		}
		if !strings.Contains(fields, "profile_image_url") {
			t.Fatalf("profile request omitted profile_image_url: %q", fields)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"id":"42","name":"Ada","username":"ada","profile_image_url":"https://pbs.twimg.com/profile_images/42/avatar_normal.jpg"}}`)
	}))
	defer server.Close()

	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	profile, err := adapter.GetProfile(t.Context(), "access-token|access-secret")
	if err != nil {
		t.Fatalf("GetProfile returned error: %v", err)
	}
	if requestCount != 2 {
		t.Fatalf("expected subscription request plus profile fallback, got %d request(s)", requestCount)
	}
	if profile.ID != "42" || profile.Username != "ada" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	if profile.AvatarURL != "https://pbs.twimg.com/profile_images/42/avatar_normal.jpg" {
		t.Fatalf("unexpected profile avatar: %#v", profile)
	}
	if profile.CapabilityState[XCapabilityStateSubscriptionType] != XSubscriptionTypeUnknown {
		t.Fatalf("expected unknown subscription state: %#v", profile.CapabilityState)
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
