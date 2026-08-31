package analytics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

func dailyFollowerTrend(accounts []AccountOverview, accountID string) []DailyBreakdownPoint {
	byDate := map[string][]DailyBreakdownItem{}
	for _, account := range accounts {
		if accountID != "" && account.ID != accountID {
			continue
		}
		for index := 1; index < len(account.FollowerSeries); index++ {
			current := account.FollowerSeries[index]
			delta := current.Value - account.FollowerSeries[index-1].Value
			if delta == 0 {
				continue
			}
			byDate[current.Date] = append(byDate[current.Date], DailyBreakdownItem{
				Key: account.ID, Label: account.Username, Platform: account.Platform, Value: delta,
			})
		}
	}
	return orderedDailyBreakdown(byDate)
}

func (s *Service) loadDailyContentTrends(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	accountID string,
) ([]DailyBreakdownPoint, []DailyBreakdownPoint, error) {
	var snapshots []models.AnalyticsRenditionSnapshot
	query := s.db.NewSelect().Model(&snapshots).
		Where("workspace_id = ? AND captured_at >= ?", workspaceID, start).
		Order("rendition_id ASC", "captured_at ASC")
	if accountID != "" {
		query = query.Where("social_account_id = ?", accountID)
	}
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, fmt.Errorf("list rendition analytics trend: %w", err)
	}
	if len(snapshots) == 0 {
		return []DailyBreakdownPoint{}, []DailyBreakdownPoint{}, nil
	}

	renditionIDs := uniqueRenditionIDs(snapshots)
	baselines, err := s.loadRenditionTrendBaselines(ctx, workspaceID, start, accountID, renditionIDs)
	if err != nil {
		return nil, nil, err
	}
	snapshots = append(baselines, snapshots...)
	sort.SliceStable(snapshots, func(i, j int) bool {
		if snapshots[i].RenditionID != snapshots[j].RenditionID {
			return snapshots[i].RenditionID < snapshots[j].RenditionID
		}
		return snapshots[i].CapturedAt.Before(snapshots[j].CapturedAt)
	})

	publicationByID, err := s.loadTrendPublications(ctx, snapshots)
	if err != nil {
		return nil, nil, err
	}
	accountByID, err := s.loadTrendAccounts(ctx, snapshots)
	if err != nil {
		return nil, nil, err
	}

	engagementByDate := map[string][]DailyBreakdownItem{}
	viewsByDate := map[string][]DailyBreakdownItem{}
	for _, history := range renditionTrendHistories(snapshots) {
		publication := publicationByID[history[0].PublicationID]
		account := accountByID[history[0].SocialAccountID]
		publishedAt := publication.ActualRunAt
		if publishedAt.IsZero() {
			publishedAt = publication.UpdatedAt
		}
		label := firstNonEmptyAnalyticsText(publication.Title, publication.SourceText, publication.SourceContent)
		appendRenditionTrend(history, start, publishedAt, label, account.AccountUsername, engagementByDate, viewsByDate)
	}
	return orderedDailyBreakdown(engagementByDate), orderedDailyBreakdown(viewsByDate), nil
}

func (s *Service) loadRenditionTrendBaselines(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	accountID string,
	renditionIDs []string,
) ([]models.AnalyticsRenditionSnapshot, error) {
	if len(renditionIDs) == 0 {
		return []models.AnalyticsRenditionSnapshot{}, nil
	}
	statement := `
		WITH ranked AS (
			SELECT id, workspace_id, publication_id, rendition_id, social_account_id, platform,
				metrics_json, capture_key, captured_at,
				ROW_NUMBER() OVER (PARTITION BY rendition_id ORDER BY captured_at DESC) AS row_number
			FROM analytics_rendition_snapshots
			WHERE workspace_id = ? AND captured_at < ? AND rendition_id IN (?)`
	args := []any{workspaceID, start, bun.List(renditionIDs)}
	if accountID != "" {
		statement += " AND social_account_id = ?"
		args = append(args, accountID)
	}
	statement += ") SELECT id, workspace_id, publication_id, rendition_id, social_account_id, platform, metrics_json, capture_key, captured_at FROM ranked WHERE row_number = 1"
	var snapshots []models.AnalyticsRenditionSnapshot
	if err := s.db.NewRaw(statement, args...).Scan(ctx, &snapshots); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load rendition analytics trend baselines: %w", err)
	}
	return snapshots, nil
}

func (s *Service) loadTrendPublications(
	ctx context.Context,
	snapshots []models.AnalyticsRenditionSnapshot,
) (map[string]models.Publication, error) {
	ids := uniqueTrendEntityIDs(snapshots, func(snapshot models.AnalyticsRenditionSnapshot) string {
		return snapshot.PublicationID
	})
	return loadTrendEntities(ctx, s.db, ids, "publications", func(publication models.Publication) string {
		return publication.ID
	})
}

func (s *Service) loadTrendAccounts(
	ctx context.Context,
	snapshots []models.AnalyticsRenditionSnapshot,
) (map[string]models.SocialAccount, error) {
	ids := uniqueTrendEntityIDs(snapshots, func(snapshot models.AnalyticsRenditionSnapshot) string {
		return snapshot.SocialAccountID
	})
	return loadTrendEntities(ctx, s.db, ids, "accounts", func(account models.SocialAccount) string {
		return account.ID
	})
}

func loadTrendEntities[T any](
	ctx context.Context,
	db *bun.DB,
	ids []string,
	label string,
	entityID func(T) string,
) (map[string]T, error) {
	var entities []T
	if err := db.NewSelect().Model(&entities).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load analytics trend %s: %w", label, err)
	}
	byID := make(map[string]T, len(entities))
	for _, entity := range entities {
		byID[entityID(entity)] = entity
	}
	return byID, nil
}

func uniqueTrendEntityIDs(
	snapshots []models.AnalyticsRenditionSnapshot,
	entityID func(models.AnalyticsRenditionSnapshot) string,
) []string {
	ids := make([]string, 0, len(snapshots))
	seen := map[string]struct{}{}
	for _, snapshot := range snapshots {
		id := entityID(snapshot)
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func uniqueRenditionIDs(snapshots []models.AnalyticsRenditionSnapshot) []string {
	ids := make([]string, 0, len(snapshots))
	seen := map[string]struct{}{}
	for _, snapshot := range snapshots {
		if _, exists := seen[snapshot.RenditionID]; exists {
			continue
		}
		seen[snapshot.RenditionID] = struct{}{}
		ids = append(ids, snapshot.RenditionID)
	}
	return ids
}

func renditionTrendHistories(snapshots []models.AnalyticsRenditionSnapshot) [][]models.AnalyticsRenditionSnapshot {
	var histories [][]models.AnalyticsRenditionSnapshot
	for _, snapshot := range snapshots {
		if len(histories) == 0 || histories[len(histories)-1][0].RenditionID != snapshot.RenditionID {
			histories = append(histories, []models.AnalyticsRenditionSnapshot{})
		}
		histories[len(histories)-1] = append(histories[len(histories)-1], snapshot)
	}
	return histories
}

func appendRenditionTrend(
	history []models.AnalyticsRenditionSnapshot,
	start time.Time,
	publishedAt time.Time,
	label string,
	username string,
	engagementByDate map[string][]DailyBreakdownItem,
	viewsByDate map[string][]DailyBreakdownItem,
) {
	daily := make([]models.AnalyticsRenditionSnapshot, 0, len(history))
	for _, snapshot := range history {
		date := snapshot.CapturedAt.UTC().Format("2006-01-02")
		if len(daily) > 0 && daily[len(daily)-1].CapturedAt.UTC().Format("2006-01-02") == date {
			daily[len(daily)-1] = snapshot
			continue
		}
		daily = append(daily, snapshot)
	}
	var previous platform.AnalyticsValues
	for _, snapshot := range daily {
		current := decodeAnalyticsValues(snapshot.MetricsJSON)
		if snapshot.CapturedAt.Before(start) {
			previous = current
			continue
		}
		if previous == nil && publishedAt.Before(start) {
			previous = current
			continue
		}
		if previous == nil {
			previous = platform.AnalyticsValues{}
		}
		date := snapshot.CapturedAt.UTC().Format("2006-01-02")
		item := DailyBreakdownItem{
			Key: snapshot.RenditionID, Label: label, Platform: snapshot.Platform,
			PublicationID: snapshot.PublicationID,
		}
		engagementDelta := platform.EngagementTotal(current) - platform.EngagementTotal(previous)
		if engagementDelta != 0 {
			engagementByDate[date] = append(engagementByDate[date], withTrendValue(item, engagementDelta, username))
		}
		viewsDelta := current[platform.MetricViews] - previous[platform.MetricViews]
		if viewsDelta != 0 {
			viewsByDate[date] = append(viewsByDate[date], withTrendValue(item, viewsDelta, username))
		}
		previous = current
	}
}

func withTrendValue(item DailyBreakdownItem, value int64, username string) DailyBreakdownItem {
	item.Value = value
	if item.Label == "" {
		item.Label = username
	}
	return item
}

func orderedDailyBreakdown(byDate map[string][]DailyBreakdownItem) []DailyBreakdownPoint {
	dates := make([]string, 0, len(byDate))
	for date := range byDate {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	points := make([]DailyBreakdownPoint, 0, len(dates))
	for _, date := range dates {
		items := byDate[date]
		sort.SliceStable(items, func(i, j int) bool {
			left := items[i].Value
			if left < 0 {
				left = -left
			}
			right := items[j].Value
			if right < 0 {
				right = -right
			}
			if left != right {
				return left > right
			}
			return items[i].Key < items[j].Key
		})
		point := DailyBreakdownPoint{Date: date, Items: items}
		for _, item := range items {
			point.Value += item.Value
		}
		points = append(points, point)
	}
	return points
}
