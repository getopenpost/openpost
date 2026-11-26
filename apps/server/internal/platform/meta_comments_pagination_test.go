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
