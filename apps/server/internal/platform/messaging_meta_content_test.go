package platform

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Instagram returns shared posts and story replies or mentions with an empty
// message, and image attachments with image_data.url and no mime_type.
const metaContentMessages = `[
	{"id":"m1","message":"","from":{"id":"alice"},"created_time":"2026-10-26T21:01:00Z",
		"attachments":{"data":[{"image_data":{"url":"https://cdn.example/photo.jpg","preview_url":"https://cdn.example/p.jpg","width":640,"height":480}}]}},
	{"id":"m2","message":"","from":{"id":"alice"},"created_time":"2026-10-26T21:02:00Z",
		"shares":{"data":[{"link":"https://www.instagram.com/reel/abc/"}]}},
	{"id":"m3","message":"","from":{"id":"alice"},"created_time":"2026-10-26T21:03:00Z",
		"story":{"mention":{"link":"https://cdn.example/story-mention.jpg","id":"s1"}}},
	{"id":"m4","message":"","from":{"id":"alice"},"created_time":"2026-10-26T21:04:00Z",
		"story":{"reply_to":{"link":"https://cdn.example/story-reply.jpg","id":"s2"}}}]`

func requireMetaContentAttachments(t *testing.T, messages []ProviderMessage) {
	t.Helper()
	require.Len(t, messages, 4)
	want := []MessageAttachment{
		{Type: "image", URL: "https://cdn.example/photo.jpg"},
		{Type: "share", URL: "https://www.instagram.com/reel/abc/"},
		{Type: "story_mention", URL: "https://cdn.example/story-mention.jpg"},
		{Type: "story_reply", URL: "https://cdn.example/story-reply.jpg"},
	}
	for i, message := range messages {
		require.Equal(t, []MessageAttachment{want[i]}, message.Attachments, message.ID)
	}
}

func TestMetaConversationsReadSharesStoriesAndImageURLs(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		fields := r.URL.Query().Get("fields")
		require.True(t, strings.Contains(fields, "shares") && strings.Contains(fields, "story"), fields)
		return jsonResponse(r, `{"data":[{"id":"c1","updated_time":"2026-10-26T21:04:00Z",
			"participants":{"data":[{"id":"me","username":"brand"},{"id":"alice","username":"alice"}]},
			"messages":{"data":`+metaContentMessages+`}}]}`), nil
	})}
	result, err := NewInstagramAdapter("", "", "").FetchMessages(t.Context(), "secret", FetchMessagesRequest{AccountID: "me"})
	require.NoError(t, err)
	require.Len(t, result.Conversations, 1)
	requireMetaContentAttachments(t, result.Conversations[0].Messages)
}

func TestMetaHistoryReadsSharesStoriesAndImageURLs(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, metaMessageFields, r.URL.Query().Get("fields"))
		return jsonResponse(r, `{"data":`+metaContentMessages+`}`), nil
	})}
	result, err := NewInstagramAdapter("", "", "").FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{AccountID: "me", ConversationID: "c1"})
	require.NoError(t, err)
	requireMetaContentAttachments(t, result.Messages)
}

func TestMetaAttachmentKeepsLegacyImageSrcAndMimeType(t *testing.T) {
	var message metaMessageView
	require.NoError(t, json.Unmarshal([]byte(`{"id":"m1","attachments":{"data":[
		{"mime_type":"image/png","image_data":{"src":"https://cdn.example/src.png"}}]}}`), &message))
	require.Equal(t, []MessageAttachment{{Type: "image", URL: "https://cdn.example/src.png", MimeType: "image/png"}}, message.provider("me").Attachments)
}

func TestMetaShareUsesDocumentedURLAndLegacyLink(t *testing.T) {
	var message metaMessageView
	require.NoError(t, json.Unmarshal([]byte(`{"id":"m1","shares":{"data":[
		{"url":"https://www.instagram.com/p/abc/","name":"A shared post"},
		{"link":"https://www.instagram.com/reel/def/"}]}}`), &message))
	require.Equal(t, []MessageAttachment{
		{Type: "share", URL: "https://www.instagram.com/p/abc/", Name: "A shared post"},
		{Type: "share", URL: "https://www.instagram.com/reel/def/"},
	}, message.provider("me").Attachments)
}
