package platform

import (
	"context"

	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMetaCommentsCollectAllConversationPages(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, tc := range []struct {
		name                  string
		adapter               CommentAdapter
		first, second, nested string
	}{
		{"threads", NewThreadsAdapter("", "", ""), `{"data":[{"id":"first","replied_to":{"id":"post"}}],"paging":{"next":"?after=second"}}`, `{"data":[{"id":"second","is_reply_owned_by_me":true,"replied_to":{"id":"first"}}]}`, ""},
		{"instagram", NewInstagramAdapter("", "", ""), `{"data":[{"id":"first","from":{"id":"visitor"},"replies":{"data":[{"id":"reply","parent_id":"first"}],"paging":{"next":"?after=nested"}}}],"paging":{"next":"?after=second"}}`, `{"data":[{"id":"second"}]}`, `{"data":[{"id":"nested","parent_id":"reply","from":{"id":"account"}}]}`},
		{"facebook", NewFacebookAdapter("", "", ""), `{"data":[{"id":"first","from":{"id":"visitor"},"comments":{"data":[{"id":"reply","parent":{"id":"first"}}],"paging":{"next":"?after=nested"}}}],"paging":{"next":"?after=second"}}`, `{"data":[{"id":"second"}]}`, `{"data":[{"id":"nested","parent":{"id":"reply"},"from":{"id":"account"}}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				require.Empty(t, req.URL.Query().Get(oauthParamAccessToken))
				require.Equal(t, "Bearer synthetic-token", req.Header.Get(headerAuthorization))
				if req.URL.Query().Get("after") == "" {
					if tc.name == "threads" {
						require.Contains(t, strings.Split(req.URL.Query().Get("fields"), ","), "is_reply_owned_by_me")
					} else {
						require.Contains(t, req.URL.Query().Get("fields"), "from", "Graph must return comment author identity")
					}
				}
				switch req.URL.Query().Get("after") {
				case "":
					return jsonResponse(req, tc.first), nil
				case "second":
					return jsonResponse(req, tc.second), nil
				case "nested":
					return jsonResponse(req, tc.nested), nil
				default:
					t.Fatalf("unexpected cursor")
					return nil, nil
				}
			})}
			comments, err := tc.adapter.ListComments(context.Background(), "synthetic-token", "account", "post")
			require.NoError(t, err)
			byID := map[string]Comment{}
			for _, item := range comments {
				byID[item.ID] = item
			}
			require.False(t, byID["first"].IsOurs, "a visitor comment is incoming engagement")
			if tc.name == "threads" {
				require.Len(t, comments, 2)
				require.Equal(t, "first", byID["second"].ParentID)
				require.True(t, byID["second"].IsOurs)
				require.Equal(t, 2, calls)
				return
			}
			require.Len(t, comments, 4)
			require.Equal(t, "visitor", byID["first"].AuthorID)
			require.Contains(t, byID, "second")
			require.Equal(t, "first", byID["reply"].ParentID)
			require.Equal(t, "reply", byID["nested"].ParentID)
			require.True(t, byID["nested"].IsOurs)
			require.Equal(t, "account", byID["nested"].AuthorID, "own-comment identity must survive the walker")
			require.Equal(t, 3, calls)
		})
	}
}
