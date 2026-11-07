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

func TestPublicationClientReviewIsExplicitAndBlocksPublishing(t *testing.T) {
	t.Setenv("OPENPOST_CLIENT_REVIEWS_ENABLED", "true")
	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewCreateTable().Model((*models.PublicationReview)(nil)).Exec(ctx)
	require.NoError(t, err)
	h := srv.handler.publicationHandler()
	h.auth = testAuthenticator{}
	apiServer := echo.New()
	api := humaecho.NewV4WithGroup(apiServer, apiServer.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h.RegisterRoutes(api)
	publication, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "A release backed by our source", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "client-1", Role: models.WorkspaceRoleClient, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	response := publicationApplicationRequest(ctx, t, apiServer, http.MethodPost, "/api/v1/publications/"+publication.ID+"/reviews", map[string]any{"expected_revision": publication.Revision, "reviewer_id": "client-1", "note": "Please check the announcement"})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = publicationApplicationRequest(ctx, t, apiServer, http.MethodPost, "/api/v1/publications/"+publication.ID+"/reviews", map[string]any{"expected_revision": publication.Revision, "reviewer_id": "client-1", "note": "Please check the announcement"})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = publicationApplicationRequest(ctx, t, apiServer, http.MethodPost, "/api/v1/publications/"+publication.ID+"/publish-now", map[string]any{"expected_revision": publication.Revision + 1})
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", publication.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "sending for review must never queue delivery")
	var submitted PublicationReviewResponse
	// Fetch the immutable evidence rather than deriving expected state from writes.
	response = publicationApplicationRequest(ctx, t, apiServer, http.MethodGet, "/api/v1/publications/"+publication.ID+"/reviews", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var history []PublicationReviewResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &history))
	require.Len(t, history, 1)
	submitted = history[0]
	require.Equal(t, "A release backed by our source", submitted.Snapshot.SourceText)
	clientServer := echo.New()
	clientAPI := humaecho.NewV4WithGroup(clientServer, clientServer.Group("/api/v1"), huma.DefaultConfig("Client", "1"))
	NewPublicationHandler(srv.db, reviewClientAuthenticator{}, nil).RegisterRoutes(clientAPI)
	decisionPath := "/api/v1/publications/" + publication.ID + "/reviews/" + submitted.ID
	decisionBody := map[string]any{"expected_epoch": 1, "decision": "approved", "feedback": "Looks correct"}
	response = publicationApplicationRequest(ctx, t, apiServer, http.MethodPut, decisionPath, decisionBody)
	require.Equal(t, http.StatusForbidden, response.Code, "the author cannot approve on the client's behalf")
	response = publicationApplicationRequest(ctx, t, clientServer, http.MethodPut, decisionPath, decisionBody)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	// Retrying a decision is safe and does not increment the post revision again.
	response = publicationApplicationRequest(ctx, t, clientServer, http.MethodPut, decisionPath, decisionBody)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	scheduledAt := time.Now().UTC().Add(4 * time.Hour)
	// The composer replaces rendition rows even when authored content is unchanged.
	err = h.publicationApplication().Update(ctx, "user-1", publication.ID, PublicationUpdateBody{ExpectedRevision: 3, Renditions: []RenditionInput{{SocialAccountID: "account-1"}}})
	require.NoError(t, err)
	require.NoError(t, publicationauth.RequireReview(ctx, srv.db, publication.ID), "a no-op composer save retains approval")
	unchanged, err := h.publicationApplication().Get(ctx, "user-1", publication.ID)
	require.NoError(t, err)
	err = h.publicationApplication().Update(ctx, "user-1", publication.ID, PublicationUpdateBody{ExpectedRevision: unchanged.Revision, ScheduledAt: &scheduledAt})
	require.NoError(t, err, "the agency may choose timing when no timing was submitted")
	post, err := h.publicationApplication().Get(ctx, "user-1", publication.ID)
	require.NoError(t, err)
	require.Equal(t, "approved", post.ReviewState)
	queued, err := h.publicationApplication().Schedule(ctx, "user-1", publication.ID, post.Revision, providerreadiness.ExecutionIntentProduction)
	require.NoError(t, err)
	require.NotEmpty(t, queued.JobID)
	var receipt models.PublicationAuthorization
	require.NoError(t, srv.db.NewSelect().Model(&receipt).Where("job_id = ?", queued.JobID).Limit(1).Scan(ctx))
	input := publicationauth.ValidateInput{BatchID: receipt.BatchID, PublicationID: publication.ID, RenditionID: receipt.RenditionID, JobID: queued.JobID, Action: publicationauth.ActionPublish, ScheduledAt: receipt.ScheduledAt, ExecutionIntent: publicationauth.ExecutionIntentProduction}
	_, err = publicationauth.ValidateBatch(ctx, srv.db, input)
	require.NoError(t, err)
	// Revoked membership must be noticed by a worker even without another API call.
	_, err = srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("status = ?", "inactive").Where("user_id = ?", "client-1").Exec(ctx)
	require.NoError(t, err)
	_, err = publicationauth.ValidateBatch(ctx, srv.db, input)
	require.NoError(t, err, "immutable receipt verification permits reconciliation of accepted provider writes")
	err = publicationauth.RequireReview(ctx, srv.db, publication.ID)
	require.ErrorIs(t, err, publicationauth.ErrReviewRequired)
	_, err = srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("status = ?", models.WorkspaceMemberStatusActive).Where("user_id = ?", "client-1").Exec(ctx)
	require.NoError(t, err)
	post, err = h.publicationApplication().Get(ctx, "user-1", publication.ID)
	require.NoError(t, err)
	changed := "A different promise"
	require.NoError(t, h.publicationApplication().Update(ctx, "user-1", publication.ID, PublicationUpdateBody{ExpectedRevision: post.Revision, SourceText: &changed}))
	post, err = h.publicationApplication().Get(ctx, "user-1", publication.ID)
	require.NoError(t, err)
	require.Equal(t, "draft", post.Status)
	require.Equal(t, "needs_review", post.ReviewState)
	require.Equal(t, 2, post.ReviewEpoch)
	count, err = srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", publication.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	original := "A release backed by our source"
	require.NoError(t, h.publicationApplication().Update(ctx, "user-1", publication.ID, PublicationUpdateBody{ExpectedRevision: post.Revision, SourceText: &original}))
	response = publicationApplicationRequest(ctx, t, clientServer, http.MethodPut, decisionPath, decisionBody)
	require.Equal(t, http.StatusConflict, response.Code, "editing and reverting cannot resurrect an old approval")
}

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

func TestTimedClientApprovalCannotBePublishedImmediately(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	h := srv.handler.publicationHandler()
	_, err := srv.db.NewCreateTable().Model((*models.PublicationReview)(nil)).Exec(ctx)
	require.NoError(t, err)
	at := time.Now().UTC().Add(time.Hour)
	post, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "An embargoed announcement", SocialAccountIDs: []string{"account-1"}, ScheduledAt: &at})
	require.NoError(t, err)
	hashes, err := publicationauth.ReviewFingerprints(ctx, srv.db, post.ID)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "client-1", Role: models.WorkspaceRoleClient, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PublicationReview{ID: "timed-review", PublicationID: post.ID, WorkspaceID: "ws-1", ReviewerID: "client-1", Epoch: 1, Decision: "approved", IncludesSchedule: true, FingerprintsJSON: hashes, SnapshotJSON: "{}", CreatedAt: time.Now()}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).Set("review_id = ?", "timed-review").Set("review_epoch = 1").Set("review_state = 'approved'").Where("id = ?", post.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = h.publicationApplication().PublishNow(ctx, "user-1", post.ID, post.Revision, providerreadiness.ExecutionIntentProduction)
	require.ErrorIs(t, err, publicationauth.ErrReviewRequired)
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", post.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	_, err = h.publicationApplication().Schedule(ctx, "user-1", post.ID, post.Revision, providerreadiness.ExecutionIntentProduction)
	require.NoError(t, err, "the approved schedule remains usable")
}
