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
	providerCostReservationPending = "pending"
	providerCostReservationUnknown = "unknown"
)

var (
	ErrProviderCostBudgetExceeded     = errors.New("provider cost quota exceeded")
	ErrProviderCostReservationMissing = errors.New("provider cost reservation not found")
)

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

type ProviderCostReserveResult struct {
	Enabled                bool
	Reserved               bool
	AlreadyConfirmed       bool
	CostMicrousd           int64
	PeriodExposureMicrousd int64
	ReservationState       string
}

type ProviderCostOperationSummary struct {
	Operation          string `json:"operation" doc:"Metered provider operation"`
	EventCount         int64  `json:"event_count" doc:"Number of confirmed successful request estimates"`
	Units              int64  `json:"units" doc:"Confirmed estimated billed operation units"`
	CostMicrousd       int64  `json:"cost_microusd" doc:"Confirmed estimated provider cost in millionths of the currency unit"`
	ReservedEventCount int64  `json:"reserved_event_count" doc:"Number of in-flight or ambiguous request reservations"`
	ReservedUnits      int64  `json:"reserved_units" doc:"Reserved provider operation units not counted as confirmed billed usage"`
	ReservedMicrousd   int64  `json:"reserved_cost_microusd" doc:"Reserved provider exposure in millionths of the currency unit"`
}

type ProviderCostSummary struct {
	Provider           string                         `json:"provider" doc:"Provider key"`
	Currency           string                         `json:"currency" doc:"ISO 4217 estimate currency"`
	PeriodStart        string                         `json:"period_start" doc:"UTC month start"`
	EventCount         int64                          `json:"event_count" doc:"Number of confirmed successful provider request estimates"`
	Units              int64                          `json:"units" doc:"Confirmed estimated billed provider operation units"`
	CostMicrousd       int64                          `json:"cost_microusd" doc:"Confirmed estimated provider cost in millionths of the currency unit"`
	ReservedEventCount int64                          `json:"reserved_event_count" doc:"Number of in-flight or ambiguous provider request reservations"`
	ReservedUnits      int64                          `json:"reserved_units" doc:"Reserved provider units not counted as confirmed billed usage"`
	ReservedMicrousd   int64                          `json:"reserved_cost_microusd" doc:"Reserved provider exposure in millionths of the currency unit"`
	BudgetMicrousd     int64                          `json:"budget_microusd" doc:"Configured monthly safety limit covering confirmed cost and reservations"`
	PricingSourceURL   string                         `json:"pricing_source_url" doc:"Provider pricing source used by this estimate"`
	Operations         []ProviderCostOperationSummary `json:"operations" doc:"Operation-level confirmed and reserved breakdown"`
}

type providerCostReconciliationRow struct {
	WorkspaceID        string `bun:"workspace_id"`
	Provider           string `bun:"provider"`
	Operation          string `bun:"operation"`
	EventCount         int64  `bun:"event_count"`
	Units              int64  `bun:"units"`
	CostMicrousd       int64  `bun:"cost_microusd"`
	ReservedEventCount int64  `bun:"reserved_event_count"`
	ReservedUnits      int64  `bun:"reserved_units"`
	ReservedMicrousd   int64  `bun:"reserved_cost_microusd"`
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

// RecordProviderCost records a known successful provider request. Publishing
// paths should use ReserveProviderCost before the request and then confirm,
// release, or mark that reservation unknown based on the provider outcome.
func (s *Service) RecordProviderCost(ctx context.Context, input ProviderCostEventInput) (ProviderCostRecordResult, error) {
	reserved, err := s.ReserveProviderCost(ctx, input)
	if err != nil {
		return ProviderCostRecordResult{Enabled: reserved.Enabled}, err
	}
	if !reserved.Enabled {
		return ProviderCostRecordResult{}, nil
	}
	return s.ConfirmProviderCost(ctx, input.OperationKey)
}

func (s *Service) ReserveProviderCost(ctx context.Context, input ProviderCostEventInput) (ProviderCostReserveResult, error) {
	pricing, enabled := s.providerPricing(input.Provider)
	if !enabled {
		return ProviderCostReserveResult{}, nil
	}
	if s == nil || s.db == nil {
		return ProviderCostReserveResult{Enabled: true}, errors.New("provider cost storage is unavailable")
	}

	unitCost, cost, err := normalizeProviderCostEventInput(&input, pricing)
	if err != nil {
		return ProviderCostReserveResult{Enabled: true}, err
	}
	result := ProviderCostReserveResult{
		Enabled:          true,
		CostMicrousd:     cost,
		ReservationState: providerCostReservationPending,
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return reserveProviderCostInTx(txCtx, tx, input, pricing, unitCost, cost, &result)
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

func reserveProviderCostInTx(
	ctx context.Context,
	tx bun.Tx,
	input ProviderCostEventInput,
	pricing ProviderCostPricing,
	unitCost, cost int64,
	result *ProviderCostReserveResult,
) error {
	existingEvent := new(models.ProviderUsageEvent)
	err := tx.NewSelect().
		Model(existingEvent).
		Where("operation_key = ?", input.OperationKey).
		Scan(ctx)
	switch {
	case err == nil:
		candidate := providerUsageEventFromInput(input, unitCost, cost)
		if !sameProviderCostEvent(existingEvent, &candidate) {
			return errors.New("provider cost operation key collision")
		}
		result.AlreadyConfirmed = true
		result.CostMicrousd = existingEvent.CostMicrousd
		return nil
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}

	now := time.Now().UTC()
	reservation := models.ProviderUsageReservation{
		OperationKey:     input.OperationKey,
		WorkspaceID:      input.WorkspaceID,
		Provider:         input.Provider,
		Operation:        input.Operation,
		State:            providerCostReservationPending,
		Units:            input.Units,
		UnitCostMicrousd: unitCost,
		CostMicrousd:     cost,
		OccurredAt:       input.OccurredAt,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	inserted, err := tx.NewInsert().
		Model(&reservation).
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
		existing := new(models.ProviderUsageReservation)
		if err := tx.NewSelect().
			Model(existing).
			Where("operation_key = ?", input.OperationKey).
			Scan(ctx); err != nil {
			return err
		}
		if !sameProviderCostReservation(existing, &reservation) {
			return errors.New("provider cost operation key collision")
		}
		result.CostMicrousd = existing.CostMicrousd
		result.ReservationState = existing.State
		return nil
	}

	periodStart := MonthStart(input.OccurredAt)
	periodExposure, err := reserveProviderCostTotal(
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
	if err := reserveProviderCostOperation(
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
	result.Reserved = true
	result.PeriodExposureMicrousd = periodExposure
	return nil
}

func (s *Service) ConfirmProviderCost(ctx context.Context, operationKey string) (ProviderCostRecordResult, error) {
	operationKey = strings.TrimSpace(operationKey)
	if operationKey == "" {
		return ProviderCostRecordResult{}, errors.New("provider cost operation key is required")
	}
	if s == nil || s.db == nil {
		return ProviderCostRecordResult{}, errors.New("provider cost storage is unavailable")
	}

	result := ProviderCostRecordResult{}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return confirmProviderCostInTx(txCtx, tx, operationKey, &result)
	})
	return result, err
}

func confirmProviderCostInTx(
	ctx context.Context,
	tx bun.Tx,
	operationKey string,
	result *ProviderCostRecordResult,
) error {
	reservation := new(models.ProviderUsageReservation)
	err := tx.NewSelect().
		Model(reservation).
		Where("operation_key = ?", operationKey).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		event := new(models.ProviderUsageEvent)
		if eventErr := tx.NewSelect().
			Model(event).
			Where("operation_key = ?", operationKey).
			Scan(ctx); eventErr != nil {
			if errors.Is(eventErr, sql.ErrNoRows) {
				return ErrProviderCostReservationMissing
			}
			return eventErr
		}
		result.Enabled = true
		result.CostMicrousd = event.CostMicrousd
		result.PeriodCostMicrousd, err = providerConfirmedPeriodCost(
			ctx,
			tx,
			event.WorkspaceID,
			MonthStart(event.OccurredAt),
			event.Provider,
		)
		return err
	}
	if err != nil {
		return err
	}

	result.Enabled = true
	result.CostMicrousd = reservation.CostMicrousd
	event := providerUsageEventFromReservation(reservation)
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
			Where("operation_key = ?", operationKey).
			Scan(ctx); err != nil {
			return err
		}
		if !sameProviderCostEvent(existing, &event) {
			return errors.New("provider cost operation key collision")
		}
	} else {
		result.Recorded = true
	}

	periodStart := MonthStart(reservation.OccurredAt)
	periodCost, err := confirmProviderCostTotal(ctx, tx, reservation, periodStart, rows > 0)
	if err != nil {
		return err
	}
	if err := confirmProviderCostOperation(ctx, tx, reservation, periodStart, rows > 0); err != nil {
		return err
	}
	if _, err := tx.NewDelete().
		Model((*models.ProviderUsageReservation)(nil)).
		Where("operation_key = ?", operationKey).
		Exec(ctx); err != nil {
		return err
	}
	result.PeriodCostMicrousd = periodCost
	return nil
}

func (s *Service) ReleaseProviderCost(ctx context.Context, operationKey string) error {
	operationKey = strings.TrimSpace(operationKey)
	if operationKey == "" {
		return errors.New("provider cost operation key is required")
	}
	if s == nil || s.db == nil {
		return errors.New("provider cost storage is unavailable")
	}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		reservation := new(models.ProviderUsageReservation)
		err := tx.NewSelect().
			Model(reservation).
			Where("operation_key = ?", operationKey).
			Scan(txCtx)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		periodStart := MonthStart(reservation.OccurredAt)
		if err := releaseProviderCostCounter(
			txCtx,
			tx,
			reservation,
			periodStart,
			providerCostTotalOperation,
		); err != nil {
			return err
		}
		if err := releaseProviderCostCounter(
			txCtx,
			tx,
			reservation,
			periodStart,
			reservation.Operation,
		); err != nil {
			return err
		}
		_, err = tx.NewDelete().
			Model((*models.ProviderUsageReservation)(nil)).
			Where("operation_key = ?", operationKey).
			Exec(txCtx)
		return err
	})
}

func (s *Service) MarkProviderCostUnknown(ctx context.Context, operationKey string) error {
	operationKey = strings.TrimSpace(operationKey)
	if operationKey == "" {
		return errors.New("provider cost operation key is required")
	}
	if s == nil || s.db == nil {
		return errors.New("provider cost storage is unavailable")
	}
	_, err := s.db.NewUpdate().
		Model((*models.ProviderUsageReservation)(nil)).
		Set("state = ?", providerCostReservationUnknown).
		Set("updated_at = ?", time.Now().UTC()).
		Where("operation_key = ?", operationKey).
		Where("state = ?", providerCostReservationPending).
		Exec(ctx)
	return err
}

func (s *Service) ReconcileProviderCosts(ctx context.Context, at time.Time) error {
	if s == nil || s.db == nil {
		return errors.New("provider cost storage is unavailable")
	}
	periodStart := MonthStart(at)
	periodEnd := periodStart.AddDate(0, 1, 0)
	var confirmedRows []providerCostReconciliationRow
	if err := s.db.NewSelect().
		Model((*models.ProviderUsageEvent)(nil)).
		Column("workspace_id", "provider", "operation").
		ColumnExpr("COUNT(*) AS event_count").
		ColumnExpr("SUM(units) AS units").
		ColumnExpr("SUM(cost_microusd) AS cost_microusd").
		Where("occurred_at >= ? AND occurred_at < ?", periodStart, periodEnd).
		Group("workspace_id", "provider", "operation").
		Scan(ctx, &confirmedRows); err != nil {
		return err
	}
	var reservedRows []providerCostReconciliationRow
	if err := s.db.NewSelect().
		Model((*models.ProviderUsageReservation)(nil)).
		Column("workspace_id", "provider", "operation").
		ColumnExpr("COUNT(*) AS reserved_event_count").
		ColumnExpr("SUM(units) AS reserved_units").
		ColumnExpr("SUM(cost_microusd) AS reserved_cost_microusd").
		Where("occurred_at >= ? AND occurred_at < ?", periodStart, periodEnd).
		Group("workspace_id", "provider", "operation").
		Scan(ctx, &reservedRows); err != nil {
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
		type operationKey struct {
			workspaceID string
			provider    string
			operation   string
		}
		operations := make(map[operationKey]models.ProviderUsagePeriodCounter)
		totals := make(map[totalKey]models.ProviderUsagePeriodCounter)
		for _, row := range append(confirmedRows, reservedRows...) {
			key := operationKey{workspaceID: row.WorkspaceID, provider: row.Provider, operation: row.Operation}
			counter := operations[key]
			counter.WorkspaceID = row.WorkspaceID
			counter.PeriodStart = periodStart
			counter.Provider = row.Provider
			counter.Operation = row.Operation
			counter.EventCount += row.EventCount
			counter.Units += row.Units
			counter.CostMicrousd += row.CostMicrousd
			counter.ReservedEventCount += row.ReservedEventCount
			counter.ReservedUnits += row.ReservedUnits
			counter.ReservedMicrousd += row.ReservedMicrousd
			operations[key] = counter

			summaryKey := totalKey{workspaceID: row.WorkspaceID, provider: row.Provider}
			total := totals[summaryKey]
			total.WorkspaceID = row.WorkspaceID
			total.PeriodStart = periodStart
			total.Provider = row.Provider
			total.Operation = providerCostTotalOperation
			total.EventCount += row.EventCount
			total.Units += row.Units
			total.CostMicrousd += row.CostMicrousd
			total.ReservedEventCount += row.ReservedEventCount
			total.ReservedUnits += row.ReservedUnits
			total.ReservedMicrousd += row.ReservedMicrousd
			totals[summaryKey] = total
		}
		for _, counter := range operations {
			if err := insertProviderCostCounter(txCtx, tx, counter); err != nil {
				return err
			}
		}
		for key, total := range totals {
			total.WorkspaceID = key.workspaceID
			total.PeriodStart = periodStart
			total.Provider = key.provider
			total.Operation = providerCostTotalOperation
			if err := insertProviderCostCounter(txCtx, tx, total); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) PruneProviderUsageEvents(ctx context.Context, before time.Time, limit int) (int64, error) {
	return s.pruneProviderUsageRows(ctx, (*models.ProviderUsageEvent)(nil), "id", before, limit)
}

func (s *Service) PruneProviderUsageReservations(ctx context.Context, before time.Time, limit int) (int64, error) {
	return s.pruneProviderUsageRows(
		ctx,
		(*models.ProviderUsageReservation)(nil),
		"operation_key",
		before,
		limit,
	)
}

func (s *Service) pruneProviderUsageRows(
	ctx context.Context,
	model any,
	keyColumn string,
	before time.Time,
	limit int,
) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("provider cost storage is unavailable")
	}
	if limit <= 0 || limit > 10_000 {
		return 0, errors.New("provider usage prune limit must be between 1 and 10000")
	}
	var keys []string
	if err := s.db.NewSelect().
		Model(model).
		Column(keyColumn).
		Where("occurred_at < ?", before.UTC()).
		Order("occurred_at ASC", keyColumn+" ASC").
		Limit(limit).
		Scan(ctx, &keys); err != nil {
		return 0, err
	}
	if len(keys) == 0 {
		return 0, nil
	}
	result, err := s.db.NewDelete().
		Model(model).
		Where(keyColumn+" IN (?)", bun.List(keys)).
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
		Provider           string `bun:"provider"`
		Operation          string `bun:"operation"`
		EventCount         int64  `bun:"event_count"`
		Units              int64  `bun:"units"`
		CostMicrousd       int64  `bun:"cost_microusd"`
		ReservedEventCount int64  `bun:"reserved_event_count"`
		ReservedUnits      int64  `bun:"reserved_units"`
		ReservedMicrousd   int64  `bun:"reserved_cost_microusd"`
	}
	query := s.db.NewSelect().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Column("provider", "operation").
		ColumnExpr("SUM(event_count) AS event_count").
		ColumnExpr("SUM(units) AS units").
		ColumnExpr("SUM(cost_microusd) AS cost_microusd").
		ColumnExpr("SUM(reserved_event_count) AS reserved_event_count").
		ColumnExpr("SUM(reserved_units) AS reserved_units").
		ColumnExpr("SUM(reserved_cost_microusd) AS reserved_cost_microusd").
		Where("period_start = ?", periodStart).
		Where("operation != ?", providerCostTotalOperation).
		Where("(event_count > 0 OR reserved_event_count > 0)").
		Group("provider", "operation")
	if err := scope(query).Scan(ctx, &rows); err != nil {
		return nil, err
	}

	byProvider := make(map[string][]ProviderCostOperationSummary)
	for _, row := range rows {
		byProvider[row.Provider] = append(byProvider[row.Provider], ProviderCostOperationSummary{
			Operation:          row.Operation,
			EventCount:         row.EventCount,
			Units:              row.Units,
			CostMicrousd:       row.CostMicrousd,
			ReservedEventCount: row.ReservedEventCount,
			ReservedUnits:      row.ReservedUnits,
			ReservedMicrousd:   row.ReservedMicrousd,
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
			summary.ReservedEventCount += operation.ReservedEventCount
			summary.ReservedUnits += operation.ReservedUnits
			summary.ReservedMicrousd += operation.ReservedMicrousd
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

func reserveProviderCostTotal(
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
		Set("reserved_event_count = reserved_event_count + 1").
		Set("reserved_units = reserved_units + ?", units).
		Set("reserved_cost_microusd = reserved_cost_microusd + ?", cost).
		Set("updated_at = ?", now).
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", provider).
		Where("operation = ?", providerCostTotalOperation).
		Where("cost_microusd + reserved_cost_microusd <= ?", budget-cost).
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
	var counterSnapshot struct {
		CostMicrousd     int64 `bun:"cost_microusd"`
		ReservedMicrousd int64 `bun:"reserved_cost_microusd"`
	}
	if err := tx.NewSelect().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Column("cost_microusd", "reserved_cost_microusd").
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", provider).
		Where("operation = ?", providerCostTotalOperation).
		Scan(ctx, &counterSnapshot); err != nil {
		return 0, err
	}
	return counterSnapshot.CostMicrousd + counterSnapshot.ReservedMicrousd, nil
}

func reserveProviderCostOperation(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	periodStart time.Time,
	provider, operation string,
	units, cost int64,
) error {
	now := time.Now().UTC()
	counter := models.ProviderUsagePeriodCounter{
		WorkspaceID:        workspaceID,
		PeriodStart:        periodStart,
		Provider:           provider,
		Operation:          operation,
		ReservedEventCount: 1,
		ReservedUnits:      units,
		ReservedMicrousd:   cost,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	const targetAlias = "provider_usage_period_counter"
	_, err := tx.NewInsert().
		Model(&counter).
		On("CONFLICT (workspace_id, period_start, provider, operation) DO UPDATE").
		Set(
			"reserved_event_count = ? + EXCLUDED.reserved_event_count",
			bun.Ident(targetAlias+".reserved_event_count"),
		).
		Set(
			"reserved_units = ? + EXCLUDED.reserved_units",
			bun.Ident(targetAlias+".reserved_units"),
		).
		Set(
			"reserved_cost_microusd = ? + EXCLUDED.reserved_cost_microusd",
			bun.Ident(targetAlias+".reserved_cost_microusd"),
		).
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func confirmProviderCostTotal(
	ctx context.Context,
	tx bun.Tx,
	reservation *models.ProviderUsageReservation,
	periodStart time.Time,
	recordConfirmed bool,
) (int64, error) {
	query := tx.NewUpdate().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Set("reserved_event_count = reserved_event_count - 1").
		Set("reserved_units = reserved_units - ?", reservation.Units).
		Set("reserved_cost_microusd = reserved_cost_microusd - ?", reservation.CostMicrousd).
		Set("updated_at = ?", time.Now().UTC()).
		Where("workspace_id = ?", reservation.WorkspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", reservation.Provider).
		Where("operation = ?", providerCostTotalOperation).
		Where("reserved_event_count >= 1").
		Where("reserved_units >= ?", reservation.Units).
		Where("reserved_cost_microusd >= ?", reservation.CostMicrousd)
	if recordConfirmed {
		query = query.
			Set("event_count = event_count + 1").
			Set("units = units + ?", reservation.Units).
			Set("cost_microusd = cost_microusd + ?", reservation.CostMicrousd)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return 0, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if rows == 0 {
		return 0, errors.New("provider cost total reservation counter is inconsistent")
	}
	return providerConfirmedPeriodCost(ctx, tx, reservation.WorkspaceID, periodStart, reservation.Provider)
}

func confirmProviderCostOperation(
	ctx context.Context,
	tx bun.Tx,
	reservation *models.ProviderUsageReservation,
	periodStart time.Time,
	recordConfirmed bool,
) error {
	query := tx.NewUpdate().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Set("reserved_event_count = reserved_event_count - 1").
		Set("reserved_units = reserved_units - ?", reservation.Units).
		Set("reserved_cost_microusd = reserved_cost_microusd - ?", reservation.CostMicrousd).
		Set("updated_at = ?", time.Now().UTC()).
		Where("workspace_id = ?", reservation.WorkspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", reservation.Provider).
		Where("operation = ?", reservation.Operation).
		Where("reserved_event_count >= 1").
		Where("reserved_units >= ?", reservation.Units).
		Where("reserved_cost_microusd >= ?", reservation.CostMicrousd)
	if recordConfirmed {
		query = query.
			Set("event_count = event_count + 1").
			Set("units = units + ?", reservation.Units).
			Set("cost_microusd = cost_microusd + ?", reservation.CostMicrousd)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("provider cost operation reservation counter is inconsistent")
	}
	return nil
}

func releaseProviderCostCounter(
	ctx context.Context,
	tx bun.Tx,
	reservation *models.ProviderUsageReservation,
	periodStart time.Time,
	operation string,
) error {
	result, err := tx.NewUpdate().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Set("reserved_event_count = reserved_event_count - 1").
		Set("reserved_units = reserved_units - ?", reservation.Units).
		Set("reserved_cost_microusd = reserved_cost_microusd - ?", reservation.CostMicrousd).
		Set("updated_at = ?", time.Now().UTC()).
		Where("workspace_id = ?", reservation.WorkspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", reservation.Provider).
		Where("operation = ?", operation).
		Where("reserved_event_count >= 1").
		Where("reserved_units >= ?", reservation.Units).
		Where("reserved_cost_microusd >= ?", reservation.CostMicrousd).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("provider cost reservation counter is inconsistent")
	}
	return nil
}

func providerConfirmedPeriodCost(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	periodStart time.Time,
	provider string,
) (int64, error) {
	var periodCost int64
	err := tx.NewSelect().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Column("cost_microusd").
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", periodStart).
		Where("provider = ?", provider).
		Where("operation = ?", providerCostTotalOperation).
		Scan(ctx, &periodCost)
	return periodCost, err
}

func insertProviderCostCounter(ctx context.Context, tx bun.Tx, counter models.ProviderUsagePeriodCounter) error {
	now := time.Now().UTC()
	counter.CreatedAt = now
	counter.UpdatedAt = now
	_, err := tx.NewInsert().Model(&counter).Exec(ctx)
	return err
}

func providerUsageEventFromInput(
	input ProviderCostEventInput,
	unitCost, cost int64,
) models.ProviderUsageEvent {
	return models.ProviderUsageEvent{
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
}

func providerUsageEventFromReservation(reservation *models.ProviderUsageReservation) models.ProviderUsageEvent {
	return models.ProviderUsageEvent{
		ID:               uuid.NewString(),
		WorkspaceID:      reservation.WorkspaceID,
		Provider:         reservation.Provider,
		Operation:        reservation.Operation,
		OperationKey:     reservation.OperationKey,
		Units:            reservation.Units,
		UnitCostMicrousd: reservation.UnitCostMicrousd,
		CostMicrousd:     reservation.CostMicrousd,
		OccurredAt:       reservation.OccurredAt,
		CreatedAt:        time.Now().UTC(),
	}
}

func sameProviderCostEvent(left, right *models.ProviderUsageEvent) bool {
	return left.WorkspaceID == right.WorkspaceID &&
		left.Provider == right.Provider &&
		left.Operation == right.Operation &&
		left.OperationKey == right.OperationKey &&
		left.Units == right.Units &&
		left.UnitCostMicrousd == right.UnitCostMicrousd &&
		left.CostMicrousd == right.CostMicrousd
}

func sameProviderCostReservation(left, right *models.ProviderUsageReservation) bool {
	return left.WorkspaceID == right.WorkspaceID &&
		left.Provider == right.Provider &&
		left.Operation == right.Operation &&
		left.OperationKey == right.OperationKey &&
		left.Units == right.Units &&
		left.UnitCostMicrousd == right.UnitCostMicrousd &&
		left.CostMicrousd == right.CostMicrousd
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
