package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetPublicationDecodesCreationSource(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/publications/pub_1" {
			t.Fatalf("path = %s, want /api/v1/publications/pub_1", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"pub_1","creation_source":"sdk"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "op_cli_test")
	got, err := c.GetPublication(context.Background(), "pub_1")
	if err != nil {
		t.Fatalf("GetPublication returned error: %v", err)
	}
	if got.CreationSource != PublicationCreationSourceSDK {
		t.Fatalf("creation source = %q, want %q", got.CreationSource, PublicationCreationSourceSDK)
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
// total}}` envelope. A previous version of this client decoded the
// body envelope and silently produced a nil slice for real items,
// making the user believe there was no media.
func TestListMedia_WireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("workspace_id") != "ws_1" {
			t.Fatalf("workspace_id = %q, want ws_1", r.URL.Query().Get("workspace_id"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"media":[{"id":"media-1","workspace_id":"ws_1","mime_type":"image/png","size":42,"original_filename":"launch.png","width":32,"height":18}],"total":1}`))
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
	item := got[0]
	if item.ID != "media-1" || item.MimeType != "image/png" || item.OriginalFilename != "launch.png" || item.Width != 32 || item.Height != 18 || item.Size != 42 {
		t.Fatalf("media item wrong: %+v", item)
	}
}

// TestListPosts_WireFormat: server returns a raw array of posts.

// TestGetWorkspaceSettings_WireFormat: server returns a flat object.

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

func TestAPIClientDoesNotForwardCredentialsThroughRedirects(t *testing.T) {
	forwarded := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { forwarded = true; w.WriteHeader(200) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	err := New(source.URL, "secret").GetJSON(context.Background(), "/redirect", nil)
	if err == nil {
		t.Fatal("redirect must be rejected")
	}
	if forwarded {
		t.Fatal("redirect target was contacted with credentials")
	}
}
