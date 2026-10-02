package aiusage

import (
	"context"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/ai"
	"github.com/uptrace/bun"
)

// EditorCall stores provider accounting independently of response parsing and
// browser lifetime. Nil counters mean that the provider usage is unknown.
type EditorCall struct {
	bun.BaseModel     `bun:"table:editor_ai_calls"`
	ID                string     `bun:"id,pk" json:"id"`
	OrganizationID    string     `json:"organization_id"`
	WorkspaceID       string     `json:"workspace_id"`
	UserID            string     `json:"user_id"`
	ProjectID         string     `json:"project_id"`
	RunID             string     `json:"run_id"`
	Step              int        `json:"step"`
	RequestedModel    string     `json:"requested_model"`
	Model             string     `json:"model"`
	ProviderRequestID string     `json:"provider_request_id"`
	State             string     `json:"state"`
	InputTokens       *int64     `json:"input_tokens"`
	OutputTokens      *int64     `json:"output_tokens"`
	TotalTokens       *int64     `json:"total_tokens"`
	CostMicrousd      *int64     `json:"cost_microusd"`
	CreatedAt         time.Time  `json:"created_at"`
	FinishedAt        *time.Time `json:"finished_at"`
}

type EditorIdentity struct {
	WorkspaceID, UserID, ProjectID, RunID string
	Step                                  int
}
type Service struct{ db *bun.DB }

func NewService(db *bun.DB) *Service { return &Service{db: db} }

func (s *Service) Generate(ctx context.Context, identity EditorIdentity, generator ai.Generator, request ai.GenerateRequest) (ai.GenerateResult, error) {
	call := EditorCall{ID: uuid.NewString(), WorkspaceID: identity.WorkspaceID, UserID: identity.UserID, ProjectID: identity.ProjectID, RunID: identity.RunID, Step: identity.Step, RequestedModel: request.Model, State: "dispatched", CreatedAt: time.Now().UTC()}
	if err := s.db.NewSelect().Table("workspaces").Column("organization_id").Where("id = ?", identity.WorkspaceID).Scan(ctx, &call.OrganizationID); err != nil {
		return ai.GenerateResult{}, err
	}
	if _, err := s.db.NewInsert().Model(&call).Exec(ctx); err != nil {
		return ai.GenerateResult{}, err
	}
	result, generationErr := generator.Generate(ctx, request)
	call.Model, call.ProviderRequestID = result.Model, result.RequestID
	call.State = "completed"
	if generationErr != nil {
		call.State = "failed"
	}
	if result.Usage.TotalTokens > 0 || result.Usage.InputTokens > 0 || result.Usage.OutputTokens > 0 {
		input, output, total := max(0, result.Usage.InputTokens), max(0, result.Usage.OutputTokens), max(0, result.Usage.TotalTokens)
		call.InputTokens, call.OutputTokens, call.TotalTokens = &input, &output, &total
	}
	if cost := result.Usage.CostUSD; cost != nil && *cost >= 0 && *cost < 1_000_000 && !math.IsNaN(*cost) && !math.IsInf(*cost, 0) {
		micros := int64(math.Round(*cost * 1_000_000))
		call.CostMicrousd = &micros
	}
	finished := time.Now().UTC()
	call.FinishedAt = &finished
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := s.db.NewUpdate().Model(&call).WherePK().Exec(writeCtx); err != nil {
		return result, err
	}
	return result, generationErr
}

func (s *Service) Invalid(ctx context.Context, runID string, step int) error {
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, err := s.db.NewUpdate().Model((*EditorCall)(nil)).Set("state = 'invalid_output'").Where("run_id = ? AND step = ?", runID, step).Exec(writeCtx)
	return err
}

func (s *Service) List(ctx context.Context, workspaceID, userID string) ([]EditorCall, error) {
	var calls = []EditorCall{}
	err := s.db.NewSelect().Model(&calls).Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Order("created_at DESC").Limit(100).Scan(ctx)
	return calls, err
}
