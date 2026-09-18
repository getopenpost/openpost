package platform

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakePeerTube struct {
	t           *testing.T
	uploaded    []byte
	videoState  int
	videoSeen   int
	chunks      int
	thumbnail   bool
	captionLang string
	threadCount string
	threadTrees int
}

func newFakePeerTube(t *testing.T) (*httptest.Server, *fakePeerTube) {
	fake := &fakePeerTube{t: t, videoState: 2}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/oauth-clients/local", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"client_id":"cid","client_secret":"csec"}`))
	})
	mux.HandleFunc("/api/v1/users/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("client_id") != "cid" {
			http.Error(w, "bad client", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"atok","refresh_token":"rtok","expires_in":14399,"token_type":"Bearer"}`))
	})
	mux.HandleFunc("/api/v1/users/me", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":42,"username":"rodrigo","account":{"name":"rodrigo","displayName":"Rodrigo"}}`))
	})
	mux.HandleFunc("/api/v1/accounts/rodrigo/video-channels", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":3,"name":"demos","displayName":"Demos"}]}`))
	})
	mux.HandleFunc("/api/v1/video-channels/demos", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":3,"name":"demos","displayName":"Demos","followersCount":12}`))
	})
	mux.HandleFunc("/api/v1/videos/upload-resumable", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var metadata map[string]any
			if err := json.NewDecoder(r.Body).Decode(&metadata); err != nil {
				http.Error(w, "bad metadata", http.StatusBadRequest)
				return
			}
			if metadata["name"] != "Launch demo" || metadata["channelId"] != float64(3) {
				http.Error(w, "unexpected metadata", http.StatusBadRequest)
				return
			}
			w.Header().Set("Location", "/api/v1/videos/upload-resumable?upload_id=abc")
			w.WriteHeader(http.StatusCreated)
			return
		}
		if r.Method == http.MethodPut {
			chunk, _ := io.ReadAll(r.Body)
			fake.uploaded = append(fake.uploaded, chunk...)
			fake.chunks++
			contentRange := r.Header.Get("Content-Range")
			total := int64(0)
			if parts := strings.Split(strings.TrimPrefix(contentRange, "bytes "), "/"); len(parts) == 2 {
				total, _ = strconv.ParseInt(parts[1], 10, 64)
			}
			if int64(len(fake.uploaded)) < total {
				w.Header().Set("Range", "bytes=0-"+strconv.Itoa(len(fake.uploaded)-1))
				w.WriteHeader(308)
				return
			}
			_, _ = w.Write([]byte(`{"video":{"uuid":"video-uuid-1","id":99}}`))
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			fake.thumbnail = true
			w.WriteHeader(http.StatusNoContent)
			return
		}
		fake.videoSeen++
		_, _ = w.Write([]byte(`{"id":99,"uuid":"video-uuid-1","shortUUID":"short1","name":"Launch demo","state":{"id":` + strconv.Itoa(fake.videoState) + `,"label":"` + map[int]string{1: "Published", 2: "To transcode"}[fake.videoState] + `"},"views":50,"likes":4,"dislikes":1}`))
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/captions", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "bad captions", http.StatusBadRequest)
			return
		}
		fake.captionLang = r.FormValue("language")
		_, _ = w.Write([]byte(`{}`))
	})
	// The thread list carries plain comments; replies come from the
	// per-thread tree endpoint.
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comment-threads", func(w http.ResponseWriter, r *http.Request) {
		fake.threadCount = r.URL.Query().Get("count")
		_, _ = w.Write([]byte(`{"total":2,"totalNotDeletedComments":2,"data":[{"id":11,"url":"https://example/c/11","text":"<p>Great demo</p>","threadId":11,"inReplyToCommentId":null,"createdAt":"2026-09-01T10:00:00Z","updatedAt":"2026-09-01T10:00:00Z","isDeleted":false,"totalReplies":1,"account":{"name":"viewer","displayName":"Viewer"}},{"id":14,"url":"https://example/c/14","text":"<p>No replies here</p>","threadId":14,"inReplyToCommentId":null,"createdAt":"2026-09-01T11:00:00Z","updatedAt":"2026-09-01T11:00:00Z","isDeleted":false,"totalReplies":0,"account":{"name":"other","displayName":"Other"}}]}`))
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comment-threads/11", func(w http.ResponseWriter, _ *http.Request) {
		fake.threadTrees++
		_, _ = w.Write([]byte(`{"comment":{"id":11,"url":"https://example/c/11","text":"<p>Great demo</p>","threadId":11,"inReplyToCommentId":null,"createdAt":"2026-09-01T10:00:00Z","updatedAt":"2026-09-01T10:00:00Z","isDeleted":false,"totalReplies":1,"account":{"name":"viewer","displayName":"Viewer"}},"children":[{"comment":{"id":13,"url":"https://example/c/13","text":"<p>Thank you</p>","threadId":11,"inReplyToCommentId":11,"createdAt":"2026-09-01T10:30:00Z","updatedAt":"2026-09-01T10:30:00Z","isDeleted":false,"totalReplies":0,"account":{"name":"rodrigo","displayName":"Rodrigo"}},"children":[],"totalChildren":0}],"totalChildren":1}`))
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comment-threads/14", func(w http.ResponseWriter, _ *http.Request) {
		fake.threadTrees++
		http.Error(w, "threads without replies need no tree request", http.StatusTeapot)
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comments/11", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"comment":{"id":12}}`))
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comments/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	return httptest.NewServer(mux), fake
}

func TestPeerTubeLoginAndChannelSelection(t *testing.T) {
	server, _ := newFakePeerTube(t)
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	token, profile, err := adapter.Login(t.Context(), "rodrigo", "secret")
	require.NoError(t, err)
	require.Equal(t, "atok", token.AccessToken)
	require.Equal(t, "rtok", token.RefreshToken)
	require.Equal(t, "rodrigo", profile.Username)

	options, err := adapter.ListAccountSelections(t.Context(), token)
	require.NoError(t, err)
	require.Len(t, options, 1)
	require.Equal(t, "demos", options[0].ID)
	require.Equal(t, "channel", options[0].Kind)

	selected, err := adapter.SelectAccount(t.Context(), token, "demos")
	require.NoError(t, err)
	require.Equal(t, "demos", selected.AccountID)
	require.Equal(t, server.URL, selected.InstanceURL)
}

func TestPeerTubeResumableUploadAndPublish(t *testing.T) {
	server, fake := newFakePeerTube(t)
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	media := bytes.Repeat([]byte("v"), 9*1024*1024)
	uuid, err := adapter.UploadMediaWithMetadata(t.Context(), "atok", "demos", UploadMediaRequest{
		MimeType: "video/mp4",
		Filename: "demo.mp4",
		Size:     int64(len(media)),
		Title:    "Launch demo",
		Settings: map[string]interface{}{
			"privacy":  "public",
			"language": "en",
			"tags":     "demo, launch",
		},
		Reader:            bytes.NewReader(media),
		ThumbnailReader:   bytes.NewReader([]byte("jpeg-bytes")),
		CaptionReader:     bytes.NewReader([]byte("WEBVTT")),
		ThumbnailFilename: "thumb.jpg",
		CaptionFilename:   "captions.vtt",
		ThumbnailMimeType: "image/jpeg",
		CaptionMimeType:   "text/vtt",
	})
	require.NoError(t, err)
	require.Equal(t, "video-uuid-1", uuid)
	require.Len(t, fake.uploaded, len(media), "all bytes must reach the server")
	require.GreaterOrEqual(t, fake.chunks, 2, "large files must upload in chunks")
	require.True(t, fake.thumbnail, "thumbnail must be applied after upload")
	require.Equal(t, "en", fake.captionLang)

	// Still transcoding: pending with reconcile-only safety, never a re-upload.
	// The durable write fence turns the pending result into a scheduled
	// reconcile; Publish itself reports no terminal error.
	result, err := adapter.Publish(t.Context(), "atok", "demos", &PublishRequest{
		PlatformMediaIDs: []string{uuid},
		Settings:         map[string]interface{}{"channel": "demos"},
	})
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionPending, result.SubmissionState)
	require.Equal(t, PublishRetryReconcileOnly, result.RetrySafety)
	require.Equal(t, uuid, result.ProviderReference)

	fake.videoState = 1
	reconciled, err := adapter.ReconcilePublish(t.Context(), "atok", "demos", uuid)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionAccepted, reconciled.SubmissionState)
	require.Equal(t, "video-uuid-1", reconciled.ExternalID)
	require.Equal(t, server.URL+"/w/short1", reconciled.ExternalURL)
}

func TestPeerTubeRequiresTitleAndChannel(t *testing.T) {
	adapter := NewPeerTubeAdapter("https://tube.example")
	_, err := adapter.UploadMediaWithMetadata(t.Context(), "atok", "", UploadMediaRequest{
		MimeType: "video/mp4", Reader: bytes.NewReader([]byte("x")),
		Settings: map[string]interface{}{},
	})
	require.ErrorContains(t, err, "channel")
}

func TestPeerTubeComments(t *testing.T) {
	server, fake := newFakePeerTube(t)
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	comments, err := adapter.ListComments(t.Context(), "atok", "demos", "video-uuid-1")
	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	thread := byID["peertube:video-uuid-1:11"]
	require.Equal(t, "Great demo", thread.Text)
	require.Equal(t, "Viewer", thread.AuthorName)
	require.Empty(t, thread.ParentID)
	require.True(t, thread.CanReply)
	require.True(t, thread.CanDelete)
	require.False(t, thread.IsOurs)

	reply := byID["peertube:video-uuid-1:13"]
	require.Equal(t, "Thank you", reply.Text)
	require.Equal(t, thread.ID, reply.ParentID)
	require.True(t, reply.IsOurs)

	require.Equal(t, "No replies here", byID["peertube:video-uuid-1:14"].Text)
	require.Len(t, comments, 3)
	require.Equal(t, "100", fake.threadCount, "threads must be requested in the largest page")
	require.Equal(t, 1, fake.threadTrees, "only threads with replies need their tree")

	replyID, err := adapter.ReplyToComment(t.Context(), "atok", "demos", thread.ID, "Thanks!")
	require.NoError(t, err)
	require.Equal(t, "peertube:video-uuid-1:12", replyID)
	require.NoError(t, adapter.DeleteComment(t.Context(), "atok", "demos", replyID))
}

func TestPeerTubeCommentsFetchesTruncatedReplies(t *testing.T) {
	mux := http.NewServeMux()
	var replyStarts []string
	var replyRequests []string
	commentID := func(id int64) *int64 { return &id }

	comment := func(id int64, parent *int64, children []peertubeCommentNode, totalChildren int64) peertubeCommentNode {
		return peertubeCommentNode{
			Comment: peertubeComment{
				ID: id, Text: "Comment " + strconv.FormatInt(id, 10), ThreadID: 11,
				InReplyToCommentID: parent,
				Account:            peertubeAccount{Name: "viewer", DisplayName: "Viewer"},
			},
			Children:      children,
			TotalChildren: totalChildren,
		}
	}
	root := comment(11, nil, nil, 12)
	deep := comment(16, commentID(15), nil, 1)
	deepChain := comment(12, commentID(11), []peertubeCommentNode{
		comment(13, commentID(12), []peertubeCommentNode{
			comment(14, commentID(13), []peertubeCommentNode{
				comment(15, commentID(14), []peertubeCommentNode{deep}, 1),
			}, 1),
		}, 1),
	}, 1)
	root.Children = []peertubeCommentNode{deepChain}

	mux.HandleFunc("/api/v1/videos/video-uuid-1/comment-threads", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"total":1,"data":[{"id":11,"text":"Comment 11","threadId":11,"totalReplies":12,"account":{"name":"viewer","displayName":"Viewer"}}]}`))
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comment-threads/11", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(root)
	})
	mux.HandleFunc("/api/v1/videos/video-uuid-1/comments/", func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/api/v1/videos/video-uuid-1/comments/"
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, prefix), "/")
		if len(parts) != 2 || parts[1] != "replies" {
			http.NotFound(w, r)
			return
		}
		replyRequests = append(replyRequests, parts[0])
		start := r.URL.Query().Get("start")
		replyStarts = append(replyStarts, start)
		switch parts[0] {
		case "11":
			children := make([]peertubeCommentNode, 0, 10)
			switch start {
			case "1":
				for id := int64(20); id < 30; id++ {
					children = append(children, comment(id, commentID(11), nil, 0))
				}
			case "11":
				children = append(children, comment(30, commentID(11), nil, 0))
			default:
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(struct {
				Total int64                 `json:"total"`
				Data  []peertubeCommentNode `json:"data"`
			}{Total: 12, Data: children})
		case "16":
			_ = json.NewEncoder(w).Encode(struct {
				Total int64                 `json:"total"`
				Data  []peertubeCommentNode `json:"data"`
			}{Total: 1, Data: []peertubeCommentNode{comment(17, commentID(16), nil, 0)}})
		default:
			http.NotFound(w, r)
		}
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	comments, err := NewPeerTubeAdapter(server.URL).ListComments(t.Context(), "token", "channel", "video-uuid-1")
	require.NoError(t, err)
	require.Len(t, comments, 18)
	require.Equal(t, []string{"11", "11", "16"}, replyRequests)
	require.Equal(t, []string{"1", "11", "0"}, replyStarts)
	require.Equal(t, "peertube:video-uuid-1:11", comments[len(comments)-1].ParentID)
	byID := map[string]Comment{}
	for _, item := range comments {
		byID[item.ID] = item
	}
	require.Equal(t, "peertube:video-uuid-1:16", byID["peertube:video-uuid-1:17"].ParentID)
}

func TestPeerTubeCategoryAndLicencePickers(t *testing.T) {
	// GET /api/v1/videos/categories and /licences answer with a plain
	// id-to-label object, not a paginated {"data":[...]} envelope.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/videos/categories":
			_, _ = w.Write([]byte(`{"1":"Music","2":"Films","7":"Gaming","15":"Science & Technology"}`))
		case "/api/v1/videos/licences":
			_, _ = w.Write([]byte(`{"1":"Attribution","7":"Public Domain Dedication"}`))
		default:
			http.Error(w, "unexpected path", http.StatusNotFound)
		}
	}))
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	categories, err := adapter.SearchPublishingOptions(t.Context(), "atok", PublishingOptionsInput{Source: "peertube_categories"})
	require.NoError(t, err)
	require.Equal(t, []DestinationOption{
		{Value: "1", Label: "Music"},
		{Value: "2", Label: "Films"},
		{Value: "7", Label: "Gaming"},
		{Value: "15", Label: "Science & Technology"},
	}, categories.Options, "categories are listed by id so the picker order is stable")

	filtered, err := adapter.SearchPublishingOptions(t.Context(), "atok", PublishingOptionsInput{Source: "peertube_categories", Search: "gam"})
	require.NoError(t, err)
	require.Equal(t, []DestinationOption{{Value: "7", Label: "Gaming"}}, filtered.Options)

	licences, err := adapter.SearchPublishingOptions(t.Context(), "atok", PublishingOptionsInput{Source: "peertube_licences"})
	require.NoError(t, err)
	require.Equal(t, []DestinationOption{
		{Value: "1", Label: "Attribution"},
		{Value: "7", Label: "Public Domain Dedication"},
	}, licences.Options)
}

func TestPeerTubeCatalogDecodeFailureIsReported(t *testing.T) {
	// A catalog that is not an id-to-label object is an error, not an
	// empty picker.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`["Music","Films"]`))
	}))
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	_, err := adapter.SearchPublishingOptions(t.Context(), "atok", PublishingOptionsInput{Source: "peertube_categories"})
	require.ErrorContains(t, err, "decoding peertube categories")
}

func TestPeerTubeCatalogNullIsReported(t *testing.T) {
	// A JSON null body decodes without error but leaves the catalog nil;
	// it is a malformed catalog, not an empty picker.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`null`))
	}))
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	_, err := adapter.SearchPublishingOptions(t.Context(), "atok", PublishingOptionsInput{Source: "peertube_licences"})
	require.ErrorContains(t, err, "decoding peertube licences")
}

func TestPeerTubeCatalogNonnumericIDIsReported(t *testing.T) {
	// Catalog keys are numeric ids. A nonnumeric key must not silently
	// become id 0, which the upload builder treats as unset.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"1":"Music","invalid":"Gaming"}`))
	}))
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	_, err := adapter.SearchPublishingOptions(t.Context(), "atok", PublishingOptionsInput{Source: "peertube_categories"})
	require.ErrorContains(t, err, `invalid catalog id "invalid"`)
}

func TestPeerTubeAnalytics(t *testing.T) {
	server, _ := newFakePeerTube(t)
	defer server.Close()

	adapter := NewPeerTubeAdapter(server.URL)
	account, err := adapter.FetchAccountAnalytics(t.Context(), "atok", AccountAnalyticsRequest{AccountID: "demos"})
	require.NoError(t, err)
	require.Equal(t, int64(12), account[MetricFollowers])

	content, err := adapter.FetchContentAnalytics(t.Context(), "atok", ContentAnalyticsRequest{ExternalIDs: []string{"video-uuid-1"}})
	require.NoError(t, err)
	require.Equal(t, int64(50), content[MetricViews])
	require.Equal(t, int64(4), content[MetricLikes])
	_, hasDislikes := content["dislikes"]
	require.False(t, hasDislikes, "dislikes must not be relabelled")
}

func TestPeerTubeValidation(t *testing.T) {
	issues := validatePeerTubeMedia([]MediaItem{{ID: "m1", MimeType: "image/jpeg"}})
	require.Len(t, issues, 1)
	require.Equal(t, "error", issues[0].Severity)

	adapter := NewPeerTubeAdapter("https://tube.example")
	require.Error(t, adapter.ValidatePublishingTarget(t.Context(), "tok", "", map[string]interface{}{}))
	require.NoError(t, adapter.ValidatePublishingTarget(t.Context(), "tok", "demos", map[string]interface{}{}))
}
