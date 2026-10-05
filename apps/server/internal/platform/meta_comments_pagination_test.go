package platform

import (
	"context"
	"encoding/json"
	"io"
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
		{"instagram", NewInstagramAdapter("", "", ""), `{"data":[{"id":"first","replies":{"data":[{"id":"reply","parent_id":"first"}],"paging":{"next":"?after=nested"}}}],"paging":{"next":"?after=second"}}`, `{"data":[{"id":"second"}]}`, `{"data":[{"id":"nested","parent_id":"reply","from":{"id":"account"}}]}`},
		{"facebook", NewFacebookAdapter("", "", ""), `{"data":[{"id":"first","comments":{"data":[{"id":"reply","parent":{"id":"first"}}],"paging":{"next":"?after=nested"}}}],"paging":{"next":"?after=second"}}`, `{"data":[{"id":"second"}]}`, `{"data":[{"id":"nested","parent":{"id":"reply"},"from":{"id":"account"}}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
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
			if tc.name == "threads" {
				require.Len(t, comments, 2)
				require.Equal(t, "first", byID["second"].ParentID)
				require.True(t, byID["second"].IsOurs)
				require.Equal(t, 2, calls)
				return
			}
			require.Len(t, comments, 4)
			require.Contains(t, byID, "second")
			require.Equal(t, "first", byID["reply"].ParentID)
			require.Equal(t, "reply", byID["nested"].ParentID)
			require.True(t, byID["nested"].IsOurs)
			require.Equal(t, 3, calls)
		})
	}
}

func TestMetaCommentsRejectsUnsafePagination(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, provider := range []struct {
		name    string
		adapter CommentAdapter
	}{{"threads", NewThreadsAdapter("", "", "")}, {"instagram", NewInstagramAdapter("", "", "")}, {"facebook", NewFacebookAdapter("", "", "")}} {
		for _, mode := range []string{"foreign host", "repeated page"} {
			t.Run(provider.name+"/"+mode, func(t *testing.T) {
				calls := 0
				httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					calls++
					if calls > 1 {
						t.Fatal("unsafe continuation must not be requested")
					}
					next := "https://attacker.example/?access_token=synthetic-token"
					if mode == "repeated page" {
						next = req.URL.String()
					}
					encoded, err := json.Marshal(next)
					require.NoError(t, err)
					return jsonResponse(req, `{"data":[{"id":"first"}],"paging":{"next":`+string(encoded)+`}}`), nil
				})}
				comments, err := provider.adapter.ListComments(context.Background(), "synthetic-token", "account", "post")
				require.Error(t, err)
				require.Nil(t, comments)
				require.NotContains(t, err.Error(), "synthetic-token")
				require.Equal(t, 1, calls)
			})
		}
	}
}

func TestMetaCommentsLaterPagePreservesRecoveryFailure(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, provider := range []struct {
		name    string
		adapter CommentAdapter
	}{{"threads", NewThreadsAdapter("", "", "")}, {"instagram", NewInstagramAdapter("", "", "")}, {"facebook", NewFacebookAdapter("", "", "")}} {
		for _, tc := range []struct {
			name, body, code string
			status           int
		}{
			{"permission", `{"error":{"code":10,"message":"private detail"}}`, "meta:permission:10", http.StatusForbidden},
			{"unavailable", `{"error":{"code":100,"error_subcode":33}}`, "meta:nonexistent:100:33", http.StatusNotFound},
		} {
			t.Run(provider.name+"/"+tc.name, func(t *testing.T) {
				calls := 0
				httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					calls++
					if calls == 1 {
						return jsonResponse(req, `{"data":[{"id":"first"}],"paging":{"next":"?after=second"}}`), nil
					}
					return jsonResponse(req, tc.body), nil
				})}
				comments, err := provider.adapter.ListComments(context.Background(), "synthetic-token", "account", "post")
				var failure *HTTPError
				require.ErrorAs(t, err, &failure)
				require.Equal(t, tc.status, failure.StatusCode)
				require.Equal(t, tc.code, failure.Code)
				require.Nil(t, comments, "a partial collection must not be recorded as successful")
				require.NotContains(t, err.Error(), "private detail")
				require.NotContains(t, err.Error(), "synthetic-token")
				require.Equal(t, 2, calls)
			})
		}
	}
}

func TestMetaCommentsRejectsLaterPageRedirect(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, provider := range []struct {
		name    string
		adapter CommentAdapter
	}{
		{"threads", NewThreadsAdapter("", "", "")},
		{"instagram", NewInstagramAdapter("", "", "")},
		{"facebook", NewFacebookAdapter("", "", "")},
	} {
		t.Run(provider.name, func(t *testing.T) {
			calls, foreignCalls := 0, 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.URL.Host == "attacker.example" {
					foreignCalls++
					return jsonResponse(req, `{"data":[]}`), nil
				}
				if req.URL.Query().Get("after") == "second" {
					return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {"https://attacker.example/?access_token=synthetic-token"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
				}
				return jsonResponse(req, `{"data":[{"id":"first"}],"paging":{"next":"?after=second"}}`), nil
			})}
			comments, err := provider.adapter.ListComments(context.Background(), "synthetic-token", "account", "post")
			require.Zero(t, foreignCalls, "a continuation redirect must not reach a foreign host")
			require.Error(t, err)
			require.Nil(t, comments)
			require.NotContains(t, err.Error(), "synthetic-token")
			require.Equal(t, 2, calls)
		})
	}
}
