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

func TestThreadsEngagementRefreshRequiresReplyReadGrant(t *testing.T) {
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	svc := engagementservice.NewService(db, commentsTokenSource{}, nil)
	svc.SetFeatureGate(alwaysEnabledCommentsGate{})
	svc.SetProvider("threads", platform.NewThreadsAdapter("client", "secret", "https://app.example/callback"))
	account := &models.SocialAccount{ID: "threads", Slug: "threads", WorkspaceID: "ws-1", Platform: "threads", AccountID: "remote-threads", IsActive: true, AccessTokenEnc: []byte("synthetic"), GrantedScopes: "threads_basic threads_content_publish threads_manage_replies threads_manage_insights"}
	_, err := db.NewInsert().Model(account).Exec(t.Context())
	require.NoError(t, err)
	now := time.Now().UTC()
	post := &models.Publication{ID: "post-threads", WorkspaceID: "ws-1", Status: models.PublicationStatusPublished, ActualRunAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(post).Exec(t.Context())
	require.NoError(t, err)
	rendition := &models.Rendition{ID: "variant-threads", PublicationID: post.ID, SocialAccountID: account.ID, Platform: "threads", Status: models.RenditionStatusPublished, ExternalID: "remote-post"}
	_, err = db.NewInsert().Model(rendition).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewEngagementMessagingHandler(testAuthenticator{}, nil, svc).RegisterRoutes(api)
	srv := &commentsTestServer{echo: e, db: db}
	refresh := srv.request(t, http.MethodPost, "/api/v1/engagement/refresh", map[string]string{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusOK, refresh.Code, refresh.Body.String())
	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", engagementservice.JobTypeEngagementSync).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "an older grant must request reconnection before scheduling provider reads")
	response := srv.request(t, http.MethodGet, "/api/v1/engagement?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var page EngagementPage
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
	require.Len(t, page.SyncStates, 1)
	require.Equal(t, "permission_required", page.SyncStates[0].Status)
	require.Equal(t, "missing_scope", page.SyncStates[0].ErrorCode)
	_, err = db.NewUpdate().Model(account).Set("granted_scopes = ?", account.GrantedScopes+" threads_read_replies").WherePK().Exec(t.Context())
	require.NoError(t, err)
	refresh = srv.request(t, http.MethodPost, "/api/v1/engagement/refresh", map[string]string{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusOK, refresh.Code, refresh.Body.String())
	count, err = db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", engagementservice.JobTypeEngagementSync).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count, "a reconnected grant may schedule collection")
}

func TestEngagementCollectionPreservesProviderTimestamps(t *testing.T) {
	for _, tc := range []struct {
		name, created, updated, expectedCreated, expectedUpdated string
		legacy                                                   bool
	}{
		{"Meta reply", "2024-09-17T20:54:47+0000", "2024-09-18T10:00:00+0000", "2024-09-17T20:54:47Z", "2024-09-18T10:00:00Z", false},
		{"legacy Meta reply with non-UTC offset", "2024-09-17T20:54:47-0330", "2024-09-18T10:00:00-0330", "2024-09-18T00:24:47Z", "2024-09-18T13:30:00Z", true},
		{"RFC3339 reply", "2024-09-17T20:54:47.123Z", "2024-09-18T10:00:00.456Z", "2024-09-17T20:54:47.123Z", "2024-09-18T10:00:00.456Z", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := newFeatureEnforcementDB(t)
			_, err := db.ExecContext(t.Context(), "CREATE UNIQUE INDEX engagement_items_remote ON engagement_items (social_account_id, remote_id)")
			require.NoError(t, err)
			seedFeatureUserWorkspace(t, db)
			svc := engagementservice.NewService(db, commentsTokenSource{}, nil)
			svc.SetFeatureGate(alwaysEnabledCommentsGate{})
			svc.SetProvider("threads", fakeCommentAdapter{comments: []platform.Comment{{ID: "remote-reply", Text: "A reply", CreatedAt: tc.created, UpdatedAt: tc.updated}}})
			account := &models.SocialAccount{ID: "threads", Slug: "threads", WorkspaceID: "ws-1", Platform: "threads", AccountID: "remote-threads", IsActive: true, AccessTokenEnc: []byte("synthetic")}
			_, err = db.NewInsert().Model(account).Exec(t.Context())
			require.NoError(t, err)
			now := time.Now().UTC()
			post := &models.Publication{ID: "post-threads", WorkspaceID: "ws-1", Status: models.PublicationStatusPublished, ActualRunAt: now, UpdatedAt: now}
			_, err = db.NewInsert().Model(post).Exec(t.Context())
			require.NoError(t, err)
			rendition := &models.Rendition{ID: "variant-threads", PublicationID: post.ID, SocialAccountID: account.ID, Platform: "threads", Status: models.RenditionStatusPublished, ExternalID: "remote-post"}
			_, err = db.NewInsert().Model(rendition).Exec(t.Context())
			require.NoError(t, err)
			if tc.legacy {
				item := &models.EngagementItem{ID: "legacy-reply", WorkspaceID: "ws-1", RenditionID: rendition.ID, SocialAccountID: account.ID, Platform: "threads", RemoteID: "remote-reply", Body: "A reply", LastSeenAt: now, CreatedAt: now, UpdatedAt: now}
				_, err = db.NewInsert().Model(item).Exec(t.Context())
				require.NoError(t, err)
			}
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			NewEngagementMessagingHandler(testAuthenticator{}, nil, svc).RegisterRoutes(api)
			srv := &commentsTestServer{echo: e, db: db}
			for range 2 {
				require.NoError(t, svc.HandleJob(t.Context(), engagementservice.JobTypeEngagementSync, `{"id":"variant-threads"}`))
				response := srv.request(t, http.MethodGet, "/api/v1/engagement?workspace_id=ws-1", nil)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var page EngagementPage
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
				require.Len(t, page.Items, 1)
				require.Equal(t, tc.expectedCreated, page.Items[0].RemoteCreatedAt.UTC().Format(time.RFC3339Nano))
				require.Equal(t, tc.expectedUpdated, page.Items[0].EditedAt.UTC().Format(time.RFC3339Nano))
				if tc.legacy {
					require.Equal(t, "legacy-reply", page.Items[0].ID)
				}
			}
		})
	}
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
