package platform

import (
	"context"
	"fmt"
	"net/http"
	"testing"
)

const (
	devNullCommentRoot = "00000000-0000-4000-8000-000000000001"
	devNullCommentOne  = "00000000-0000-4000-8000-000000000002"
)

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
