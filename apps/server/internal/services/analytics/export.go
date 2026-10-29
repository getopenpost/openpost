package analytics

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	_ "time/tzdata" // IANA zones must resolve on hosts without a system zoneinfo database.

	"github.com/openpost/backend/internal/platform"
)

// Export groupings. "post" keeps one row per published destination output;
// every other value aggregates the same rows into buckets.
const (
	ExportGroupPost     = "post"
	ExportGroupDay      = "day"
	ExportGroupWeek     = "week"
	ExportGroupMonth    = "month"
	ExportGroupPlatform = "platform"
	ExportGroupAccount  = "account"
)

var (
	ErrInvalidExportOptions = errors.New("invalid analytics export options")

	exportMetricKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
	// exportMetricOrder keeps the common counters first so exports from
	// different workspaces line up; provider-specific keys follow alphabetically.
	exportMetricOrder = []string{
		platform.MetricViews, platform.MetricImpressions, platform.MetricReach,
		platform.MetricLikes, platform.MetricReactions, platform.MetricComments,
		platform.MetricReposts, platform.MetricQuotes, platform.MetricShares,
		platform.MetricSaves, platform.MetricClicks, platform.MetricVideoViews,
		"visibility",
	}
)

// ExportOptions selects what an export contains. The zero value exports every
// account and metric for all time, one row per post, in UTC.
type ExportOptions struct {
	From      string
	To        string
	Days      int
	AccountID string
	// AccountIDs selects individual accounts. Empty means every account.
	AccountIDs []string
	// Platforms limits posts, accounts and daily trends to these platforms.
	Platforms []string
	GroupBy   string
	// Metrics limits post and grouped-report columns. Empty means every measured metric.
	Metrics  []string
	Location *time.Location
}

// ExportTable is a header row plus typed cells. A nil cell means "not
// measured", which is different from a measured zero.
type ExportTable struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

// ExportDataset From and To are UTC calendar days, matching the daily trend
// rows; only publish times and day, week and month groups follow Timezone.
type ExportDataset struct {
	GeneratedAt time.Time `json:"generated_at"`
	Timezone    string    `json:"timezone"`
	RangeDays   int       `json:"range_days"`
	From        string    `json:"from"`
	To          string    `json:"to"`
	GroupBy     string    `json:"group_by"`
	Metrics     []string  `json:"metrics"`
	// Grouped is the table for GroupBy; for "post" it equals Posts.
	Grouped  ExportTable `json:"grouped"`
	Posts    ExportTable `json:"posts"`
	Daily    ExportTable `json:"daily"`
	Accounts ExportTable `json:"accounts"`
}

func NormalizeExportGroupBy(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", ExportGroupPost:
		return ExportGroupPost, nil
	case ExportGroupDay, ExportGroupWeek, ExportGroupMonth, ExportGroupPlatform, ExportGroupAccount:
		return strings.ToLower(strings.TrimSpace(value)), nil
	default:
		return "", ErrInvalidExportOptions
	}
}

func (s *Service) BuildExport(ctx context.Context, workspaceID string, options ExportOptions) (ExportDataset, error) {
	groupBy, err := NormalizeExportGroupBy(options.GroupBy)
	if err != nil {
		return ExportDataset{}, err
	}
	location := options.Location
	if location == nil {
		location = time.UTC
	}
	scope := exportScope{accountID: strings.TrimSpace(options.AccountID), accounts: map[string]bool{}, platforms: map[string]bool{}}
	for _, id := range options.AccountIDs {
		if id = strings.TrimSpace(id); id != "" {
			scope.accounts[id] = true
		}
	}
	for _, name := range options.Platforms {
		if name = strings.ToLower(strings.TrimSpace(name)); name != "" {
			scope.platforms[name] = true
		}
	}
	requested, err := normalizeExportMetrics(options.Metrics)
	if err != nil {
		return ExportDataset{}, err
	}

	// One unpaged pass keeps the export complete without rebuilding the
	// overview for every page of a large workspace.
	overview, err := s.OverviewWithOptions(ctx, workspaceID, options.Days, OverviewOptions{
		From: options.From, To: options.To, AccountID: scope.accountID, Sort: "newest", Unpaged: true,
	})
	if err != nil {
		return ExportDataset{}, err
	}
	content := filterExportContent(append([]ContentOverview(nil), overview.Content...), scope)
	sort.SliceStable(content, func(i, j int) bool { return content[i].PublishedAt.Before(content[j].PublishedAt) })

	metrics := requested
	if len(metrics) == 0 {
		metrics = measuredContentMetrics(content)
	}

	dataset := ExportDataset{
		GeneratedAt: overview.GeneratedAt.In(location),
		Timezone:    location.String(),
		RangeDays:   overview.RangeDays,
		From:        overview.RangeStart.UTC().Format("2006-01-02"),
		To:          overview.RangeEnd.Add(-time.Nanosecond).UTC().Format("2006-01-02"),
		GroupBy:     groupBy,
		Metrics:     metrics,
		Posts:       exportPostsTable(content, metrics, location),
		Daily:       exportDailyTable(overview.Trends, scope),
		Accounts:    exportAccountsTable(overview.Accounts, scope, location),
	}
	if groupBy == ExportGroupPost {
		dataset.Grouped = dataset.Posts
	} else {
		dataset.Grouped = exportGroupedTable(content, metrics, groupBy, location)
	}
	return dataset, nil
}

// ExportMetricLabel turns a provider metric key into a column title.
func ExportMetricLabel(key string) string {
	words := strings.Split(strings.ReplaceAll(key, "_", " "), " ")
	if len(words) > 0 && words[0] != "" {
		words[0] = strings.ToUpper(words[0][:1]) + words[0][1:]
	}
	return strings.Join(words, " ")
}

func normalizeExportMetrics(values []string) ([]string, error) {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || seen[value] {
			continue
		}
		if !exportMetricKeyPattern.MatchString(value) {
			return nil, ErrInvalidExportOptions
		}
		seen[value] = true
		result = append(result, value)
	}
	return result, nil
}

type exportScope struct {
	accountID string
	accounts  map[string]bool
	platforms map[string]bool
}

func (scope exportScope) includes(accountID, platformName string) bool {
	return (scope.accountID == "" || scope.accountID == accountID) &&
		(len(scope.accounts) == 0 || scope.accounts[accountID]) &&
		(len(scope.platforms) == 0 || scope.platforms[strings.ToLower(platformName)])
}

func filterExportContent(content []ContentOverview, scope exportScope) []ContentOverview {
	filtered := content[:0]
	for _, item := range content {
		if scope.includes(item.AccountID, item.Platform) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func measuredContentMetrics(content []ContentOverview) []string {
	present := map[string]bool{}
	for _, item := range content {
		if item.Visibility != nil {
			present["visibility"] = true
		}
		for key := range item.Metrics {
			if key == "visibility" {
				continue
			}
			present[key] = true
		}
	}
	metrics := []string{}
	for _, key := range exportMetricOrder {
		if present[key] {
			metrics = append(metrics, key)
			delete(present, key)
		}
	}
	rest := make([]string, 0, len(present))
	for key := range present {
		rest = append(rest, key)
	}
	sort.Strings(rest)
	return append(metrics, rest...)
}

func exportMetricColumns(metrics []string) []string {
	columns := make([]string, 0, len(metrics))
	for _, key := range metrics {
		columns = append(columns, ExportMetricLabel(key))
	}
	return columns
}

func exportPostsTable(content []ContentOverview, metrics []string, location *time.Location) ExportTable {
	table := ExportTable{
		Columns: append([]string{"Published at", "Title", "Platform", "Account", "Format", "URL", "Engagement"}, exportMetricColumns(metrics)...),
		Rows:    [][]any{},
	}
	for _, item := range content {
		row := make([]any, 0, 7+len(metrics))
		row = append(row,
			item.PublishedAt.In(location).Format("2006-01-02 15:04"),
			firstNonEmpty(item.Title, item.Excerpt), item.Platform, item.Username, item.ContentProfile, item.ExternalURL,
			exportEngagement(item),
		)
		for _, key := range metrics {
			row = append(row, exportContentMetricValue(item, key))
		}
		table.Rows = append(table.Rows, row)
	}
	return table
}

func exportEngagement(item ContentOverview) any {
	if item.MetricAvailability != "available" {
		return nil
	}
	var total int64
	measured := false
	// An aggregate engagement value takes precedence over its components.
	// Missing or incompatible metadata must not turn that projection into zero.
	for _, metric := range engagementProjectionMetricNames(item.Metrics) {
		if value, ok := compatibleCountMetricValue(item.Metrics, item.MetricMetadata, metric, platform.AnalyticsMetricAggregationLifetimeTotal); ok {
			total += value
			measured = true
		}
	}
	if !measured {
		return nil
	}
	return total
}

func exportMetricValue(values platform.AnalyticsValues, key string) any {
	if value, ok := values[key]; ok {
		return value
	}
	return nil
}

func exportContentMetricValue(item ContentOverview, key string) any {
	if key == "visibility" {
		if item.Visibility != nil {
			return item.Visibility.Value
		}
		return nil
	}
	return exportMetricValue(item.Metrics, key)
}

type exportBucket struct {
	key, label  string
	posts       int
	engagement  int64
	measuredEng bool
	metrics     map[string]int64
}

func exportGroupedTable(content []ContentOverview, metrics []string, groupBy string, location *time.Location) ExportTable {
	buckets := map[string]*exportBucket{}
	for _, item := range content {
		key, label := exportGroupKey(item, groupBy, location)
		bucket := buckets[key]
		if bucket == nil {
			bucket = &exportBucket{key: key, label: label, metrics: map[string]int64{}}
			buckets[key] = bucket
		}
		bucket.posts++
		if engagement, ok := exportEngagement(item).(int64); ok {
			bucket.engagement += engagement
			bucket.measuredEng = true
		}
		for _, metric := range metrics {
			if metric == "visibility" {
				if item.Visibility != nil {
					bucket.metrics[metric] += item.Visibility.Value
				}
				continue
			}
			// Publish-date buckets can sum lifetime counters, not averages or
			// values measured over separate provider reporting periods.
			if value, ok := compatibleCountMetricValue(item.Metrics, item.MetricMetadata, metric, platform.AnalyticsMetricAggregationLifetimeTotal); ok {
				bucket.metrics[metric] += value
			}
		}
	}
	ordered := make([]*exportBucket, 0, len(buckets))
	for _, bucket := range buckets {
		ordered = append(ordered, bucket)
	}
	switch groupBy {
	case ExportGroupPlatform, ExportGroupAccount:
		sort.SliceStable(ordered, func(i, j int) bool {
			if ordered[i].engagement != ordered[j].engagement {
				return ordered[i].engagement > ordered[j].engagement
			}
			return ordered[i].key < ordered[j].key
		})
	default:
		sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].key < ordered[j].key })
	}

	title := map[string]string{
		ExportGroupDay: "Day", ExportGroupWeek: "Week starting", ExportGroupMonth: "Month",
		ExportGroupPlatform: "Platform", ExportGroupAccount: "Account",
	}[groupBy]
	table := ExportTable{
		Columns: append([]string{title, "Posts", "Engagement"}, exportMetricColumns(metrics)...),
		Rows:    [][]any{},
	}
	for _, bucket := range ordered {
		row := []any{bucket.label, bucket.posts, nil}
		if bucket.measuredEng {
			row[2] = bucket.engagement
		}
		for _, metric := range metrics {
			if value, ok := bucket.metrics[metric]; ok {
				row = append(row, value)
			} else {
				row = append(row, nil)
			}
		}
		table.Rows = append(table.Rows, row)
	}
	return table
}

func exportGroupKey(item ContentOverview, groupBy string, location *time.Location) (string, string) {
	published := item.PublishedAt.In(location)
	switch groupBy {
	case ExportGroupDay:
		day := published.Format("2006-01-02")
		return day, day
	case ExportGroupWeek:
		offset := (int(published.Weekday()) + 6) % 7 // weeks start on Monday
		monday := time.Date(published.Year(), published.Month(), published.Day()-offset, 0, 0, 0, 0, location)
		day := monday.Format("2006-01-02")
		return day, day
	case ExportGroupMonth:
		month := published.Format("2006-01")
		return month, month
	case ExportGroupPlatform:
		return item.Platform, item.Platform
	default:
		label := firstNonEmpty(item.Username, item.AccountID)
		return item.Platform + "/" + item.AccountID, fmt.Sprintf("%s (%s)", label, item.Platform)
	}
}

// exportDailyTable merges the daily trend series on calendar day. Trend
// days are the provider-neutral UTC days the dashboard charts use, so they do
// not shift with the export timezone.
func exportDailyTable(trends TrendSeries, scope exportScope) ExportTable {
	type day struct {
		followers, engagement, views, visibility             int64
		hasFollowers, hasEngagement, hasViews, hasVisibility bool
	}
	days := map[string]*day{}
	add := func(points []DailyBreakdownPoint, apply func(*day, int64)) {
		for _, point := range points {
			var value int64
			measured := false
			for _, item := range point.Items {
				if scope.includes(item.AccountID, item.Platform) {
					value += item.Value
					measured = true
				}
			}
			if !measured {
				continue
			}

			entry := days[point.Date]
			if entry == nil {
				entry = &day{}
				days[point.Date] = entry
			}
			apply(entry, value)
		}
	}
	add(trends.Followers, func(d *day, v int64) { d.followers, d.hasFollowers = v, true })
	add(trends.Engagement, func(d *day, v int64) { d.engagement, d.hasEngagement = v, true })
	add(trends.Views, func(d *day, v int64) { d.views, d.hasViews = v, true })
	add(trends.Visibility, func(d *day, v int64) { d.visibility, d.hasVisibility = v, true })

	dates := make([]string, 0, len(days))
	for date := range days {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	table := ExportTable{Columns: []string{"Date", "Follower change", "Engagement", "Views", "Visibility"}, Rows: [][]any{}}
	for _, date := range dates {
		entry := days[date]
		row := []any{date, nil, nil, nil, nil}
		if entry.hasFollowers {
			row[1] = entry.followers
		}
		if entry.hasEngagement {
			row[2] = entry.engagement
		}
		if entry.hasViews {
			row[3] = entry.views
		}
		if entry.hasVisibility {
			row[4] = entry.visibility
		}
		table.Rows = append(table.Rows, row)
	}
	return table
}

func exportAccountsTable(accounts []AccountOverview, scope exportScope, location *time.Location) ExportTable {
	table := ExportTable{
		Columns: []string{"Platform", "Account", "Status", "Followers", "Follower change", "Last synced"},
		Rows:    [][]any{},
	}
	for _, account := range accounts {
		if !scope.includes(account.ID, account.Platform) {
			continue
		}
		row := []any{account.Platform, account.Username, account.Status, exportMetricValue(account.Metrics, platform.MetricFollowers), nil, ""}
		if account.FollowerDelta != nil {
			row[4] = *account.FollowerDelta
		}
		if !account.LastSyncedAt.IsZero() {
			row[5] = account.LastSyncedAt.In(location).Format("2006-01-02 15:04")
		}
		table.Rows = append(table.Rows, row)
	}
	return table
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
