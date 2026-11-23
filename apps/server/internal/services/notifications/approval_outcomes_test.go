package notifications

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func mustOutcome(t *testing.T, facts WorkflowApprovalFacts) Outcome {
	t.Helper()
	outcome, err := NewWorkflowApprovalOutcome(facts)
	require.NoError(t, err)
	return outcome
}

func materialize(t *testing.T, facts WorkflowApprovalFacts) createInput {
	t.Helper()
	input, err := materializeWorkflowApproval(mustOutcome(t, facts).notificationOutcome())
	require.NoError(t, err)
	return input
}

func TestWorkflowApprovalNoApproverActions(t *testing.T) {
	for _, state := range []string{ApprovalStateWaiting, ApprovalStateReminder} {
		for _, publicationID := range []string{"", "post-1"} {
			t.Run(state+publicationID, func(t *testing.T) {
				input := materialize(t, WorkflowApprovalFacts{
					RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
					StepID: "step-1", State: state, Audience: ApprovalAudienceNoApprover,
					PublicationID: publicationID, DaysLeft: 3,
				})
				require.NotContains(t, input.Title, "your approval")
				require.NotContains(t, input.Body, "approve it yourself")
				require.Contains(t, input.Body, "workspace administrator")
				require.Len(t, input.Actions, 1)
				require.NotEqual(t, "Review post", input.Actions[0].Label)
				if publicationID == "" {
					require.Equal(t, "/workflows?run=run-1&workspace_id=workspace-1", input.Href)
					require.Equal(t, "View workflow run", input.Actions[0].Label)
				} else {
					require.Equal(t, "/publications/post-1?workspace_id=workspace-1", input.Href)
					require.Equal(t, "Open post", input.Actions[0].Label)
				}
			})
		}
	}
}
