package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	communicationsservice "github.com/openpost/backend/internal/services/communications"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestListRenditionCommentsReturnsUnsupportedProvider(t *testing.T) {
	srv := newCommentsTestServer(t, nil)

	resp := srv.request(t, http.MethodGet, "/api/v1/renditions/rendition-1/comments", nil)

	require.Equal(t, http.StatusNotImplemented, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "comments are not supported for x")
}

func TestReplyToCommentReturnsUnsupportedProvider(t *testing.T) {
	srv := newCommentsTestServer(t, nil)
	commentID, err := encodeCommentReference(commentReference{RenditionID: "rendition-1", ProviderCommentID: "provider-comment-1"})
	require.NoError(t, err)

	resp := srv.request(t, http.MethodPost, "/api/v1/comments/"+commentID+"/reply", map[string]string{"body": "Thanks"})

	require.Equal(t, http.StatusNotImplemented, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "comments are not supported for x")
}

func TestHideAndDeleteCommentReturnUnsupportedProvider(t *testing.T) {
	srv := newCommentsTestServer(t, nil)
	commentID, err := encodeCommentReference(commentReference{RenditionID: "rendition-1", ProviderCommentID: "provider-comment-1"})
	require.NoError(t, err)

	hideResp := srv.request(t, http.MethodPost, "/api/v1/comments/"+commentID+"/hide", nil)
	require.Equal(t, http.StatusNotImplemented, hideResp.Code, hideResp.Body.String())

	deleteResp := srv.request(t, http.MethodDelete, "/api/v1/comments/"+commentID, nil)
	require.Equal(t, http.StatusNotImplemented, deleteResp.Code, deleteResp.Body.String())
}

func TestViewerCannotModerateComments(t *testing.T) {
	srv := newCommentsTestServer(t, map[string]platform.Adapter{"x": fakeCommentAdapter{}})
	_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").
		Exec(context.Background())
	require.NoError(t, err)
	commentID, err := encodeCommentReference(commentReference{RenditionID: "rendition-1", ProviderCommentID: "provider-comment-1"})
	require.NoError(t, err)

	resp := srv.request(t, http.MethodPost, "/api/v1/comments/"+commentID+"/hide", nil)

	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "workspace editor role required")
}

func TestListRenditionCommentsEncodesProviderCommentIDs(t *testing.T) {
	srv := newCommentsTestServer(t, map[string]platform.Adapter{
		"x": fakeCommentAdapter{comments: []platform.Comment{{
			ID:        "provider-comment-1",
			AuthorID:  "author-1",
			Text:      "Nice launch",
			CanReply:  true,
			CanHide:   true,
			CanDelete: true,
		}}},
	})

	resp := srv.request(t, http.MethodGet, "/api/v1/renditions/rendition-1/comments", nil)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out CommentListResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out.Comments, 1)
	require.Equal(t, "provider-comment-1", out.Comments[0].ProviderCommentID)
	require.NotEqual(t, "provider-comment-1", out.Comments[0].ID)
	decoded, err := decodeCommentReference(out.Comments[0].ID)
	require.NoError(t, err)
	require.Equal(t, "rendition-1", decoded.RenditionID)
	require.Equal(t, "provider-comment-1", decoded.ProviderCommentID)
}

func TestReplyToCommentRecordsLifecycleEvent(t *testing.T) {
	srv := newCommentsTestServer(t, map[string]platform.Adapter{"x": fakeCommentAdapter{}})
	commentID, err := encodeCommentReference(commentReference{RenditionID: "rendition-1", ProviderCommentID: "provider-comment-1"})
	require.NoError(t, err)

	resp := srv.request(t, http.MethodPost, "/api/v1/comments/"+commentID+"/reply", map[string]string{"body": "Thanks"})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var queued struct {
		Message string `json:"message"`
		ID      string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &queued))
	require.Equal(t, "comment reply queued", queued.Message)
	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("id = ?", queued.ID).Scan(t.Context()))
	require.Equal(t, communicationsservice.JobTypeEngagementAct, job.Type)
	require.Equal(t, 1, job.MaxAttempts)
	require.NoError(t, srv.runQueuedCommentJob(t))
	events := srv.lifecycleEvents(t)
	require.Len(t, events, 1)
	require.Equal(t, lifecycle.EventCommentActionSucceeded, events[0].Type)
	require.Equal(t, lifecycle.StatusSucceeded, events[0].Status)
	require.Equal(t, "rendition-1", events[0].RenditionID)
	require.Contains(t, events[0].MetadataJSON, "reply")
}

func TestHideCommentProviderFailureRecordsLifecycleEvent(t *testing.T) {
	srv := newCommentsTestServer(t, map[string]platform.Adapter{
		"x": fakeCommentAdapter{hideErr: errors.New("provider moderation failed")},
	})
	commentID, err := encodeCommentReference(commentReference{RenditionID: "rendition-1", ProviderCommentID: "provider-comment-1"})
	require.NoError(t, err)

	resp := srv.request(t, http.MethodPost, "/api/v1/comments/"+commentID+"/hide", nil)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Error(t, srv.runQueuedCommentJob(t))
	events := srv.lifecycleEvents(t)
	require.Len(t, events, 1)
	require.Equal(t, lifecycle.EventModerationActionFailed, events[0].Type)
	require.Equal(t, lifecycle.StatusFailed, events[0].Status)
	require.Contains(t, events[0].MetadataJSON, "ambiguous_provider_write")
	require.NotContains(t, events[0].MetadataJSON, "provider moderation failed")
}

type commentsTestServer struct {
	echo      *echo.Echo
	db        *bun.DB
	providers map[string]platform.Adapter
}

func newCommentsTestServer(t *testing.T, providers map[string]platform.Adapter) *commentsTestServer {
	t.Helper()

	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.ProviderWriteAttempt)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Comments"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	encryptor := servicecrypto.NewTokenEncryptor("test-comment-key")
	token, err := encryptor.Encrypt("token")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "account-1", WorkspaceID: "ws-1", Slug: "x", Platform: "x", AccountID: "acct-1", AccessTokenEnc: token, IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch", ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText, Body: "Launch", Status: models.RenditionStatusPublished, ExternalID: "external-1"}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewCommentHandler(db, testAuthenticator{}, providers, encryptor).RegisterRoutes(api)
	return &commentsTestServer{echo: e, db: db, providers: providers}
}

func (s *commentsTestServer) request(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *commentsTestServer) lifecycleEvents(t *testing.T) []models.PublicationLifecycleEvent {
	t.Helper()
	var events []models.PublicationLifecycleEvent
	require.NoError(t, s.db.NewSelect().Model(&events).Order("created_at ASC").Scan(context.Background()))
	return events
}

func (s *commentsTestServer) runQueuedCommentJob(t *testing.T) error {
	t.Helper()
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).
		Where("type = ?", communicationsservice.JobTypeEngagementAct).
		Order("created_at DESC").Limit(1).Scan(t.Context()))
	service := communicationsservice.NewService(s.db, commentsTokenSource{}, nil)
	for name, adapter := range s.providers {
		service.SetProvider(name, adapter)
	}
	ctx := providerwrite.WithJobExecution(t.Context(), job.ID, 1, time.Now().UTC())
	return service.HandleJob(ctx, job.Type, job.Payload)
}

type commentsTokenSource struct{}

func (commentsTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type fakeCommentAdapter struct {
	comments []platform.Comment
	hideErr  error
}

func (f fakeCommentAdapter) GenerateAuthURL(string) (string, map[string]string) { return "", nil }
func (f fakeCommentAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}
func (f fakeCommentAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}
func (f fakeCommentAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}
func (f fakeCommentAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}
func (f fakeCommentAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}
func (f fakeCommentAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}
func (f fakeCommentAdapter) ListComments(context.Context, string, string, string) ([]platform.Comment, error) {
	return f.comments, nil
}
func (f fakeCommentAdapter) ReplyToComment(context.Context, string, string, string, string) (string, error) {
	return "reply-1", nil
}
func (f fakeCommentAdapter) HideComment(context.Context, string, string, string) error {
	return f.hideErr
}
func (f fakeCommentAdapter) DeleteComment(context.Context, string, string, string) error {
	return nil
}
