package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/services/workflows"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

func TestWorkflowBuilderPreservesLongWritingInstructions(t *testing.T) {
	t.Parallel()
	server := newPublicationBuildTestServer(t)
	actions := workflowActions{builds: server.handler}
	instructions := "Make a simple Twitter post following the format:\n\nWhat you can now use OpenPost for, in your benefit (that will bring the reader of the post more $ or more views), that changed or was added in this release. Basically a use case that they definitely want to read.\n\nNow in OpenPost v[...] (or something like this)"
	input := workflows.EffectRequest{
		RunID: "release-run", StepID: "build", Kind: workflows.KindBuild,
		Authority: workspaceaccess.StoredAuthority{UserID: "user-1", WorkspaceID: "ws-1", OrganizationID: "org-1", AssuredAt: server.handler.now()},
		Inputs:    map[string]any{"text": "v7.34.1\nPage logos now load.", "instructions": instructions, "social_set_id": "founder-set"},
	}
	result, err := actions.build(t.Context(), input)
	require.NoError(t, err)
	require.True(t, result.Pending)
	build, err := server.handler.application.Get(t.Context(), "user-1", result.Output["build_id"].(string))
	require.NoError(t, err)
	encoded, err := json.Marshal(build.Input.Direction)
	require.NoError(t, err)
	var direction map[string]any
	require.NoError(t, json.Unmarshal(encoded, &direction))
	require.Equal(t, instructions, direction["instructions"], "keep the complete authored instructions in their own field")
	require.Empty(t, build.Input.Direction.Outcome, "writing instructions are not a short outcome")
	require.Equal(t, input.Inputs["text"], build.Input.Idea)
	require.NotEmpty(t, build.Input.Destinations)
	// Replaying an accepted native step must retain its original authored input.
	input.Inputs["instructions"] = strings.Repeat("changed", 50)
	replayed, err := actions.build(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, result.Output["build_id"], replayed.Output["build_id"])
}
