package usage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	ProviderX = "x"

	XOperationContentCreate        = "content_create"
	XOperationContentCreateWithURL = "content_create_with_url"

	XPricingSourceURL = "https://docs.x.com/x-api/getting-started/pricing"
)

var ErrProviderCostBudgetExceeded = errors.New("provider cost quota exceeded")

type ProviderCostPolicy struct {
	Enabled          bool
	Currency         string
	PricingSourceURL string
	MonthlyBudgets   map[string]int64
	UnitCosts        map[string]map[string]int64
}

type ProviderCostEventInput struct {
	WorkspaceID  string
	Provider     string
	Operation    string
	OperationKey string
	Units        int64
	OccurredAt   time.Time
}

type ProviderCostRecordResult struct {
	Recorded           bool
	Duplicate          bool
	CostMicrousd       int64
	PeriodCostMicrousd int64
	BudgetMicrousd     int64
}

type ProviderCostOperationSummary struct {
	Operation    string `json:"operation" doc:"Metered provider operation"`
	EventCount   int64  `json:"event_count" doc:"Number of idempotent operation events"`
	Units        int64  `json:"units" doc:"Billed operation units"`
	CostMicrousd int64  `json:"cost_microusd" doc:"Estimated provider cost in millionths of the currency unit"`
}

type ProviderCostSummary struct {
	Provider         string                         `json:"provider" doc:"Provider key"`
	Currency         string                         `json:"currency" doc:"ISO 4217 cost currency"`
	PeriodStart      string                         `json:"period_start" doc:"UTC month start"`
	EventCount       int64                          `json:"event_count" doc:"Number of idempotent provider operation events"`
	Units            int64                          `json:"units" doc:"Billed provider operation units"`
	CostMicrousd     int64                          `json:"cost_microusd" doc:"Estimated provider cost in millionths of the currency unit"`
	BudgetMicrousd   int64                          `json:"budget_microusd" doc:"Configured monthly organization budget in millionths of the currency unit"`
	PricingSourceURL string                         `json:"pricing_source_url" doc:"Provider pricing source used by this estimate"`
	Operations       []ProviderCostOperationSummary `json:"operations" doc:"Operation-level cost breakdown"`
}

type providerCostAggregate struct {
	WorkspaceID  string `bun:"workspace_id"`
	Provider     string `bun:"provider"`
	Operation    string `bun:"operation"`
	EventCount   int64  `bun:"event_count"`
	Units        int64  `bun:"units"`
	CostMicrousd int64  `bun:"cost_microusd"`
}

func NewXProviderCostPolicy(monthlyBudgetMicrousd, contentCreateMicrousd, contentCreateWithURLMicrousd int64) ProviderCostPolicy {
	return ProviderCostPolicy{
		Enabled:          true,
		Currency:         "USD",
		PricingSourceURL: XPricingSourceURL,
		MonthlyBudgets: map[string]int64{
			ProviderX: monthlyBudgetMicrousd,
		},
		UnitCosts: map[string]map[string]int64{
			ProviderX: {
				XOperationContentCreate:        contentCreateMicrousd,
				XOperationContentCreateWithURL: contentCreateWithURLMicrousd,
			},
		},
	}
}

func (s *Service) SetProviderCostPolicy(policy ProviderCostPolicy) {
	s.providerCostPolicyMu.Lock()
	defer s.providerCostPolicyMu.Unlock()
	s.providerCostPolicy = cloneProviderCostPolicy(policy)
}

func (s *Service) ProviderCostPolicyEnabled() bool {
	return s.providerCostPolicySnapshot().Enabled
}

// RecordProviderCost appends an idempotent usage event and updates its monthly
// projection in the same transaction. A configured hosted budget is reserved
// before the provider request so concurrent workers cannot exceed it.
func (s *Service) RecordProviderCost(ctx context.Context, input ProviderCostEventInput) (ProviderCostRecordResult, error) {
	policy := s.providerCostPolicySnapshot()
	if !policy.Enabled {
		return ProviderCostRecordResult{}, nil
	}
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Operation = strings.TrimSpace(input.Operation)
	input.OperationKey = strings.TrimSpace(input.OperationKey)
	if input.WorkspaceID == "" || input.Provider == "" || input.Operation == "" || input.OperationKey == "" {
		return ProviderCostRecordResult{}, fmt.Errorf("workspace, provider, operation, and operation key are required")
	}
	if input.Units <= 0 {
		return ProviderCostRecordResult{}, fmt.Errorf("provider cost units must be positive")
	}
	if input.OccurredAt.IsZero() {
		input.OccurredAt = time.Now().UTC()
	} else {
		input.OccurredAt = input.OccurredAt.UTC()
	}

	unitCosts, providerEnabled := policy.UnitCosts[input.Provider]
	unitCost, operationEnabled := unitCosts[input.Operation]
	if !providerEnabled || !operationEnabled {
		return ProviderCostRecordResult{}, nil
	}
	if unitCost < 0 {
		return ProviderCostRecordResult{}, fmt.Errorf("provider unit cost cannot be negative")
	}
	budget, hasBudget := policy.MonthlyBudgets[input.Provider]
	if !hasBudget || budget < 0 {
		return ProviderCostRecordResult{}, fmt.Errorf("provider monthly budget is not configured")
	}
	cost, err := multiplyCost(input.Units, unitCost)
	if err != nil {
		return ProviderCostRecordResult{}, err
	}

	result := ProviderCostRecordResult{
		CostMicrousd:   cost,
		BudgetMicrousd: budget,
	}
	periodStart := MonthStart(input.OccurredAt)
	now := time.Now().UTC()
	event := &models.ProviderUsageEvent{
		ID:               uuid.NewString(),
		WorkspaceID:      input.WorkspaceID,
		Provider:         input.Provider,
		Operation:        input.Operation,
		OperationKey:     input.OperationKey,
		Units:            input.Units,
		UnitCostMicrousd: unitCost,
		CostMicrousd:     cost,
		OccurredAt:       input.OccurredAt,
		CreatedAt:        now,
	}

	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		insertResult, insertErr := tx.NewInsert().
			Model(event).
			On("CONFLICT (operation_key) DO NOTHING").
			Exec(txCtx)
		if insertErr != nil {
			return fmt.Errorf("recording provider usage event: %w", insertErr)
		}
		rows, rowsErr := insertResult.RowsAffected()
		if rowsErr != nil {
			return fmt.Errorf("checking provider usage event insert: %w", rowsErr)
		}
		if rows == 0 {
			var existing models.ProviderUsageEvent
			if loadErr := tx.NewSelect().
				Model(&existing).
				Where("operation_key = ?", input.OperationKey).
				Scan(txCtx); loadErr != nil {
				return fmt.Errorf("loading duplicate provider usage event: %w", loadErr)
			}
			if existing.WorkspaceID != input.WorkspaceID ||
				existing.Provider != input.Provider ||
				existing.Operation != input.Operation ||
				existing.Units != input.Units {
				return fmt.Errorf("provider usage operation key was reused with different event data")
			}
			result.Duplicate = true
			result.CostMicrousd = existing.CostMicrousd
			periodCost, periodErr := providerPeriodCost(
				txCtx,
				tx,
				input.WorkspaceID,
				input.Provider,
				MonthStart(existing.OccurredAt),
			)
			result.PeriodCostMicrousd = periodCost
			return periodErr
		}

		counter := &models.ProviderUsagePeriodCounter{
			WorkspaceID: input.WorkspaceID,
			PeriodStart: periodStart,
			Provider:    input.Provider,
			Operation:   input.Operation,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if _, insertErr = tx.NewInsert().
			Model(counter).
			On("CONFLICT (workspace_id, period_start, provider, operation) DO NOTHING").
			Exec(txCtx); insertErr != nil {
			return fmt.Errorf("creating provider usage counter: %w", insertErr)
		}

		update := tx.NewUpdate().
			Model((*models.ProviderUsagePeriodCounter)(nil)).
			Set("event_count = event_count + 1").
			Set("units = units + ?", input.Units).
			Set("cost_microusd = cost_microusd + ?", cost).
			Set("updated_at = ?", now).
			Where("workspace_id = ?", input.WorkspaceID).
			Where("period_start = ?", periodStart).
			Where("provider = ?", input.Provider).
			Where("operation = ?", input.Operation)
		if budget >= 0 {
			update = update.Where(
				"(SELECT COALESCE(SUM(cost_microusd), 0) FROM provider_usage_period_counters WHERE workspace_id = ? AND period_start = ? AND provider = ?) + ? <= ?",
				input.WorkspaceID,
				periodStart,
				input.Provider,
				cost,
				budget,
			)
		}
		updateResult, updateErr := update.Exec(txCtx)
		if updateErr != nil {
			return fmt.Errorf("incrementing provider usage counter: %w", updateErr)
		}
		updated, updateRowsErr := updateResult.RowsAffected()
		if updateRowsErr != nil {
			return fmt.Errorf("checking provider usage counter update: %w", updateRowsErr)
		}
		if updated == 0 {
			return fmt.Errorf("%w for %s: monthly budget is %d microusd", ErrProviderCostBudgetExceeded, input.Provider, budget)
		}
		result.Recorded = true
		result.PeriodCostMicrousd, updateErr = providerPeriodCost(txCtx, tx, input.WorkspaceID, input.Provider, periodStart)
		return updateErr
	})
	return result, err
}

func (s *Service) ReconcileProviderCosts(ctx context.Context, at time.Time) error {
	if !s.ProviderCostPolicyEnabled() {
		return nil
	}
	periodStart := MonthStart(at)
	periodEnd := periodStart.AddDate(0, 1, 0)
	var aggregates []providerCostAggregate
	if err := s.db.NewSelect().
		Model((*models.ProviderUsageEvent)(nil)).
		Column("workspace_id", "provider", "operation").
		ColumnExpr("COUNT(*) AS event_count").
		ColumnExpr("SUM(units) AS units").
		ColumnExpr("SUM(cost_microusd) AS cost_microusd").
		Where("occurred_at >= ?", periodStart).
		Where("occurred_at < ?", periodEnd).
		Group("workspace_id", "provider", "operation").
		Scan(ctx, &aggregates); err != nil {
		return fmt.Errorf("aggregating provider usage events: %w", err)
	}

	now := time.Now().UTC()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewDelete().
			Model((*models.ProviderUsagePeriodCounter)(nil)).
			Where("period_start = ?", periodStart).
			Exec(txCtx); err != nil {
			return fmt.Errorf("clearing provider usage counters: %w", err)
		}
		for _, aggregate := range aggregates {
			counter := &models.ProviderUsagePeriodCounter{
				WorkspaceID:  aggregate.WorkspaceID,
				PeriodStart:  periodStart,
				Provider:     aggregate.Provider,
				Operation:    aggregate.Operation,
				EventCount:   aggregate.EventCount,
				Units:        aggregate.Units,
				CostMicrousd: aggregate.CostMicrousd,
				CreatedAt:    now,
				UpdatedAt:    now,
			}
			if _, err := tx.NewInsert().Model(counter).Exec(txCtx); err != nil {
				return fmt.Errorf("rebuilding provider usage counter: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) PruneProviderUsageEvents(ctx context.Context, before time.Time, limit int) (int64, error) {
	if limit <= 0 {
		limit = 1000
	}
	var ids []string
	if err := s.db.NewSelect().
		Model((*models.ProviderUsageEvent)(nil)).
		Column("id").
		Where("occurred_at < ?", before.UTC()).
		Order("occurred_at ASC", "id ASC").
		Limit(limit).
		Scan(ctx, &ids); err != nil {
		return 0, fmt.Errorf("listing provider usage events to prune: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result, err := s.db.NewDelete().
		Model((*models.ProviderUsageEvent)(nil)).
		Where("id IN (?)", bun.In(ids)).
		Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("pruning provider usage events: %w", err)
	}
	return result.RowsAffected()
}

func (s *Service) SnapshotOrganizationProviderCosts(ctx context.Context, organizationID string, at time.Time) ([]ProviderCostSummary, error) {
	policy := s.providerCostPolicySnapshot()
	if !policy.Enabled || strings.TrimSpace(organizationID) == "" {
		return []ProviderCostSummary{}, nil
	}
	periodStart := MonthStart(at)
	var rows []providerCostAggregate
	if err := s.db.NewSelect().
		TableExpr("provider_usage_period_counters AS puc").
		ColumnExpr("puc.provider").
		ColumnExpr("puc.operation").
		ColumnExpr("SUM(puc.event_count) AS event_count").
		ColumnExpr("SUM(puc.units) AS units").
		ColumnExpr("SUM(puc.cost_microusd) AS cost_microusd").
		Join("JOIN workspaces AS w ON w.id = puc.workspace_id").
		Where("w.organization_id = ?", organizationID).
		Where("puc.period_start = ?", periodStart).
		Group("puc.provider", "puc.operation").
		Order("puc.provider ASC", "puc.operation ASC").
		Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("loading organization provider costs: %w", err)
	}

	workspaceCount, err := s.db.NewSelect().
		Model((*models.Workspace)(nil)).
		Where("organization_id = ?", organizationID).
		Count(ctx)
	if err != nil {
		return nil, fmt.Errorf("counting organization workspaces for provider budget: %w", err)
	}
	if workspaceCount < 1 {
		workspaceCount = 1
	}

	byProvider := make(map[string]*ProviderCostSummary, len(policy.UnitCosts))
	for provider := range policy.UnitCosts {
		byProvider[provider] = &ProviderCostSummary{
			Provider:         provider,
			Currency:         policy.Currency,
			PeriodStart:      periodStart.Format(time.RFC3339),
			BudgetMicrousd:   policy.MonthlyBudgets[provider] * int64(workspaceCount),
			PricingSourceURL: policy.PricingSourceURL,
			Operations:       []ProviderCostOperationSummary{},
		}
	}
	for _, row := range rows {
		summary, ok := byProvider[row.Provider]
		if !ok {
			summary = &ProviderCostSummary{
				Provider:         row.Provider,
				Currency:         policy.Currency,
				PeriodStart:      periodStart.Format(time.RFC3339),
				PricingSourceURL: policy.PricingSourceURL,
				Operations:       []ProviderCostOperationSummary{},
			}
			byProvider[row.Provider] = summary
		}
		summary.EventCount += row.EventCount
		summary.Units += row.Units
		summary.CostMicrousd += row.CostMicrousd
		summary.Operations = append(summary.Operations, ProviderCostOperationSummary{
			Operation:    row.Operation,
			EventCount:   row.EventCount,
			Units:        row.Units,
			CostMicrousd: row.CostMicrousd,
		})
	}

	providers := make([]string, 0, len(byProvider))
	for provider := range byProvider {
		providers = append(providers, provider)
	}
	sortStrings(providers)
	summaries := make([]ProviderCostSummary, 0, len(providers))
	for _, provider := range providers {
		summaries = append(summaries, *byProvider[provider])
	}
	return summaries, nil
}

func providerPeriodCost(ctx context.Context, tx bun.Tx, workspaceID, provider string, periodStart time.Time) (int64, error) {
	var total int64
	if err := tx.NewSelect().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		ColumnExpr("COALESCE(SUM(cost_microusd), 0)").
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", provider).
		Scan(ctx, &total); err != nil {
		return 0, fmt.Errorf("loading provider period cost: %w", err)
	}
	return total, nil
}

func (s *Service) providerCostPolicySnapshot() ProviderCostPolicy {
	s.providerCostPolicyMu.RLock()
	defer s.providerCostPolicyMu.RUnlock()
	return cloneProviderCostPolicy(s.providerCostPolicy)
}

func cloneProviderCostPolicy(policy ProviderCostPolicy) ProviderCostPolicy {
	clone := policy
	clone.MonthlyBudgets = make(map[string]int64, len(policy.MonthlyBudgets))
	for provider, budget := range policy.MonthlyBudgets {
		clone.MonthlyBudgets[provider] = budget
	}
	clone.UnitCosts = make(map[string]map[string]int64, len(policy.UnitCosts))
	for provider, operations := range policy.UnitCosts {
		clone.UnitCosts[provider] = make(map[string]int64, len(operations))
		for operation, cost := range operations {
			clone.UnitCosts[provider][operation] = cost
		}
	}
	return clone
}

func multiplyCost(units, unitCost int64) (int64, error) {
	if units < 0 || unitCost < 0 {
		return 0, fmt.Errorf("provider cost values cannot be negative")
	}
	if units != 0 && unitCost > int64(^uint64(0)>>1)/units {
		return 0, fmt.Errorf("provider cost exceeds supported range")
	}
	return units * unitCost, nil
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}
