package analytics

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

var engagementMetricNames = []string{
	platform.MetricLikes,
	platform.MetricReactions,
	platform.MetricComments,
	platform.MetricReposts,
	platform.MetricQuotes,
	platform.MetricShares,
	platform.MetricSaves,
	platform.MetricClicks,
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
	contentSummary.FollowerScope = "account_wide"
	if accountID == "" {
		contentSummary.Followers = accountSummary.Followers
		return contentSummary
	}
	for _, account := range accounts {
		if account.ID != accountID {
			continue
		}
		if followers, ok := compatibleCountMetricValue(
			account.Metrics,
			account.MetricMetadata,
			platform.MetricFollowers,
			platform.AnalyticsMetricAggregationCurrentSnapshot,
		); ok {
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
		cursor.AccountID != options.AccountID || cursor.Source != options.Source || cursor.Sort != options.Sort || cursor.Days != days {
		return 0, ErrInvalidOverviewCursor
	}
	return cursor.Offset, nil
}

func encodeOverviewNextCursor(offset, pageSize, total int, options OverviewOptions, days int) string {
	nextOffset := offset + pageSize
	if nextOffset >= total {
		return ""
	}
	next, _ := json.Marshal(overviewCursor{Offset: nextOffset, AccountID: options.AccountID, Source: options.Source, Sort: options.Sort, Days: days})
	return base64.RawURLEncoding.EncodeToString(next)
}
