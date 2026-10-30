package analytics

import (
	"context"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// loadLatestRenditionSnapshots seeks the rendition/workspace/capture index
// for each requested rendition, without scanning or transferring its full history.
// A nonzero before selects the last measurement strictly before a trend range.
func (s *Service) loadLatestRenditionSnapshots(
	ctx context.Context,
	workspaceID string,
	renditionIDs []string,
	before time.Time,
	accountIDs ...string,
) ([]models.AnalyticsRenditionSnapshot, error) {
	type reference struct{ RenditionID string }
	requested := make([]reference, 0, len(renditionIDs))
	seen := make(map[string]struct{}, len(renditionIDs))
	for _, id := range renditionIDs {
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		requested = append(requested, reference{RenditionID: id})
	}
	snapshots := []models.AnalyticsRenditionSnapshot{}
	if len(requested) == 0 {
		return snapshots, nil
	}
	latest := s.db.NewSelect().Table("analytics_rendition_snapshots").Column("id").
		Where("rendition_id = requested.rendition_id").
		Where("workspace_id = ?", workspaceID).
		Order("captured_at DESC").Limit(1)
	if !before.IsZero() {
		latest = latest.Where("captured_at < ?", before)
	}
	if ids := normalizedOverviewAccountIDs("", accountIDs); len(ids) > 0 {
		latest = latest.Where("social_account_id IN (?)", bun.List(ids))
	}
	err := s.db.NewSelect().With("requested", s.db.NewValues(&requested)).
		TableExpr("requested").ColumnExpr("snapshot.*").
		Join("JOIN analytics_rendition_snapshots AS snapshot ON snapshot.id = (?)", latest).
		Scan(ctx, &snapshots)
	if err != nil {
		return nil, fmt.Errorf("load latest rendition analytics snapshots: %w", err)
	}
	return snapshots, nil
}
