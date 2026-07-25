package commands

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/openpost/cli/internal/api"
)

func TestPublicationCommandExposesFormatFirstLifecycle(t *testing.T) {
	cmd := newPublicationCmd()
	want := map[string]bool{
		"create": true, "list": true, "view": true, "update": true, "renditions": true,
		"reply": true, "validate": true, "schedule": true, "publish-now": true,
		"retry": true, "delete-rendition": true, "delete": true,
		"events": true, "comments": true, "reply-comment": true, "hide-comment": true, "delete-comment": true,
	}
	for _, child := range cmd.Commands() {
		delete(want, child.Name())
	}
	if len(want) != 0 {
		t.Fatalf("missing publication commands: %v", want)
	}
}

func TestContentProfileFlagsDoNotShadowCLIProfile(t *testing.T) {
	root := NewRoot("test")
	for _, path := range [][]string{
		{"publication", "create"},
		{"publication", "update"},
		{"publication", "list"},
		{"provider", "capabilities"},
	} {
		cmd, _, err := root.Find(path)
		if err != nil {
			t.Fatalf("find %v: %v", path, err)
		}
		if cmd.Flag("profile") == nil {
			t.Fatalf("%v does not inherit the CLI --profile flag", path)
		}
		if cmd.Flag("content-profile") == nil {
			t.Fatalf("%v does not expose --content-profile", path)
		}
	}
}

func TestPublicationEventsCommandPrintsLifecycleEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/publications/pub_1/events" {
			t.Fatalf("path = %s, want /api/v1/publications/pub_1/events", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"evt_1","publication_id":"pub_1","rendition_id":"rend_1","type":"published","status":"succeeded","message":"rendition published","metadata":{"platform":"x"},"created_at":"2026-07-04T21:00:00Z"}
		]`))
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--token", "op_cli_test", "publication", "events", "pub_1")

	if err != nil {
		t.Fatalf("publication events returned error: %v", err)
	}
	for _, want := range []string{"published", "succeeded", "rendition published", "rend_1"} {
		if !strings.Contains(out, want) {
			t.Fatalf("output %q missing %q", out, want)
		}
	}
}

func TestPublicationCommentsCommandHidesUnsupportedActions(t *testing.T) {
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

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--token", "op_cli_test", "publication", "comments", "rend_1")

	if err != nil {
		t.Fatalf("publication comments returned error: %v", err)
	}
	if !strings.Contains(out, "Nice launch") || !strings.Contains(out, "reply") {
		t.Fatalf("output %q missing comment text or supported action", out)
	}
	if strings.Contains(out, "hide") || strings.Contains(out, "delete") {
		t.Fatalf("output %q should not include unsupported actions", out)
	}
}

func TestPublicationScheduleCommandUpdatesAndEnqueues(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	scheduleAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second).Format(time.RFC3339)
	var updateBody map[string]any
	var scheduled bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/workspaces/ws-1/settings":
			_, _ = w.Write([]byte(`{"timezone":"Europe/Lisbon","week_start":1,"media_cleanup_days":30,"random_delay_minutes":0,"draft_gap_minutes":0,"slot_start_hour":9,"slot_end_hour":17,"slot_interval_minutes":30}`))
		case "/api/v1/publications/pub_1":
			switch r.Method {
			case http.MethodGet:
				_, _ = w.Write([]byte(`{"id":"pub_1","workspace_id":"ws-1","created_by":"u-1","title":"Draft","content_profile":"short_video","source_text":"Demo","status":"draft","revision":4,"created_at":"2026-07-06T09:00:00Z","renditions":[]}`))
			case http.MethodPut:
				if err := json.NewDecoder(r.Body).Decode(&updateBody); err != nil {
					t.Fatalf("decode update body: %v", err)
				}
				_, _ = fmt.Fprintf(w, `{"id":"pub_1","workspace_id":"ws-1","created_by":"u-1","title":"Draft","content_profile":"short_video","source_text":"Demo","status":"draft","revision":5,"scheduled_at":%q,"created_at":"2026-07-06T09:00:00Z","renditions":[]}`, scheduleAt)
			default:
				t.Fatalf("publication method = %s, want GET or PUT", r.Method)
			}
		case "/api/v1/publications/pub_1/schedule":
			if r.Method != http.MethodPost {
				t.Fatalf("publication schedule method = %s, want POST", r.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode schedule body: %v", err)
			}
			if body["expected_revision"] != float64(5) {
				t.Fatalf("schedule body = %#v, want expected_revision 5", body)
			}
			scheduled = true
			_, _ = w.Write([]byte(`{"message":"publication scheduled","job_id":"job_1"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--workspace", "Production",
		"publication", "schedule", "pub_1",
		"--at", scheduleAt,
	)

	if err != nil {
		t.Fatalf("publication schedule returned error: %v", err)
	}
	if updateBody["scheduled_at"] != scheduleAt {
		t.Fatalf("scheduled_at body = %#v", updateBody)
	}
	if updateBody["expected_revision"] != float64(4) {
		t.Fatalf("expected_revision body = %#v", updateBody)
	}
	if !scheduled {
		t.Fatalf("schedule endpoint was not called")
	}
	if !strings.Contains(out, "publication scheduled") || !strings.Contains(out, "job_1") {
		t.Fatalf("output %q missing schedule result", out)
	}
}

func TestPublicationRenditionsMapYouTubeVideoFields(t *testing.T) {
	flags := publicationFlags{
		title:            "Internal draft",
		videoTitle:       "Launch walkthrough",
		videoDescription: "Full product demo.",
		privacy:          "unlisted",
	}
	renditions := buildPublicationRenditions(
		"long_video",
		"fallback body",
		flags,
		[]api.SocialAccount{{ID: "acc_youtube", Platform: "youtube"}},
		[]string{"acc_youtube"},
		[]api.PublicationMediaInput{{MediaID: "med_video", Role: "attachment"}},
	)

	if len(renditions) != 1 {
		t.Fatalf("renditions = %+v", renditions)
	}
	got := renditions[0]
	if got.Title != "Launch walkthrough" {
		t.Fatalf("title = %q", got.Title)
	}
	if got.Description != "Full product demo." || got.Body != "Full product demo." {
		t.Fatalf("description/body = %q/%q", got.Description, got.Body)
	}
	if got.Settings["privacy"] != "unlisted" || got.Settings["title"] != "Launch walkthrough" || got.Settings["description"] != "Full product demo." {
		t.Fatalf("settings = %+v", got.Settings)
	}
	if len(got.Media) != 1 || got.Media[0].MediaID != "med_video" {
		t.Fatalf("media = %+v", got.Media)
	}
}

func TestPublicationRenditionsMapMixedShortVideoTargets(t *testing.T) {
	flags := publicationFlags{
		videoTitle:       "YouTube Short title",
		videoDescription: "YouTube Short description.",
		caption:          "Social caption",
		tiktokMethod:     "DIRECT_POST",
		tiktokPrivacy:    "SELF_ONLY",
	}
	renditions := buildPublicationRenditions(
		"short_video",
		"",
		flags,
		[]api.SocialAccount{
			{ID: "acc_youtube", Platform: "youtube"},
			{ID: "acc_tiktok", Platform: "tiktok"},
		},
		[]string{"acc_youtube", "acc_tiktok"},
		nil,
	)

	if len(renditions) != 2 {
		t.Fatalf("renditions = %+v", renditions)
	}
	youtube := renditions[0]
	tiktok := renditions[1]
	if youtube.Title != "YouTube Short title" || youtube.Description != "YouTube Short description." || youtube.Body != "YouTube Short description." {
		t.Fatalf("youtube rendition = %+v", youtube)
	}
	if tiktok.Body != "Social caption" || tiktok.Title != "" || tiktok.Description != "" {
		t.Fatalf("tiktok rendition = %+v", tiktok)
	}
	if tiktok.Settings["content_posting_method"] != "DIRECT_POST" || tiktok.Settings["privacy_level"] != "SELF_ONLY" {
		t.Fatalf("tiktok settings = %+v", tiktok.Settings)
	}
}
