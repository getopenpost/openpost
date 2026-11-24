package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
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

func newTestWorkflowActions(publications *PublicationHandler) workflows.Actions {
	return NewWorkflowActionsWithEngagement(publications, nil, nil, nil)
}

func workflowHandlerDB(t *testing.T) *bun.DB {
	t.Helper()
	db := newHandlerSchemaTestDB(t)
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

func TestWorkflowNativeDraftReplayAndStoredWorkspaceBoundary(t *testing.T) {
	t.Parallel()
	db := workflowHandlerDB(t)
	actions := newTestWorkflowActions(NewPublicationHandler(db, workflowSession{}, nil))
	input := workflows.EffectRequest{Kind: workflows.KindDraft, Inputs: map[string]any{"text": "Only once"}, Authority: workspaceaccess.StoredAuthority{UserID: "user", WorkspaceID: "ws", OrganizationID: "org", AssuredAt: time.Now().UTC()}, RunID: "run", StepID: "draft", ExpiresAt: time.Now().Add(time.Hour)}
	first, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	second, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first, second)
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
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
	t.Parallel()
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	handler := srv.handler.publicationHandler()
	publication, err := handler.publicationApplication().Create(t.Context(), "user-1", CreatePublicationBody{WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText, SourceText: "Schedule this approved revision", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	actions := newTestWorkflowActions(handler)
	input := workflows.EffectRequest{Kind: workflows.KindSchedule, Inputs: map[string]any{"publication_id": publication.ID, "revision": publication.Revision, "scheduled_at": time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)}, Authority: workspaceaccess.StoredAuthority{UserID: "user-1", WorkspaceID: "ws-1", OrganizationID: "organization-1", AssuredAt: time.Now().UTC()}, RunID: "schedule-run", StepID: "schedule", ExpiresAt: time.Now().Add(time.Hour)}
	first, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	replay, err := actions.Execute(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first, replay)
	require.NotEmpty(t, first.Output["renditions"], "workflow runs must expose the scheduler destination outcomes")
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", publication.ID).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	count, err = srv.db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Where("publication_id = ?", publication.ID).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestWorkflowNativeDraftWithDestinationAndReplyReplay(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	actions := newTestWorkflowActions(srv.handler.publicationHandler())
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
	require.EqualValues(t, 1, count)
}
