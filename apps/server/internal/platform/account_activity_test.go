package platform

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBlueskyMentionPageKeepsNativeReplyContext(t *testing.T) {
	stubGoogleBusinessClient(t, func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "Bearer credential", request.Header.Get("Authorization"))
		require.Equal(t, "/xrpc/app.bsky.notification.listNotifications", request.URL.Path)
		require.Equal(t, "mention", request.URL.Query().Get("reasons"))
		require.Equal(t, "opaque+cursor", request.URL.Query().Get("cursor"))
		return jsonResponse(request, `{"cursor":"next-page","notifications":[{"reason":"mention","uri":"at://did:plc:alice/app.bsky.feed.post/one","cid":"post-cid","indexedAt":"2026-10-24T10:00:00Z","author":{"did":"did:plc:alice","handle":"alice.example","displayName":"Alice"},"record":{"text":"Hello @founder","createdAt":"2026-10-23T09:00:00Z","reply":{"root":{"uri":"at://did:plc:root/app.bsky.feed.post/root","cid":"root-cid"}}}},{"reason":"like","uri":"at://like","cid":"cid"}]}`), nil
	})
	page, err := NewBlueskyAdapter("https://pds.example").ListAccountActivity(t.Context(), "credential", "did:plc:founder", AccountActivityRequest{Feed: "mentions", Cursor: "opaque+cursor"})
	require.NoError(t, err)
	require.Equal(t, "next-page", page.NextCursor)
	require.Len(t, page.Items, 1)
	item := page.Items[0]
	require.Equal(t, "Hello @founder", item.Text)
	require.Equal(t, "did:plc:alice", item.AuthorID)
	require.Equal(t, "root-cid", item.Subject.Root.CID)
	require.Equal(t, `{"_root":{"cid":"root-cid","uri":"at://did:plc:root/app.bsky.feed.post/root"},"cid":"post-cid","uri":"at://did:plc:alice/app.bsky.feed.post/one"}`, item.ID, "mention notifications and the existing comment collector share one stable Inbox identity")
	require.Equal(t, "post-cid", item.Subject.Parent.CID)
	require.Equal(t, "2026-10-24T10:00:00Z", item.ObservedAt.Format("2006-01-02T15:04:05Z"))
	var reference map[string]any
	require.NoError(t, json.Unmarshal([]byte(item.ID), &reference))
	require.Equal(t, "at://did:plc:alice/app.bsky.feed.post/one", reference["uri"])
}

func TestMastodonMentionPageExcludesDirectMessagesAndValidatesContinuation(t *testing.T) {
	for _, hostile := range []bool{false, true} {
		t.Run(map[bool]string{false: "same instance", true: "hostile continuation"}[hostile], func(t *testing.T) {
			stubGoogleBusinessClient(t, func(request *http.Request) (*http.Response, error) {
				require.Equal(t, "mention", request.URL.Query().Get("types[]"))
				require.Equal(t, "91", request.URL.Query().Get("max_id"))
				response := jsonResponse(request, `[{"type":"mention","created_at":"2026-10-24T10:00:00Z","status":{"id":"80","visibility":"public","url":"https://social.example/@alice/80","content":"<p>Hello</p>","account":{"id":"alice","acct":"alice@remote.example"}}},{"type":"mention","status":{"id":"79","visibility":"direct","content":"Private","account":{"id":"alice"}}}]`)
				host := "social.example"
				if hostile {
					host = "attacker.example"
				}
				response.Header.Set("Link", `<https://`+host+`/api/v1/notifications?max_id=78>; rel="next"`)
				return response, nil
			})
			page, err := NewMastodonAdapter("", "", "", "https://social.example").ListAccountActivity(t.Context(), "credential", "founder", AccountActivityRequest{Feed: "mentions", Cursor: "91"})
			if hostile {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, "78", page.NextCursor)
			require.Len(t, page.Items, 1)
			require.Equal(t, "Hello", page.Items[0].Text)
			require.Equal(t, "80", page.Items[0].ID)
		})
	}
}

func TestGoogleReviewsRetainAnonymousRatingsAndOwnerReplyModeration(t *testing.T) {
	const name = "accounts/123/locations/456/reviews/review_one"
	writes := 0
	stubGoogleBusinessClient(t, func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "Bearer credential", request.Header.Get("Authorization"))
		if request.Method == http.MethodPut {
			writes++
			require.Equal(t, "/v4/"+name+"/reply", request.URL.Path)
			body, err := io.ReadAll(request.Body)
			require.NoError(t, err)
			require.JSONEq(t, `{"comment":"Thanks 日本語"}`, string(body))
			return jsonResponse(request, `{"comment":"Thanks 日本語","reviewReplyState":"PENDING"}`), nil
		}
		require.Equal(t, "50", request.URL.Query().Get("pageSize"))
		require.Equal(t, "updateTime desc", request.URL.Query().Get("orderBy"))
		return jsonResponse(request, `{"nextPageToken":"page-two","reviews":[{"reviewId":"review_one","starRating":"FIVE","reviewer":{"isAnonymous":true,"displayName":"Must not expose","profilePhotoUrl":"https://example.com/private"},"updateTime":"2026-10-24T10:00:00Z","reviewReply":{"comment":"Existing reply","reviewReplyState":"REJECTED","policyViolation":"FUTURE_POLICY"}}]}`), nil
	})
	adapter := NewGoogleBusinessAdapter("", "", "")
	page, err := adapter.ListAccountActivity(t.Context(), "credential", "accounts/123/locations/456", AccountActivityRequest{Feed: "reviews"})
	require.NoError(t, err)
	require.Equal(t, "page-two", page.NextCursor)
	require.Len(t, page.Items, 1)
	item := page.Items[0]
	require.Empty(t, item.Text, "rating-only reviews remain visible")
	require.Empty(t, item.AuthorName)
	require.Empty(t, item.AuthorAvatarURL)
	require.Equal(t, name, item.ID)
	require.Equal(t, 5, *item.Subject.Review.Stars)
	require.Equal(t, "REJECTED", item.Subject.Review.OwnerReply.State)
	require.Equal(t, "FUTURE_POLICY", item.Subject.Review.OwnerReply.PolicyViolation)
	require.False(t, item.CanDelete, "customer reviews can never be deleted")
	_, err = adapter.SetReviewReply(t.Context(), "credential", "accounts/123/locations/456", name, strings.Repeat("🚀", 1025))
	require.Error(t, err)
	require.Zero(t, writes, "the limit counts UTF-8 bytes before provider I/O")
	reply, err := adapter.SetReviewReply(t.Context(), "credential", "accounts/123/locations/456", name, "Thanks 日本語")
	require.NoError(t, err)
	require.Equal(t, "PENDING", reply.State)
	require.Equal(t, 1, writes)
}

func TestThreadsMentionPagePersistsOnlyOpaqueContinuation(t *testing.T) {
	stubGoogleBusinessClient(t, func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "/v1.0/me/mentions", request.URL.Path)
		require.Equal(t, "opaque&token", request.URL.Query().Get("after"))
		require.Empty(t, request.URL.Query().Get("access_token"))
		return jsonResponse(request, `{"data":[{"id":"mention-1","text":"Hello","username":"alice","timestamp":"2026-10-24T10:00:00Z"}],"paging":{"next":"https://graph.threads.net/next?access_token=secret","cursors":{"after":"next-page"}}}`), nil
	})
	page, err := NewThreadsAdapter("", "", "").ListAccountActivity(t.Context(), "credential", "founder", AccountActivityRequest{Feed: "mentions", Cursor: "opaque&token"})
	require.NoError(t, err)
	require.Equal(t, "next-page", page.NextCursor)
	require.Len(t, page.Items, 1)
	require.Equal(t, "mention-1", page.Items[0].ID)
}

// Threads returns mention timestamps with a colonless offset, which a strict
// RFC 3339 parse rejects and stores as the zero time.
func TestThreadsMentionKeepsGraphTimestamp(t *testing.T) {
	stubGoogleBusinessClient(t, func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "/v1.0/me/mentions", request.URL.Path)
		return jsonResponse(request, `{"data":[{"id":"mention-1","text":"Hello","username":"alice","timestamp":"2026-10-24T10:00:00+0000","permalink":"https://www.threads.net/@alice/post/9"}]}`), nil
	})
	page, err := NewThreadsAdapter("", "", "").ListAccountActivity(t.Context(), "credential", "founder", AccountActivityRequest{Feed: "mentions"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.True(t, page.Items[0].ObservedAt.Equal(time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)))
}
