package platform

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseCommunityRef(t *testing.T) {
	name, host, ok := ParseCommunityRef("!selfhosted@lemmy.world")
	require.True(t, ok)
	require.Equal(t, "selfhosted", name)
	require.Equal(t, "lemmy.world", host)

	name, parsedHost, ok := ParseCommunityRef("selfhosted@lemmy.world")
	require.True(t, ok)
	require.Equal(t, "selfhosted", name)
	require.Equal(t, "lemmy.world", parsedHost)

	name, host, ok = ParseCommunityRef("https://lemmy.world/c/selfhosted")
	require.True(t, ok)
	require.Equal(t, "selfhosted", name)
	require.Equal(t, "lemmy.world", host)

	_, _, ok = ParseCommunityRef("!bad name@host.example")
	require.False(t, ok)
	_, _, ok = ParseCommunityRef("")
	require.False(t, ok)
}

func TestCommunityCommentReferenceRoundTrip(t *testing.T) {
	for _, provider := range []string{providerLemmy, providerPieFed} {
		ref := communityCommentRef(provider, 42, "7")
		postID, commentID, err := splitCommunityCommentRef(provider, ref)
		require.NoError(t, err)
		require.EqualValues(t, 42, postID)
		require.EqualValues(t, 7, commentID)
		require.Error(t, func() error {
			_, _, splitErr := splitCommunityCommentRef(provider, "other:42:7")
			return splitErr
		}())
	}
}

func TestFirstCommunityMediaURL(t *testing.T) {
	require.Empty(t, firstCommunityMediaURL(nil))
	require.Equal(t, "https://cdn.example/image.jpg", firstCommunityMediaURL(&PublishRequest{
		PlatformMediaIDs: []string{"provider-id", " https://cdn.example/image.jpg "},
	}))
}

func TestCommunityTargetKeyRoundTrip(t *testing.T) {
	key := CommunityTargetKey("lemmy", "lemmy.world", "selfhosted")
	require.Equal(t, "lemmy:community:lemmy.world:selfhosted", key)
	provider, host, name, ok := ParseCommunityTargetKey(key)
	require.True(t, ok)
	require.Equal(t, "lemmy", provider)
	require.Equal(t, "lemmy.world", host)
	require.Equal(t, "selfhosted", name)

	// Same name on different origins stays different destinations.
	other := CommunityTargetKey("lemmy", "other.example", "selfhosted")
	require.NotEqual(t, key, other)
}

func TestValidateCommunityPost(t *testing.T) {
	require.NoError(t, ValidateCommunityPost("lemmy", "!selfhosted@lemmy.world", "Why I self-host"))
	require.ErrorContains(t, ValidateCommunityPost("lemmy", "", "Title"), "require a community")
	require.ErrorContains(t, ValidateCommunityPost("lemmy", "!selfhosted@lemmy.world", "  "), "require a title")
}

func newFakeLemmy(_ *testing.T) (*httptest.Server, *string) {
	version := "0.19.11"
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v3/user/login", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"jwt":"lemmy-jwt","registration_created":false,"verify_email_sent":false}`))
	})
	mux.HandleFunc("/api/v3/site", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"version":"` + version + `","site_view":{},"my_user":{"local_user_view":{"person":{"id":5,"name":"rodrigo","display_name":"Rodrigo","ap_id":"https://home.example/u/rodrigo"}}}}`))
	})
	mux.HandleFunc("/api/v3/resolve_object", func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Query().Get("q"), "mods-only") {
			_, _ = w.Write([]byte(`{"community":{"community":{"id":8,"name":"mods-only","title":"Mods Only","actor_id":"https://remote.example/c/mods-only","posting_restricted_to_mods":true}}}`))
			return
		}
		// API v3 names a community's canonical actor URL actor_id.
		_, _ = w.Write([]byte(`{"community":{"community":{"id":7,"name":"selfhosted","title":"Selfhosted","sidebar":"Be excellent.","actor_id":"https://remote.example/c/selfhosted","posting_restricted_to_mods":false}}}`))
	})
	mux.HandleFunc("/api/v3/search", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"type_":"Communities","communities":[{"community":{"id":7,"name":"selfhosted","title":"Selfhosted","actor_id":"https://remote.example/c/selfhosted"}}],"comments":[],"posts":[],"users":[]}`))
	})
	mux.HandleFunc("/api/v3/post", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"post_view":{"post":{"id":100,"name":"Why I self-host","body":"Body text","ap_id":"https://remote.example/post/100"},"counts":{"comments":0,"score":1,"upvotes":1}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"post_view":{"post":{"id":100,"name":"Why I self-host","ap_id":"https://remote.example/post/100"},"counts":{"comments":3,"score":9,"upvotes":10}},"community_view":{}}`))
	})
	// API v3 comments carry published/updated, keep the score in counts, and
	// report the connected account's own vote as my_vote. Lemmy upvotes a
	// comment for its author, so a positive score alone says nothing about
	// the connected account.
	mux.HandleFunc("/api/v3/comment/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comments":[{"comment":{"id":11,"creator_id":9,"post_id":100,"content":"First!","published":"2026-09-01T10:00:00Z","path":"0.11","ap_id":"https://remote.example/comment/11"},"creator":{"id":9,"name":"viewer","actor_id":"https://remote.example/u/viewer"},"counts":{"comment_id":11,"score":1,"upvotes":1,"downvotes":0,"child_count":1}},{"comment":{"id":12,"creator_id":5,"post_id":100,"content":"Thanks","published":"2026-09-01T10:05:00Z","updated":"2026-09-01T10:30:00Z","path":"0.11.12","ap_id":"https://remote.example/comment/12"},"creator":{"id":5,"name":"rodrigo","actor_id":"https://home.example/u/rodrigo"},"counts":{"comment_id":12,"score":2,"upvotes":2,"downvotes":0,"child_count":0},"my_vote":1}]}`))
	})
	mux.HandleFunc("/api/v3/comment", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comment_view":{"comment":{"id":13,"creator_id":5,"post_id":100,"content":"Reply","published":"2026-09-01T10:00:00Z","path":"0.11.13","ap_id":"https://remote.example/comment/13"},"creator":{"id":5,"name":"rodrigo"},"counts":{"comment_id":13,"score":1,"upvotes":1,"downvotes":0,"child_count":0},"my_vote":1}}`))
	})
	mux.HandleFunc("/api/v3/comment/like", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comment_view":{}}`))
	})
	mux.HandleFunc("/api/v3/comment/delete", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	})
	mux.HandleFunc("/api/v3/user", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"person_view":{"person":{"id":5,"name":"rodrigo"},"counts":{"post_count":42,"comment_count":7}}}`))
	})
	mux.HandleFunc("/api/v3/post/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"posts":[{"post":{"id":100,"name":"Why I self-host","body":"Body text","ap_id":"https://remote.example/post/100","published":"2026-09-01T10:00:00Z"},"counts":{"post_id":100,"comments":3,"score":9,"upvotes":10}}],"next_page":"Pa100"}`))
	})
	// Lemmy 0.19 serves image uploads only at /pictrs/image: a logged-in
	// multipart upload of images[] answered with pict-rs's file list. There is
	// no /api/v3/image route on that line.
	mux.HandleFunc("/pictrs/image", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer lemmy-jwt" {
			http.Error(w, `{"error":"not_logged_in"}`, http.StatusUnauthorized)
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "bad upload", http.StatusBadRequest)
			return
		}
		if _, _, err := r.FormFile("images[]"); err != nil {
			http.Error(w, "missing image", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"msg":"ok","files":[{"file":"8f3c2b.jpeg","delete_token":"d41d8c","details":{"width":1,"height":1,"content_type":"image/jpeg","created_at":"2026-09-01T10:00:00Z"}}]}`))
	})
	server := httptest.NewServer(mux)
	return server, &version
}

func TestLemmyLoginAndProfile(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	token, profile, err := adapter.Login(t.Context(), "rodrigo", "secret")
	require.NoError(t, err)
	require.Equal(t, "lemmy-jwt", token.AccessToken)
	require.Equal(t, "5", profile.ID)
	require.Equal(t, "rodrigo", profile.Username)
	require.Equal(t, "0.19.11", profile.CapabilityState["lemmy_version"])
}

func TestLemmyPublishDiscussion(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	result, err := adapter.Publish(t.Context(), "lemmy-jwt", "5", &PublishRequest{
		Content: "Body text",
		Title:   "Why I self-host",
		Settings: map[string]interface{}{
			"community": "!selfhosted@remote.example",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "100", result.ExternalID)
	require.Equal(t, "https://remote.example/post/100", result.ExternalURL)
	require.Equal(t, "lemmy:community:remote.example:selfhosted", result.ProviderReference)
}

func TestLemmyPublishRequiresCommunityAndTitle(t *testing.T) {
	adapter := NewLemmyAdapter("https://lemmy.example")
	_, err := adapter.Publish(t.Context(), "jwt", "5", &PublishRequest{Content: "Body", Title: "Title"})
	require.ErrorContains(t, err, "require a community")
	_, err = adapter.Publish(t.Context(), "jwt", "5", &PublishRequest{
		Content:  "Body",
		Settings: map[string]interface{}{"community": "!c@h.example"},
	})
	require.ErrorContains(t, err, "require a title")
}

func TestLemmyPublishRejectsModsOnlyCommunity(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	_, err := adapter.Publish(t.Context(), "lemmy-jwt", "5", &PublishRequest{
		Title:    "Hello",
		Settings: map[string]interface{}{"community": "!mods-only@remote.example"},
	})
	require.ErrorContains(t, err, "restricts posting to moderators")
}

func TestLemmyCommunitySearch(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	page, err := adapter.SearchPublishingOptions(t.Context(), "lemmy-jwt", PublishingOptionsInput{
		Context: map[string]string{"query": "selfhost"},
		Limit:   10,
	})
	require.NoError(t, err)
	require.Len(t, page.Options, 1)
	require.Equal(t, "https://remote.example/c/selfhosted", page.Options[0].Value)
	require.Contains(t, page.Options[0].Label, "!selfhosted@remote.example")
}

func TestLemmyComments(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "lemmy-jwt", "5", "100")
	require.NoError(t, err)
	require.Len(t, comments, 2)
	require.Equal(t, "lemmy:100:11", comments[0].ID)
	require.Equal(t, "", comments[0].ParentID, "top-level replies carry no parent")
	require.Equal(t, "lemmy:100:11", comments[1].ParentID, "nested replies link to their parent")
	require.False(t, comments[0].IsOurs)
	require.True(t, comments[1].IsOurs)
	require.Equal(t, "2026-09-01T10:00:00Z", comments[0].CreatedAt)
	require.Equal(t, "2026-09-01T10:05:00Z", comments[1].CreatedAt)
	require.Equal(t, "2026-09-01T10:30:00Z", comments[1].UpdatedAt)

	// Only my_vote reflects the connected account's like; the author's
	// automatic upvote on comment 11 does not.
	require.True(t, comments[0].LikeStateKnown)
	require.False(t, comments[0].Liked)
	require.True(t, comments[0].CanLike)
	require.False(t, comments[0].CanUnlike)
	require.True(t, comments[1].Liked)
	require.False(t, comments[1].CanLike)
	require.True(t, comments[1].CanUnlike)

	replyID, err := adapter.ReplyToComment(t.Context(), "lemmy-jwt", "5", comments[0].ID, "Welcome!")
	require.NoError(t, err)
	require.Equal(t, "lemmy:100:13", replyID)
	require.NoError(t, adapter.LikeComment(t.Context(), "lemmy-jwt", "5", comments[0].ID))
	require.NoError(t, adapter.UnlikeComment(t.Context(), "lemmy-jwt", "5", comments[0].ID))
	require.NoError(t, adapter.DeleteComment(t.Context(), "lemmy-jwt", "5", replyID))
}

func TestLemmyAccountContentDiscovery(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	page, err := adapter.DiscoverAccountContent(t.Context(), "lemmy-jwt", AccountContentDiscoveryRequest{AccountID: "5"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1, "posts with an API v3 publish time must not be dropped")
	require.Equal(t, time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC), page.Items[0].PublishedAt)
	require.Equal(t, "https://remote.example/post/100", page.Items[0].ExternalURL)
	require.Equal(t, "Why I self-host", page.Items[0].Title)
	require.Equal(t, "Pa100", page.NextCursor)
}

func TestLemmyAnalytics(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	content, err := adapter.FetchContentAnalytics(t.Context(), "lemmy-jwt", ContentAnalyticsRequest{ExternalIDs: []string{"100"}})
	require.NoError(t, err)
	require.Equal(t, int64(10), content[MetricLikes], "upvotes are reported as likes")
	require.Equal(t, int64(3), content[MetricComments])
	_, hasScore := content["score"]
	require.False(t, hasScore, "the net score must not be relabelled")

	account, err := adapter.FetchAccountAnalytics(t.Context(), "lemmy-jwt", AccountAnalyticsRequest{AccountID: "5"})
	require.NoError(t, err)
	require.Equal(t, int64(42), account[MetricPosts])
}

func TestLemmyImageUpload(t *testing.T) {
	server, _ := newFakeLemmy(t)
	defer server.Close()

	adapter := NewLemmyAdapter(server.URL)
	imageURL, err := adapter.UploadMedia(t.Context(), "lemmy-jwt", "5", "image/jpeg", strings.NewReader("jpeg-bytes"))
	require.NoError(t, err)
	require.Equal(t, server.URL+"/pictrs/image/8f3c2b.jpeg", imageURL)

	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"msg":"no_files"}`))
	}))
	defer empty.Close()
	_, err = NewLemmyAdapter(empty.URL).UploadMedia(t.Context(), "lemmy-jwt", "5", "image/jpeg", strings.NewReader("jpeg-bytes"))
	require.ErrorContains(t, err, "returned no file: no_files")
}

func TestLemmyRejectsV4Instances(t *testing.T) {
	server, version := newFakeLemmy(t)
	defer server.Close()
	*version = "1.0.0"

	adapter := NewLemmyAdapter(server.URL)
	_, err := adapter.GetProfile(t.Context(), "lemmy-jwt")
	require.ErrorContains(t, err, "API v4")
}

func TestResolveCommunityTargetKeys(t *testing.T) {
	t.Parallel()

	resolved, err := ResolveTargetKey("lemmy", "lemmy", "", map[string]interface{}{"community": "https://remote.example/c/selfhosted"})
	require.NoError(t, err)
	require.Equal(t, "lemmy:community:remote.example:selfhosted", resolved)

	_, err = ResolveTargetKey("lemmy", "lemmy", "lemmy:community:other.example:selfhosted", map[string]interface{}{"community": "https://remote.example/c/selfhosted"})
	require.ErrorContains(t, err, "does not match")

	resolved, err = ResolveTargetKey("peertube", "peertube", "", map[string]interface{}{"channel": "demos"})
	require.NoError(t, err)
	require.Equal(t, "peertube:channel:demos", resolved)

	contract := PublishingTargetContract("lemmy")
	require.Equal(t, "community", contract.Subdestination)
	contract = PublishingTargetContract("peertube")
	require.Equal(t, "channel", contract.Subdestination)
	contract = PublishingTargetContract("piefed")
	require.Equal(t, "community", contract.Subdestination)
}
