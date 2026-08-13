package analytics

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

var engagementMetricNames = []string{
	platform.MetricLikes,
	platform.MetricComments,
	platform.MetricReposts,
	platform.MetricQuotes,
	platform.MetricShares,
	platform.MetricSaves,
	platform.MetricClicks,
}

type overviewContentTotals struct {
	Publications int
	Content      int
	Summary      Summary
}

type overviewAggregateRow struct {
	Publications        int   `bun:"publications"`
	Content             int   `bun:"content"`
	Engagement          int64 `bun:"engagement"`
	EngagementMeasured  int   `bun:"engagement_measured"`
	Views               int64 `bun:"views"`
	ViewsMeasured       int   `bun:"views_measured"`
	Impressions         int64 `bun:"impressions"`
	ImpressionsMeasured int   `bun:"impressions_measured"`
	Reach               int64 `bun:"reach"`
	ReachMeasured       int   `bun:"reach_measured"`
}

func (s *Service) overviewContentBaseQuery(workspaceID string, start time.Time, accountID string) *bun.SelectQuery {
	query := s.db.NewSelect().
		TableExpr("publications AS p").
		Join("JOIN renditions AS r ON r.publication_id = p.id AND r.status = ?", models.RenditionStatusPublished).
		Join("LEFT JOIN analytics_sync_states AS ast ON ast.subject_type = ? AND ast.subject_id = r.id", subjectRendition).
		Where("p.workspace_id = ?", workspaceID).
		Where("p.status = ?", models.PublicationStatusPublished).
		Where("COALESCE(p.actual_run_at, p.updated_at) >= ?", start).
		Where("(ast.status IS NULL OR ast.status <> ?)", platform.AnalyticsStatusNotFound)
	if accountID != "" {
		query = query.Where("r.social_account_id = ?", accountID)
	}
	return query
}

func (s *Service) metricValueExpr(metric string) string {
	if s.db.Dialect().Name() == dialect.PG {
		return fmt.Sprintf("CAST(COALESCE(NULLIF(ast.metrics_json, '')::jsonb ->> '%s', '0') AS BIGINT)", metric)
	}
	return fmt.Sprintf("CAST(COALESCE(json_extract(ast.metrics_json, '$.%s'), 0) AS INTEGER)", metric)
}

func (s *Service) metricPresentExpr(metric string) string {
	if s.db.Dialect().Name() == dialect.PG {
		return fmt.Sprintf("COALESCE(NULLIF(ast.metrics_json, '')::jsonb ? '%s', FALSE)", metric)
	}
	return fmt.Sprintf("json_type(ast.metrics_json, '$.%s') IS NOT NULL", metric)
}

func (s *Service) engagementValueExpr() string {
	parts := make([]string, 0, len(engagementMetricNames))
	for _, metric := range engagementMetricNames {
		parts = append(parts, s.metricValueExpr(metric))
	}
	return "(" + strings.Join(parts, " + ") + ")"
}

func (s *Service) engagementPresentExpr() string {
	parts := make([]string, 0, len(engagementMetricNames))
	for _, metric := range engagementMetricNames {
		parts = append(parts, s.metricPresentExpr(metric))
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

func (s *Service) loadOverviewContentTotals(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	accountID string,
) (overviewContentTotals, error) {
	var row overviewAggregateRow
	query := s.overviewContentBaseQuery(workspaceID, start, accountID).
		ColumnExpr("COUNT(DISTINCT p.id) AS publications").
		ColumnExpr("COUNT(r.id) AS content").
		ColumnExpr("COALESCE(SUM(" + s.engagementValueExpr() + "), 0) AS engagement").
		ColumnExpr("COALESCE(SUM(CASE WHEN " + s.engagementPresentExpr() + " THEN 1 ELSE 0 END), 0) AS engagement_measured")
	for _, metric := range []struct {
		name  string
		value string
		count string
	}{
		{platform.MetricViews, "views", "views_measured"},
		{platform.MetricImpressions, "impressions", "impressions_measured"},
		{platform.MetricReach, "reach", "reach_measured"},
	} {
		query = query.
			ColumnExpr("COALESCE(SUM(" + s.metricValueExpr(metric.name) + "), 0) AS " + metric.value).
			ColumnExpr("COALESCE(SUM(CASE WHEN " + s.metricPresentExpr(metric.name) + " THEN 1 ELSE 0 END), 0) AS " + metric.count)
	}
	if err := query.Scan(ctx, &row); err != nil {
		return overviewContentTotals{}, fmt.Errorf("summarize analytics overview content: %w", err)
	}
	return overviewContentTotals{
		Publications: row.Publications,
		Content:      row.Content,
		Summary: Summary{
			Published:   row.Publications,
			Engagement:  MetricSummary{Value: row.Engagement, Measured: row.EngagementMeasured},
			Views:       MetricSummary{Value: row.Views, Measured: row.ViewsMeasured},
			Impressions: MetricSummary{Value: row.Impressions, Measured: row.ImpressionsMeasured},
			Reach:       MetricSummary{Value: row.Reach, Measured: row.ReachMeasured},
		},
	}, nil
}

func (s *Service) loadOverviewPublicationPageIDs(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	options OverviewOptions,
	offset int,
) ([]string, error) {
	type row struct {
		ID string `bun:"id"`
	}
	var rows []row
	query := s.overviewContentBaseQuery(workspaceID, start, options.AccountID).
		ColumnExpr("p.id AS id").
		GroupExpr("p.id, p.actual_run_at, p.updated_at")
	switch options.Sort {
	case "newest":
		query = query.OrderExpr("COALESCE(p.actual_run_at, p.updated_at) DESC")
	case "views":
		query = query.OrderExpr("SUM(" + s.metricValueExpr(platform.MetricViews) + ") DESC")
	default:
		query = query.OrderExpr("SUM(" + s.engagementValueExpr() + ") DESC")
	}
	query = query.OrderExpr("p.id ASC").Offset(offset).Limit(options.Limit)
	if err := query.Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("page analytics overview publications: %w", err)
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids, nil
}

func (s *Service) loadOverviewPublicationsByID(
	ctx context.Context,
	publicationIDs []string,
) (map[string]models.Publication, error) {
	if len(publicationIDs) == 0 {
		return map[string]models.Publication{}, nil
	}
	var publications []models.Publication
	if err := s.db.NewSelect().Model(&publications).
		Where("id IN (?)", bun.List(publicationIDs)).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load analytics overview publication page: %w", err)
	}
	byID := make(map[string]models.Publication, len(publications))
	for _, publication := range publications {
		byID[publication.ID] = publication
	}
	return byID, nil
}

func (s *Service) loadOverviewPageRenditions(
	ctx context.Context,
	publicationIDs []string,
	accountID string,
) ([]models.Rendition, error) {
	if len(publicationIDs) == 0 {
		return []models.Rendition{}, nil
	}
	var renditions []models.Rendition
	query := s.db.NewSelect().Model(&renditions).
		Where("publication_id IN (?)", bun.List(publicationIDs)).
		Where("status = ?", models.RenditionStatusPublished)
	if accountID != "" {
		query = query.Where("social_account_id = ?", accountID)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, fmt.Errorf("load analytics overview rendition page: %w", err)
	}
	return renditions, nil
}

func (s *Service) loadOverviewRenditionStates(
	ctx context.Context,
	workspaceID string,
	renditions []models.Rendition,
) (map[string]models.AnalyticsSyncState, error) {
	stateByID := make(map[string]models.AnalyticsSyncState, len(renditions))
	if len(renditions) == 0 {
		return stateByID, nil
	}
	ids := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		ids = append(ids, rendition.ID)
	}
	var states []models.AnalyticsSyncState
	if err := s.db.NewSelect().Model(&states).
		Where("workspace_id = ?", workspaceID).
		Where("subject_type = ?", subjectRendition).
		Where("subject_id IN (?)", bun.List(ids)).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load analytics overview rendition states: %w", err)
	}
	for _, state := range states {
		stateByID[state.ID] = state
	}
	return stateByID, nil
}

func mergeOverviewContentSummary(
	accountSummary Summary,
	contentSummary Summary,
	accounts []AccountOverview,
	accountID string,
) Summary {
	if accountID == "" {
		contentSummary.Followers = accountSummary.Followers
		return contentSummary
	}
	for _, account := range accounts {
		if account.ID != accountID {
			continue
		}
		if followers, ok := account.Metrics[platform.MetricFollowers]; ok {
			contentSummary.Followers = MetricSummary{Value: followers, Delta: account.FollowerDelta, Measured: 1}
		}
		break
	}
	return contentSummary
}

func decodeOverviewOffset(options OverviewOptions, days, total int) (int, error) {
	if options.Cursor == "" {
		return 0, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(options.Cursor)
	if err != nil {
		return 0, ErrInvalidOverviewCursor
	}
	var cursor overviewCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.Offset < 0 || cursor.Offset > total ||
		cursor.AccountID != options.AccountID || cursor.Sort != options.Sort || cursor.Days != days {
		return 0, ErrInvalidOverviewCursor
	}
	return cursor.Offset, nil
}

func encodeOverviewNextCursor(offset, pageSize, total int, options OverviewOptions, days int) string {
	nextOffset := offset + pageSize
	if nextOffset >= total {
		return ""
	}
	next, _ := json.Marshal(overviewCursor{Offset: nextOffset, AccountID: options.AccountID, Sort: options.Sort, Days: days})
	return base64.RawURLEncoding.EncodeToString(next)
}

func orderPublicationOverviews(publications []PublicationOverview, publicationIDs []string) {
	positions := make(map[string]int, len(publicationIDs))
	for index, id := range publicationIDs {
		positions[id] = index
	}
	sort.SliceStable(publications, func(i, j int) bool {
		return positions[publications[i].PublicationID] < positions[publications[j].PublicationID]
	})
}
