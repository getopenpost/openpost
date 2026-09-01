package analytics

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

type MetricSummary struct {
	Value    int64  `json:"value"`
	Delta    *int64 `json:"delta,omitempty"`
	Measured int    `json:"measured"`
}

type Summary struct {
	Followers     MetricSummary `json:"followers"`
	FollowerScope string        `json:"follower_scope" enum:"account_wide"`
	Engagement    MetricSummary `json:"engagement"`
	Views         MetricSummary `json:"views"`
	Impressions   MetricSummary `json:"impressions"`
	Reach         MetricSummary `json:"reach"`
	Published     int           `json:"published"`
}

type SeriesPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

type DailyBreakdownItem struct {
	Key           string `json:"key"`
	Label         string `json:"label"`
	Platform      string `json:"platform"`
	PublicationID string `json:"publication_id,omitempty"`
	Value         int64  `json:"value"`
}

type DailyBreakdownPoint struct {
	Date  string               `json:"date"`
	Value int64                `json:"value"`
	Items []DailyBreakdownItem `json:"items"`
}

type TrendSeries struct {
	Followers  []DailyBreakdownPoint `json:"followers"`
	Engagement []DailyBreakdownPoint `json:"engagement"`
	Views      []DailyBreakdownPoint `json:"views"`
}

type AccountOverview struct {
	ID                   string                                      `json:"id"`
	Platform             string                                      `json:"platform"`
	Username             string                                      `json:"username"`
	AvatarURL            string                                      `json:"avatar_url,omitempty"`
	Status               string                                      `json:"status"`
	ErrorCode            string                                      `json:"error_code,omitempty"`
	ErrorMessage         string                                      `json:"error_message,omitempty"`
	AccountSupported     bool                                        `json:"account_supported"`
	ContentSupported     bool                                        `json:"content_supported"`
	MissingAccountScopes []string                                    `json:"missing_account_scopes"`
	MissingContentScopes []string                                    `json:"missing_content_scopes"`
	Metrics              platform.AnalyticsValues                    `json:"metrics"`
	MetricMetadata       map[string]platform.AnalyticsMetricMetadata `json:"metric_metadata"`
	FollowerDelta        *int64                                      `json:"follower_delta,omitempty"`
	FollowerSeries       []SeriesPoint                               `json:"follower_series"`
	LastSyncedAt         time.Time                                   `json:"last_synced_at,omitempty"`
	NextSyncAt           time.Time                                   `json:"next_sync_at,omitempty"`
	Stale                bool                                        `json:"stale"`
}

type ContentReference struct {
	Type             string `json:"type" enum:"openpost,external"`
	PublicationID    string `json:"publication_id,omitempty"`
	RenditionID      string `json:"rendition_id,omitempty"`
	AccountContentID string `json:"account_content_id,omitempty"`
}

func (ContentReference) TransformSchema(_ huma.Registry, _ *huma.Schema) *huma.Schema {
	stringID := func() *huma.Schema {
		minimum := 1
		return &huma.Schema{Type: "string", MinLength: &minimum}
	}
	return &huma.Schema{
		OneOf: []*huma.Schema{
			{
				Type: "object", AdditionalProperties: false,
				Properties: map[string]*huma.Schema{
					"type":               {Type: "string", Enum: []any{"external"}},
					"account_content_id": stringID(),
				},
				Required: []string{"type", "account_content_id"},
			},
			{
				Type: "object", AdditionalProperties: false,
				Properties: map[string]*huma.Schema{
					"type":           {Type: "string", Enum: []any{"openpost"}},
					"publication_id": stringID(), "rendition_id": stringID(),
				},
				Required: []string{"type", "publication_id", "rendition_id"},
			},
		},
		Discriminator: &huma.Discriminator{PropertyName: "type"},
	}
}

type ContentMeasurement struct {
	Value        int64                            `json:"value"`
	Availability string                           `json:"availability" enum:"available"`
	CollectedAt  time.Time                        `json:"collected_at"`
	Metadata     platform.AnalyticsMetricMetadata `json:"metadata"`
}

type ContentOverview struct {
	insightSnapshotBacked bool
	Reference             ContentReference                            `json:"reference"`
	Source                string                                      `json:"source" enum:"openpost,external"`
	PublicationID         string                                      `json:"publication_id,omitempty"`
	RenditionID           string                                      `json:"rendition_id,omitempty"`
	Title                 string                                      `json:"title"`
	Excerpt               string                                      `json:"excerpt"`
	ContentProfile        string                                      `json:"content_profile"`
	Platform              string                                      `json:"platform"`
	AccountID             string                                      `json:"account_id"`
	Username              string                                      `json:"username"`
	ExternalURL           string                                      `json:"external_url,omitempty"`
	PublishedAt           time.Time                                   `json:"published_at"`
	Status                string                                      `json:"status"`
	MetricAvailability    string                                      `json:"metric_availability" enum:"available,pending,unavailable"`
	CollectedAt           time.Time                                   `json:"collected_at,omitempty"`
	ErrorCode             string                                      `json:"error_code,omitempty"`
	ErrorMessage          string                                      `json:"error_message,omitempty"`
	Metrics               platform.AnalyticsValues                    `json:"metrics"`
	MetricMetadata        map[string]platform.AnalyticsMetricMetadata `json:"metric_metadata"`
	Measurements          map[string]ContentMeasurement               `json:"measurements"`
	Engagement            int64                                       `json:"engagement"`
	LastSyncedAt          time.Time                                   `json:"last_synced_at,omitempty"`
	NextSyncAt            time.Time                                   `json:"next_sync_at,omitempty"`
	Stale                 bool                                        `json:"stale"`
}

type AccountDiscoveryCoverage struct {
	AccountID              string    `json:"account_id"`
	Platform               string    `json:"platform"`
	Status                 string    `json:"status" enum:"complete,partial,permission_required,rate_limited,cost_limited,unsupported,failed"`
	Description            string    `json:"description,omitempty"`
	BackfillWatermark      time.Time `json:"backfill_watermark,omitempty"`
	InitialItemsDiscovered int       `json:"initial_items_discovered"`
	InitialCompletedAt     time.Time `json:"initial_completed_at,omitempty"`
	LastSuccessAt          time.Time `json:"last_success_at,omitempty"`
	LastAttemptedAt        time.Time `json:"last_attempted_at,omitempty"`
	FailureCode            string    `json:"failure_code,omitempty"`
	FailureMessage         string    `json:"failure_message,omitempty"`
	NextEligibleAt         time.Time `json:"next_eligible_at,omitempty"`
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
	GeneratedAt           time.Time                  `json:"generated_at"`
	LastSyncedAt          time.Time                  `json:"last_synced_at,omitempty"`
	RangeDays             int                        `json:"range_days"`
	Summary               Summary                    `json:"summary"`
	Accounts              []AccountOverview          `json:"accounts"`
	FollowerSeries        []SeriesPoint              `json:"follower_series"`
	Trends                TrendSeries                `json:"trends"`
	Publications          []PublicationOverview      `json:"publications"`
	Content               []ContentOverview          `json:"content"`
	Coverage              []AccountDiscoveryCoverage `json:"coverage"`
	Insights              []Insight                  `json:"insights"`
	Source                string                     `json:"source" enum:"all,openpost,external"`
	AccountGrowthScope    string                     `json:"account_growth_scope" enum:"account_wide"`
	PublicationTotal      int                        `json:"publication_total"`
	PublicationNextCursor string                     `json:"publication_next_cursor,omitempty"`
	ContentNextCursor     string                     `json:"content_next_cursor,omitempty"`
	ContentTotal          int                        `json:"content_total"`
}

func (s *Service) Overview(ctx context.Context, workspaceID string, days int) (Overview, error) {
	return s.OverviewWithOptions(ctx, workspaceID, days, OverviewOptions{})
}

type OverviewOptions struct {
	AccountID string
	Source    string
	Sort      string
	Cursor    string
	Limit     int
}

var ErrInvalidOverviewCursor = errors.New("invalid analytics overview cursor")

func (s *Service) OverviewWithOptions(ctx context.Context, workspaceID string, days int, options OverviewOptions) (Overview, error) {
	days = normalizeOverviewDays(days)
	options = normalizeOverviewOptions(options)
	now := s.now()
	if options.Cursor != "" {
		cursor, err := s.decodeSignedOverviewCursor(workspaceID, options, days)
		if err != nil {
			return Overview{}, err
		}
		now = cursor.RangeEnd.UTC()
	}
	start := now.AddDate(0, 0, -days)
	result := Overview{
		GeneratedAt:        now,
		RangeDays:          days,
		Source:             options.Source,
		AccountGrowthScope: "account_wide",
		Summary:            Summary{FollowerScope: "account_wide"},
		Accounts:           []AccountOverview{},
		Coverage:           []AccountDiscoveryCoverage{},
		FollowerSeries:     []SeriesPoint{},
		Trends: TrendSeries{
			Followers:  []DailyBreakdownPoint{},
			Engagement: []DailyBreakdownPoint{},
			Views:      []DailyBreakdownPoint{},
		},
		Publications: []PublicationOverview{},
		Content:      []ContentOverview{},
		Insights:     []Insight{},
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
	result.Trends.Followers = dailyFollowerTrend(result.Accounts, options.AccountID)
	result.Trends.Engagement, result.Trends.Views, err = s.loadDailyContentTrends(ctx, workspaceID, start, options.AccountID)
	if err != nil {
		return Overview{}, err
	}
	result.Coverage, err = s.loadAccountDiscoveryCoverage(ctx, activeAccounts, options.AccountID)
	if err != nil {
		return Overview{}, err
	}

	allContent, err := s.loadWholeAccountContent(ctx, workspaceID, start, options, accountByID, now)
	if err != nil {
		return Overview{}, err
	}
	insightContent, err := s.loadStoredInsightContent(ctx, workspaceID, allContent)
	if err != nil {
		return Overview{}, err
	}
	result.Insights = buildOverviewInsights(insightContent, result.Accounts, options.AccountID, start, now)
	orderContentOverviews(allContent, options.Sort)
	result.ContentTotal = len(allContent)
	result.PublicationTotal = uniqueManagedPublicationCount(allContent)
	contentSummary := summarizeWholeAccountContent(allContent)
	result.Summary = mergeOverviewContentSummary(result.Summary, contentSummary, result.Accounts, options.AccountID)

	populationRevision := overviewPopulationRevision(allContent)
	offset, err := s.decodeOverviewOffset(workspaceID, options, days, len(allContent), populationRevision)
	if err != nil {
		return Overview{}, err
	}
	end := min(offset+options.Limit, len(allContent))
	result.Content = allContent[offset:end]
	managedPage := make([]ContentOverview, 0, len(result.Content))
	for _, item := range result.Content {
		if item.Reference.Type == string(platform.AccountContentOriginOpenPost) {
			managedPage = append(managedPage, item)
		}
	}
	result.Publications = buildPublicationOverviews(managedPage)
	nextCursor := s.encodeOverviewNextCursor(workspaceID, offset, len(result.Content), len(allContent), options, days, populationRevision, now)
	result.ContentNextCursor = nextCursor
	result.PublicationNextCursor = nextCursor
	return result, nil
}

func normalizeOverviewOptions(options OverviewOptions) OverviewOptions {
	options.AccountID = strings.TrimSpace(options.AccountID)
	options.Source = strings.ToLower(strings.TrimSpace(options.Source))
	switch options.Source {
	case string(platform.AccountContentOriginOpenPost), string(platform.AccountContentOriginExternal):
	default:
		options.Source = "all"
	}
	options.Sort = strings.ToLower(strings.TrimSpace(options.Sort))
	switch options.Sort {
	case "views", "newest":
	default:
		options.Sort = "engagement"
	}
	if options.Limit <= 0 {
		options.Limit = 50
	} else if options.Limit > 100 {
		options.Limit = 100
	}
	options.Cursor = strings.TrimSpace(options.Cursor)
	return options
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
		Where("subject_type = ?", subjectAccount).
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
	var latest models.AnalyticsSyncState
	if err := s.db.NewSelect().
		Model(&latest).
		Where("workspace_id = ?", workspaceID).
		Where("last_success_at IS NOT NULL").
		OrderExpr("last_success_at DESC").
		Limit(1).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, time.Time{}, fmt.Errorf("load analytics overview last sync: %w", err)
	}
	if latest.LastSuccessAt.After(lastSyncedAt) {
		lastSyncedAt = latest.LastSuccessAt
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
		MetricMetadata:       map[string]platform.AnalyticsMetricMetadata{},
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
		overview.Metrics, overview.MetricMetadata = decodeAnalyticsMetrics(
			state.MetricsJSON,
			state.MetricMetadataJSON,
			platform.AnalyticsMetricSubjectAccount,
			state.Platform,
		)
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
	if followers, ok := compatibleCountMetricValue(
		overview.Metrics,
		overview.MetricMetadata,
		platform.MetricFollowers,
		platform.AnalyticsMetricAggregationCurrentSnapshot,
	); ok {
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
		compatible := compatibleContentValues(item.Metrics, item.MetricMetadata)
		item.Engagement, _ = projectedContentEngagement(item.Metrics, item.MetricMetadata)
		summary.Engagement.Value += platform.EngagementTotal(compatible)
		if platform.HasEngagementMetric(compatible) {
			summary.Engagement.Measured++
		}
		addMeasuredSummary(&summary.Views, compatible, platform.MetricViews)
		addMeasuredSummary(&summary.Impressions, compatible, platform.MetricImpressions)
		addMeasuredSummary(&summary.Reach, compatible, platform.MetricReach)
		content = append(content, item)
	}
	sort.SliceStable(content, func(i, j int) bool {
		if content[i].Engagement != content[j].Engagement {
			return content[i].Engagement > content[j].Engagement
		}
		left, _ := compatibleCountMetricValue(content[i].Metrics, content[i].MetricMetadata, platform.MetricViews, platform.AnalyticsMetricAggregationLifetimeTotal)
		right, _ := compatibleCountMetricValue(content[j].Metrics, content[j].MetricMetadata, platform.MetricViews, platform.AnalyticsMetricAggregationLifetimeTotal)
		return left > right
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
		externalURL = ""
	}
	item := ContentOverview{
		Reference: ContentReference{
			Type: string(platform.AccountContentOriginOpenPost), PublicationID: publication.ID, RenditionID: rendition.ID,
		},
		Source:             string(platform.AccountContentOriginOpenPost),
		PublicationID:      publication.ID,
		RenditionID:        rendition.ID,
		Title:              publication.Title,
		Excerpt:            firstNonEmptyAnalyticsText(publication.SourceText, publication.SourceContent),
		ContentProfile:     rendition.Profile,
		Platform:           rendition.Platform,
		AccountID:          account.ID,
		Username:           account.AccountUsername,
		ExternalURL:        externalURL,
		PublishedAt:        publishedAt,
		Status:             string(platform.AnalyticsStatusPending),
		MetricAvailability: "pending",
		Metrics:            platform.AnalyticsValues{},
		MetricMetadata:     map[string]platform.AnalyticsMetricMetadata{},
		Measurements:       map[string]ContentMeasurement{},
	}
	if state.ID != "" {
		item.Status = state.Status
		item.ErrorCode = state.ErrorCode
		item.ErrorMessage = state.ErrorMessage
		item.LastSyncedAt = state.LastSuccessAt
		item.CollectedAt = state.LastSuccessAt
		item.NextSyncAt = state.NextSyncAt
		item.Stale = analyticsStateStale(state, now)
		item.Metrics, item.MetricMetadata = decodeAnalyticsMetrics(
			state.MetricsJSON,
			state.MetricMetadataJSON,
			platform.AnalyticsMetricSubjectContent,
			state.Platform,
		)
		item.Measurements = contentMeasurements(item.Metrics, item.MetricMetadata, item.CollectedAt)
		item.MetricAvailability = metricAvailability(item.Status, len(item.Measurements))
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
		compatible := compatibleContentValues(item.Metrics, item.MetricMetadata)
		publication.Engagement += platform.EngagementTotal(compatible)
		if platform.HasEngagementMetric(compatible) {
			publication.EngagementMeasured++
		}
		for metric, value := range compatible {
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
		if !publications[i].PublishedAt.Equal(publications[j].PublishedAt) {
			return publications[i].PublishedAt.After(publications[j].PublishedAt)
		}
		return publications[i].PublicationID < publications[j].PublicationID
	})
	return publications
}

type overviewCursor struct {
	WorkspaceID string    `json:"workspace_id"`
	Offset      int       `json:"offset"`
	AccountID   string    `json:"account_id"`
	Source      string    `json:"source"`
	Sort        string    `json:"sort"`
	Days        int       `json:"days"`
	Revision    string    `json:"revision"`
	RangeEnd    time.Time `json:"range_end"`
}

func overviewPopulationRevision(content []ContentOverview) string {
	encoded, _ := json.Marshal(content)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
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
		values, metadata := decodeAnalyticsMetrics(
			snapshot.MetricsJSON,
			snapshot.MetricMetadataJSON,
			platform.AnalyticsMetricSubjectAccount,
			snapshot.Platform,
		)
		followers, ok := compatibleCountMetricValue(
			values,
			metadata,
			platform.MetricFollowers,
			platform.AnalyticsMetricAggregationCurrentSnapshot,
		)
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
