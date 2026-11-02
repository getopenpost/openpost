package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

const (
	devNullCommentRoot = "00000000-0000-4000-8000-000000000001"
	devNullCommentOne  = "00000000-0000-4000-8000-000000000002"
	devNullCommentTwo  = "00000000-0000-4000-8000-000000000003"
	devNullCommentLeaf = "00000000-0000-4000-8000-000000000004"
)

func TestDevNullEngagementSupport(t *testing.T) {
	adapter, ok := any(NewDevNullAdapter("")).(EngagementAdapter)
	if !ok {
		t.Fatal("dev/null does not expose comments and replies to Engagement")
	}
	support := adapter.EngagementSupport()
	if !support.Enabled || !support.CanReply || support.CanHide || support.CanDelete || support.CanLike {
		t.Fatalf("unexpected dev/null engagement support: %+v", support)
	}
}

func TestDevNullListComments(t *testing.T) {
	requests := make([]string, 0)
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-SSH-Signature") != "" {
			t.Error("public comment reads must not send a credential")
		}
		requests = append(requests, r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/commits/" + devNullCommentRoot + "/replies":
			if r.URL.Query().Get("cursor") == "next/opaque+=" {
				fmt.Fprintf(w, `{"data":[{"id":%q,"parent_id":%q,"deleted_at":"2026-11-01T12:00:00Z","replies_count":1}],"next_cursor":null}`, devNullCommentTwo, devNullCommentRoot)
				return
			}
			fmt.Fprintf(w, `{"data":[{"id":%q,"parent_id":%q,"body":"Public reply","created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T11:00:00Z","replies_count":1,"author":{"id":"account-id","type":"user","handle":"TestUser","name":"Test User","avatar_url":"https://example.com/avatar.png"},"images":[{"url":"https://example.com/image.webp","description":"A diagram"}]}],"next_cursor":"next/opaque+=","next_page_url":"https://untrusted.example/never-follow"}`, devNullCommentOne, devNullCommentRoot)
		case "/commits/" + devNullCommentOne + "/replies":
			// A quote appears beneath its quoted commit even without parent_id.
			fmt.Fprintf(w, `{"data":[{"id":%q,"body":"Quote","replies_count":0,"author":{"id":"stranger","handle":"other","name":"Other"}}],"next_cursor":null}`, devNullCommentLeaf)
		case "/commits/" + devNullCommentTwo + "/replies":
			// The same quote can occur in multiple visible branches, once only.
			fmt.Fprintf(w, `{"data":[{"id":%q,"body":"Quote","replies_count":0}],"next_cursor":null}`, devNullCommentLeaf)
		default:
			http.NotFound(w, r)
		}
	}))
	adapter := NewDevNullAdapter(server.URL)
	comments, err := adapter.ListComments(context.Background(), devNullCredential("testuser", "key"), "account-id", server.URL+"/@testuser/commits/"+devNullCommentRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 3 || len(requests) != 4 {
		t.Fatalf("comments = %+v, requests = %v", comments, requests)
	}
	one := comments[0]
	if one.ID != devNullCommentOne || one.ParentID != devNullCommentRoot || one.ConversationID != devNullCommentRoot || one.Text != "Public reply" || one.AuthorHandle != "TestUser" || one.AuthorName != "Test User" || !one.IsOurs || !one.CanReply || one.CanHide || one.CanDelete || one.CanLike {
		t.Fatalf("unexpected reply: %+v", one)
	}
	if one.AuthorAvatarURL != "https://example.com/avatar.png" || one.CreatedAt != "2026-11-01T10:00:00Z" || one.UpdatedAt != "2026-11-01T11:00:00Z" || len(one.Attachments) != 1 || one.Attachments[0].AltText != "A diagram" || one.Attachments[0].URL != "https://example.com/image.webp" {
		t.Fatalf("reply metadata lost: %+v", one)
	}
	if !comments[1].Deleted || comments[1].CanReply || comments[1].Text != "" || comments[1].AuthorID != "" {
		t.Fatalf("unexpected tombstone: %+v", comments[1])
	}
	if comments[2].ParentID != devNullCommentOne || comments[2].IsOurs {
		t.Fatalf("quote nesting or ownership lost: %+v", comments[2])
	}
}

func TestDevNullCommentsOwnership(t *testing.T) {
	for _, tc := range []struct {
		name      string
		author    devNullCommentAuthor
		accountID string
		ours      bool
	}{
		{"account ID", devNullCommentAuthor{ID: "ours", Handle: "renamed"}, "ours", true},
		{"handle", devNullCommentAuthor{ID: "new-id", Handle: "TESTUSER"}, "old-id", true},
		{"other", devNullCommentAuthor{ID: "other", Handle: "someone"}, "ours", false},
		{"missing", devNullCommentAuthor{}, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			comment := (devNullCommentCommit{Author: tc.author}).comment("testuser", tc.accountID, devNullCommentRoot, devNullCommentRoot)
			if comment.IsOurs != tc.ours {
				t.Fatalf("ownership = %v, want %v", comment.IsOurs, tc.ours)
			}
		})
	}
}

func TestDevNullCommentsRejectIncompleteCollection(t *testing.T) {
	for _, mode := range []string{"later-page-error", "nested-page-error", "cursor-cycle", "request-limit", "malformed-page", "missing-data", "missing-cursor", "invalid-reply"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				if (mode == "later-page-error" || mode == "nested-page-error") && calls == 2 {
					http.Error(w, "failed later page", http.StatusBadGateway)
					return
				}
				switch mode {
				case "malformed-page":
					fmt.Fprint(w, `{`)
				case "missing-data":
					fmt.Fprint(w, `{}`)
				case "missing-cursor":
					fmt.Fprint(w, `{"data":[],"next_page_url":"https://example.com/more"}`)
				case "nested-page-error":
					fmt.Fprintf(w, `{"data":[{"id":%q,"parent_id":%q,"body":"Reply","replies_count":1}],"next_cursor":null}`, devNullCommentOne, devNullCommentRoot)
				case "invalid-reply":
					fmt.Fprint(w, `{"data":[{"id":"../../other"}]}`)
				case "request-limit":
					fmt.Fprintf(w, `{"data":[],"next_cursor":%q}`, fmt.Sprint(calls))
				default:
					fmt.Fprintf(w, `{"data":[{"id":%q,"parent_id":%q,"body":"Reply"}],"next_cursor":"same"}`, devNullCommentOne, devNullCommentRoot)
				}
			}))
			comments, err := NewDevNullAdapter(server.URL).ListComments(context.Background(), devNullCredential("testuser", "key"), "account", devNullCommentRoot)
			if err == nil || comments != nil {
				t.Fatalf("partial collection accepted: comments=%+v, error=%v", comments, err)
			}
			if calls > devNullCommentRequestLimit {
				t.Fatalf("unbounded requests: %d", calls)
			}
		})
	}
}

func TestDevNullReplyToComment(t *testing.T) {
	_, key := devNullTestSigner(t)
	calls := 0
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/commits" {
			t.Errorf("unexpected reply request: %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		parts := strings.SplitN(string(body), "\n", 4)
		if len(parts) != 4 || parts[2] != devNullCommentOne || parts[3] != "Thanks for the feedback!" {
			t.Errorf("reply lost parent or message: %q", body)
		}
		namespace, _, _, _, _ := devNullSignatureParts(t, r.Header.Get("X-SSH-Signature"))
		if namespace != devNullNamespace {
			t.Errorf("signature namespace = %q", namespace)
		}
		fmt.Fprintf(w, "Committed: https://dev-null.sh/@testuser/commits/%s\n", devNullCommentLeaf)
	}))
	adapter := NewDevNullAdapter(server.URL)
	credential := devNullCredential("testuser", key)
	id, err := adapter.ReplyToComment(context.Background(), credential, "account", server.URL+"/@other/commits/"+devNullCommentOne, "Thanks for the feedback!")
	if err != nil || !strings.HasSuffix(id, devNullCommentLeaf) || calls != 1 {
		t.Fatalf("reply result = %q, %v, calls=%d", id, err, calls)
	}
	for _, parent := range []string{"", "../invalid", "https://untrusted.example/commits/" + devNullCommentOne} {
		if _, err := adapter.ReplyToComment(context.Background(), credential, "account", parent, "Reply"); err == nil {
			t.Fatalf("accepted invalid parent %q", parent)
		}
	}
	if calls != 1 {
		t.Fatalf("invalid reply performed a write: calls=%d", calls)
	}
	for _, action := range []func(context.Context, string, string, string) error{adapter.HideComment, adapter.DeleteComment} {
		if err := action(context.Background(), credential, "account", devNullCommentOne); !errors.Is(err, ErrUnsupportedCommentAction) {
			t.Fatalf("unsupported moderation returned %v", err)
		}
	}
}

func TestDevNullCommentsLegacyUser(t *testing.T) {
	var commit devNullCommentCommit
	if err := json.Unmarshal([]byte(`{"id":"legacy","body":"Earlier public reply","user":{"id":"account","handle":"testuser","name":"Test User"}}`), &commit); err != nil {
		t.Fatal(err)
	}
	comment := commit.comment("testuser", "account", devNullCommentRoot, devNullCommentRoot)
	if !comment.IsOurs || comment.AuthorName != "Test User" {
		t.Fatalf("legacy user relation lost: %+v", comment)
	}
}
