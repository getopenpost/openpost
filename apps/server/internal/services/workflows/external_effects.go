package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const decisionMatchThreshold = 0.5

type externalEffectRecord struct {
	bun.BaseModel `bun:"table:workflow_effects"`
	RunID         string `bun:",pk"`
	StepID        string `bun:",pk"`
	WorkspaceID   string
	Kind          string
	State         string
	OutputJSON    string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}
type usageRecord struct {
	bun.BaseModel     `bun:"table:workflow_ai_usage"`
	ID                string `bun:",pk"`
	WorkspaceID       string
	UserID            string
	WorkflowID        string
	RunID             string
	StepID            string
	Kind              string
	Model             string
	ProviderRequestID string
	InputTokens       int64
	OutputTokens      int64
	TotalTokens       int64
	CostUSD           *float64
	State             string
	CreatedAt         time.Time
}

// External APIs cannot participate in the checkpoint transaction. Claim the
// effect first and stop uncertain recovery rather than sending a duplicate write.
func (s *Service) externalEffect(ctx context.Context, record runRecord, step Step, inputs map[string]any) (map[string]any, error) {
	now := time.Now().UTC()
	effect := externalEffectRecord{RunID: record.ID, StepID: step.ID, WorkspaceID: record.WorkspaceID, Kind: step.Kind, State: StateRunning, OutputJSON: "{}", CreatedAt: now, UpdatedAt: now}
	var claimed bool
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, record.WorkspaceID); err != nil {
			return err
		}
		active, err := tx.NewSelect().Model((*runRecord)(nil)).Where("id = ? AND state = ? AND lease_token = ?", record.ID, StateRunning, record.LeaseToken).Exists(ctx)
		if err != nil {
			return err
		}
		if !active {
			return ErrState
		}
		result, err := tx.NewInsert().Model(&effect).On("CONFLICT DO NOTHING").Exec(ctx)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		claimed = n == 1
		return err
	})
	if err != nil {
		return nil, err
	}
	if !claimed {
		if err := s.db.NewSelect().Model(&effect).Where("run_id = ? AND step_id = ?", record.ID, step.ID).Scan(ctx); err != nil {
			return nil, err
		}
		if effect.State != StateSucceeded {
			return nil, errors.New("this external step was interrupted or failed; inspect its previous outcome before starting another run")
		}
		var output map[string]any
		err := json.Unmarshal([]byte(effect.OutputJSON), &output)
		return output, err
	}
	var output map[string]any
	switch step.Kind {
	case KindHTTP:
		output, err = s.request(ctx, record.WorkspaceID, record.ID+":"+step.ID, inputs)
	case KindAIText, KindAIDecision:
		output, err = s.generate(ctx, record, step, inputs)
	default:
		err = errors.New("unsupported external effect")
	}
	state := StateSucceeded
	if err != nil {
		state = StateFailed
	}
	encoded, encodeErr := json.Marshal(output)
	if encodeErr != nil {
		return nil, encodeErr
	}
	_, saveErr := s.db.NewUpdate().Model(&effect).Set("state = ?, output_json = ?, updated_at = ?", state, string(encoded), time.Now().UTC()).WherePK().Exec(ctx)
	if saveErr != nil {
		return nil, saveErr
	}
	return output, err
}

func (s *Service) generate(ctx context.Context, record runRecord, step Step, inputs map[string]any) (map[string]any, error) {
	if (step.Kind == KindAIDecision && s.decider == nil) || (step.Kind == KindAIText && s.generator == nil) {
		return nil, errors.New("configure an AI provider before using this node")
	}
	var authority workspaceaccess.StoredAuthority
	if err := json.Unmarshal([]byte(record.AuthorityJSON), &authority); err != nil {
		return nil, err
	}
	model := s.model
	if step.Kind == KindAIDecision {
		model = s.decisionModel
	}
	usage := usageRecord{ID: record.ID + ":" + step.ID, WorkspaceID: record.WorkspaceID, UserID: authority.UserID, WorkflowID: record.WorkflowID, RunID: record.ID, StepID: step.ID, Kind: step.Kind, Model: model, State: StateRunning, CreatedAt: time.Now().UTC()}
	if _, err := s.db.NewInsert().Model(&usage).Exec(ctx); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	result, output, err := s.generateOutput(ctx, step, model, inputs)
	if result.Model != "" {
		usage.Model = result.Model
	}
	usage.ProviderRequestID = result.RequestID
	usage.InputTokens = max(0, result.Usage.InputTokens)
	usage.OutputTokens = max(0, result.Usage.OutputTokens)
	usage.TotalTokens = max(0, result.Usage.TotalTokens)
	if cost := result.Usage.CostUSD; cost != nil && *cost >= 0 && !math.IsNaN(*cost) && !math.IsInf(*cost, 0) {
		usage.CostUSD = cost
	}
	if err != nil {
		usage.State = StateFailed
		err = errors.New("AI generation failed; check the provider configuration and usage")
		output = nil
	} else {
		usage.State = StateSucceeded
		output["usage"] = map[string]any{"model": usage.Model, "input_tokens": usage.InputTokens, "output_tokens": usage.OutputTokens, "total_tokens": usage.TotalTokens, "cost_usd": usage.CostUSD}
	}
	// Persist even when a provider call failed or its response cannot be parsed.
	writeCtx, cancelWrite := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelWrite()
	if _, saveErr := s.db.NewUpdate().Model(&usage).WherePK().Exec(writeCtx); saveErr != nil {
		return nil, saveErr
	}
	return output, err
}

func (s *Service) generateOutput(ctx context.Context, step Step, model string, inputs map[string]any) (ai.GenerateResult, map[string]any, error) {
	if step.Kind == KindAIDecision {
		decision, decisionErr := s.decider.Decide(ctx, ai.DecisionRequest{Model: model, Input: textInput(inputs, "text"), Criteria: textInput(inputs, "instructions")})
		result := ai.GenerateResult{Model: decision.Model, RequestID: decision.RequestID, Usage: decision.Usage}
		err := decisionErr
		if err == nil && (math.IsNaN(decision.Probability) || math.IsInf(decision.Probability, 0) || decision.Probability < 0 || decision.Probability > 1) {
			err = errors.New("invalid decision probability")
		}
		// Retain reason for saved bindings. Jev reports evidence as a probability,
		// not a generated explanation.
		output := map[string]any{"matched": decision.Probability >= decisionMatchThreshold, "probability": decision.Probability, "reason": ""}
		return result, output, err
	}
	result, err := s.generator.Generate(ctx, ai.GenerateRequest{Model: model, SystemPrompt: textInput(inputs, "instructions"), UserPrompt: textInput(inputs, "text"), MaxOutputTokens: 2048})
	return result, map[string]any{"text": result.Text}, err
}
