package handlers

import (
	"encoding/json"
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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
	require.Len(t, page.SyncStates, 2)
	feeds := map[string]EngagementSyncState{}
	for _, state := range page.SyncStates {
		feeds[state.Feed] = state
	}
	require.Equal(t, "permission_required", feeds["comments"].Status)
	require.Equal(t, "permission_required", feeds["mentions"].Status)
	require.Equal(t, "missing_scope", feeds["comments"].ErrorCode)
	require.Equal(t, "missing_scope", feeds["mentions"].ErrorCode)
	_, err = db.NewUpdate().Model(account).Set("granted_scopes = ?", account.GrantedScopes+" threads_read_replies").WherePK().Exec(t.Context())
	require.NoError(t, err)
	refresh = srv.request(t, http.MethodPost, "/api/v1/engagement/refresh", map[string]string{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusOK, refresh.Code, refresh.Body.String())
	count, err = db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", engagementservice.JobTypeEngagementSync).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count, "a reconnected grant may schedule collection")
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
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
