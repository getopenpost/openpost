package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workflows"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type workflowSession struct{}

func (workflowSession) AuthenticateBearer(context.Context, string) (*middleware.Principal, error) {
	return &middleware.Principal{UserID: "user", SessionID: "session"}, nil
}

func workflowHandlerDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:workflow-http-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "user", Email: "workflow-http@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: "org", Name: "Example", CreatedByID: "user", CreatedAt: now, UpdatedAt: now},
		&models.OrganizationMember{OrganizationID: "org", UserID: "user", Role: models.OrganizationRoleOwner, CreatedAt: now},
		&models.Workspace{ID: "ws", OrganizationID: "org", Name: "Workspace", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.UserSession{ID: "session", UserID: "user", CreatedAt: now, LastUsedAt: now, ExpiresAt: now.Add(time.Hour)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	return db
}
func TestWorkflowHTTPPreviewAndLiveDraftApproval(t *testing.T) {
	db := workflowHandlerDB(t)
	publications := NewPublicationHandler(db, workflowSession{}, nil)
	service := workflows.NewService(db, NewWorkflowActions(publications, nil, nil), nil)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewWorkflowHandler(service, workflowSession{}).RegisterRoutes(api)
	request := func(method, path string, body any, code int) []byte {
		data, err := json.Marshal(body)
		require.NoError(t, err)
		req := httptest.NewRequestWithContext(t.Context(), method, "/api/v1"+path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer session")
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, req)
		require.Equal(t, code, response.Code, response.Body.String())
		return response.Body.Bytes()
	}
	var workflow workflows.Workflow
	require.NoError(t, json.Unmarshal(request(http.MethodPost, "/workflows?workspace_id=ws", map[string]any{"name": "Launch", "description": "", "expected_revision": 0, "definition": map[string]any{"schema": 1, "source": map[string]any{"kind": "manual"}, "steps": []any{
		map[string]any{"id": "draft", "kind": "create_draft", "name": "Draft", "inputs": map[string]any{"text": map[string]any{"reference": "source.title"}}},
		map[string]any{"id": "review", "kind": "approval", "name": "Review", "inputs": map[string]any{"publication_id": map[string]any{"reference": "draft.id"}}},
	}}}, http.StatusOK), &workflow))
	run := func(mode string) workflows.Run {
		var result workflows.Run
		require.NoError(t, json.Unmarshal(request(http.MethodPost, "/workflows/"+workflow.ID+"/runs?workspace_id=ws", map[string]any{"expected_revision": workflow.Revision, "mode": mode, "source": map[string]any{"title": "A real native draft"}}, http.StatusOK), &result))
		for range 3 {
			require.NoError(t, service.HandleJob(t.Context(), jobregistry.TypeWorkflowRun, `{"run_id":"`+result.ID+`"}`))
		}
		require.NoError(t, json.Unmarshal(request(http.MethodGet, "/workflow-runs/"+result.ID+"?workspace_id=ws", nil, http.StatusOK), &result))
		return result
	}
	preview := run(workflows.ModePreview)
	require.Equal(t, workflows.StateSucceeded, preview.State)
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	live := run(workflows.ModeLive)
	require.Equal(t, workflows.StateApproval, live.State, live.Error)
	count, err = db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	publicationID := live.Steps[0].Output["id"].(string)
	var post models.Publication
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", publicationID).Scan(t.Context()))
	require.Equal(t, "A real native draft", post.SourceText)
	_, err = db.NewUpdate().Model((*models.Publication)(nil)).Set("revision = revision + 1, source_text = ?", "Edited after review").Where("id = ?", post.ID).Exec(t.Context())
	require.NoError(t, err)
	request(http.MethodPost, "/workflow-runs/"+live.ID+"/approve?workspace_id=ws", map[string]any{"expected_revision": live.Revision, "publication_revision": post.Revision}, http.StatusConflict)
	request(http.MethodPost, "/workflow-runs/"+live.ID+"/approve?workspace_id=ws", map[string]any{"expected_revision": live.Revision, "publication_revision": post.Revision + 1}, http.StatusOK)
	request(http.MethodPost, "/workflow-runs/"+live.ID+"/approve?workspace_id=ws", map[string]any{"expected_revision": live.Revision, "publication_revision": post.Revision + 1}, http.StatusConflict)
	request(http.MethodGet, "/workflow-runs/"+live.ID+"?workspace_id=other", nil, http.StatusForbidden)
}

func TestWorkflowNativeDraftReplayAndStoredWorkspaceBoundary(t *testing.T) {
	db := workflowHandlerDB(t)
	actions := NewWorkflowActions(NewPublicationHandler(db, workflowSession{}, nil), nil, nil)
	input := workflows.EffectRequest{Kind: workflows.KindDraft, Inputs: map[string]any{"text": "Only once"}, Authority: workspaceaccess.StoredAuthority{UserID: "user", WorkspaceID: "ws", OrganizationID: "org", AssuredAt: time.Now().UTC()}, RunID: "run", StepID: "draft", ExpiresAt: time.Now().Add(time.Hour)}
	first, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	second, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first, second)
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	ctx := workspaceaccess.WithStoredAuthority(t.Context(), input.Authority)
	allowed, err := workspaceEditAllowed(ctx, db, "other", "user")
	require.NoError(t, err)
	require.False(t, allowed)
	allowed, err = workspaceEditAllowed(ctx, db, "ws", "someone-else")
	require.NoError(t, err)
	require.False(t, allowed)
	_, err = db.NewDelete().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ?", "ws").Exec(t.Context())
	require.NoError(t, err)
	_, err = actions.Execute(t.Context(), input)
	require.ErrorIs(t, err, workflows.ErrAccess)
}

func TestWorkflowNativeScheduleReplayKeepsOneJobAndOneAuthorization(t *testing.T) {
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	handler := srv.handler.publicationHandler()
	publication, err := handler.publicationApplication().Create(t.Context(), "user-1", CreatePublicationBody{WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText, SourceText: "Schedule this approved revision", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	actions := NewWorkflowActions(handler, nil, nil)
	input := workflows.EffectRequest{Kind: workflows.KindSchedule, Inputs: map[string]any{"publication_id": publication.ID, "revision": publication.Revision, "scheduled_at": time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)}, Authority: workspaceaccess.StoredAuthority{UserID: "user-1", WorkspaceID: "ws-1", OrganizationID: "organization-1", AssuredAt: time.Now().UTC()}, RunID: "schedule-run", StepID: "schedule", ExpiresAt: time.Now().Add(time.Hour)}
	first, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	replay, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first, replay)
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", publication.ID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	count, err = srv.db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Where("publication_id = ?", publication.ID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestWorkflowNativeDraftWithDestinationAndReplyReplay(t *testing.T) {
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	actions := NewWorkflowActions(srv.handler.publicationHandler(), nil, nil)
	input := workflows.EffectRequest{Kind: workflows.KindDraft, Inputs: map[string]any{"text": "Launch notes", "account_ids": []string{"account-1"}}, Authority: workspaceaccess.StoredAuthority{UserID: "user-1", WorkspaceID: "ws-1", OrganizationID: "organization-1", AssuredAt: time.Now().UTC()}, RunID: "reply-run", StepID: "draft", ExpiresAt: time.Now().Add(time.Hour)}
	draft, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("publication_id = ?", draft.Output["id"]).Scan(t.Context()))
	require.Equal(t, "Launch notes", rendition.Body)
	_, err = srv.db.NewUpdate().Model(&rendition).Set("status = ?, external_id = ?", models.RenditionStatusPublished, "external-42").WherePK().Exec(t.Context())
	require.NoError(t, err)
	input.Kind = workflows.KindReply
	input.StepID = "reply"
	input.Inputs = map[string]any{"rendition_id": rendition.ID, "text": "More detail", "run_at": time.Now().UTC().Format(time.RFC3339Nano)}
	first, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	second, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first, second)
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", rendition.PublicationID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestWorkflowDraftRecoveryAfterSocialSetRemoval(t *testing.T) {
	db := workflowHandlerDB(t)
	now := time.Now().UTC()
	for _, row := range []any{
		&models.SocialAccount{ID: "source", WorkspaceID: "ws", Platform: "mastodon", AccountUsername: "founder", AccountID: "founder", AccessTokenEnc: []byte("test"), IsActive: true, CreatedAt: now},
		&models.SocialSet{ID: "set", WorkspaceID: "ws", Name: "Founder", CreatedAt: now, UpdatedAt: now},
		&models.SocialSetAccount{SocialSetID: "set", SocialAccountID: "source", CreatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	actions := NewWorkflowActions(NewPublicationHandler(db, workflowSession{}, nil), nil, nil)
	input := workflows.EffectRequest{Kind: workflows.KindDraft, Inputs: map[string]any{"text": "Preserve this draft", "social_set_id": "set"}, Authority: workspaceaccess.StoredAuthority{UserID: "user", WorkspaceID: "ws", OrganizationID: "org", AssuredAt: now}, RunID: "recovery", StepID: "draft", ExpiresAt: now.Add(time.Hour)}
	first, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	_, err = db.NewDelete().Model((*models.SocialSet)(nil)).Where("id = ?", "set").Exec(t.Context())
	require.NoError(t, err)
	replay, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first, replay)
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}
