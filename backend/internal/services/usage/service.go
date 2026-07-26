package usage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

type Service struct {
	db *bun.DB
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func MonthStart(t time.Time) time.Time {
	utc := t.UTC()
	return time.Date(utc.Year(), utc.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func (s *Service) IncrementMonthly(ctx context.Context, workspaceID string, metric entitlements.LimitKey, amount int64, at time.Time) (int64, error) {
	if amount <= 0 {
		return 0, fmt.Errorf("usage increment amount must be positive")
	}
	if workspaceID == "" {
		return 0, fmt.Errorf("workspace id is required")
	}
	if metric == "" {
		return 0, fmt.Errorf("usage metric is required")
	}

	periodStart := MonthStart(at)
	now := time.Now().UTC()
	var value int64
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var counter models.UsageCounter
		err := tx.NewSelect().
			Model(&counter).
			Where("workspace_id = ?", workspaceID).
			Where("metric = ?", string(metric)).
			Where("period_start = ?", periodStart).
			Scan(txCtx)
		switch err {
		case nil:
			value = counter.Value + amount
			_, err = tx.NewUpdate().
				Model((*models.UsageCounter)(nil)).
				Set("value = ?", value).
				Set("updated_at = ?", now).
				Where("workspace_id = ?", workspaceID).
				Where("metric = ?", string(metric)).
				Where("period_start = ?", periodStart).
				Exec(txCtx)
			return err
		case sql.ErrNoRows:
			value = amount
			counter = models.UsageCounter{
				WorkspaceID: workspaceID,
				Metric:      string(metric),
				PeriodStart: periodStart,
				Value:       value,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			_, err = tx.NewInsert().Model(&counter).Exec(txCtx)
			return err
		default:
			return err
		}
	})
	return value, err
}

func (s *Service) CurrentMonthly(ctx context.Context, workspaceID string, metric entitlements.LimitKey, at time.Time) (int64, error) {
	var counter models.UsageCounter
	err := s.db.NewSelect().
		Model(&counter).
		Where("workspace_id = ?", workspaceID).
		Where("metric = ?", string(metric)).
		Where("period_start = ?", MonthStart(at)).
		Scan(ctx)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return counter.Value, nil
}

func (s *Service) SnapshotMonthly(ctx context.Context, workspaceID string, at time.Time) (map[entitlements.LimitKey]int64, error) {
	var counters []models.UsageCounter
	err := s.db.NewSelect().
		Model(&counters).
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", MonthStart(at)).
		Scan(ctx)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[entitlements.LimitKey]int64, len(counters))
	for _, counter := range counters {
		snapshot[entitlements.LimitKey(counter.Metric)] = counter.Value
	}
	return snapshot, nil
}

func (s *Service) SnapshotOrganizationMonthly(ctx context.Context, organizationID string, at time.Time) (map[entitlements.LimitKey]int64, error) {
	var rows []struct {
		Metric string `bun:"metric"`
		Value  int64  `bun:"value"`
	}
	err := s.db.NewSelect().
		TableExpr("usage_counters AS uc").
		ColumnExpr("uc.metric").
		ColumnExpr("SUM(uc.value) AS value").
		Join("JOIN workspaces AS w ON w.id = uc.workspace_id").
		Where("w.organization_id = ?", organizationID).
		Where("uc.period_start = ?", MonthStart(at)).
		Group("uc.metric").
		Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[entitlements.LimitKey]int64, len(rows))
	for _, row := range rows {
		snapshot[entitlements.LimitKey(row.Metric)] = row.Value
	}
	return snapshot, nil
}
