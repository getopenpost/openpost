package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"

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
		"accounts/111/locations/bbb",
		"accounts/222/locations/zzz",
	}, ids, "locations supporting local posts or verified reviews are selectable; malformed and unverified-only locations stay excluded")
}

func TestGoogleBusinessOptionsUnknownCursorDoesNotRestartPagination(t *testing.T) {
	options := []DestinationOption{{Value: "location-a", Label: "A"}, {Value: "location-b", Label: "B"}}
	first := paginateGoogleBusinessOptions(options, "", "", 1)
	require.Equal(t, "location-a", first.Options[0].Value)
	require.Equal(t, "location-a", first.NextCursor)

	missing := paginateGoogleBusinessOptions(options, "", "removed-location", 1)
	require.Empty(t, missing.Options)
	require.Empty(t, missing.NextCursor)
}

func TestGoogleBusinessSelectAccountSeparatesReviewAndPublishingEligibility(t *testing.T) {
	stubGoogleBusinessDirectory(t, `{"locations": []}`)

	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")
	token := &TokenResult{AccessToken: "access", Extra: map[string]string{"scope": "business.manage"}}

	selected, err := adapter.SelectAccount(context.Background(), token, "accounts/111/locations/aaa")
	require.NoError(t, err)
	require.Equal(t, "accounts/111/locations/aaa", selected.AccountID)
	require.Equal(t, "Downtown Store", selected.AccountUsername)
	require.Equal(t, "accounts/111/locations/aaa", selected.Token.Extra["location_id"])
	require.Equal(t, "business.manage", selected.Token.Extra["scope"])

	selected, err = adapter.SelectAccount(context.Background(), token, "accounts/111/locations/bbb")
	require.NoError(t, err)
	require.Equal(t, "accounts/111/locations/bbb", selected.AccountID)
	require.Equal(t, "true", selected.CapabilityState["googlebusiness_location_verified"])
	require.ErrorContains(t, adapter.ValidatePublishingTarget(context.Background(), "access", selected.AccountID, nil), "no longer operable")
	_, err = adapter.SelectAccount(context.Background(), token, "accounts/111/locations/ccc")
	require.ErrorContains(t, err, "not available")

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

func TestGoogleBusinessLocationValidation(t *testing.T) {
	stubGoogleBusinessDirectory(t, `{"locations": []}`)
	adapter := NewGoogleBusinessAdapter("gbp-client", "gbp-secret", "https://app.test/callback")

	require.NoError(t, adapter.ValidatePublishingTarget(context.Background(), "access", "accounts/111/locations/aaa", map[string]interface{}{}))
	require.ErrorContains(t, adapter.ValidatePublishingTarget(context.Background(), "access", "accounts/111/locations/bbb", map[string]interface{}{}), "no longer operable")
	require.ErrorContains(t, adapter.ValidatePublishingTarget(context.Background(), "access", "", map[string]interface{}{}), "requires a selected location")
}
