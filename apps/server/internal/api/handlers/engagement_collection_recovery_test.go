package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/stretchr/testify/require"
)

type collectionRecoveryProvider struct {
	fakeCommentAdapter
	failure error
}

func (p *collectionRecoveryProvider) ListComments(context.Context, string, string, string) ([]platform.Comment, error) {
	return p.comments, p.failure
}

func TestEngagementRefreshReportsPersistedFailuresAndClearsRecoveredTargets(t *testing.T) {
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	svc := engagementservice.NewService(db, commentsTokenSource{}, nil)
	svc.SetFeatureGate(alwaysEnabledCommentsGate{})
	providers := map[string]*collectionRecoveryProvider{}
	now := time.Now().UTC()
	for _, name := range []string{"facebook", "instagram", "threads"} {
		account := &models.SocialAccount{ID: name, Slug: name, WorkspaceID: "ws-1", Platform: name, AccountID: "remote-" + name, IsActive: true, AccessTokenEnc: []byte("synthetic")}
		_, err := db.NewInsert().Model(account).Exec(t.Context())
		require.NoError(t, err)
		post := &models.Publication{ID: "post-" + name, WorkspaceID: "ws-1", Status: models.PublicationStatusPublished, ActualRunAt: now, UpdatedAt: now}
		_, err = db.NewInsert().Model(post).Exec(t.Context())
		require.NoError(t, err)
		rendition := &models.Rendition{ID: "variant-" + name, PublicationID: post.ID, SocialAccountID: name, Platform: name, Status: models.RenditionStatusPublished, ExternalID: "remote-post"}
		_, err = db.NewInsert().Model(rendition).Exec(t.Context())
		require.NoError(t, err)
		p := &collectionRecoveryProvider{failure: &platform.HTTPError{StatusCode: 403, Code: "meta:permission:200", Subcode: "99", TraceID: "trace-safe"}}
		providers[name] = p
		svc.SetProvider(name, p)
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewEngagementMessagingHandler(testAuthenticator{}, nil, svc).RegisterRoutes(api)
	srv := &commentsTestServer{echo: e, db: db}
	var logs bytes.Buffer
	old := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(old) })
	queued := srv.request(t, http.MethodPost, "/api/v1/engagement/refresh", map[string]string{"workspace_id": "ws-1"})
	require.Equal(t, 200, queued.Code, queued.Body.String())
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", engagementservice.JobTypeEngagementSync).Scan(t.Context()))
	require.Len(t, jobs, 3)
	for _, job := range jobs {
		require.NoError(t, svc.HandleJob(t.Context(), job.Type, job.Payload), "durable scheduler records provider outcome instead of retrying twice")
	}
	failed := srv.request(t, http.MethodGet, "/api/v1/engagement?workspace_id=ws-1", nil)
	require.Equal(t, 200, failed.Code, failed.Body.String())
	var page EngagementPage
	require.NoError(t, json.Unmarshal(failed.Body.Bytes(), &page))
	require.Len(t, page.SyncStates, 3)
	for _, state := range page.SyncStates {
		require.Equal(t, "permission_required", state.Status)
		require.Equal(t, "meta:permission:200", state.ErrorCode)
		require.True(t, state.LastSuccessAt.IsZero())
	}
	require.Contains(t, logs.String(), "collection")
	require.Contains(t, logs.String(), "meta:permission:200")
	require.Contains(t, logs.String(), "trace_id=trace-safe")
	require.Contains(t, logs.String(), "subcode=99")
	require.NotContains(t, logs.String(), "token")
	// One provider recovers; the other two failures must remain independently visible.
	providers["facebook"].failure = nil
	require.NoError(t, svc.HandleJob(t.Context(), engagementservice.JobTypeEngagementSync, `{"id":"variant-facebook"}`))
	recovered := srv.request(t, http.MethodGet, "/api/v1/engagement?workspace_id=ws-1", nil)
	require.Equal(t, 200, recovered.Code, recovered.Body.String())
	require.NoError(t, json.Unmarshal(recovered.Body.Bytes(), &page))
	require.Len(t, page.SyncStates, 3)
	for _, state := range page.SyncStates {
		if state.Platform == "facebook" {
			require.Equal(t, "ok", state.Status)
			require.Empty(t, state.ErrorCode)
			require.Empty(t, state.ErrorMessage)
			require.False(t, state.LastSuccessAt.IsZero())
			continue
		}
		require.Equal(t, "permission_required", state.Status)
	}
}
