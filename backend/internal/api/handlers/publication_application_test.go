package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

func TestPublicationApplicationKeepsRESTAndMCPUpdateParity(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := NewPublicationHandler(srv.db, testAuthenticator{}, nil)

	create := func(title string) *models.Publication {
		t.Helper()
		publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
			WorkspaceID:      "ws-1",
			Title:            title,
			ContentProfile:   models.ContentProfileShortText,
			SourceText:       "Initial copy",
			SocialAccountIDs: []string{"account-1"},
		})
		require.NoError(t, err)
		return publication
	}
	restPublication := create("REST publication")
	mcpPublication := create("MCP publication")

	restEcho := echo.New()
	api := humaecho.NewWithGroup(restEcho, restEcho.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.RegisterRoutes(api)

	scheduledAt := time.Now().UTC().Add(3 * time.Hour).Truncate(time.Second)
	restUpdateBody := map[string]any{
		"expected_revision": 1,
		"title":             "Shared title",
		"source_text":       "Shared source",
		"scheduled_at":      scheduledAt,
		"metadata":          map[string]any{"campaign": "launch"},
	}
	restUpdate := publicationApplicationRequest(ctx, t, restEcho, http.MethodPut, "/api/v1/publications/"+restPublication.ID, restUpdateBody)
	require.Equal(t, http.StatusOK, restUpdate.Code, restUpdate.Body.String())

	_, rpcErr := srv.handler.updatePublication(ctx, "user-1", map[string]any{
		"publication_id":    mcpPublication.ID,
		"expected_revision": 1,
		"title":             "Shared title",
		"source_text":       "Shared source",
		"scheduled_at":      scheduledAt,
		"metadata":          map[string]any{"campaign": "launch"},
	})
	require.Nil(t, rpcErr)

	assertPublicationStateParity(t, srv, restPublication.ID, mcpPublication.ID, 2)

	renditions := []map[string]any{{
		"social_account_id": "account-1",
		"profile":           models.ContentProfileShortText,
		"body":              "Destination copy",
		"settings":          map[string]any{"reply_control": "everyone"},
	}}
	restRenditions := publicationApplicationRequest(ctx, t, restEcho, http.MethodPut, "/api/v1/publications/"+restPublication.ID, map[string]any{
		"expected_revision": 2,
		"renditions":        renditions,
	})
	require.Equal(t, http.StatusOK, restRenditions.Code, restRenditions.Body.String())

	_, rpcErr = srv.handler.setPublicationRenditions(ctx, "user-1", map[string]any{
		"publication_id":    mcpPublication.ID,
		"expected_revision": 2,
		"renditions":        renditions,
	})
	require.Nil(t, rpcErr)

	assertPublicationStateParity(t, srv, restPublication.ID, mcpPublication.ID, 3)
	var restRenditionsStored, mcpRenditionsStored []models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&restRenditionsStored).Where("publication_id = ?", restPublication.ID).Scan(ctx))
	require.NoError(t, srv.db.NewSelect().Model(&mcpRenditionsStored).Where("publication_id = ?", mcpPublication.ID).Scan(ctx))
	require.Len(t, restRenditionsStored, 1)
	require.Len(t, mcpRenditionsStored, 1)
	require.Equal(t, restRenditionsStored[0].SocialAccountID, mcpRenditionsStored[0].SocialAccountID)
	require.Equal(t, restRenditionsStored[0].Profile, mcpRenditionsStored[0].Profile)
	require.Equal(t, restRenditionsStored[0].OutputProfile, mcpRenditionsStored[0].OutputProfile)
	require.Equal(t, restRenditionsStored[0].Body, mcpRenditionsStored[0].Body)
	require.JSONEq(t, restRenditionsStored[0].SettingsJSON, mcpRenditionsStored[0].SettingsJSON)
}

func TestPublicationApplicationUsesOneMutationTimestamp(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := srv.handler.publicationHandler()
	application := handler.publicationApplication()
	createdAt := time.Date(2026, time.August, 9, 8, 0, 0, 0, time.UTC)
	application.now = func() time.Time { return createdAt }
	publication, err := application.Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:      "ws-1",
		ContentProfile:   models.ContentProfileShortText,
		SourceText:       "Initial copy",
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)

	updatedAt := createdAt.Add(time.Hour)
	application.now = func() time.Time { return updatedAt }
	updatedCopy := "Updated once"
	require.NoError(t, application.Update(ctx, "user-1", publication.ID, PublicationUpdateBody{
		ExpectedRevision: 1,
		SourceText:       &updatedCopy,
	}))

	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, 2, stored.Revision)
	require.True(t, stored.UpdatedAt.Equal(updatedAt))
	var editor models.Post
	require.NoError(t, srv.db.NewSelect().Model(&editor).Where("publication_id = ?", publication.ID).Scan(ctx))
	require.Equal(t, 2, editor.Revision)
	require.Equal(t, updatedCopy, editor.Content)
	require.True(t, editor.UpdatedAt.Equal(updatedAt))
}

func TestPublicationApplicationValidatesBeforeQueueMutation(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := srv.handler.publicationHandler()
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:      "ws-1",
		ContentProfile:   models.ContentProfileShortText,
		SourceText:       strings.Repeat("x", 281),
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)
	publication.ScheduledAt = time.Now().UTC().Add(time.Hour)
	_, err = srv.db.NewUpdate().Model(publication).Column("scheduled_at").WherePK().Exec(ctx)
	require.NoError(t, err)

	commands := handler.publicationApplication()
	for _, run := range []func() (string, error){
		func() (string, error) {
			return commands.Schedule(ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction)
		},
		func() (string, error) {
			return commands.PublishNow(ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction)
		},
	} {
		jobID, runErr := run()
		require.Empty(t, jobID)
		require.ErrorIs(t, runErr, errPublicationValidationBlocked)
	}

	jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, stored.Status)
}

func TestPublicationTransportsRejectViewerMutations(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	publication, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id":       "ws-1",
		"content_profile":    models.ContentProfileShortText,
		"source_text":        "Viewer-safe draft",
		"social_account_ids": []string{"account-1"},
	})
	require.Nil(t, rpcErr)
	publicationID := publication.(map[string]any)["structuredContent"].(map[string]any)["publication"].(mcpPublicationStatus).ID
	_, err := srv.db.NewUpdate().
		Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").
		Exec(ctx)
	require.NoError(t, err)

	restEcho := echo.New()
	api := humaecho.NewWithGroup(restEcho, restEcho.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(srv.db, testAuthenticator{}, nil).RegisterRoutes(api)
	restUpdate := publicationApplicationRequest(ctx, t, restEcho, http.MethodPut, "/api/v1/publications/"+publicationID, map[string]any{
		"expected_revision": 1,
		"title":             "Forbidden update",
	})
	require.Equal(t, http.StatusForbidden, restUpdate.Code, restUpdate.Body.String())

	mutations := []func() (any, *mcpError){
		func() (any, *mcpError) {
			return srv.handler.updatePublication(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1, "title": "Forbidden update",
			})
		},
		func() (any, *mcpError) {
			return srv.handler.setPublicationRenditions(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1,
				"renditions": []map[string]any{{"social_account_id": "account-1", "body": "Forbidden update"}},
			})
		},
		func() (any, *mcpError) {
			return srv.handler.schedulePublication(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1,
			})
		},
		func() (any, *mcpError) {
			return srv.handler.publishPublicationNow(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1,
			})
		},
	}
	for _, mutate := range mutations {
		result, mutationErr := mutate()
		require.Nil(t, result)
		require.NotNil(t, mutationErr)
		require.Equal(t, -32602, mutationErr.Code)
		require.Equal(t, "workspace editor role required", mutationErr.Message)
	}

	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publicationID).Scan(ctx))
	require.Equal(t, 1, stored.Revision)
	require.NotEqual(t, "Forbidden update", stored.Title)
	jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestMCPPublicationCreateHonorsWorkspaceTokenScope(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := contextWithMCPWorkspaceScope(context.Background(), "ws-1")
	result, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id":       "ws-2",
		"content_profile":    models.ContentProfileShortText,
		"source_text":        "Must remain scoped",
		"social_account_ids": []string{"account-other-workspace"},
	})
	require.Nil(t, result)
	require.NotNil(t, rpcErr)
	require.Equal(t, -32602, rpcErr.Code)
	require.Equal(t, "workspace outside token scope", rpcErr.Message)

	count, err := srv.db.NewSelect().
		Model((*models.Publication)(nil)).
		Where("workspace_id = ?", "ws-2").
		Where("source_text = ?", "Must remain scoped").
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}

func publicationApplicationRequest(
	ctx context.Context,
	t *testing.T,
	server *echo.Echo,
	method string,
	path string,
	body any,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	request := httptest.NewRequestWithContext(ctx, method, path, &payload)
	request.Header.Set("Authorization", "Bearer web-token")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func assertPublicationStateParity(t *testing.T, srv *mcpTestServer, restID, mcpID string, revision int) {
	t.Helper()
	ctx := context.Background()
	var restPublication, mcpPublication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&restPublication).Where("id = ?", restID).Scan(ctx))
	require.NoError(t, srv.db.NewSelect().Model(&mcpPublication).Where("id = ?", mcpID).Scan(ctx))
	require.Equal(t, revision, restPublication.Revision)
	require.Equal(t, revision, mcpPublication.Revision)
	require.Equal(t, restPublication.Title, mcpPublication.Title)
	require.Equal(t, restPublication.ContentProfile, mcpPublication.ContentProfile)
	require.Equal(t, restPublication.SourceText, mcpPublication.SourceText)
	require.Equal(t, restPublication.SourceContent, mcpPublication.SourceContent)
	require.True(t, restPublication.ScheduledAt.Equal(mcpPublication.ScheduledAt))
	require.JSONEq(t, restPublication.MetadataJSON, mcpPublication.MetadataJSON)
	require.JSONEq(t, restPublication.ReleasePlanJSON, mcpPublication.ReleasePlanJSON)

	var restEditor, mcpEditor models.Post
	require.NoError(t, srv.db.NewSelect().Model(&restEditor).Where("publication_id = ?", restID).Scan(ctx))
	require.NoError(t, srv.db.NewSelect().Model(&mcpEditor).Where("publication_id = ?", mcpID).Scan(ctx))
	require.Equal(t, revision, restEditor.Revision)
	require.Equal(t, revision, mcpEditor.Revision)
	require.Equal(t, restEditor.Content, mcpEditor.Content)
}
