package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/openpost/backend/internal/services/workspaceaccess"
)

type stepProgress struct {
	result    StepResult
	remaining []Step
	state     string
	wakeAt    *time.Time
}

// The resolved inputs and relative times commit before native effects. A worker
// replay uses the original request, even if time or source data has changed.
func (s *Service) prepareRunStep(ctx context.Context, record runRecord, run *Run, step Step) (int, bool, error) {
	values := map[string]any{"source": run.Source}
	for i, result := range run.Steps {
		if result.StepID == step.ID {
			return i, true, nil
		}
		if result.State == StateSucceeded {
			values[result.StepID] = result.Output
		}
	}
	now := time.Now().UTC()
	inputs, inputErr := resolveInputs(step, values)
	result := StepResult{StepID: step.ID, Kind: step.Kind, Name: step.Name, State: StateRunning, Inputs: inputs, Output: map[string]any{}, StartedAt: now}
	if inputErr != nil {
		result.Error = inputErr.Error()
	} else {
		anchorStepTimes(step, &result)
	}
	run.Steps = append(run.Steps, result)
	index := len(run.Steps) - 1
	prepared, err := json.Marshal(run.Steps)
	if err != nil {
		return index, false, err
	}
	updated, err := s.db.NewUpdate().Model((*runRecord)(nil)).Set("results_json = ?, current_step_id = ?, updated_at = ?", string(prepared), step.ID, now).Where("id = ? AND lease_token = ? AND state = ?", record.ID, record.LeaseToken, StateRunning).Exec(ctx)
	if err != nil {
		return index, false, err
	}
	n, err := updated.RowsAffected()
	return index, n == 1, err
}
func anchorStepTimes(step Step, result *StepResult) {
	switch step.Kind {
	case KindReply:
		result.Inputs["run_at"] = result.StartedAt.Format(time.RFC3339Nano)
	case KindSchedule:
		minutes, err := number(result.Inputs["minutes"])
		if err != nil || minutes < 1 || minutes > 43200 {
			result.Error = "schedule delay must be between 1 minute and 30 days"
			return
		}
		result.Inputs["scheduled_at"] = result.StartedAt.Add(time.Duration(minutes * float64(time.Minute))).Format(time.RFC3339Nano)
	}
}
func (s *Service) evaluateStep(ctx context.Context, record runRecord, authority workspaceaccess.StoredAuthority, step Step, result StepResult, remaining []Step) (stepProgress, error) {
	progress := stepProgress{result: result, remaining: remaining[1:], state: StateQueued}
	if isTransform(step.Kind) {
		output, err := transform(ctx, step.Kind, result.Inputs)
		progress.result.Output = output
		return progress, err
	}
	switch step.Kind {
	case KindHTTP, KindAIText, KindAIDecision:
		return s.evaluateExternalStep(ctx, record, step, progress)
	case KindFeed:
		return s.evaluateFeedStep(ctx, record.Mode, progress)
	case KindCondition:
		matched, err := compare(result.Inputs)
		if err != nil {
			return progress, err
		}
		progress.result.Output = map[string]any{"matched": matched}
		branch := step.Else
		if matched {
			branch = step.Then
		}
		progress.remaining = append(append([]Step{}, branch...), progress.remaining...)
	case KindWait:
		minutes, err := number(result.Inputs["minutes"])
		if err != nil || minutes < 0 || minutes > 43200 {
			return progress, errors.New("wait must be between 0 minutes and 30 days")
		}
		deadline := result.StartedAt.Add(time.Duration(minutes * float64(time.Minute)))
		progress.result.Output = map[string]any{"until": deadline.Format(time.RFC3339)}
		if record.Mode == ModeLive && time.Now().Before(deadline) {
			progress.state = StateWaiting
			progress.wakeAt = &deadline
			progress.remaining = remaining
		}
	default:
		return s.evaluateNativeStep(ctx, record, authority, step, progress, remaining)
	}
	return progress, nil
}
func (s *Service) evaluateExternalStep(ctx context.Context, record runRecord, step Step, progress stepProgress) (stepProgress, error) {
	if record.Mode == ModePreview {
		progress.result.Output = map[string]any{"preview": true, "text": textInput(progress.result.Inputs, "text"), "matched": true, "probability": 0.75, "reason": "", "body": map[string]any{}, "status": 200}
	} else {
		output, err := s.externalEffect(ctx, record, step, progress.result.Inputs)
		progress.result.Output = output
		if err != nil {
			return progress, err
		}
	}
	if step.Kind == KindAIDecision {
		branch := step.Else
		if progress.result.Output["matched"] == true {
			branch = step.Then
		}
		progress.remaining = append(append([]Step{}, branch...), progress.remaining...)
	}
	return progress, nil
}

func (s *Service) evaluateFeedStep(ctx context.Context, mode string, progress stepProgress) (stepProgress, error) {
	if mode == ModePreview {
		progress.result.Output = map[string]any{"preview": true, "items": []any{}, "count": 0}
		return progress, nil
	}
	items, err := s.feedItems(ctx, textInput(progress.result.Inputs, "url"))
	if err != nil {
		return progress, err
	}
	output := map[string]any{"items": items, "count": len(items)}
	encoded, err := json.Marshal(output)
	if err != nil || len(encoded) > 256*1024 {
		return progress, errors.New("feed output exceeds 256 KiB; use an RSS trigger to process entries individually")
	}
	progress.result.Output = output
	return progress, nil
}

func (s *Service) evaluateNativeStep(ctx context.Context, record runRecord, authority workspaceaccess.StoredAuthority, step Step, progress stepProgress, remaining []Step) (stepProgress, error) {
	if record.Mode == ModePreview {
		progress.result.Output = previewOutput(step, progress.result.Inputs)
		return progress, nil
	}
	effect, err := s.executeEffect(ctx, record, authority, step, progress.result.Inputs)
	progress.result.Output = effect.Output
	if err != nil {
		return progress, err
	}
	switch {
	case step.Kind == KindApproval:
		progress.state = StateApproval
		progress.remaining = remaining
	case effect.Pending:
		wake := time.Now().UTC().Add(5 * time.Second)
		progress.state = StateWaiting
		progress.wakeAt = &wake
		progress.remaining = remaining
	}
	return progress, nil
}
