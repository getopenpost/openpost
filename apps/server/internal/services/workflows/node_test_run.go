package workflows

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"time"

	"github.com/openpost/backend/internal/services/workspaceaccess"
)

type WorkflowNodeTestRequest struct {
	ExpectedRevision int            `json:"expected_revision" minimum:"1"`
	StepID           string         `json:"step_id" minLength:"1" maxLength:"64"`
	Data             map[string]any `json:"data"`
}

// TestNode dispatches only the selected data/tool node. Resolved inputs and the
// single-step definition are retained in the normal durable run history.
func (s *Service) TestNode(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, request WorkflowNodeTestRequest) (Run, error) {
	authority, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister)
	if err != nil {
		return Run{}, err
	}
	record, err := s.loadWorkflow(ctx, workspaceID, id)
	if err != nil {
		return Run{}, err
	}
	if record.Revision != request.ExpectedRevision {
		return Run{}, ErrConflict
	}
	workflow, err := decodeWorkflow(record)
	if err != nil {
		return Run{}, err
	}
	step := findStep(workflow.Definition.Steps, request.StepID)
	if step == nil {
		return Run{}, ErrNotFound
	}
	if !isTransform(step.Kind) && !slices.Contains([]string{KindHTTP, KindFeed, KindAIText, KindAIDecision, KindCondition}, step.Kind) {
		return Run{}, invalid("use a workflow run to test publication actions")
	}
	encoded, err := json.Marshal(request.Data)
	if err != nil || len(encoded) > 256*1024 {
		return Run{}, invalid("test data is too large")
	}
	available := suppliedFields(request.Data)
	if err := validateStep(*step, available, true); err != nil {
		return Run{}, err
	}
	inputs, err := resolveInputs(*step, request.Data)
	if err != nil {
		return Run{}, invalid(err.Error())
	}
	step.Then = nil
	step.Else = nil
	definition := Definition{Schema: SchemaVersion, Source: Source{Kind: "manual"}, Steps: []Step{*step}}
	prepared := StepResult{StepID: step.ID, Kind: step.Kind, Name: step.Name, State: StateRunning, Inputs: inputs, Output: map[string]any{}, StartedAt: time.Now().UTC()}

	source, _ := request.Data["source"].(map[string]any)
	return s.admitRun(ctx, record, definition, authority, ModeTest, source, &prepared)
}

func findStep(steps []Step, id string) *Step {
	for _, step := range steps {
		if step.ID == id {
			return &step
		}
		if match := findStep(step.Then, id); match != nil {
			return match
		}
		if match := findStep(step.Else, id); match != nil {
			return match
		}
	}
	return nil
}

// Scope consists only of explicitly supplied input data for this test.
func suppliedFields(data map[string]any) map[string]bool {
	available := map[string]bool{"source": true}
	var fields func(any, string, int)
	fields = func(value any, path string, depth int) {
		if depth > 10 {
			return
		}
		available[path] = true
		if object, ok := value.(map[string]any); ok {
			for key, child := range object {
				fields(child, path+"."+key, depth+1)
			}
		}
		if items, ok := value.([]any); ok {
			for index, child := range items {
				fields(child, path+"."+strconv.Itoa(index), depth+1)
			}
		}
	}
	for key, value := range data {
		fields(value, key, 0)
	}
	return available
}
