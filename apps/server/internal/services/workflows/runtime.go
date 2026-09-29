package workflows

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const runLeaseDuration = 3 * time.Minute

func (s *Service) executeRun(ctx context.Context, id string) error {
	now := time.Now().UTC()
	leaseUntil := now.Add(runLeaseDuration)
	token := uuid.NewString()
	claimed, err := s.db.NewUpdate().Model((*runRecord)(nil)).Set("lease_token = ?, lease_until = ?, state = ?", token, leaseUntil, StateRunning).
		Where("id = ? AND state IN (?)", id, bun.List([]string{StateQueued, StateRunning, StateWaiting})).
		Where("(wake_at IS NULL OR wake_at <= ?) AND (lease_until IS NULL OR lease_until <= ?)", now, now).Exec(ctx)
	if err != nil {
		return err
	}
	if n, _ := claimed.RowsAffected(); n != 1 {
		return nil
	}
	var record runRecord
	if err := s.db.NewSelect().Model(&record).Where("id = ? AND lease_token = ?", id, token).Scan(ctx); err != nil {
		return err
	}
	run, err := decodeRun(record)
	if err != nil {
		return err
	}
	var remaining []Step
	if err := json.Unmarshal([]byte(record.RemainingJSON), &remaining); err != nil {
		return err
	}
	var authority workspaceaccess.StoredAuthority
	if err := json.Unmarshal([]byte(record.AuthorityJSON), &authority); err != nil {
		return err
	}
	if now.After(record.CreatedAt.Add(MaxRunAge)) {
		return s.finishRunStep(ctx, record, run.Steps, remaining, StateFailed, "The run reached its 30 day limit.", nil)
	}
	level := workspaceaccess.LevelEdit
	if record.Mode != ModePreview {
		level = workspaceaccess.LevelAdminister
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).AuthorizeStored(ctx, authority, level)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return s.finishRunStep(ctx, record, run.Steps, remaining, StateFailed, ErrAccess.Error(), nil)
	}
	if len(remaining) == 0 {
		return s.finishRunStep(ctx, record, run.Steps, remaining, StateSucceeded, "", nil)
	}
	return s.advanceRun(ctx, record, &run, remaining, authority)
}

func (s *Service) advanceRun(ctx context.Context, record runRecord, run *Run, remaining []Step, authority workspaceaccess.StoredAuthority) error {
	step := remaining[0]
	index, prepared, err := s.prepareRunStep(ctx, record, run, step)
	if err != nil {
		return err
	}
	if !prepared {
		return nil
	}
	result := run.Steps[index]
	progress := stepProgress{result: result, remaining: remaining[1:], state: StateQueued}
	if result.Error == "" {
		progress, err = s.evaluateStep(ctx, record, authority, step, result, remaining)
		if err != nil {
			progress.result.Error = err.Error()
		}
	}
	completed := time.Now().UTC()
	switch {
	case progress.result.Error != "":
		progress.state = StateFailed
		progress.remaining = remaining
		progress.result.State = StateFailed
		progress.result.CompletedAt = &completed
	case progress.state == StateWaiting || progress.state == StateApproval:
		progress.result.State = progress.state
	default:
		progress.result.State = StateSucceeded
		progress.result.CompletedAt = &completed
	}
	if progress.state == StateQueued && len(progress.remaining) == 0 {
		progress.state = StateSucceeded
	}
	run.Steps[index] = progress.result
	return s.finishRunStep(ctx, record, run.Steps, progress.remaining, progress.state, progress.result.Error, progress.wakeAt)
}

func (s *Service) executeEffect(ctx context.Context, record runRecord, authority workspaceaccess.StoredAuthority, step Step, inputs map[string]any) (EffectResult, error) {
	if s.actions == nil {
		return EffectResult{}, errors.New("native workflow actions are unavailable")
	}
	active, err := s.db.NewSelect().Model((*runRecord)(nil)).Where("id = ? AND state = ? AND lease_token = ?", record.ID, StateRunning, record.LeaseToken).Exists(ctx)
	if err != nil {
		return EffectResult{}, err
	}
	if !active {
		return EffectResult{}, errors.New("run cancelled before the next action")
	}
	return s.actions.Execute(ctx, EffectRequest{Kind: step.Kind, Inputs: inputs, Authority: authority, RunID: record.ID, StepID: step.ID, ExpiresAt: record.CreatedAt.Add(MaxRunAge + 24*time.Hour)})
}

func (s *Service) finishRunStep(ctx context.Context, record runRecord, results []StepResult, remaining []Step, state, message string, wakeAt *time.Time) error {
	resultJSON, err := json.Marshal(results)
	if err != nil {
		return err
	}
	remainingJSON, err := json.Marshal(remaining)
	if err != nil {
		return err
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, record.WorkspaceID); err != nil {
			return err
		}
		var current runRecord
		if err := tx.NewSelect().Model(&current).Where("id = ? AND lease_token = ?", record.ID, record.LeaseToken).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		if current.State == StateCancelled {
			state = StateCancelled
			wakeAt = nil
		}
		currentStep := ""
		if len(remaining) > 0 {
			currentStep = remaining[0].ID
		}
		updated, err := tx.NewUpdate().Model((*runRecord)(nil)).
			Set("results_json = ?, remaining_json = ?, state = ?, error = ?, wake_at = ?, current_step_id = ?", string(resultJSON), string(remainingJSON), state, message, wakeAt, currentStep).
			Set("revision = revision + 1, lease_token = '', lease_until = NULL, updated_at = ?", time.Now().UTC()).
			Where("id = ? AND lease_token = ? AND revision = ?", record.ID, record.LeaseToken, current.Revision).Exec(ctx)
		if err != nil {
			return err
		}
		if n, _ := updated.RowsAffected(); n != 1 {
			return nil
		}
		current.Revision++
		current.State = state
		if state == StateQueued || state == StateWaiting {
			runAt := time.Now().UTC()
			if wakeAt != nil {
				runAt = *wakeAt
			}
			return enqueueRun(ctx, tx, current, runAt)
		}
		return nil
	})
}

func number(value any) (float64, error) {
	var result float64
	var err error
	switch v := value.(type) {
	case float64:
		result = v
	case int:
		result = float64(v)
	case json.Number:
		result, err = v.Float64()
	case string:
		result, err = strconv.ParseFloat(strings.TrimSpace(v), 64)
	default:
		return 0, errors.New("expected a number")
	}
	if err != nil || math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, errors.New("expected a finite number")
	}
	return result, nil
}

// Text from form fields adopts the type of a referenced scalar. Two text values
// keep exact text equality, so identifiers such as "001" and "1" stay distinct.
func equalityOperand(value, example any) (any, error) {
	text, ok := value.(string)
	if !ok {
		return value, nil
	}
	switch example.(type) {
	case float64, int, json.Number:
		return number(text)
	case bool:
		switch strings.ToLower(strings.TrimSpace(text)) {
		case "true":
			return true, nil
		case "false":
			return false, nil
		default:
			return nil, errors.New("enter true or false to compare a boolean value")
		}
	}
	return value, nil
}
func equalValues(left, right any) (bool, error) {
	left, err := equalityOperand(left, right)
	if err != nil {
		return false, err
	}
	right, err = equalityOperand(right, left)
	if err != nil {
		return false, err
	}
	return reflect.DeepEqual(left, right), nil
}
func compare(inputs map[string]any) (bool, error) {
	left, lExists := inputs["left"]
	right, rExists := inputs["right"]
	if !lExists || !rExists {
		return false, errors.New("both condition values are required")
	}
	operator, _ := inputs["operator"].(string)
	switch operator {
	case "equals":
		return equalValues(left, right)
	case "not_equals":
		equal, err := equalValues(left, right)
		return !equal, err
	case "contains":
		l, ok := left.(string)
		r, okR := right.(string)
		if !ok || !okR {
			return false, errors.New("contains requires two text values")
		}
		return strings.Contains(strings.ToLower(l), strings.ToLower(r)), nil
	case "greater_than", "at_least", "less_than":
		l, err := number(left)
		if err != nil {
			return false, errors.New("the first condition value is not a number")
		}
		r, err := number(right)
		if err != nil {
			return false, errors.New("the second condition value is not a number")
		}
		if operator == "greater_than" {
			return l > r, nil
		}
		if operator == "at_least" {
			return l >= r, nil
		}
		return l < r, nil
	default:
		return false, errors.New("choose a supported condition operator")
	}
}
func previewOutput(step Step, inputs map[string]any) map[string]any {
	output := map[string]any{"preview": true}
	switch step.Kind {
	case KindDraft, KindBuild:
		output["id"] = "preview-" + step.ID
		output["revision"] = 1
		output["text"] = inputs["text"]
		output["title"] = inputs["title"]
		output["status"] = "draft"
	case KindApproval:
		output["publication_id"] = inputs["publication_id"]
		output["revision"] = 1
		output["approved"] = true
	case KindSchedule:
		output["renditions"] = []any{}
		output["publication_id"] = inputs["publication_id"]
		output["scheduled_at"] = inputs["scheduled_at"]
		output["status"] = "scheduled"
	case KindReply:
		output["rendition_id"] = inputs["rendition_id"]
		output["status"] = "queued"
	case KindMetrics:
		output["likes"] = float64(10)
		output["comments"] = float64(2)
		output["impressions"] = float64(100)
		output["observed_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	return output
}

func decodeJobPayload(payload string) (map[string]string, error) {
	var result map[string]string
	if err := json.Unmarshal([]byte(payload), &result); err != nil {
		return nil, fmt.Errorf("decode workflow job: %w", err)
	}
	return result, nil
}
