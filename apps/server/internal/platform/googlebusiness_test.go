package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func stubGoogleBusinessClient(t *testing.T, handler func(req *http.Request) (*http.Response, error)) {
	t.Helper()
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(handler)}
}

func googleBusinessAccountsPayload() string {
	return `{"accounts": [
		{"name": "accounts/111", "accountName": "First brand", "type": "PERSONAL"},
		{"name": "accounts/222", "accountName": "Second brand", "type": "BUSINESS"}
	]}`
}

func googleBusinessLocationsPayload() string {
	return `{"locations": [
		{"name": "accounts/111/locations/aaa", "title": "Downtown Store",
		 "storefrontAddress": {"locality": "Austin", "region": "TX"},
		 "locationState": {"canOperateLocalPost": true, "isVerified": true, "isPublished": true}},
		{"name": "accounts/111/locations/bbb", "title": "Closed Outlet",
		 "locationState": {"canOperateLocalPost": false, "isVerified": true}},
		{"name": "accounts/111/locations/ccc", "title": "Unverified Kiosk",
		 "locationState": {"isVerified": false}}
	]}`
}

func stubGoogleBusinessDirectory(t *testing.T, secondAccountLocations string) {
	t.Helper()
	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/v1/accounts"):
			return jsonResponse(req, googleBusinessAccountsPayload()), nil
		case strings.Contains(req.URL.Path, "/accounts/111/locations"):
			return jsonResponse(req, googleBusinessLocationsPayload()), nil
		case strings.Contains(req.URL.Path, "/accounts/222/locations"):
			return jsonResponse(req, secondAccountLocations), nil
		default:
			t.Fatalf("unexpected Google Business request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})
}

func TestGoogleBusinessOAuthExchangeAndRefresh(t *testing.T) {
	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		require.Equal(t, googleTokenURL, req.URL.String())
		body, err := io.ReadAll(req.Body)
		require.NoError(t, err)
		values, err := url.ParseQuery(string(body))
		require.NoError(t, err)
		if values.Get(grantType) == oauthGrantRefresh {
			require.Equal(t, "refresh-1", values.Get(string(RefreshCredentialRefreshToken)))
			return jsonResponse(req, `{"access_token":"access-2","refresh_token":"refresh-2","expires_in":3600,"token_type":"Bearer"}`), nil
		}
		require.Equal(t, "auth-code", values.Get(oauthParamCode))
		return jsonResponse(req, `{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,"token_type":"Bearer"}`), nil
	})

	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/api/v1/accounts/googlebusiness/callback")
	authURL, _ := adapter.GenerateAuthURL("oauth-state")
	parsed, err := url.Parse(authURL)
	require.NoError(t, err)
	require.Equal(t, "oauth-state", parsed.Query().Get("state"))
	for _, scope := range googleBusinessOAuthScopes {
		require.Contains(t, parsed.Query().Get("scope"), scope)
	}

	exchanged, err := adapter.ExchangeCode(context.Background(), "auth-code", nil)
	require.NoError(t, err)
	require.Equal(t, "access-1", exchanged.AccessToken)
	require.Equal(t, "refresh-1", exchanged.RefreshToken)

	capability := adapter.RefreshCapability()
	require.True(t, capability.Supported)
	require.Equal(t, RefreshCredentialRefreshToken, capability.CredentialSource)

	refreshed, err := adapter.RefreshToken(context.Background(), RefreshTokenInput{RefreshToken: exchanged.RefreshToken})
	require.NoError(t, err)
	require.Equal(t, "access-2", refreshed.AccessToken)
	require.Equal(t, "refresh-2", refreshed.RefreshToken, "rotated refresh tokens must be persisted by the grant manager")
}

func TestGoogleBusinessLocationFilteringAcrossAccounts(t *testing.T) {
	secondAccount := `{"locations": [
		{"name": "accounts/222/locations/zzz", "title": "Second Brand HQ",
		 "locationState": {"canOperateLocalPost": true, "isVerified": true}},
		{"name": "not-a-location", "title": "Malformed",
		 "locationState": {"canOperateLocalPost": true}}
	]}`
	stubGoogleBusinessDirectory(t, secondAccount)

	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")
	options, err := adapter.ListAccountSelections(context.Background(), &TokenResult{AccessToken: "access"})
	require.NoError(t, err)
	ids := make([]string, 0, len(options))
	for _, option := range options {
		ids = append(ids, option.ID)
		require.Equal(t, "location", option.Kind)
	}
	require.ElementsMatch(t, []string{
		"accounts/111/locations/aaa",
		"accounts/222/locations/zzz",
	}, ids, "only operable locations across every account are selectable; rejected and unverified-signal locations are filtered")
}

func TestGoogleBusinessSelectAccountRequiresOperability(t *testing.T) {
	stubGoogleBusinessDirectory(t, `{"locations": []}`)

	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")
	token := &TokenResult{AccessToken: "access", Extra: map[string]string{"scope": "business.manage"}}

	selected, err := adapter.SelectAccount(context.Background(), token, "accounts/111/locations/aaa")
	require.NoError(t, err)
	require.Equal(t, "accounts/111/locations/aaa", selected.AccountID)
	require.Equal(t, "Downtown Store", selected.AccountUsername)
	require.Equal(t, "accounts/111/locations/aaa", selected.Token.Extra["location_id"])
	require.Equal(t, "business.manage", selected.Token.Extra["scope"])

	_, err = adapter.SelectAccount(context.Background(), token, "accounts/111/locations/bbb")
	require.ErrorContains(t, err, "not operable")

	_, err = adapter.SelectAccount(context.Background(), token, "not-a-location")
	require.ErrorContains(t, err, "not a valid location")
}

func TestGoogleBusinessPayloadTopics(t *testing.T) {
	standard, err := buildGoogleBusinessLocalPost(&PublishRequest{
		Content:  "Fresh beans every morning.",
		Profile:  "short_text",
		Settings: map[string]interface{}{"language_code": "en-US"},
	})
	require.NoError(t, err)
	require.Equal(t, "STANDARD", standard.TopicType)
	require.Equal(t, "en-US", standard.LanguageCode)
	require.Nil(t, standard.Event)
	require.Nil(t, standard.Offer)

	event, err := buildGoogleBusinessLocalPost(&PublishRequest{
		Content: "Join us Saturday.",
		Profile: "short_text",
		Settings: map[string]interface{}{
			"topic_type": "event", "event_title": "Cupping Morning",
			"event_start_date": "2026-10-03", "event_start_time": "09:00",
			"event_end_date": "2026-10-03", "event_end_time": "12:00",
			"call_to_action": "LEARN_MORE", "action_url": "https://example.com/cupping",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "EVENT", event.TopicType)
	require.Equal(t, "Cupping Morning", event.Event.Title)
	require.Equal(t, 2026, event.Event.Schedule.StartDate.Year)
	require.Equal(t, 9, event.Event.Schedule.StartTime.Hours)
	require.Equal(t, "LEARN_MORE", event.CallToAction.ActionType)

	offer, err := buildGoogleBusinessLocalPost(&PublishRequest{
		Content: "Ten percent off bags this week.",
		Profile: "short_text",
		Settings: map[string]interface{}{
			"topic_type": "offer", "event_title": "Fall Sale",
			"event_start_date": "2026-10-01", "event_end_date": "2026-10-07",
			"offer_coupon_code": "FALL10", "offer_terms": "In store only.",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "OFFER", offer.TopicType)
	require.Equal(t, "FALL10", offer.Offer.CouponCode)
	require.Nil(t, offer.CallToAction)
}

func TestGoogleBusinessPayloadRejects(t *testing.T) {
	cases := []struct {
		name     string
		request  *PublishRequest
		contains string
	}{
		{
			name:     "unknown topic",
			request:  &PublishRequest{Content: "Hi.", Profile: "short_text", Settings: map[string]interface{}{"topic_type": "alert"}},
			contains: "not supported",
		},
		{
			name:     "offer with button",
			request:  &PublishRequest{Content: "Sale.", Profile: "short_text", Settings: map[string]interface{}{"topic_type": "offer", "event_title": "Sale", "event_start_date": "2026-10-01", "offer_coupon_code": "X", "call_to_action": "BOOK", "action_url": "https://example.com"}},
			contains: "ignores call-to-action",
		},
		{
			name:     "event without title",
			request:  &PublishRequest{Content: "Party.", Profile: "short_text", Settings: map[string]interface{}{"topic_type": "event", "event_start_date": "2026-10-01"}},
			contains: "event_title",
		},
		{
			name:     "long event title",
			request:  &PublishRequest{Content: "Party.", Profile: "short_text", Settings: map[string]interface{}{"topic_type": "event", "event_title": strings.Repeat("x", 59), "event_start_date": "2026-10-01"}},
			contains: "58",
		},
		{
			name:     "offer without coupon or url",
			request:  &PublishRequest{Content: "Sale.", Profile: "short_text", Settings: map[string]interface{}{"topic_type": "offer", "event_title": "Sale", "event_start_date": "2026-10-01"}},
			contains: "offer_coupon_code",
		},
		{
			name:     "cta without url",
			request:  &PublishRequest{Content: "Order.", Profile: "short_text", Settings: map[string]interface{}{"call_to_action": "ORDER"}},
			contains: "action_url",
		},
		{
			name:     "two photos",
			request:  &PublishRequest{Content: "Look.", Profile: "image_post", PlatformMediaIDs: []string{"https://cdn.example/a.jpg", "https://cdn.example/b.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}, {MimeType: "image/jpeg"}}},
			contains: "at most one photo",
		},
		{
			name:     "video attachment",
			request:  &PublishRequest{Content: "Watch.", Profile: "image_post", PlatformMediaIDs: []string{"https://cdn.example/a.mp4"}, Media: []MediaItem{{MimeType: "video/mp4"}}},
			contains: "JPEG or PNG",
		},
		{
			name:     "private media url",
			request:  &PublishRequest{Content: "Look.", Profile: "image_post", PlatformMediaIDs: []string{"http://intranet/a.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}}},
			contains: "public HTTPS",
		},
		{
			name:     "unsupported profile",
			request:  &PublishRequest{Content: "Hi.", Profile: "short_video"},
			contains: "does not support profile",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := buildGoogleBusinessLocalPost(tc.request)
			require.ErrorContains(t, err, tc.contains)
		})
	}
}

func TestGoogleBusinessSubmissionStateMachine(t *testing.T) {
	accepted, safety := googleBusinessSubmissionClass("LIVE")
	require.Equal(t, PublishSubmissionAccepted, accepted)
	require.Equal(t, PublishRetryNever, safety)

	for _, state := range []string{"PROCESSING", "SCHEDULED", "", "NEEDS_REVIEW", "UNKNOWN_FUTURE"} {
		submission, retry := googleBusinessSubmissionClass(state)
		require.Equal(t, PublishSubmissionPending, submission, "state %q must stay pending", state)
		require.Equal(t, PublishRetryReconcileOnly, retry, "state %q must never replay the write", state)
	}

	rejected, safety := googleBusinessSubmissionClass("REJECTED")
	require.Equal(t, PublishSubmissionRejected, rejected)
	require.Equal(t, PublishRetryNever, safety)
}

func TestGoogleBusinessSearchURLHandling(t *testing.T) {
	require.Equal(t, "https://www.google.com/maps/post/abc", googleBusinessSearchURL("https://www.google.com/maps/post/abc"))
	require.Equal(t, "", googleBusinessSearchURL(""), "missing searchUrl leaves ExternalURL empty")
	require.Equal(t, "", googleBusinessSearchURL("http://www.google.com/maps/post/abc"), "non-HTTPS values are never trusted")
	require.Equal(t, "", googleBusinessSearchURL("not a url"), "unusable values never become fabricated links")
}

func TestGoogleBusinessCreateIsPendingUntilReconciled(t *testing.T) {
	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/localPosts"):
			require.Equal(t, http.MethodPost, req.Method)
			return jsonResponse(req, `{"name": "accounts/111/locations/aaa/localPosts/post-1", "state": "LIVE", "searchUrl": "https://www.google.com/maps/post/1"}`), nil
		case strings.HasSuffix(req.URL.Path, "/v1/accounts"):
			return jsonResponse(req, googleBusinessAccountsPayload()), nil
		case strings.Contains(req.URL.Path, "/locations"):
			return jsonResponse(req, googleBusinessLocationsPayload()), nil
		default:
			t.Fatalf("unexpected Google Business request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})

	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")
	var checkpoints []PublishResult
	req := &PublishRequest{Content: "Fresh beans.", Profile: "short_text", Settings: map[string]interface{}{}}
	req.SetWriteFence(func(PublishResult) error { return nil }, func(result PublishResult) error {
		checkpoints = append(checkpoints, result)
		return nil
	})

	result, err := adapter.Publish(context.Background(), "access", "accounts/111/locations/aaa", req)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionPending, result.SubmissionState, "create acceptance is not publication, even when Google echoes LIVE")
	require.Equal(t, PublishRetryReconcileOnly, result.RetrySafety)
	require.Equal(t, "gbplocalpost1:accounts/111/locations/aaa/localPosts/post-1", result.ProviderReference)
	require.Equal(t, googleBusinessReconcileDelay, result.ReconcileAfter)
	require.NotEmpty(t, checkpoints)
}

func TestGoogleBusinessReconcileTransitions(t *testing.T) {
	reference := "gbplocalpost1:accounts/111/locations/aaa/localPosts/post-1"
	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")

	liveBody := `{"name": "accounts/111/locations/aaa/localPosts/post-1", "state": "LIVE", "searchUrl": "https://www.google.com/maps/post/1"}`
	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, liveBody), nil
	})
	accepted, err := adapter.ReconcilePublish(context.Background(), "access", "", reference)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionAccepted, accepted.SubmissionState)
	require.Equal(t, "accounts/111/locations/aaa/localPosts/post-1", accepted.ExternalID)
	require.Equal(t, "https://www.google.com/maps/post/1", accepted.ExternalURL, "ExternalURL uses the provider-returned searchUrl")

	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"name": "accounts/111/locations/aaa/localPosts/post-1", "state": "PROCESSING"}`), nil
	})
	pending, err := adapter.ReconcilePublish(context.Background(), "access", "", reference)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionPending, pending.SubmissionState)
	require.Equal(t, PublishRetryReconcileOnly, pending.RetrySafety)

	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"name": "accounts/111/locations/aaa/localPosts/post-1", "state": "REJECTED"}`), nil
	})
	rejected, err := adapter.ReconcilePublish(context.Background(), "access", "", reference)
	require.Error(t, err)
	require.Equal(t, PublishSubmissionRejected, rejected.SubmissionState)
	require.Equal(t, PublishRetryNever, rejected.RetrySafety, "rejected reviews never become publications")

	stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
		return jsonResponseWithStatus(req, http.StatusNotFound, `{"error": {"code": 404}}`), nil
	})
	missing, err := adapter.ReconcilePublish(context.Background(), "access", "", reference)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionPending, missing.SubmissionState, "eventual consistency keeps missing posts pending")

	_, err = adapter.ReconcilePublish(context.Background(), "access", "", "unversioned-reference")
	require.ErrorContains(t, err, "versioned reference")
}

func TestGoogleBusinessAnalyticsBoundary(t *testing.T) {
	support := GoogleBusinessAnalyticsSupport()
	require.False(t, support.Account)
	require.False(t, support.Content, "Google offers no per-post insights for local posts")
	require.NotEmpty(t, support.ContentUnavailable)
}

func TestGoogleBusinessDisabledDestinationSettles(t *testing.T) {
	settled := settleGoogleBusinessDisabledDestination("gbplocalpost1:accounts/111/locations/aaa/localPosts/post-1")
	require.Equal(t, PublishSubmissionRejected, settled.SubmissionState)
	require.Equal(t, PublishRetryNever, settled.RetrySafety)
	require.Equal(t, "destination_disabled", settled.ProviderState)
}

func TestGoogleBusinessReferenceValidation(t *testing.T) {
	reference, err := googleBusinessPostReference("accounts/111/locations/aaa/localPosts/post-1")
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(reference, googleBusinessPostReferencePrefix))

	_, err = googleBusinessPostReference("post-1")
	require.Error(t, err)

	name, err := googleBusinessPostNameFromReference(reference)
	require.NoError(t, err)
	require.Equal(t, "accounts/111/locations/aaa/localPosts/post-1", name)
}

func TestGoogleBusinessLocationValidation(t *testing.T) {
	stubGoogleBusinessDirectory(t, `{"locations": []}`)
	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")

	require.NoError(t, adapter.ValidatePublishingTarget(context.Background(), "access", "accounts/111/locations/aaa", map[string]interface{}{}))
	require.ErrorContains(t, adapter.ValidatePublishingTarget(context.Background(), "access", "accounts/111/locations/bbb", map[string]interface{}{}), "no longer operable")
	require.ErrorContains(t, adapter.ValidatePublishingTarget(context.Background(), "access", "", map[string]interface{}{}), "requires a selected location")
}

func TestGoogleBusinessRegistered(t *testing.T) {
	contract, ok := ApplicationContract(providerGoogleBusiness, ConnectionModeOAuth)
	require.True(t, ok)
	require.True(t, contract.AdapterBacked)

	adapters, _, err := BuildAdapterRegistry([]AppConfig{{Provider: "googlebusiness", ClientID: "id", ClientSecret: "secret", RedirectURI: "https://app.test/callback"}}, RegistryOptions{})
	require.NoError(t, err)
	require.Contains(t, adapters, providerGoogleBusiness)

	settings := PublishingSettingsContract(providerGoogleBusiness)
	require.Contains(t, settings.AdapterKeys, "topic_type")

	RegisterAllMediaValidators()
	require.Nil(t, ValidateMedia(providerGoogleBusiness, []MediaItem{{MimeType: "image/jpeg"}}))
	issues := ValidateMedia(providerGoogleBusiness, []MediaItem{{MimeType: "video/mp4"}})
	require.NotEmpty(t, issues)
}

func TestGoogleBusinessFixturesDecode(t *testing.T) {
	var post googleBusinessLocalPost
	require.NoError(t, json.Unmarshal([]byte(`{"name": "accounts/111/locations/aaa/localPosts/post-1", "state": "LIVE", "searchUrl": "https://www.google.com/maps/post/1"}`), &post))
	require.Equal(t, "LIVE", post.State)
	require.Equal(t, "https://www.google.com/maps/post/1", googleBusinessSearchURL(post.SearchURL))
	require.Equal(t, time.Minute, googleBusinessReconcileDelay)
}
