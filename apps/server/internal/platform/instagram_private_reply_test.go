package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInstagramPrivateReplyAddressesCommentInBothLoginModes(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, direct := range []bool{false, true} {
		t.Run(map[bool]string{false: "facebook login", true: "instagram login"}[direct], func(t *testing.T) {
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				host := "graph.facebook.com"
				if direct {
					host = "graph.instagram.com"
				}
				require.Equal(t, host, req.URL.Host)
				require.Contains(t, req.URL.Path, "/owner/messages")
				require.Equal(t, "Bearer private-token", req.Header.Get("Authorization"))
				var body map[string]any
				require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
				require.Equal(t, map[string]any{"comment_id": "comment-42"}, body["recipient"])
				require.Equal(t, map[string]any{"text": "Here is your playbook: https://example.test/book"}, body["message"])
				return jsonResponse(req, `{"recipient_id":"reader","message_id":"dm-42"}`), nil
			})}
			adapter := NewInstagramAdapter("", "", "")
			adapter.instagramLogin = direct
			id, err := adapter.ReplyPrivatelyToComment(context.Background(), "private-token", "owner", "comment-42", "Here is your playbook: https://example.test/book")
			require.NoError(t, err)
			require.Equal(t, "dm-42", id)
		})
	}
}
