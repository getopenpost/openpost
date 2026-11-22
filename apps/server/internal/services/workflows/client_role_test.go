package workflows

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

// TestClientRoleDecidesApprovalWithoutAuthoring proves both halves of the client
// role at the workflow boundary, which is where the role earns its keep: a
// client must be able to decide a parked approval, and must not be able to
// author or change the workflow that produced it.
//
// The workflow is saved and started while the member is still an administrator,
// because starting a live run is an edit. The role is then dropped to client,
// with nothing else changed, so the only difference between the two halves is
// the role itself.
func TestClientRoleDecidesApprovalWithoutAuthoring(t *testing.T) {
	t.Parallel()
	s, actor := workflowTestService(t, actionFunc(func(_ context.Context, input EffectRequest) (EffectResult, error) {
		if input.Kind == KindApproval {
			return EffectResult{Output: map[string]any{"publication_id": "post-1", "revision": 3, "text": "review me"}}, nil
		}
		return EffectResult{Output: map[string]any{"job_id": "job-1"}}, nil
	}))

	workflow := saveTestWorkflow(t, s, actor, []Step{
		{ID: "review", Kind: KindApproval, Inputs: map[string]Value{"publication_id": literal("post-1")}},
	})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)

	awaiting, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateApproval, awaiting.State)

	// Drop the member to client. Nothing else changes.
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleClient).
		Where("workspace_id = ? AND user_id = ?", "ws", actor.UserID).
		Exec(t.Context())
	require.NoError(t, err)

	// A client may decide the parked approval.
	approved, err := s.Approve(t.Context(), actor, "ws", run.ID, awaiting.Revision, 3)
	require.NoError(t, err)
	require.NotEqual(t, StateApproval, approved.State)

	// A client may not author or change the workflow.
	_, err = s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{
		Name:       "Renamed by a client",
		Definition: workflow.Definition,
	})
	require.ErrorIs(t, err, ErrAccess)

	// A client may not start a live run either, since that is an edit.
	_, err = s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.ErrorIs(t, err, ErrAccess)
}

// TestViewerRoleCannotDecideApproval keeps the other side of the same boundary:
// approval is a decision, and a viewer has none.
func TestViewerRoleCannotDecideApproval(t *testing.T) {
	t.Parallel()
	s, actor := workflowTestService(t, actionFunc(func(_ context.Context, input EffectRequest) (EffectResult, error) {
		if input.Kind == KindApproval {
			return EffectResult{Output: map[string]any{"publication_id": "post-1", "revision": 3, "text": "review me"}}, nil
		}
		return EffectResult{}, nil
	}))

	workflow := saveTestWorkflow(t, s, actor, []Step{
		{ID: "review", Kind: KindApproval, Inputs: map[string]Value{"publication_id": literal("post-1")}},
	})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)

	awaiting, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateApproval, awaiting.State)

	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws", actor.UserID).
		Exec(t.Context())
	require.NoError(t, err)

	_, err = s.Approve(t.Context(), actor, "ws", run.ID, awaiting.Revision, 3)
	require.ErrorIs(t, err, ErrAccess)
}
