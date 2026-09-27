package workflows

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) Start(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id, mode string, source map[string]any, expected int) (Run, error) {
	level := workspaceaccess.LevelEdit
	if mode == ModeLive {
		level = workspaceaccess.LevelAdminister
	}
	authority, err := s.authorize(ctx, actor, workspaceID, level)
	if err != nil {
		return Run{}, err
	}
	if mode != ModeLive && mode != ModePreview {
		return Run{}, invalid("choose preview or live execution")
	}
	record, err := s.loadWorkflow(ctx, workspaceID, id)
	if err != nil {
		return Run{}, err
	}
	if record.Revision != expected {
		return Run{}, ErrConflict
	}
	item, err := decodeWorkflow(record)
	if err != nil {
		return Run{}, err
	}
	if err := Validate(item.Definition, true); err != nil {
		return Run{}, err
	}
	data, err := json.Marshal(source)
	if err != nil || len(data) > 64*1024 {
		return Run{}, invalid("sample is too large")
	}
	var run runRecord
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		count, err := tx.NewSelect().Model((*runRecord)(nil)).Where("workspace_id = ? AND state IN (?)", workspaceID, bun.List([]string{StateQueued, StateRunning, StateWaiting, StateApproval})).Count(ctx)
		if err != nil {
			return err
		}
		if count >= maxActiveRuns {
			return invalid("workspace has reached 1000 active workflow runs")
		}
		var createErr error
		run, createErr = s.createRun(ctx, tx, record, item.Definition, authority, mode, source)
		return createErr
	})
	if err != nil {
		return Run{}, err
	}
	return decodeRun(run)
}

func (s *Service) createRun(ctx context.Context, db bun.IDB, workflow workflowRecord, def Definition, authority workspaceaccess.StoredAuthority, mode string, source map[string]any) (runRecord, error) {
	now := time.Now().UTC()
	definitionJSON, err := json.Marshal(def)
	if err != nil {
		return runRecord{}, err
	}
	authorityJSON, err := json.Marshal(authority)
	if err != nil {
		return runRecord{}, err
	}
	sourceJSON, err := json.Marshal(source)
	if err != nil {
		return runRecord{}, err
	}
	stepsJSON, err := json.Marshal(def.Steps)
	if err != nil {
		return runRecord{}, err
	}
	revision := workflow.Revision
	if workflow.PublishedRevision > 0 && workflow.PublishedJSON == string(definitionJSON) {
		revision = workflow.PublishedRevision
	}
	record := runRecord{ID: uuid.NewString(), WorkflowID: workflow.ID, WorkspaceID: workflow.WorkspaceID, WorkflowName: workflow.Name, WorkflowRevision: revision, Mode: mode, State: StateQueued, Revision: 1, DefinitionJSON: string(definitionJSON), AuthorityJSON: string(authorityJSON), SourceJSON: string(sourceJSON), RemainingJSON: string(stepsJSON), ResultsJSON: "[]", CreatedAt: now, UpdatedAt: now}
	if _, err := db.NewInsert().Model(&record).Exec(ctx); err != nil {
		return record, err
	}
	return record, enqueueRun(ctx, db, record, now)
}
func (s *Service) Runs(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, workflowID string) ([]Run, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	records := []runRecord{}
	query := s.db.NewSelect().Model(&records).Where("workspace_id = ?", workspaceID).Order("created_at DESC").Limit(50)
	if workflowID != "" {
		query = query.Where("workflow_id = ?", workflowID)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	result := make([]Run, 0, len(records))
	for _, record := range records {
		item, err := decodeRun(record)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}
func (s *Service) GetRun(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string) (Run, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return Run{}, err
	}
	var record runRecord
	err := s.db.NewSelect().Model(&record).Where("id = ? AND workspace_id = ?", id, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	return decodeRun(record)
}
func (s *Service) Cancel(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, expected int) (Run, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return Run{}, err
	}
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		result, err := tx.NewUpdate().Model((*runRecord)(nil)).Set("state = ?, revision = revision + 1, wake_at = NULL, updated_at = ?", StateCancelled, time.Now().UTC()).
			Where("id = ? AND workspace_id = ? AND revision = ? AND state IN (?)", id, workspaceID, expected, bun.List([]string{StateQueued, StateRunning, StateWaiting, StateApproval})).Exec(ctx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrState
		}
		return nil
	})
	if err != nil {
		return Run{}, err
	}

	return s.GetRun(ctx, actor, workspaceID, id)
}

// Approve binds approval to the current native publication revision. The next
// scheduling command receives that revision and rejects intervening edits.
func (s *Service) Approve(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, expected, publicationRevision int) (Run, error) {
	authority, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister)
	if err != nil {
		return Run{}, err
	}
	var record runRecord
	if err := s.db.NewSelect().Model(&record).Where("id = ? AND workspace_id = ?", id, workspaceID).Scan(ctx); err != nil {
		return Run{}, ErrNotFound
	}
	if record.State != StateApproval || record.Revision != expected {
		return Run{}, ErrState
	}
	run, err := decodeRun(record)
	if err != nil {
		return Run{}, err
	}
	index := -1
	for i, step := range run.Steps {
		if step.StepID == record.CurrentStepID {
			index = i
			break
		}
	}
	if index < 0 {
		return Run{}, ErrState
	}
	step := run.Steps[index]
	inputs := map[string]any{"publication_id": step.Inputs["publication_id"], "revision": publicationRevision}
	if s.actions == nil {
		return Run{}, errors.New("native workflow actions are unavailable")
	}
	approved, err := s.actions.Execute(ctx, EffectRequest{Kind: KindApproval, Inputs: inputs, Authority: authority, RunID: id, StepID: step.StepID, ExpiresAt: record.CreatedAt.Add(MaxRunAge)})
	if err != nil {
		return Run{}, err
	}
	if err := s.resumeApprovedRun(ctx, record, run, index, approved, actor.UserID); err != nil {
		return Run{}, err
	}
	return s.GetRun(ctx, actor, workspaceID, id)
}
func (s *Service) resumeApprovedRun(ctx context.Context, record runRecord, run Run, index int, approved EffectResult, reviewerID string) error {
	id, workspaceID, expected := record.ID, record.WorkspaceID, record.Revision
	step := run.Steps[index]
	now := time.Now().UTC()
	approved.Output["approved_by"] = reviewerID
	step.Output = approved.Output
	step.State = StateSucceeded
	step.CompletedAt = &now
	run.Steps[index] = step
	resultsJSON, err := json.Marshal(run.Steps)
	if err != nil {
		return err
	}
	var remaining []Step
	if err := json.Unmarshal([]byte(record.RemainingJSON), &remaining); err != nil {
		return err
	}
	if len(remaining) == 0 || remaining[0].ID != step.StepID {
		return ErrState
	}
	remainingJSON, err := json.Marshal(remaining[1:])
	if err != nil {
		return err
	}
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*runRecord)(nil)).Set("state = ?, results_json = ?, remaining_json = ?, current_step_id = '', revision = revision + 1, updated_at = ?", StateQueued, string(resultsJSON), string(remainingJSON), now).
			Where("id = ? AND workspace_id = ? AND revision = ? AND state = ?", id, workspaceID, expected, StateApproval).Exec(ctx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrState
		}
		record.Revision++
		return enqueueRun(ctx, tx, record, now)
	})
	if err != nil {
		return err
	}
	return nil
}

func decodeRun(record runRecord) (Run, error) {
	run := Run{ID: record.ID, WorkflowID: record.WorkflowID, WorkspaceID: record.WorkspaceID, WorkflowName: record.WorkflowName, WorkflowRevision: record.WorkflowRevision, Mode: record.Mode, State: record.State, Revision: record.Revision, CurrentStepID: record.CurrentStepID, Error: record.Error, WakeAt: record.WakeAt, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt, Steps: []StepResult{}}
	for _, entry := range []struct {
		data   string
		target any
	}{{record.DefinitionJSON, &run.Definition}, {record.SourceJSON, &run.Source}, {record.ResultsJSON, &run.Steps}} {
		if err := json.Unmarshal([]byte(entry.data), entry.target); err != nil {
			return Run{}, fmt.Errorf("decode workflow run: %w", err)
		}
	}
	return run, nil
}
