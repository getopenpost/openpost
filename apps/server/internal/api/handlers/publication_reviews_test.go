package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
)

type reviewClientAuthenticator struct{}

func (reviewClientAuthenticator) AuthenticateBearer(context.Context, string) (*middleware.Principal, error) {
	return &middleware.Principal{UserID: "client-1"}, nil
}

func TestClientApprovalRejectsChangedInheritedMediaText(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	h := srv.handler.publicationHandler()
	_, err := srv.db.NewCreateTable().Model((*models.PublicationReview)(nil)).Exec(ctx)
	require.NoError(t, err)
	media := models.MediaAttachment{ID: "review-media", WorkspaceID: "ws-1", FilePath: "review.jpg", MimeType: "image/jpeg", Size: 100, Width: 640, Height: 480, AltText: "The approved screenshot", ProcessingStatus: "ready"}
	_, err = srv.db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)
	at := time.Now().UTC().Add(time.Hour)
	post, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "A screenshot of the release", SocialAccountIDs: []string{"account-1"}, Media: []PublicationMediaInput{{MediaID: media.ID, Role: "attachment"}}, ScheduledAt: &at})
	require.NoError(t, err)
	// Legacy and inherited media may intentionally leave relation alt text empty.
	_, err = srv.db.NewUpdate().Model((*models.RenditionSegmentMedia)(nil)).Set("alt_text = ''").Where("media_id = ?", media.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.RenditionMedia)(nil)).Set("alt_text = ''").Where("media_id = ?", media.ID).Exec(ctx)
	require.NoError(t, err)
	hashes, err := publicationauth.ReviewFingerprints(ctx, srv.db, post.ID)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "client-1", Role: models.WorkspaceRoleClient, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PublicationReview{ID: "media-review", PublicationID: post.ID, WorkspaceID: "ws-1", ReviewerID: "client-1", Epoch: 1, Decision: "approved", FingerprintsJSON: hashes, SnapshotJSON: "{}", CreatedAt: time.Now()}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).Set("review_id = ?", "media-review").Set("review_epoch = 1").Set("review_state = 'approved'").Where("id = ?", post.ID).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, publicationauth.RequireReview(ctx, srv.db, post.ID))
	_, err = srv.db.NewUpdate().Model(&media).Set("alt_text = ?", "An unreviewed claim").WherePK().Exec(ctx)
	require.NoError(t, err)
	_, err = h.publicationApplication().Schedule(ctx, "user-1", post.ID, post.Revision, providerreadiness.ExecutionIntentProduction)
	require.ErrorIs(t, err, publicationauth.ErrReviewRequired)
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", post.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestWorkspaceClientReviewRequirementBlocksUnsubmittedPosts(t *testing.T) {
	t.Setenv("OPENPOST_CLIENT_REVIEWS_ENABLED", "true")
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewCreateTable().Model((*models.PublicationReview)(nil)).Exec(ctx)
	require.NoError(t, err)
	h := srv.handler.publicationHandler()
	h.auth = testAuthenticator{}
	apiServer := echo.New()
	api := humaecho.NewV4WithGroup(apiServer, apiServer.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h.RegisterRoutes(api)
	at := time.Now().UTC().Add(2 * time.Hour)
	post, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "An automation's draft", SocialAccountIDs: []string{"account-1"}, ScheduledAt: &at})
	require.NoError(t, err)
	require.NoError(t, publicationauth.RequireUnreviewedRepost(ctx, srv.db, post.ID), "per-post review stays opt-in by default")

	_, err = srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("require_client_review = ?", true).Where("id = ?", "ws-1").Exec(ctx)
	require.NoError(t, err)
	_, err = h.publicationApplication().Schedule(ctx, "user-1", post.ID, post.Revision, providerreadiness.ExecutionIntentProduction)
	require.ErrorIs(t, err, publicationauth.ErrReviewRequired)
	response := publicationApplicationRequest(ctx, t, apiServer, http.MethodPost, "/api/v1/publications/"+post.ID+"/publish-now", map[string]any{"expected_revision": post.Revision})
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "requires client review for every post")
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", post.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "an unsubmitted post must not queue delivery")
	require.ErrorIs(t, publicationauth.RequireReview(ctx, srv.db, post.ID), publicationauth.ErrReviewRequired, "the provider-write gate also refuses it")
	require.Error(t, publicationauth.RequireUnreviewedRepost(ctx, srv.db, post.ID), "reposts are placements outside any approval")

	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "client-1", Role: models.WorkspaceRoleClient, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	draft, err := h.publicationApplication().Get(ctx, "user-1", post.ID)
	require.NoError(t, err)
	response = publicationApplicationRequest(ctx, t, apiServer, http.MethodPost, "/api/v1/publications/"+post.ID+"/reviews", map[string]any{"expected_revision": draft.Revision, "reviewer_id": "client-1", "note": "Ready for approval"})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var review PublicationReviewResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &review))
	clientServer := echo.New()
	clientAPI := humaecho.NewV4WithGroup(clientServer, clientServer.Group("/api/v1"), huma.DefaultConfig("Client", "1"))
	NewPublicationHandler(srv.db, reviewClientAuthenticator{}, nil).RegisterRoutes(clientAPI)
	response = publicationApplicationRequest(ctx, t, clientServer, http.MethodPut, "/api/v1/publications/"+post.ID+"/reviews/"+review.ID, map[string]any{"expected_epoch": 1, "decision": "approved", "feedback": ""})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	approved, err := h.publicationApplication().Get(ctx, "user-1", post.ID)
	require.NoError(t, err)
	queued, err := h.publicationApplication().Schedule(ctx, "user-1", post.ID, approved.Revision, providerreadiness.ExecutionIntentProduction)
	require.NoError(t, err, "the approved version can be scheduled")
	require.NotEmpty(t, queued.JobID)
}
