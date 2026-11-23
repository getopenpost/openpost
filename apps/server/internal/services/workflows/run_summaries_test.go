package workflows

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

func TestRunSummariesPreserveStoredHistoryAndBoundaries(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, actor := workflowTestServiceWithDB(t, nil, workflowRunListTestDB(t, backend))
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Original")}}})
			definition, err := json.Marshal(workflow.Definition)
			require.NoError(t, err)
			now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
			for i := range 55 {
				run := runRecord{ID: fmt.Sprintf("run-%02d", i), WorkspaceID: "ws", WorkflowID: workflow.ID, WorkflowName: "Original name", WorkflowRevision: workflow.Revision, Revision: i + 1, Mode: ModePreview, State: StateSucceeded, DefinitionJSON: string(definition), AuthorityJSON: "{}", SourceJSON: `{"body":"Source payload"}`, RemainingJSON: "[]", ResultsJSON: `[{"step_id":"draft","state":"succeeded","inputs":{"text":"Original"},"output":{"text":"Output payload"}},{"step_id":"unknown","state":"waiting"}]`, CreatedAt: now.Add(time.Duration(i) * time.Minute), UpdatedAt: now}
				_, err := s.db.NewInsert().Model(&run).Exec(t.Context())
				require.NoError(t, err)
			}
			other := saveTestWorkflow(t, s, actor, []Step{{ID: "other", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Other")}}})
			otherRun, err := s.Start(t.Context(), actor, "ws", other.ID, ModePreview, nil, other.Revision)
			require.NoError(t, err)
			_, err = s.db.NewUpdate().Model((*runRecord)(nil)).Set("created_at = ?", now.Add(2*time.Hour)).Where("id = ?", otherRun.ID).Exec(t.Context())
			require.NoError(t, err)
			_, err = s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: "Renamed", ExpectedRevision: workflow.Revision, Definition: Definition{Schema: 1, Source: Source{Kind: "manual"}, Steps: []Step{{ID: "replacement", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Edited")}}}}})
			require.NoError(t, err)
			otherWorkspace := models.Workspace{ID: "other-ws", OrganizationID: "org", Name: "Other", CreatedAt: now}
			_, err = s.db.NewInsert().Model(&otherWorkspace).Exec(t.Context())
			require.NoError(t, err)
			alien := runRecord{ID: "alien", WorkspaceID: "other-ws", WorkflowID: workflow.ID, DefinitionJSON: string(definition), SourceJSON: "{}", ResultsJSON: "[]", AuthorityJSON: "{}", RemainingJSON: "[]", CreatedAt: time.Now().Add(time.Hour), UpdatedAt: now}
			_, err = s.db.NewInsert().Model(&alien).Exec(t.Context())
			require.NoError(t, err)
			summaries, err := s.RunSummaries(t.Context(), actor, "ws", workflow.ID)
			require.NoError(t, err)
			require.Len(t, summaries, 50)
			for i, run := range summaries {
				require.Equal(t, fmt.Sprintf("run-%02d", 54-i), run.ID)
				require.Equal(t, "ws", run.WorkspaceID)
				require.Equal(t, "Original name", run.WorkflowName)
				require.Equal(t, workflow.Definition, run.Definition)
				require.Equal(t, []WorkflowStepSummary{{StepID: "draft", State: "succeeded"}, {StepID: "unknown", State: "waiting"}}, run.Steps)
			}
			all, err := s.RunSummaries(t.Context(), actor, "ws", "")
			require.NoError(t, err)
			require.Len(t, all, 50)
			require.Equal(t, other.ID, all[0].WorkflowID)
			encoded, err := json.Marshal(all)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "Source payload")
			require.NotContains(t, string(encoded), "Output payload")
			denied, err := s.RunSummaries(t.Context(), workspaceaccess.ActorFacts{UserID: "outsider"}, "ws", "")
			require.ErrorIs(t, err, ErrAccess)
			require.Nil(t, denied)
		})
	}
}

func TestRunSummariesKeepJSONStatusTypesAndOrder(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, actor := workflowTestServiceWithDB(t, nil, workflowRunListTestDB(t, backend))
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Test")}}})
			run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModePreview, nil, workflow.Revision)
			require.NoError(t, err)
			for _, tc := range []struct {
				name, results string
				want          []WorkflowStepSummary
				invalid       bool
			}{
				{name: "empty", results: "[]", want: []WorkflowStepSummary{}},
				{name: "legacy null", results: " null ", want: []WorkflowStepSummary{}},
				{name: "null entry and missing status", results: `[null,{"step_id":"draft"}]`, want: []WorkflowStepSummary{{}, {StepID: "draft"}}},
				{name: "unicode and ignored payload", results: `[{"step_id":"雪\u0000","state":"succeeded","output":{"body":"\u0000 \ud83c\udf1f", "large":1e200}},{"step_id":"draft","state":"failed"},{"step_id":"draft","state":"succeeded"}]`, want: []WorkflowStepSummary{{StepID: "雪\x00", State: "succeeded"}, {StepID: "draft", State: "failed"}, {StepID: "draft", State: "succeeded"}}},
				{name: "malformed", results: `[`, invalid: true},
				{name: "object", results: `{"draft":{"step_id":"draft"}}`, invalid: true},
				{name: "scalar entry", results: `[42]`, invalid: true},
				{name: "numeric status", results: `[{"step_id":"draft","state":42}]`, invalid: true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					_, err := s.db.NewUpdate().Model((*runRecord)(nil)).Set("results_json = ?", tc.results).Where("id = ?", run.ID).Exec(t.Context())
					require.NoError(t, err)
					got, err := s.RunSummaries(t.Context(), actor, "ws", workflow.ID)
					if tc.invalid {
						require.Error(t, err)
						return
					}
					require.NoError(t, err)
					require.Len(t, got, 1)
					require.Equal(t, tc.want, got[0].Steps)
				})
			}
		})
	}
}
