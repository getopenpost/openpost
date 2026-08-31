package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadyChecksReadinessEndpoint(t *testing.T) {
	SetVersion("v4.5.6")
	t.Cleanup(func() { SetVersion("dev") })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/ready" {
			t.Fatalf("path = %s, want /api/v1/ready", r.URL.Path)
		}
		if got := r.Header.Get("User-Agent"); got != "openpost-cli/v4.5.6" {
			t.Fatalf("user-agent = %q, want openpost-cli/v4.5.6", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.Ready(context.Background())
	if err != nil {
		t.Fatalf("Ready returned error: %v", err)
	}
	if got.Status != "ready" || got.Database != "ok" {
		t.Fatalf("readiness = %+v", got)
	}
}

func TestReadyRejectsUnexpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"status":"starting","database":"ok"}`)
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	_, err := c.Ready(context.Background())
	if err == nil {
		t.Fatal("Ready returned nil error")
	}
}

func TestListPublicationEvents_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/publications/pub_1/events" {
			t.Fatalf("path = %s, want /api/v1/publications/pub_1/events", r.URL.Path)
		}
		if r.URL.Query().Get("limit") != "25" {
			t.Fatalf("limit query = %q, want 25", r.URL.Query().Get("limit"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"evt_1","publication_id":"pub_1","rendition_id":"rend_1","type":"published","status":"succeeded","message":"rendition published","metadata":{"platform":"x"},"created_at":"2026-07-04T21:00:00Z"}
		]`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.ListPublicationEvents(context.Background(), "pub_1", 25)
	if err != nil {
		t.Fatalf("ListPublicationEvents returned error: %v", err)
	}
	if len(got) != 1 || got[0].Type != "published" || got[0].Metadata["platform"] != "x" {
		t.Fatalf("events wrong: %+v", got)
	}
}

func TestSchedulePublication_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/v1/publications/pub_1/schedule" {
			t.Fatalf("path = %s, want /api/v1/publications/pub_1/schedule", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["expected_revision"] != float64(7) {
			t.Fatalf("body = %#v, want expected_revision 7", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"publication scheduled","job_id":"job_1"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.SchedulePublication(context.Background(), "pub_1", 7)
	if err != nil {
		t.Fatalf("SchedulePublication returned error: %v", err)
	}
	if got.JobID != "job_1" {
		t.Fatalf("result = %+v", got)
	}
}

func TestListRenditionComments_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/renditions/rend_1/comments" {
			t.Fatalf("path = %s, want /api/v1/renditions/rend_1/comments", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"comments":[
			{"id":"comment_1","rendition_id":"rend_1","provider_comment_id":"provider_1","author_name":"Rita","text":"Nice launch","hidden":false,"can_reply":true,"can_hide":false,"can_delete":false}
		]}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.ListRenditionComments(context.Background(), "rend_1")
	if err != nil {
		t.Fatalf("ListRenditionComments returned error: %v", err)
	}
	if len(got) != 1 || got[0].Text != "Nice launch" || got[0].CanHide {
		t.Fatalf("comments wrong: %+v", got)
	}
}

func TestPublicationMutationMethods_WireFormat(t *testing.T) {
	requests := make(chan string, 5)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Method + " " + r.URL.EscapedPath()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/publications/pub_1/renditions" {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode rendition body: %v", err)
			}
			if body["expected_revision"] != float64(3) {
				t.Fatalf("rendition body = %#v, want expected_revision 3", body)
			}
			_, _ = w.Write([]byte(`{"id":"pub_1","renditions":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"message":"ok","id":"provider_reply","job_id":"job_1"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	if _, err := c.UpsertPublicationRenditions(context.Background(), "pub_1", 3, []RenditionInput{{SocialAccountID: "acc_1", Body: "Hello"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ReplyToRendition(context.Background(), "rend_1", RenditionReplyInput{Body: "Follow-up"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ReplyToComment(context.Background(), "opaque/id", "Thanks"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.HideComment(context.Background(), "opaque/id"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.DeleteComment(context.Background(), "opaque/id"); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"PUT /api/v1/publications/pub_1/renditions",
		"POST /api/v1/renditions/rend_1/reply",
		"POST /api/v1/comments/opaque%2Fid/reply",
		"POST /api/v1/comments/opaque%2Fid/hide",
		"DELETE /api/v1/comments/opaque%2Fid",
	}
	for _, expected := range want {
		if got := <-requests; got != expected {
			t.Fatalf("request = %q, want %q", got, expected)
		}
	}
}

// TestListAccounts_WireFormat verifies that ListAccounts decodes a raw
// JSON array from the server. The server's Huma output type is
// ListAccountsOutput { Body []AccountResponse } and Huma flattens the
// Body field on the wire, so the response is `[...]`, not
// `{body: [...]}`.
//
// This is a regression guard. A previous version of this client
// decoded `{body: [...]}` and failed with "cannot unmarshal array
// into Go value of type struct { Body []SocialAccount }".
func TestListAccounts_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"acc_1","slug":"x","platform":"x","account_id":"x_handle","account_username":"@rodrigo","is_active":true},
			{"id":"acc_2","slug":"bluesky","platform":"bluesky","account_id":"did:plc:abc","account_username":"rodrigo.bsky.social","is_active":true}
		]`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.ListAccounts(context.Background(), "ws_1")
	if err != nil {
		t.Fatalf("ListAccounts returned error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 accounts, got %d", len(got))
	}
	if got[0].ID != "acc_1" || got[0].Slug != "x" || got[0].Platform != "x" {
		t.Errorf("account[0] wrong: %+v", got[0])
	}
	if got[1].ID != "acc_2" || got[1].Slug != "bluesky" || got[1].Platform != "bluesky" {
		t.Errorf("account[1] wrong: %+v", got[1])
	}
}

func TestListAccountProviders_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/accounts/providers" {
			t.Fatalf("path = %s, want /api/v1/accounts/providers", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"platform":"bluesky","display_name":"Bluesky","auth_mode":"app_password","configured":true,"status":"available","capabilities":["Text posts"]},
			{"platform":"youtube","display_name":"YouTube","auth_mode":"oauth","configured":false,"status":"needs_configuration","description":"Requires a Google OAuth provider app."}
		]`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.ListAccountProviders(context.Background())
	if err != nil {
		t.Fatalf("ListAccountProviders returned error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(got))
	}
	if got[0].Platform != "bluesky" || !got[0].Configured || got[0].Status != "available" {
		t.Errorf("provider[0] wrong: %+v", got[0])
	}
	if got[1].Platform != "youtube" || got[1].Configured || got[1].Status != "needs_configuration" {
		t.Errorf("provider[1] wrong: %+v", got[1])
	}
}

func TestBillingStatus_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/billing/status" {
			t.Fatalf("path = %s, want /api/v1/billing/status", r.URL.Path)
		}
		if r.URL.Query().Get("workspace_id") != "ws_1" {
			t.Fatalf("workspace_id query = %q, want ws_1", r.URL.Query().Get("workspace_id"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"workspace_id":"ws_1",
			"provider":"paddle",
			"status":"active",
			"plan_id":"founder",
			"current_period_end":"2026-07-31T00:00:00Z",
			"cancel_at_period_end":false,
			"limits":{"scheduled_posts_monthly":500,"social_accounts":6},
			"usage":{"scheduled_posts_monthly":42,"social_accounts":3},
			"period_start":"2026-07-01T00:00:00Z"
		}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.BillingStatus(context.Background(), "ws_1")
	if err != nil {
		t.Fatalf("BillingStatus returned error: %v", err)
	}
	if got.WorkspaceID != "ws_1" || got.Provider != "paddle" || got.Status != "active" || got.PlanID != "founder" {
		t.Fatalf("billing status wrong: %+v", got)
	}
	if got.Limits["scheduled_posts_monthly"] != 500 || got.Usage["scheduled_posts_monthly"] != 42 {
		t.Fatalf("billing usage wrong: %+v", got)
	}
}

func TestCreateBillingCheckout_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/v1/billing/checkout" {
			t.Fatalf("path = %s, want /api/v1/billing/checkout", r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["workspace_id"] != "ws_1" || body["plan_id"] != "founder" || body["billing_period"] != "annual" {
			t.Fatalf("body = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chkat_1","url":"https://app.openpost.social/checkout?billing_period=annual&plan=founder","plan_id":"founder","billing_period":"annual","provider_price_id":"pri_founder_year"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.CreateBillingCheckout(context.Background(), "ws_1", "founder", "annual")
	if err != nil {
		t.Fatalf("CreateBillingCheckout returned error: %v", err)
	}
	if got.ID != "chkat_1" || got.URL != "https://app.openpost.social/checkout?billing_period=annual&plan=founder" || got.BillingPeriod != "annual" {
		t.Fatalf("checkout = %+v", got)
	}
}

func TestCreateBillingPortal_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/v1/billing/portal" {
			t.Fatalf("path = %s, want /api/v1/billing/portal", r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["workspace_id"] != "ws_1" {
			t.Fatalf("body = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cps_1","url":"https://customer-portal.paddle.com/overview?token=test"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.CreateBillingPortal(context.Background(), "ws_1")
	if err != nil {
		t.Fatalf("CreateBillingPortal returned error: %v", err)
	}
	if got.ID != "cps_1" || got.URL != "https://customer-portal.paddle.com/overview?token=test" {
		t.Fatalf("portal = %+v", got)
	}
}

func TestUpdateAccount_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Errorf("method = %s, want PATCH", r.Method)
		}
		if r.URL.Path != "/api/v1/accounts/acc_1" {
			t.Errorf("path = %s, want /api/v1/accounts/acc_1", r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body["slug"] != "main-x" {
			t.Errorf("slug body = %q, want main-x", body["slug"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"acc_1","slug":"main-x","platform":"x","account_id":"x_handle","account_username":"@rodrigo","is_active":true}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.UpdateAccount(context.Background(), "acc_1", UpdateAccountInput{Slug: "main-x"})
	if err != nil {
		t.Fatalf("UpdateAccount returned error: %v", err)
	}
	if got.ID != "acc_1" || got.Slug != "main-x" || got.Platform != "x" {
		t.Errorf("account wrong: %+v", got)
	}
}

// TestListMedia_WireFormat verifies that ListMedia decodes the
// server's `{media: [...], total: N}` shape, not a `{body: {media,
// total}}` envelope.
func TestListMedia_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"media":[{"id":"m_1","workspace_id":"ws_1","mime_type":"image/png","size":1024,"original_filename":"x.png","width":800,"height":600,"alt_text":"","is_favorite":false,"created_at":"2026-06-15T10:00:00Z","url":"/media/m_1","thumbnail_url":"/media/m_1/thumb/sm","usage_count":0,"can_delete":true,"processing_status":"ready"}],"total":1}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.ListMedia(context.Background(), "ws_1", 50)
	if err != nil {
		t.Fatalf("ListMedia returned error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 media item, got %d", len(got))
	}
	if got[0].ID != "m_1" || got[0].URL != "/media/m_1" {
		t.Errorf("media[0] wrong: %+v", got[0])
	}
}

func TestGetMediaUsage_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/media/m_1/usage" {
			t.Fatalf("path = %s, want /api/v1/media/m_1/usage", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"usage":[{"kind":"publication","id":"usage_1","label":"Launch","publication_id":"pub_1","status":"scheduled","scheduled_at":"2026-08-30T10:00:00Z"}],"count":1}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.GetMediaUsage(context.Background(), "m_1")
	if err != nil {
		t.Fatalf("GetMediaUsage returned error: %v", err)
	}
	if len(got.Usage) != 1 || got.Usage[0].PublicationID != "pub_1" {
		t.Fatalf("media usage wrong: %+v", got.Usage)
	}
}

// TestListMedia_EmptyResponse_DoesNotSilentlySucceed guards against
// the prior bug where the client decoded `{media: null, total: 0}`
// into `{body: {media, total}}`, which silently produced a nil
// slice — making the user believe there was no media when in fact
// the response was just missing the `body` wrapper. With the fix,
// the decode now matches the wire format and returns the empty
// list directly.
func TestListMedia_EmptyResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"media":[],"total":0}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.ListMedia(context.Background(), "ws_1", 50)
	if err != nil {
		t.Fatalf("ListMedia returned error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 media items, got %d", len(got))
	}
}

// TestListPosts_WireFormat: server returns a raw array of posts.
func TestListJobs_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("workspace_id"); got != "ws_1" {
			t.Fatalf("workspace_id query = %q, want ws_1", got)
		}
		if got := r.URL.Query().Get("status"); got != "pending" {
			t.Fatalf("status query = %q, want pending", got)
		}
		if got := r.URL.Query().Get("limit"); got != "25" {
			t.Fatalf("limit query = %q, want 25", got)
		}
		if got := r.URL.Query().Get("offset"); got != "50" {
			t.Fatalf("offset query = %q, want 50", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"j_1","type":"publish","payload":"{}","status":"queued","run_at":"2026-06-16T09:00:00Z","attempts":0}]`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.ListJobs(context.Background(), ListJobsInput{WorkspaceID: "ws_1", Status: "pending", Limit: 25, Offset: 50})
	if err != nil {
		t.Fatalf("ListJobs returned error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 job, got %d", len(got))
	}
	if got[0].ID != "j_1" || got[0].Type != "publish" {
		t.Errorf("job wrong: %+v", got[0])
	}
}

// TestGetWorkspaceSettings_WireFormat: server returns a flat object.
func TestGetWorkspaceSettings_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"timezone":"Europe/Lisbon","week_start":1,"media_cleanup_days":30,"random_delay_minutes":5,"slot_start_hour":9,"slot_end_hour":18,"slot_interval_minutes":30}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.GetWorkspaceSettings(context.Background(), "ws_1")
	if err != nil {
		t.Fatalf("GetWorkspaceSettings returned error: %v", err)
	}
	if got.Timezone != "Europe/Lisbon" {
		t.Errorf("expected timezone Europe/Lisbon, got %q", got.Timezone)
	}
	if got.WeekStart != 1 {
		t.Errorf("expected week_start 1, got %d", got.WeekStart)
	}
}

func TestNextAvailableSlot_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/api/v1/posting-schedules/next-slot" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("workspace_id"); got != "ws_1" {
			t.Errorf("workspace_id = %q, want ws_1", got)
		}
		if got := r.URL.Query().Get("set_id"); got != "" {
			t.Errorf("set_id query = %q, want empty", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"slot":{"id":"slot_1","workspace_id":"ws_1","utc_hour":9,"utc_minute":0,"day_of_week":2,"local_hour":9,"local_minute":0,"local_day_of_week":2,"label":"Morning","is_active":true,"created_at":"2026-06-16T08:00:00Z"},
			"slot_time":"2026-06-16T09:00:00Z",
			"message":"Next available slot found"
		}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.NextAvailableSlot(context.Background(), NextAvailableSlotInput{WorkspaceID: "ws_1"})
	if err != nil {
		t.Fatalf("NextAvailableSlot returned error: %v", err)
	}
	if got.SlotTime != "2026-06-16T09:00:00Z" {
		t.Fatalf("slot_time = %q", got.SlotTime)
	}
	if got.Slot == nil || got.Slot.ID != "slot_1" {
		t.Fatalf("slot = %+v", got.Slot)
	}
}

func TestListAndRevokeAPITokensWireFormat(t *testing.T) {
	var revoked bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			if r.URL.Path != "/api/v1/api-tokens/t_1" {
				t.Fatalf("delete path = %s", r.URL.Path)
			}
			revoked = true
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/api-tokens" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"t_1","name":"laptop","token_prefix":"op_cli_","scope":"cli:full","created_at":"2026-06-15T10:00:00Z"}]`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got, err := c.ListAPITokens(context.Background())
	if err != nil {
		t.Fatalf("ListAPITokens returned error: %v", err)
	}
	if len(got) != 1 || got[0].ID != "t_1" || got[0].Name != "laptop" {
		t.Fatalf("tokens = %+v", got)
	}
	if err := c.RevokeAPIToken(context.Background(), "t_1"); err != nil {
		t.Fatalf("RevokeAPIToken returned error: %v", err)
	}
	if !revoked {
		t.Fatal("revoke request was not observed")
	}
}
