package platform

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func newFakePieFed(_ *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/alpha/user/login", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"jwt":"piefed-jwt"}`))
	})
	mux.HandleFunc("/api/alpha/site", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"version":"1.2.0","site":{},"my_user":{"local_user_view":{"person":{"id":6,"user_name":"rodrigo","title":"Rodrigo","actor_id":"https://home.example/u/rodrigo"}}}}`))
	})
	mux.HandleFunc("/api/alpha/resolve_object", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"community":{"community":{"id":9,"name":"piefed_meta","title":"PieFed Meta","description":"Rules here.","actor_id":"https://piefed.social/c/piefed_meta","restricted_to_mods":false}}}`))
	})
	mux.HandleFunc("/api/alpha/community/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"communities":[{"community":{"id":9,"name":"piefed_meta","title":"PieFed Meta","actor_id":"https://piefed.social/c/piefed_meta"}}]}`))
	})
	mux.HandleFunc("/api/alpha/post", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"post_view":{"post":{"id":200,"title":"Hello PieFed","body":"Body","ap_id":"https://piefed.social/post/200"}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"post_view":{"post":{"id":200,"title":"Hello","ap_id":"https://piefed.social/post/200"},"counts":{"comments":2,"upvotes":5}}}`))
	})
	mux.HandleFunc("/api/alpha/post/replies", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comments":[{"comment":{"id":21,"post_id":200,"body":"Nice","published":"2026-09-01T10:00:00Z","ap_id":"https://piefed.social/comment/21","path":"0.21"},"creator":{"id":8,"user_name":"viewer","actor_id":"https://piefed.social/u/viewer"}}]}`))
	})
	mux.HandleFunc("/api/alpha/comment", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comment_view":{"comment":{"id":22,"post_id":200,"body":"Reply","published":"2026-09-01T10:00:00Z","ap_id":"https://piefed.social/comment/22"},"creator":{"id":6,"user_name":"rodrigo"}}}`))
	})
	mux.HandleFunc("/api/alpha/comment/like", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	})
	mux.HandleFunc("/api/alpha/comment/delete", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	})
	mux.HandleFunc("/api/alpha/upload/image", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "bad upload", http.StatusBadRequest)
			return
		}
		if _, _, err := r.FormFile("image"); err != nil {
			http.Error(w, "missing image", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"url":"https://home.example/media/1.jpg"}`))
	})
	// PieFed filters the post list by person_id; any other parameter is
	// accepted and ignored, which leaves the "All" feed unfiltered.
	mux.HandleFunc("/api/alpha/post/list", func(w http.ResponseWriter, r *http.Request) {
		own := `{"post":{"id":200,"user_id":6,"title":"Hello","ap_id":"https://piefed.social/post/200","published":"2026-09-01T10:00:00Z"}}`
		if r.URL.Query().Get("person_id") == "6" {
			_, _ = w.Write([]byte(`{"posts":[` + own + `],"next_page":null}`))
			return
		}
		_, _ = w.Write([]byte(`{"posts":[` + own + `,{"post":{"id":201,"user_id":8,"title":"Someone else's post","ap_id":"https://piefed.social/post/201","published":"2026-09-02T10:00:00Z"}}],"next_page":"2"}`))
	})
	return httptest.NewServer(mux)
}

func TestPieFedLoginAndProfile(t *testing.T) {
	server := newFakePieFed(t)
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	token, profile, err := adapter.Login(t.Context(), "rodrigo", "secret")
	require.NoError(t, err)
	require.Equal(t, "piefed-jwt", token.AccessToken)
	require.Equal(t, "6", profile.ID)
	require.Equal(t, "rodrigo", profile.Username)
	require.Equal(t, "piefed", profile.CapabilityState["fediverse_software"])
}

func TestPieFedPublishDiscussion(t *testing.T) {
	server := newFakePieFed(t)
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	result, err := adapter.Publish(t.Context(), "piefed-jwt", "6", &PublishRequest{
		Content: "Body",
		Title:   "Hello PieFed",
		Settings: map[string]interface{}{
			"community": "!piefed_meta@piefed.social",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "200", result.ExternalID)
	require.Equal(t, "https://piefed.social/post/200", result.ExternalURL)
	require.Equal(t, "piefed:community:piefed.social:piefed_meta", result.ProviderReference)
}

func TestPieFedCommunitySearch(t *testing.T) {
	server := newFakePieFed(t)
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	page, err := adapter.SearchPublishingOptions(t.Context(), "piefed-jwt", PublishingOptionsInput{
		Context: map[string]string{"query": "meta"},
	})
	require.NoError(t, err)
	require.Len(t, page.Options, 1)
	require.Equal(t, "https://piefed.social/c/piefed_meta", page.Options[0].Value)
}

func TestPieFedComments(t *testing.T) {
	server := newFakePieFed(t)
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "piefed-jwt", "6", "200")
	require.NoError(t, err)
	require.Len(t, comments, 1)
	require.True(t, strings.HasPrefix(comments[0].ID, "piefed:200:"))

	replyID, err := adapter.ReplyToComment(t.Context(), "piefed-jwt", "6", comments[0].ID, "Thanks")
	require.NoError(t, err)
	require.Equal(t, "piefed:200:22", replyID)
	require.NoError(t, adapter.LikeComment(t.Context(), "piefed-jwt", "6", comments[0].ID))
	require.NoError(t, adapter.DeleteComment(t.Context(), "piefed-jwt", "6", replyID))
}

func TestPieFedAccountContentDiscovery(t *testing.T) {
	server := newFakePieFed(t)
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	page, err := adapter.DiscoverAccountContent(t.Context(), "piefed-jwt", AccountContentDiscoveryRequest{AccountID: "6"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1, "only the connected person's own posts are account content")
	require.Equal(t, "https://piefed.social/post/200", page.Items[0].ExternalURL)
	require.Empty(t, page.NextCursor)
}

func TestPieFedImageUploadAndAnalytics(t *testing.T) {
	server := newFakePieFed(t)
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	imageURL, err := adapter.UploadMedia(t.Context(), "piefed-jwt", "6", "image/jpeg", strings.NewReader("jpeg-bytes"))
	require.NoError(t, err)
	require.Equal(t, "https://home.example/media/1.jpg", imageURL)

	content, err := adapter.FetchContentAnalytics(t.Context(), "piefed-jwt", ContentAnalyticsRequest{ExternalIDs: []string{"200"}})
	require.NoError(t, err)
	require.Equal(t, int64(5), content[MetricLikes])
	require.Equal(t, int64(2), content[MetricComments])
}
