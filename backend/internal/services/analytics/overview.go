package analytics

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

type MetricSummary struct {
	Value    int64  `json:"value"`
	Delta    *int64 `json:"delta,omitempty"`
	Measured int    `json:"measured"`
}

type Summary struct {
	Followers   MetricSummary `json:"followers"`
	Engagement  MetricSummary `json:"engagement"`
	Views       MetricSummary `json:"views"`
	Impressions MetricSummary `json:"impressions"`
	Reach       MetricSummary `json:"reach"`
	Published   int           `json:"published"`
}

type SeriesPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

type AccountOverview struct {
	ID                   string                   `json:"id"`
	Platform             string                   `json:"platform"`
	Username             string                   `json:"username"`
	AvatarURL            string                   `json:"avatar_url,omitempty"`
	Status               string                   `json:"status"`
	ErrorCode            string                   `json:"error_code,omitempty"`
	ErrorMessage         string                   `json:"error_message,omitempty"`
	AccountSupported     bool                     `json:"account_supported"`
	ContentSupported     bool                     `json:"content_supported"`
	MissingAccountScopes []string                 `json:"missing_account_scopes"`
	MissingContentScopes []string                 `json:"missing_content_scopes"`
	Metrics              platform.AnalyticsValues `json:"metrics"`
	FollowerDelta        *int64                   `json:"follower_delta,omitempty"`
	FollowerSeries       []SeriesPoint            `json:"follower_series"`
	LastSyncedAt         time.Time                `json:"last_synced_at,omitempty"`
	NextSyncAt           time.Time                `json:"next_sync_at,omitempty"`
	Stale                bool                     `json:"stale"`
}

type ContentOverview struct {
	PublicationID string                   `json:"publication_id"`
	RenditionID   string                   `json:"rendition_id"`
	Title         string                   `json:"title"`
	Excerpt       string                   `json:"excerpt"`
	Platform      string                   `json:"platform"`
	AccountID     string                   `json:"account_id"`
	Username      string                   `json:"username"`
	ExternalURL   string                   `json:"external_url,omitempty"`
	PublishedAt   time.Time                `json:"published_at"`
	Status        string                   `json:"status"`
	ErrorCode     string                   `json:"error_code,omitempty"`
	ErrorMessage  string                   `json:"error_message,omitempty"`
	Metrics       platform.AnalyticsValues `json:"metrics"`
	Engagement    int64                    `json:"engagement"`
	LastSyncedAt  time.Time                `json:"last_synced_at,omitempty"`
	NextSyncAt    time.Time                `json:"next_sync_at,omitempty"`
	Stale         bool                     `json:"stale"`
}

type PublicationOverview struct {
	PublicationID      string                   `json:"publication_id"`
	Title              string                   `json:"title"`
	Excerpt            string                   `json:"excerpt"`
	PublishedAt        time.Time                `json:"published_at"`
	Metrics            platform.AnalyticsValues `json:"metrics"`
	Measured           map[string]int           `json:"measured"`
	Engagement         int64                    `json:"engagement"`
	EngagementMeasured int                      `json:"engagement_measured"`
	LastSyncedAt       time.Time                `json:"last_synced_at,omitempty"`
	Renditions         []ContentOverview        `json:"renditions"`
}

type Overview struct {
	GeneratedAt    time.Time             `json:"generated_at"`
	LastSyncedAt   time.Time             `json:"last_synced_at,omitempty"`
	RangeDays      int                   `json:"range_days"`
	Summary        Summary               `json:"summary"`
	Accounts       []AccountOverview     `json:"accounts"`
	FollowerSeries []SeriesPoint         `json:"follower_series"`
	Publications   []PublicationOverview `json:"publications"`
	Content        []ContentOverview     `json:"content"`
}

func (s *Service) Overview(ctx context.Context, workspaceID string, days int) (Overview, error) {
	days = normalizeOverviewDays(days)
	now := s.now()
	start := now.AddDate(0, 0, -days)
	result := Overview{
		GeneratedAt:    now,
		RangeDays:      days,
		Accounts:       []AccountOverview{},
		FollowerSeries: []SeriesPoint{},
		Publications:   []PublicationOverview{},
		Content:        []ContentOverview{},
	}

	activeAccounts, accountByID, err := s.loadOverviewAccounts(ctx, workspaceID)
	if err != nil {
		return Overview{}, err
	}
	stateByID, lastSyncedAt, err := s.loadOverviewStates(ctx, workspaceID)
	if err != nil {
		return Overview{}, err
	}
	result.LastSyncedAt = lastSyncedAt
	history, err := s.loadAccountHistory(ctx, workspaceID, start)
	if err != nil {
		return Overview{}, err
	}

	result.Accounts = s.buildAccountOverviews(activeAccounts, stateByID, history, &result.Summary)
	result.FollowerSeries = combinedFollowerSeries(result.Accounts)

	publications, publicationByID, publicationIDs, err := s.loadOverviewPublications(ctx, workspaceID, start)
	if err != nil {
		return Overview{}, err
	}
	result.Summary.Published = len(publications)
	if len(publicationIDs) == 0 {
		return result, nil
	}
	renditions, err := s.loadOverviewRenditions(ctx, publicationIDs)
	if err != nil {
		return Overview{}, err
	}
	result.Content = buildContentOverviews(renditions, publicationByID, accountByID, stateByID, now, &result.Summary)
	result.Publications = buildPublicationOverviews(result.Content)
	return result, nil
}

func normalizeOverviewDays(days int) int {
	switch days {
	case 7, 30, 90:
		return days
	default:
		return 30
	}
}

func (s *Service) loadOverviewAccounts(
	ctx context.Context,
	workspaceID string,
) ([]models.SocialAccount, map[string]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().
		Model(&accounts).
		Where("workspace_id = ?", workspaceID).
		Order("platform ASC", "account_username ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, fmt.Errorf("list analytics overview accounts: %w", err)
	}
	accountByID := make(map[string]models.SocialAccount, len(accounts))
	activeAccounts := make([]models.SocialAccount, 0, len(accounts))
	for _, account := range accounts {
		accountByID[account.ID] = account
		if account.IsActive {
			activeAccounts = append(activeAccounts, account)
		}
	}
	return activeAccounts, accountByID, nil
}

func (s *Service) loadOverviewStates(
	ctx context.Context,
	workspaceID string,
) (map[string]models.AnalyticsSyncState, time.Time, error) {
	var states []models.AnalyticsSyncState
	if err := s.db.NewSelect().
		Model(&states).
		Where("workspace_id = ?", workspaceID).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, time.Time{}, fmt.Errorf("list analytics overview states: %w", err)
	}
	stateByID := make(map[string]models.AnalyticsSyncState, len(states))
	var lastSyncedAt time.Time
	for _, state := range states {
		stateByID[state.ID] = state
		if state.LastSuccessAt.After(lastSyncedAt) {
			lastSyncedAt = state.LastSuccessAt
		}
	}
	return stateByID, lastSyncedAt, nil
}

func (s *Service) loadAccountHistory(
	ctx context.Context,
	workspaceID string,
	start time.Time,
) (map[string][]models.AnalyticsAccountSnapshot, error) {
	var snapshots []models.AnalyticsAccountSnapshot
	if err := s.db.NewSelect().
		Model(&snapshots).
		Where("workspace_id = ? AND captured_at >= ?", workspaceID, start).
		Order("social_account_id ASC", "captured_at ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list account analytics history: %w", err)
	}
	history := make(map[string][]models.AnalyticsAccountSnapshot)
	for _, snapshot := range snapshots {
		history[snapshot.SocialAccountID] = append(history[snapshot.SocialAccountID], snapshot)
	}
	return history, nil
}

func (s *Service) loadOverviewPublications(
	ctx context.Context,
	workspaceID string,
	start time.Time,
) ([]models.Publication, map[string]models.Publication, []string, error) {
	var publications []models.Publication
	if err := s.db.NewSelect().
		Model(&publications).
		Where("workspace_id = ? AND status = ?", workspaceID, models.PublicationStatusPublished).
		Where("COALESCE(actual_run_at, updated_at) >= ?", start).
		OrderExpr("COALESCE(actual_run_at, updated_at) DESC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil, fmt.Errorf("list analytics publications: %w", err)
	}
	publicationByID := make(map[string]models.Publication, len(publications))
	publicationIDs := make([]string, 0, len(publications))
	for _, publication := range publications {
		publicationByID[publication.ID] = publication
		publicationIDs = append(publicationIDs, publication.ID)
	}
	return publications, publicationByID, publicationIDs, nil
}

func (s *Service) loadOverviewRenditions(ctx context.Context, publicationIDs []string) ([]models.Rendition, error) {
	var renditions []models.Rendition
	if err := s.db.NewSelect().
		Model(&renditions).
		Where("publication_id IN (?)", bun.List(publicationIDs)).
		Where("status = ?", models.RenditionStatusPublished).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list analytics content: %w", err)
	}
	return renditions, nil
}

func (s *Service) buildAccountOverviews(
	accounts []models.SocialAccount,
	stateByID map[string]models.AnalyticsSyncState,
	history map[string][]models.AnalyticsAccountSnapshot,
	summary *Summary,
) []AccountOverview {
	overviews := make([]AccountOverview, 0, len(accounts))
	for _, account := range accounts {
		overview := s.buildAccountOverview(account, stateByID[stateID(subjectAccount, account.ID)])
		overview.FollowerSeries, overview.FollowerDelta = accountFollowerHistory(history[account.ID])
		addFollowerSummary(&summary.Followers, overview)
		overviews = append(overviews, overview)
	}
	return overviews
}

func (s *Service) buildAccountOverview(account models.SocialAccount, state models.AnalyticsSyncState) AccountOverview {
	overview := AccountOverview{
		ID:                   account.ID,
		Platform:             account.Platform,
		Username:             account.AccountUsername,
		AvatarURL:            account.AccountAvatarURL,
		Status:               string(platform.AnalyticsStatusPending),
		Metrics:              platform.AnalyticsValues{},
		FollowerSeries:       []SeriesPoint{},
		MissingAccountScopes: []string{},
		MissingContentScopes: []string{},
	}
	adapter := s.analyticsAdapter(account)
	if adapter == nil {
		overview.Status = string(platform.AnalyticsStatusUnsupported)
		overview.ErrorMessage = "Analytics are not available for this provider."
	} else {
		applyAnalyticsSupport(&overview, account, analyticsSupportForAccount(adapter, account))
	}
	if state.ID != "" {
		overview.Status = state.Status
		overview.ErrorCode = state.ErrorCode
		overview.ErrorMessage = state.ErrorMessage
		overview.LastSyncedAt = state.LastSuccessAt
		overview.NextSyncAt = state.NextSyncAt
		overview.Stale = analyticsStateStale(state, s.now())
		overview.Metrics = decodeAnalyticsValues(state.MetricsJSON)
	}
	return overview
}

func applyAnalyticsSupport(overview *AccountOverview, account models.SocialAccount, support platform.AnalyticsSupport) {
	overview.AccountSupported = support.Account
	overview.ContentSupported = support.Content
	overview.MissingAccountScopes = platform.MissingAnalyticsScopes(account.GrantedScopes, support.AccountRequiredScopes)
	overview.MissingContentScopes = platform.MissingAnalyticsScopes(account.GrantedScopes, support.ContentRequiredScopes)
	if !support.Account {
		overview.Status = string(platform.AnalyticsStatusUnsupported)
		overview.ErrorMessage = support.AccountUnavailable
		return
	}
	if len(overview.MissingAccountScopes) > 0 {
		overview.Status = string(platform.AnalyticsStatusPermissionRequired)
		overview.ErrorMessage = missingScopeMessage(overview.MissingAccountScopes)
	}
}

func addFollowerSummary(summary *MetricSummary, overview AccountOverview) {
	if followers, ok := overview.Metrics[platform.MetricFollowers]; ok {
		summary.Value += followers
		summary.Measured++
	}
	if overview.FollowerDelta == nil {
		return
	}
	if summary.Delta == nil {
		summary.Delta = new(int64)
	}
	*summary.Delta += *overview.FollowerDelta
}

func buildContentOverviews(
	renditions []models.Rendition,
	publicationByID map[string]models.Publication,
	accountByID map[string]models.SocialAccount,
	stateByID map[string]models.AnalyticsSyncState,
	now time.Time,
	summary *Summary,
) []ContentOverview {
	content := make([]ContentOverview, 0, len(renditions))
	for _, rendition := range renditions {
		publication, publicationExists := publicationByID[rendition.PublicationID]
		account, accountExists := accountByID[rendition.SocialAccountID]
		if !publicationExists || !accountExists {
			continue
		}
		state := stateByID[stateID(subjectRendition, rendition.ID)]
		if state.Status == string(platform.AnalyticsStatusNotFound) {
			continue
		}
		item := buildContentOverview(
			rendition,
			publication,
			account,
			state,
			now,
		)
		item.Engagement = platform.EngagementTotal(item.Metrics)
		summary.Engagement.Value += item.Engagement
		if platform.HasEngagementMetric(item.Metrics) {
			summary.Engagement.Measured++
		}
		addMeasuredSummary(&summary.Views, item.Metrics, platform.MetricViews)
		addMeasuredSummary(&summary.Impressions, item.Metrics, platform.MetricImpressions)
		addMeasuredSummary(&summary.Reach, item.Metrics, platform.MetricReach)
		content = append(content, item)
	}
	sort.SliceStable(content, func(i, j int) bool {
		if content[i].Engagement != content[j].Engagement {
			return content[i].Engagement > content[j].Engagement
		}
		return content[i].Metrics[platform.MetricViews] > content[j].Metrics[platform.MetricViews]
	})
	return content
}

func buildContentOverview(
	rendition models.Rendition,
	publication models.Publication,
	account models.SocialAccount,
	state models.AnalyticsSyncState,
	now time.Time,
) ContentOverview {
	publishedAt := publication.ActualRunAt
	if publishedAt.IsZero() {
		publishedAt = publication.UpdatedAt
	}
	externalURL := rendition.ExternalURL
	if !platform.IsSafeContentURL(externalURL) {
		externalURL = platform.DeterministicContentURL(
			account.Platform,
			account.AccountID,
			account.AccountUsername,
			account.InstanceURL,
			rendition.ExternalID,
		)
	}
	item := ContentOverview{
		PublicationID: publication.ID,
		RenditionID:   rendition.ID,
		Title:         publication.Title,
		Excerpt:       firstNonEmptyAnalyticsText(publication.SourceText, publication.SourceContent),
		Platform:      rendition.Platform,
		AccountID:     account.ID,
		Username:      account.AccountUsername,
		ExternalURL:   externalURL,
		PublishedAt:   publishedAt,
		Status:        string(platform.AnalyticsStatusPending),
		Metrics:       platform.AnalyticsValues{},
	}
	if state.ID != "" {
		item.Status = state.Status
		item.ErrorCode = state.ErrorCode
		item.ErrorMessage = state.ErrorMessage
		item.LastSyncedAt = state.LastSuccessAt
		item.NextSyncAt = state.NextSyncAt
		item.Stale = analyticsStateStale(state, now)
		item.Metrics = decodeAnalyticsValues(state.MetricsJSON)
	}
	return item
}

func analyticsStateStale(state models.AnalyticsSyncState, now time.Time) bool {
	return !state.LastSuccessAt.IsZero() && !state.NextSyncAt.IsZero() && now.After(state.NextSyncAt)
}

func buildPublicationOverviews(content []ContentOverview) []PublicationOverview {
	byID := make(map[string]*PublicationOverview)
	order := make([]string, 0)
	for _, item := range content {
		publication := byID[item.PublicationID]
		if publication == nil {
			publication = &PublicationOverview{
				PublicationID: item.PublicationID,
				Title:         item.Title,
				Excerpt:       item.Excerpt,
				PublishedAt:   item.PublishedAt,
				Metrics:       platform.AnalyticsValues{},
				Measured:      map[string]int{},
				Renditions:    []ContentOverview{},
			}
			byID[item.PublicationID] = publication
			order = append(order, item.PublicationID)
		}
		publication.Renditions = append(publication.Renditions, item)
		publication.Engagement += item.Engagement
		if platform.HasEngagementMetric(item.Metrics) {
			publication.EngagementMeasured++
		}
		for metric, value := range item.Metrics {
			publication.Metrics[metric] += value
			publication.Measured[metric]++
		}
		if item.LastSyncedAt.After(publication.LastSyncedAt) {
			publication.LastSyncedAt = item.LastSyncedAt
		}
	}
	publications := make([]PublicationOverview, 0, len(order))
	for _, id := range order {
		publication := byID[id]
		sort.SliceStable(publication.Renditions, func(i, j int) bool {
			if publication.Renditions[i].Platform != publication.Renditions[j].Platform {
				return publication.Renditions[i].Platform < publication.Renditions[j].Platform
			}
			return publication.Renditions[i].Username < publication.Renditions[j].Username
		})
		publications = append(publications, *publication)
	}
	sort.SliceStable(publications, func(i, j int) bool {
		if publications[i].Engagement != publications[j].Engagement {
			return publications[i].Engagement > publications[j].Engagement
		}
		if publications[i].Metrics[platform.MetricViews] != publications[j].Metrics[platform.MetricViews] {
			return publications[i].Metrics[platform.MetricViews] > publications[j].Metrics[platform.MetricViews]
		}
		return publications[i].PublishedAt.After(publications[j].PublishedAt)
	})
	if len(publications) > 50 {
		publications = publications[:50]
	}
	return publications
}

func combinedFollowerSeries(accounts []AccountOverview) []SeriesPoint {
	dateSet := map[string]struct{}{}
	for _, account := range accounts {
		for _, point := range account.FollowerSeries {
			dateSet[point.Date] = struct{}{}
		}
	}
	dates := make([]string, 0, len(dateSet))
	for date := range dateSet {
		dates = append(dates, date)
	}
	sort.Strings(dates)

	latest := make([]int64, len(accounts))
	known := make([]bool, len(accounts))
	indexes := make([]int, len(accounts))
	series := make([]SeriesPoint, 0, len(dates))
	for _, date := range dates {
		var total int64
		measured := 0
		for accountIndex, account := range accounts {
			for indexes[accountIndex] < len(account.FollowerSeries) &&
				account.FollowerSeries[indexes[accountIndex]].Date <= date {
				latest[accountIndex] = account.FollowerSeries[indexes[accountIndex]].Value
				known[accountIndex] = true
				indexes[accountIndex]++
			}
			if known[accountIndex] {
				total += latest[accountIndex]
				measured++
			}
		}
		if measured > 0 {
			series = append(series, SeriesPoint{Date: date, Value: total})
		}
	}
	return series
}

func firstNonEmptyAnalyticsText(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func accountFollowerHistory(snapshots []models.AnalyticsAccountSnapshot) ([]SeriesPoint, *int64) {
	daily := make(map[string]int64)
	order := make([]string, 0)
	for _, snapshot := range snapshots {
		values := decodeAnalyticsValues(snapshot.MetricsJSON)
		followers, ok := values[platform.MetricFollowers]
		if !ok {
			continue
		}
		date := snapshot.CapturedAt.UTC().Format("2006-01-02")
		if _, exists := daily[date]; !exists {
			order = append(order, date)
		}
		daily[date] = followers
	}
	points := make([]SeriesPoint, 0, len(order))
	for _, date := range order {
		points = append(points, SeriesPoint{Date: date, Value: daily[date]})
	}
	if len(points) < 2 {
		return points, nil
	}
	delta := points[len(points)-1].Value - points[0].Value
	return points, &delta
}

func decodeAnalyticsValues(raw string) platform.AnalyticsValues {
	values := platform.AnalyticsValues{}
	if json.Unmarshal([]byte(raw), &values) != nil {
		return platform.AnalyticsValues{}
	}
	return values
}

func addMeasuredSummary(summary *MetricSummary, values platform.AnalyticsValues, metric string) {
	value, ok := values[metric]
	if !ok {
		return
	}
	summary.Value += value
	summary.Measured++
}
