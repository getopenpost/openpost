package usage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	ProviderX                      = "x"
	XOperationPostCreate           = "post_create"
	XOperationPostCreateWithURL    = "post_create_with_url"
	XPricingSourceURL              = "https://docs.x.com/x-api/getting-started/pricing"
	providerCostTotalOperation     = "__total__"
	providerCostCurrencyMicrounits = "USD"
)

var ErrProviderCostBudgetExceeded = errors.New("provider cost quota exceeded")

type ProviderCostPricing struct {
	Currency              string
	MonthlyBudgetMicrousd int64
	PricingSourceURL      string
	OperationCostMicrousd map[string]int64
}

type ProviderCostPolicy struct {
	Providers map[string]ProviderCostPricing
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
	Enabled            bool
	Recorded           bool
	CostMicrousd       int64
	PeriodCostMicrousd int64
}

type ProviderCostOperationSummary struct {
	Operation    string `json:"operation" doc:"Metered provider operation"`
	EventCount   int64  `json:"event_count" doc:"Number of idempotent request estimates"`
	Units        int64  `json:"units" doc:"Estimated billed operation units"`
	CostMicrousd int64  `json:"cost_microusd" doc:"Estimated provider cost in millionths of the currency unit"`
}

type ProviderCostSummary struct {
	Provider         string                         `json:"provider" doc:"Provider key"`
	Currency         string                         `json:"currency" doc:"ISO 4217 estimate currency"`
	PeriodStart      string                         `json:"period_start" doc:"UTC month start"`
	EventCount       int64                          `json:"event_count" doc:"Number of idempotent provider request estimates"`
	Units            int64                          `json:"units" doc:"Estimated billed provider operation units"`
	CostMicrousd     int64                          `json:"cost_microusd" doc:"Estimated provider cost in millionths of the currency unit"`
	BudgetMicrousd   int64                          `json:"budget_microusd" doc:"Configured monthly safety limit in millionths of the currency unit"`
	PricingSourceURL string                         `json:"pricing_source_url" doc:"Provider pricing source used by this estimate"`
	Operations       []ProviderCostOperationSummary `json:"operations" doc:"Operation-level estimate breakdown"`
}

func NewXProviderCostPolicy(monthlyBudgetMicrousd, postCreateMicrousd, postCreateWithURLMicrousd int64) ProviderCostPolicy {
	return ProviderCostPolicy{Providers: map[string]ProviderCostPricing{
		ProviderX: {
			Currency:              providerCostCurrencyMicrounits,
			MonthlyBudgetMicrousd: monthlyBudgetMicrousd,
			PricingSourceURL:      XPricingSourceURL,
			OperationCostMicrousd: map[string]int64{
				XOperationPostCreate:        postCreateMicrousd,
				XOperationPostCreateWithURL: postCreateWithURLMicrousd,
			},
		},
	}}
}

func (s *Service) SetProviderCostPolicy(policy ProviderCostPolicy) error {
	cloned, err := cloneProviderCostPolicy(policy)
	if err != nil {
		return err
	}
	s.providerCostPolicyMu.Lock()
	s.providerCostPolicy = cloned
	s.providerCostPolicyMu.Unlock()
	return nil
}

func (s *Service) RecordProviderCost(ctx context.Context, input ProviderCostEventInput) (ProviderCostRecordResult, error) {
	pricing, enabled := s.providerPricing(input.Provider)
	if !enabled {
		return ProviderCostRecordResult{}, nil
	}
	if s == nil || s.db == nil {
		return ProviderCostRecordResult{Enabled: true}, errors.New("provider cost storage is unavailable")
	}

	unitCost, cost, err := normalizeProviderCostEventInput(&input, pricing)
	if err != nil {
		return ProviderCostRecordResult{Enabled: true}, err
	}
	result := ProviderCostRecordResult{Enabled: true, CostMicrousd: cost}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return recordProviderCostInTx(txCtx, tx, input, pricing, unitCost, cost, &result)
	})
	return result, err
}

func normalizeProviderCostEventInput(
	input *ProviderCostEventInput,
	pricing ProviderCostPricing,
) (int64, int64, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.Provider = strings.TrimSpace(input.Provider)
	input.Operation = strings.TrimSpace(input.Operation)
	input.OperationKey = strings.TrimSpace(input.OperationKey)
	if input.WorkspaceID == "" {
		return 0, 0, errors.New("workspace id is required")
	}
	if input.OperationKey == "" || len(input.OperationKey) > 200 {
		return 0, 0, errors.New("bounded operation key is required")
	}
	if input.Units <= 0 {
		return 0, 0, errors.New("provider cost units must be positive")
	}
	unitCost, ok := pricing.OperationCostMicrousd[input.Operation]
	if !ok {
		return 0, 0, fmt.Errorf("provider cost operation %q is not priced", input.Operation)
	}
	if unitCost > 0 && input.Units > math.MaxInt64/unitCost {
		return 0, 0, errors.New("provider cost exceeds the supported range")
	}
	cost := input.Units * unitCost
	if input.OccurredAt.IsZero() {
		input.OccurredAt = time.Now().UTC()
	} else {
		input.OccurredAt = input.OccurredAt.UTC()
	}
	return unitCost, cost, nil
}

func recordProviderCostInTx(
	ctx context.Context,
	tx bun.Tx,
	input ProviderCostEventInput,
	pricing ProviderCostPricing,
	unitCost, cost int64,
	result *ProviderCostRecordResult,
) error {
	event := models.ProviderUsageEvent{
		ID:               uuid.NewString(),
		WorkspaceID:      input.WorkspaceID,
		Provider:         input.Provider,
		Operation:        input.Operation,
		OperationKey:     input.OperationKey,
		Units:            input.Units,
		UnitCostMicrousd: unitCost,
		CostMicrousd:     cost,
		OccurredAt:       input.OccurredAt,
		CreatedAt:        time.Now().UTC(),
	}
	inserted, err := tx.NewInsert().
		Model(&event).
		On("CONFLICT (operation_key) DO NOTHING").
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := inserted.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		existing := new(models.ProviderUsageEvent)
		if err := tx.NewSelect().
			Model(existing).
			Where("operation_key = ?", input.OperationKey).
			Scan(ctx); err != nil {
			return err
		}
		if !sameProviderCostEvent(existing, &event) {
			return errors.New("provider cost operation key collision")
		}
		result.CostMicrousd = existing.CostMicrousd
		return nil
	}

	periodStart := MonthStart(input.OccurredAt)
	periodCost, err := incrementProviderCostTotal(
		ctx,
		tx,
		input.WorkspaceID,
		periodStart,
		input.Provider,
		input.Units,
		cost,
		pricing.MonthlyBudgetMicrousd,
	)
	if err != nil {
		return err
	}
	if err := incrementProviderCostOperation(
		ctx,
		tx,
		input.WorkspaceID,
		periodStart,
		input.Provider,
		input.Operation,
		input.Units,
		cost,
	); err != nil {
		return err
	}
	result.Recorded = true
	result.PeriodCostMicrousd = periodCost
	return nil
}

func (s *Service) ReconcileProviderCosts(ctx context.Context, at time.Time) error {
	if s == nil || s.db == nil {
		return errors.New("provider cost storage is unavailable")
	}
	periodStart := MonthStart(at)
	periodEnd := periodStart.AddDate(0, 1, 0)
	var rows []struct {
		WorkspaceID  string `bun:"workspace_id"`
		Provider     string `bun:"provider"`
		Operation    string `bun:"operation"`
		EventCount   int64  `bun:"event_count"`
		Units        int64  `bun:"units"`
		CostMicrousd int64  `bun:"cost_microusd"`
	}
	if err := s.db.NewSelect().
		Model((*models.ProviderUsageEvent)(nil)).
		Column("workspace_id", "provider", "operation").
		ColumnExpr("COUNT(*) AS event_count").
		ColumnExpr("SUM(units) AS units").
		ColumnExpr("SUM(cost_microusd) AS cost_microusd").
		Where("occurred_at >= ? AND occurred_at < ?", periodStart, periodEnd).
		Group("workspace_id", "provider", "operation").
		Scan(ctx, &rows); err != nil {
		return err
	}

	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewDelete().
			Model((*models.ProviderUsagePeriodCounter)(nil)).
			Where("period_start = ?", periodStart).
			Exec(txCtx); err != nil {
			return err
		}

		type totalKey struct {
			workspaceID string
			provider    string
		}
		totals := make(map[totalKey]ProviderCostOperationSummary)
		for _, row := range rows {
			if err := insertProviderCostCounter(txCtx, tx, models.ProviderUsagePeriodCounter{
				WorkspaceID:  row.WorkspaceID,
				PeriodStart:  periodStart,
				Provider:     row.Provider,
				Operation:    row.Operation,
				EventCount:   row.EventCount,
				Units:        row.Units,
				CostMicrousd: row.CostMicrousd,
			}); err != nil {
				return err
			}
			key := totalKey{workspaceID: row.WorkspaceID, provider: row.Provider}
			total := totals[key]
			total.EventCount += row.EventCount
			total.Units += row.Units
			total.CostMicrousd += row.CostMicrousd
			totals[key] = total
		}
		for key, total := range totals {
			if err := insertProviderCostCounter(txCtx, tx, models.ProviderUsagePeriodCounter{
				WorkspaceID:  key.workspaceID,
				PeriodStart:  periodStart,
				Provider:     key.provider,
				Operation:    providerCostTotalOperation,
				EventCount:   total.EventCount,
				Units:        total.Units,
				CostMicrousd: total.CostMicrousd,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) PruneProviderUsageEvents(ctx context.Context, before time.Time, limit int) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("provider cost storage is unavailable")
	}
	if limit <= 0 || limit > 10_000 {
		return 0, errors.New("provider usage prune limit must be between 1 and 10000")
	}
	var ids []string
	if err := s.db.NewSelect().
		Model((*models.ProviderUsageEvent)(nil)).
		Column("id").
		Where("occurred_at < ?", before.UTC()).
		Order("occurred_at ASC", "id ASC").
		Limit(limit).
		Scan(ctx, &ids); err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result, err := s.db.NewDelete().
		Model((*models.ProviderUsageEvent)(nil)).
		Where("id IN (?)", bun.List(ids)).
		Exec(ctx)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Service) SnapshotProviderCosts(ctx context.Context, workspaceID string, at time.Time) ([]ProviderCostSummary, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return nil, errors.New("workspace id is required")
	}
	return s.snapshotProviderCosts(ctx, at, 1, func(query *bun.SelectQuery) *bun.SelectQuery {
		return query.Where("workspace_id = ?", workspaceID)
	})
}

func (s *Service) SnapshotOrganizationProviderCosts(ctx context.Context, organizationID string, at time.Time) ([]ProviderCostSummary, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return nil, errors.New("organization id is required")
	}
	workspaceCount, err := s.db.NewSelect().
		Model((*models.Workspace)(nil)).
		Where("organization_id = ?", organizationID).
		Count(ctx)
	if err != nil {
		return nil, err
	}
	return s.snapshotProviderCosts(ctx, at, int64(workspaceCount), func(query *bun.SelectQuery) *bun.SelectQuery {
		return query.Join("JOIN workspaces AS w ON w.id = provider_usage_period_counter.workspace_id").
			Where("w.organization_id = ?", organizationID)
	})
}

func (s *Service) snapshotProviderCosts(
	ctx context.Context,
	at time.Time,
	budgetMultiplier int64,
	scope func(*bun.SelectQuery) *bun.SelectQuery,
) ([]ProviderCostSummary, error) {
	policy := s.currentProviderCostPolicy()
	if len(policy.Providers) == 0 {
		return []ProviderCostSummary{}, nil
	}
	periodStart := MonthStart(at)
	var rows []struct {
		Provider     string `bun:"provider"`
		Operation    string `bun:"operation"`
		EventCount   int64  `bun:"event_count"`
		Units        int64  `bun:"units"`
		CostMicrousd int64  `bun:"cost_microusd"`
	}
	query := s.db.NewSelect().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Column("provider", "operation").
		ColumnExpr("SUM(event_count) AS event_count").
		ColumnExpr("SUM(units) AS units").
		ColumnExpr("SUM(cost_microusd) AS cost_microusd").
		Where("period_start = ?", periodStart).
		Where("operation != ?", providerCostTotalOperation).
		Group("provider", "operation")
	if err := scope(query).Scan(ctx, &rows); err != nil {
		return nil, err
	}

	byProvider := make(map[string][]ProviderCostOperationSummary)
	for _, row := range rows {
		byProvider[row.Provider] = append(byProvider[row.Provider], ProviderCostOperationSummary{
			Operation:    row.Operation,
			EventCount:   row.EventCount,
			Units:        row.Units,
			CostMicrousd: row.CostMicrousd,
		})
	}
	providers := make([]string, 0, len(policy.Providers))
	for provider := range policy.Providers {
		providers = append(providers, provider)
	}
	sort.Strings(providers)

	summaries := make([]ProviderCostSummary, 0, len(providers))
	for _, provider := range providers {
		pricing := policy.Providers[provider]
		operations := byProvider[provider]
		sort.Slice(operations, func(i, j int) bool {
			return operations[i].Operation < operations[j].Operation
		})
		summary := ProviderCostSummary{
			Provider:         provider,
			Currency:         pricing.Currency,
			PeriodStart:      periodStart.Format(time.RFC3339),
			BudgetMicrousd:   multiplyProviderCost(pricing.MonthlyBudgetMicrousd, budgetMultiplier),
			PricingSourceURL: pricing.PricingSourceURL,
			Operations:       operations,
		}
		for _, operation := range operations {
			summary.EventCount += operation.EventCount
			summary.Units += operation.Units
			summary.CostMicrousd += operation.CostMicrousd
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (s *Service) providerPricing(provider string) (ProviderCostPricing, bool) {
	policy := s.currentProviderCostPolicy()
	pricing, ok := policy.Providers[strings.TrimSpace(provider)]
	return pricing, ok
}

func (s *Service) currentProviderCostPolicy() ProviderCostPolicy {
	if s == nil {
		return ProviderCostPolicy{}
	}
	s.providerCostPolicyMu.RLock()
	defer s.providerCostPolicyMu.RUnlock()
	cloned, _ := cloneProviderCostPolicy(s.providerCostPolicy)
	return cloned
}

func cloneProviderCostPolicy(policy ProviderCostPolicy) (ProviderCostPolicy, error) {
	if len(policy.Providers) == 0 {
		return ProviderCostPolicy{}, nil
	}
	cloned := ProviderCostPolicy{Providers: make(map[string]ProviderCostPricing, len(policy.Providers))}
	for rawProvider, pricing := range policy.Providers {
		provider := strings.TrimSpace(rawProvider)
		if provider == "" {
			return ProviderCostPolicy{}, errors.New("provider cost policy provider is required")
		}
		if pricing.MonthlyBudgetMicrousd < 0 {
			return ProviderCostPolicy{}, fmt.Errorf("%s provider cost budget cannot be negative", provider)
		}
		if strings.TrimSpace(pricing.Currency) == "" || strings.TrimSpace(pricing.PricingSourceURL) == "" {
			return ProviderCostPolicy{}, fmt.Errorf("%s provider cost currency and pricing source are required", provider)
		}
		operations := make(map[string]int64, len(pricing.OperationCostMicrousd))
		for operation, cost := range pricing.OperationCostMicrousd {
			operation = strings.TrimSpace(operation)
			if operation == "" || operation == providerCostTotalOperation || cost < 0 {
				return ProviderCostPolicy{}, fmt.Errorf("%s provider cost operation is invalid", provider)
			}
			operations[operation] = cost
		}
		if len(operations) == 0 {
			return ProviderCostPolicy{}, fmt.Errorf("%s provider cost operations are required", provider)
		}
		pricing.Currency = strings.TrimSpace(pricing.Currency)
		pricing.PricingSourceURL = strings.TrimSpace(pricing.PricingSourceURL)
		pricing.OperationCostMicrousd = operations
		cloned.Providers[provider] = pricing
	}
	return cloned, nil
}

func incrementProviderCostTotal(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	periodStart time.Time,
	provider string,
	units, cost, budget int64,
) (int64, error) {
	if cost > budget {
		return 0, ErrProviderCostBudgetExceeded
	}
	now := time.Now().UTC()
	counter := models.ProviderUsagePeriodCounter{
		WorkspaceID: workspaceID,
		PeriodStart: periodStart,
		Provider:    provider,
		Operation:   providerCostTotalOperation,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if _, err := tx.NewInsert().
		Model(&counter).
		On("CONFLICT (workspace_id, period_start, provider, operation) DO NOTHING").
		Exec(ctx); err != nil {
		return 0, err
	}
	result, err := tx.NewUpdate().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Set("event_count = event_count + 1").
		Set("units = units + ?", units).
		Set("cost_microusd = cost_microusd + ?", cost).
		Set("updated_at = ?", now).
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", provider).
		Where("operation = ?", providerCostTotalOperation).
		Where("cost_microusd <= ?", budget-cost).
		Exec(ctx)
	if err != nil {
		return 0, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if rows == 0 {
		return 0, ErrProviderCostBudgetExceeded
	}
	var periodCost int64
	if err := tx.NewSelect().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Column("cost_microusd").
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", provider).
		Where("operation = ?", providerCostTotalOperation).
		Scan(ctx, &periodCost); err != nil {
		return 0, err
	}
	return periodCost, nil
}

func incrementProviderCostOperation(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	periodStart time.Time,
	provider, operation string,
	units, cost int64,
) error {
	now := time.Now().UTC()
	counter := models.ProviderUsagePeriodCounter{
		WorkspaceID:  workspaceID,
		PeriodStart:  periodStart,
		Provider:     provider,
		Operation:    operation,
		EventCount:   1,
		Units:        units,
		CostMicrousd: cost,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	_, err := tx.NewInsert().
		Model(&counter).
		On("CONFLICT (workspace_id, period_start, provider, operation) DO UPDATE").
		Set("event_count = event_count + EXCLUDED.event_count").
		Set("units = units + EXCLUDED.units").
		Set("cost_microusd = cost_microusd + EXCLUDED.cost_microusd").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func insertProviderCostCounter(ctx context.Context, tx bun.Tx, counter models.ProviderUsagePeriodCounter) error {
	now := time.Now().UTC()
	counter.CreatedAt = now
	counter.UpdatedAt = now
	_, err := tx.NewInsert().Model(&counter).Exec(ctx)
	return err
}

func sameProviderCostEvent(left, right *models.ProviderUsageEvent) bool {
	return left.WorkspaceID == right.WorkspaceID &&
		left.Provider == right.Provider &&
		left.Operation == right.Operation &&
		left.OperationKey == right.OperationKey &&
		left.Units == right.Units &&
		left.UnitCostMicrousd == right.UnitCostMicrousd &&
		left.CostMicrousd == right.CostMicrousd &&
		left.OccurredAt.Equal(right.OccurredAt)
}

func multiplyProviderCost(value, multiplier int64) int64 {
	if value <= 0 || multiplier <= 0 {
		return 0
	}
	if multiplier > math.MaxInt64/value {
		return math.MaxInt64
	}
	return value * multiplier
}
