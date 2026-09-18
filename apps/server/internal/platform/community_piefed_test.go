package platform

import (
	"encoding/json"
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
	meta := `{"community":{"id":9,"name":"piefed_meta","title":"PieFed Meta","actor_id":"https://piefed.social/c/piefed_meta"}}`
	technology := `{"community":{"id":10,"name":"technology","title":"Technology","actor_id":"https://piefed.social/c/technology"}}`
	// ListCommunitiesRequest has no search field and excludes unknown
	// fields, so the community list is never filtered by a query.
	mux.HandleFunc("/api/alpha/community/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"communities":[` + technology + `,` + meta + `],"next_page":"2"}`))
	})
	// SearchRequest requires q and type_; Communities matches q against the
	// community title and actor ID.
	mux.HandleFunc("/api/alpha/search", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if !query.Has("q") || query.Get("type_") == "" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"code":422,"errors":{"query":{"q":["Missing data for required field."]}},"status":"Unprocessable Entity"}`))
			return
		}
		communities := []string{}
		if query.Get("type_") == "Communities" {
			for _, community := range []struct{ match, view string }{
				{"technology https://piefed.social/c/technology", technology},
				{"piefed meta https://piefed.social/c/piefed_meta", meta},
			} {
				if strings.Contains(community.match, strings.ToLower(query.Get("q"))) {
					communities = append(communities, community.view)
				}
			}
		}
		_, _ = w.Write([]byte(`{"type_":"` + query.Get("type_") + `","communities":[` + strings.Join(communities, ",") + `],"posts":[],"users":[],"comments":[]}`))
	})
	mux.HandleFunc("/api/alpha/post", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"post_view":{"post":{"id":200,"title":"Hello PieFed","body":"Body","ap_id":"https://piefed.social/post/200"}}}`))
			return
		}
		// GetPostRequest requires id and excludes unknown fields.
		if r.URL.Query().Get("id") == "" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"code":422,"errors":{"query":{"id":["Missing data for required field."]}},"status":"Unprocessable Entity"}`))
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
	// DeleteCommentRequest requires both comment_id and deleted.
	mux.HandleFunc("/api/alpha/comment/delete", func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request["comment_id"] == nil || request["deleted"] == nil {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"code":422,"errors":{"json":{"deleted":["Missing data for required field."]}},"status":"Unprocessable Entity"}`))
			return
		}
		_, _ = w.Write([]byte(`{"comment_view":{}}`))
	})
	// ImageUploadRequest requires the multipart part to be named file.
	mux.HandleFunc("/api/alpha/upload/image", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "bad upload", http.StatusBadRequest)
			return
		}
		if _, _, err := r.FormFile("file"); err != nil {
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

func TestPieFedCommentsIncludeNestedReplies(t *testing.T) {
	// /post/replies lists top-level comments only; each reply is nested under
	// the comment it answers.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comments":[` +
			`{"comment":{"id":21,"post_id":200,"body":"Nice","published":"2026-09-01T10:00:00.000000Z","ap_id":"https://piefed.social/comment/21","path":"0.21","deleted":false,"removed":false},"creator":{"id":8,"user_name":"viewer"},"replies":[` +
			`{"comment":{"id":22,"post_id":200,"body":"Thanks","published":"2026-09-01T11:00:00.000000Z","ap_id":"https://home.example/comment/22","path":"0.21.22","deleted":false,"removed":false},"creator":{"id":6,"user_name":"rodrigo"},"replies":[` +
			`{"comment":{"id":23,"post_id":200,"body":"Any time","published":"2026-09-01T12:00:00.000000Z","ap_id":"https://piefed.social/comment/23","path":"0.21.22.23","deleted":false,"removed":false},"creator":{"id":8,"user_name":"viewer"},"replies":[]}]}]},` +
			`{"comment":{"id":24,"post_id":200,"body":"Bookmarked","published":"2026-09-01T13:00:00.000000Z","ap_id":"https://piefed.social/comment/24","path":"0.24","deleted":false,"removed":false},"creator":{"id":9,"user_name":"reader"},"replies":[]}` +
			`],"next_page":null}`))
	}))
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "piefed-jwt", "6", "200")
	require.NoError(t, err)
	ids := make([]string, 0, len(comments))
	parents := make([]string, 0, len(comments))
	for _, comment := range comments {
		ids = append(ids, comment.ID)
		parents = append(parents, comment.ParentID)
	}
	require.Equal(t, []string{"piefed:200:21", "piefed:200:22", "piefed:200:23", "piefed:200:24"}, ids)
	require.Equal(t, []string{"", "piefed:200:21", "piefed:200:22", ""}, parents)
	require.True(t, comments[1].IsOurs)
	require.Equal(t, "Any time", comments[2].Text)
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

func TestPieFedDeleteReplyMarksItDeleted(t *testing.T) {
	var path string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&payload)
		_, _ = w.Write([]byte(`{"comment_view":{}}`))
	}))
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	require.NoError(t, adapter.DeleteComment(t.Context(), "piefed-jwt", "6", "piefed:200:22"))
	require.Equal(t, "/api/alpha/comment/delete", path)
	// deleted false would restore the reply instead.
	require.Equal(t, map[string]any{"comment_id": float64(22), "deleted": true}, payload)
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

func TestPieFedCommentsReadTheAccountVote(t *testing.T) {
	// Every PieFed comment view carries my_vote for the authenticated
	// account: 1 for an upvote, -1 for a downvote, 0 for no vote.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comments":[` +
			`{"comment":{"id":21,"post_id":200,"body":"Nice","published":"2026-09-01T10:00:00.000000Z","ap_id":"https://piefed.social/comment/21","path":"0.21","deleted":false,"removed":false},"creator":{"id":8,"user_name":"viewer"},"counts":{"upvotes":3},"my_vote":0,"replies":[]},` +
			`{"comment":{"id":22,"post_id":200,"body":"Agreed","published":"2026-09-01T11:00:00.000000Z","ap_id":"https://piefed.social/comment/22","path":"0.22","deleted":false,"removed":false},"creator":{"id":9,"user_name":"reader"},"counts":{"upvotes":1},"my_vote":1,"replies":[]},` +
			`{"comment":{"id":23,"post_id":200,"body":"Off topic","published":"2026-09-01T12:00:00.000000Z","ap_id":"https://piefed.social/comment/23","path":"0.23","deleted":false,"removed":false},"creator":{"id":10,"user_name":"stranger"},"counts":{"upvotes":0},"my_vote":-1,"replies":[]}` +
			`],"next_page":null}`))
	}))
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "piefed-jwt", "6", "200")
	require.NoError(t, err)
	require.Len(t, comments, 3)
	for _, comment := range comments {
		require.True(t, comment.LikeStateKnown, "piefed reports the account vote on every reply")
	}
	// The author's own upvote is counted in upvotes, so only my_vote says
	// whether the connected account liked the reply.
	require.False(t, comments[0].Liked)
	require.True(t, comments[0].CanLike)
	require.False(t, comments[0].CanUnlike)

	require.True(t, comments[1].Liked)
	require.False(t, comments[1].CanLike)
	require.True(t, comments[1].CanUnlike)

	// A downvote is not a like; liking it again is still offered.
	require.False(t, comments[2].Liked)
	require.True(t, comments[2].CanLike)
	require.False(t, comments[2].CanUnlike)
}

func TestPieFedCommentsMissingVoteStaysUnknown(t *testing.T) {
	// A reply without my_vote carries no vote information. It must not be
	// reported as a known no-vote, or stored like state would be clobbered.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comments":[` +
			`{"comment":{"id":21,"post_id":200,"body":"Nice","published":"2026-09-01T10:00:00.000000Z","ap_id":"https://piefed.social/comment/21","path":"0.21","deleted":false,"removed":false},"creator":{"id":8,"user_name":"viewer"},"replies":[]}` +
			`],"next_page":null}`))
	}))
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "piefed-jwt", "6", "200")
	require.NoError(t, err)
	require.Len(t, comments, 1)
	require.False(t, comments[0].LikeStateKnown)
	require.False(t, comments[0].Liked)
	require.True(t, comments[0].CanLike)
	require.True(t, comments[0].CanUnlike)
}

func TestPieFedCommentsSkipRemovedReplies(t *testing.T) {
	// PieFed blanks the body of a deleted reply. It reports deleted when the
	// author deleted it and removed (with deleted false) when a moderator did.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"comments":[` +
			`{"comment":{"id":21,"post_id":200,"body":"Nice","published":"2026-09-01T10:00:00.000000Z","ap_id":"https://piefed.social/comment/21","path":"0.21","deleted":false,"removed":false},"creator":{"id":8,"user_name":"viewer"},"replies":[]},` +
			`{"comment":{"id":25,"post_id":200,"body":"","published":"2026-09-01T11:00:00.000000Z","ap_id":"https://piefed.social/comment/25","path":"0.25","deleted":false,"removed":true},"creator":{"id":9,"user_name":"spammer"},"replies":[]},` +
			`{"comment":{"id":26,"post_id":200,"body":"","published":"2026-09-01T12:00:00.000000Z","ap_id":"https://piefed.social/comment/26","path":"0.26","deleted":true,"removed":false},"creator":{"id":10,"user_name":"reader"},"replies":[]}` +
			`],"next_page":null}`))
	}))
	defer server.Close()

	adapter := NewPieFedAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "piefed-jwt", "6", "200")
	require.NoError(t, err)
	ids := make([]string, 0, len(comments))
	for _, comment := range comments {
		ids = append(ids, comment.ID)
	}
	require.Equal(t, []string{"piefed:200:21"}, ids)
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
