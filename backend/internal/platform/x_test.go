package platform

import (
	"reflect"
	"testing"
	"time"
)

type consumeOnceXRequestStore struct {
	meta     XRequestMeta
	consume  int
	consumed bool
}

func (s *consumeOnceXRequestStore) Save(_, _, _, _ string, _ time.Time) error {
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
		Secret:      "request-secret",
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		CreatedAt:   time.Now().UTC(),
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
	if meta.Secret != "request-secret" || meta.UserID != "user-1" {
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
