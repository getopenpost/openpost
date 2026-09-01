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

func (s *Service) loadWholeAccountContent(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	options OverviewOptions,
	accountByID map[string]models.SocialAccount,
	now time.Time,
) ([]ContentOverview, error) {
	itemsByKey := make(map[string]ContentOverview)

	if options.Source != string(platform.AccountContentOriginExternal) {
		managed, err := s.loadManagedContent(ctx, workspaceID, start, options.AccountID, accountByID, now)
		if err != nil {
			return nil, err
		}
		for _, item := range managed {
			itemsByKey[managedContentKey(item.RenditionID)] = item
		}
	}

	inventory, err := s.loadAccountContentInventory(ctx, workspaceID, start, options)
	if err != nil {
		return nil, err
	}
	snapshots, err := s.loadLatestAccountContentSnapshots(ctx, workspaceID, inventory)
	if err != nil {
		return nil, err
	}
	linked, err := s.loadLinkedManagedContent(ctx, inventory)
	if err != nil {
		return nil, err
	}
	for _, content := range inventory {
		account, ok := accountByID[content.SocialAccountID]
		if !ok {
			continue
		}
		item, ok := buildAccountContentOverview(content, account, snapshots[content.ID], linked[content.RenditionID])
		if !ok {
			continue
		}
		if item.Reference.Type == string(platform.AccountContentOriginOpenPost) {
			delete(itemsByKey, managedContentKey(item.RenditionID))
		}
		itemsByKey[accountContentKey(content.ID)] = item
	}

	items := make([]ContentOverview, 0, len(itemsByKey))
	for _, item := range itemsByKey {
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) loadManagedContent(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	accountID string,
	accountByID map[string]models.SocialAccount,
	now time.Time,
) ([]ContentOverview, error) {
	var renditions []models.Rendition
	query := s.db.NewSelect().Model(&renditions).
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Where("publication.workspace_id = ?", workspaceID).
		Where("publication.status = ?", models.PublicationStatusPublished).
		Where("rendition.status = ?", models.RenditionStatusPublished).
		Where("COALESCE(publication.actual_run_at, publication.updated_at) >= ?", start)
	if accountID != "" {
		query = query.Where("rendition.social_account_id = ?", accountID)
	}
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load managed whole-account content: %w", err)
	}
	publicationIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		publicationIDs = append(publicationIDs, rendition.PublicationID)
	}
	publicationByID, err := s.loadOverviewPublicationsByID(ctx, publicationIDs)
	if err != nil {
		return nil, err
	}
	states, err := s.loadOverviewRenditionStates(ctx, workspaceID, renditions)
	if err != nil {
		return nil, err
	}
	unused := Summary{}
	return buildContentOverviews(renditions, publicationByID, accountByID, states, now, &unused), nil
}

func (s *Service) loadAccountContentInventory(
	ctx context.Context,
	workspaceID string,
	start time.Time,
	options OverviewOptions,
) ([]models.AccountContent, error) {
	var inventory []models.AccountContent
	query := s.db.NewSelect().Model(&inventory).
		Where("workspace_id = ?", workspaceID).
		Where("published_at >= ?", start)
	if options.AccountID != "" {
		query = query.Where("social_account_id = ?", options.AccountID)
	}
	switch options.Source {
	case string(platform.AccountContentOriginOpenPost):
		query = query.Where("origin = ?", platform.AccountContentOriginOpenPost)
	case string(platform.AccountContentOriginExternal):
		query = query.Where("origin = ?", platform.AccountContentOriginExternal)
	}
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load account content inventory for analytics: %w", err)
	}
	return inventory, nil
}

func (s *Service) loadLatestAccountContentSnapshots(
	ctx context.Context,
	workspaceID string,
	inventory []models.AccountContent,
) (map[string]models.AnalyticsAccountContentSnapshot, error) {
	latest := make(map[string]models.AnalyticsAccountContentSnapshot, len(inventory))
	if len(inventory) == 0 {
		return latest, nil
	}
	ids := make([]string, 0, len(inventory))
	for _, content := range inventory {
		ids = append(ids, content.ID)
	}
	var snapshots []models.AnalyticsAccountContentSnapshot
	if err := s.db.NewSelect().Model(&snapshots).
		Where("workspace_id = ?", workspaceID).
		Where("account_content_id IN (?)", bun.List(ids)).
		Order("account_content_id ASC", "captured_at DESC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load account content analytics snapshots: %w", err)
	}
	for _, snapshot := range snapshots {
		if _, exists := latest[snapshot.AccountContentID]; !exists {
			latest[snapshot.AccountContentID] = snapshot
		}
	}
	return latest, nil
}

type linkedManagedContent struct {
	rendition   models.Rendition
	publication models.Publication
}

func (s *Service) loadLinkedManagedContent(
	ctx context.Context,
	inventory []models.AccountContent,
) (map[string]linkedManagedContent, error) {
	ids := make([]string, 0)
	for _, content := range inventory {
		if content.Origin == string(platform.AccountContentOriginOpenPost) && content.RenditionID != "" {
			ids = append(ids, content.RenditionID)
		}
	}
	result := make(map[string]linkedManagedContent, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var renditions []models.Rendition
	if err := s.db.NewSelect().Model(&renditions).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load linked managed content renditions: %w", err)
	}
	publicationIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		publicationIDs = append(publicationIDs, rendition.PublicationID)
	}
	publications, err := s.loadOverviewPublicationsByID(ctx, publicationIDs)
	if err != nil {
		return nil, err
	}
	for _, rendition := range renditions {
		publication, ok := publications[rendition.PublicationID]
		if ok {
			result[rendition.ID] = linkedManagedContent{rendition: rendition, publication: publication}
		}
	}
	return result, nil
}

func buildAccountContentOverview(
	content models.AccountContent,
	account models.SocialAccount,
	snapshot models.AnalyticsAccountContentSnapshot,
	managed linkedManagedContent,
) (ContentOverview, bool) {
	reference := ContentReference{Type: content.Origin}
	publicationID := ""
	renditionID := ""
	title := content.Title
	excerpt := content.Text
	switch content.Origin {
	case string(platform.AccountContentOriginOpenPost):
		if managed.rendition.ID == "" || managed.rendition.ID != content.RenditionID ||
			managed.rendition.SocialAccountID != content.SocialAccountID || managed.rendition.ExternalID != content.ProviderContentID ||
			managed.publication.WorkspaceID != content.WorkspaceID {
			return ContentOverview{}, false
		}
		publicationID = managed.publication.ID
		renditionID = managed.rendition.ID
		reference.PublicationID = publicationID
		reference.RenditionID = renditionID
		title = firstNonEmptyAnalyticsText(title, managed.publication.Title)
		excerpt = firstNonEmptyAnalyticsText(excerpt, managed.publication.SourceText, managed.publication.SourceContent)
	case string(platform.AccountContentOriginExternal):
		reference.AccountContentID = content.ID
	default:
		return ContentOverview{}, false
	}

	status := string(platform.AnalyticsStatusPending)
	if !content.ProviderUnavailableAt.IsZero() {
		status = string(platform.AnalyticsStatusNotFound)
	} else if snapshot.ID != "" {
		status = string(platform.AnalyticsStatusOK)
	}
	metrics, metadata := decodeAnalyticsMetrics(
		snapshot.MetricsJSON,
		snapshot.MetricMetadataJSON,
		platform.AnalyticsMetricSubjectContent,
		content.Platform,
	)
	externalURL := content.ExternalURL
	if !platform.IsSafeContentURL(externalURL) {
		externalURL = ""
	}
	measurements := contentMeasurements(metrics, metadata, snapshot.CapturedAt)
	item := ContentOverview{
		insightSnapshotBacked: true,
		Reference:             reference,
		Source:                content.Origin,
		PublicationID:         publicationID,
		RenditionID:           renditionID,
		Title:                 title,
		Excerpt:               excerpt,
		ContentProfile:        content.ContentProfile,
		Platform:              content.Platform,
		AccountID:             content.SocialAccountID,
		Username:              account.AccountUsername,
		ExternalURL:           externalURL,
		PublishedAt:           content.PublishedAt,
		Status:                status,
		MetricAvailability:    metricAvailability(status, len(measurements)),
		CollectedAt:           snapshot.CapturedAt,
		Metrics:               metrics,
		MetricMetadata:        metadata,
		Measurements:          measurements,
		LastSyncedAt:          snapshot.CapturedAt,
	}
	item.Engagement, _ = projectedContentEngagement(metrics, metadata)
	return item, true
}

func contentMeasurements(
	values platform.AnalyticsValues,
	metadata map[string]platform.AnalyticsMetricMetadata,
	collectedAt time.Time,
) map[string]ContentMeasurement {
	measurements := make(map[string]ContentMeasurement, len(values))
	for metric, value := range values {
		meta, ok := metadata[metric]
		if !ok {
			continue
		}
		measurements[metric] = ContentMeasurement{
			Value: value, Availability: "available", CollectedAt: collectedAt, Metadata: meta,
		}
	}
	return measurements
}

func metricAvailability(status string, measured int) string {
	if measured > 0 {
		return "available"
	}
	if status == "" || status == string(platform.AnalyticsStatusPending) {
		return "pending"
	}
	return "unavailable"
}

func summarizeWholeAccountContent(content []ContentOverview) Summary {
	summary := Summary{Published: len(content)}
	for _, item := range content {
		compatible := compatibleContentValues(item.Metrics, item.MetricMetadata)
		summary.Engagement.Value += platform.EngagementTotal(compatible)
		if platform.HasEngagementMetric(compatible) {
			summary.Engagement.Measured++
		}
		addMeasuredSummary(&summary.Views, compatible, platform.MetricViews)
		addMeasuredSummary(&summary.Impressions, compatible, platform.MetricImpressions)
		addMeasuredSummary(&summary.Reach, compatible, platform.MetricReach)
	}
	return summary
}

func uniqueManagedPublicationCount(content []ContentOverview) int {
	ids := make(map[string]struct{})
	for _, item := range content {
		if item.Reference.Type == string(platform.AccountContentOriginOpenPost) && item.PublicationID != "" {
			ids[item.PublicationID] = struct{}{}
		}
	}
	return len(ids)
}

func orderContentOverviews(content []ContentOverview, order string) {
	sort.SliceStable(content, func(i, j int) bool {
		left, right := content[i], content[j]
		switch order {
		case "newest":
			if !left.PublishedAt.Equal(right.PublishedAt) {
				return left.PublishedAt.After(right.PublishedAt)
			}
		case "views":
			leftViews, _ := compatibleCountMetricValue(left.Metrics, left.MetricMetadata, platform.MetricViews, platform.AnalyticsMetricAggregationLifetimeTotal)
			rightViews, _ := compatibleCountMetricValue(right.Metrics, right.MetricMetadata, platform.MetricViews, platform.AnalyticsMetricAggregationLifetimeTotal)
			if leftViews != rightViews {
				return leftViews > rightViews
			}
		default:
			if left.Engagement != right.Engagement {
				return left.Engagement > right.Engagement
			}
		}
		if !left.PublishedAt.Equal(right.PublishedAt) {
			return left.PublishedAt.After(right.PublishedAt)
		}
		return contentIdentity(left) < contentIdentity(right)
	})
}

func contentIdentity(item ContentOverview) string {
	if item.Reference.Type == string(platform.AccountContentOriginExternal) {
		return "external:" + item.Reference.AccountContentID
	}
	return "openpost:" + item.Reference.RenditionID
}

func managedContentKey(renditionID string) string { return "managed:" + renditionID }
func accountContentKey(contentID string) string   { return "inventory:" + contentID }

func (s *Service) loadAccountDiscoveryCoverage(
	ctx context.Context,
	accounts []models.SocialAccount,
	accountID string,
) ([]AccountDiscoveryCoverage, error) {
	if len(accounts) == 0 {
		return []AccountDiscoveryCoverage{}, nil
	}
	var states []models.AccountContentDiscoveryState
	query := s.db.NewSelect().Model(&states)
	ids := make([]string, 0, len(accounts))
	for _, account := range accounts {
		ids = append(ids, account.ID)
	}
	query = query.Where("social_account_id IN (?)", bun.List(ids))
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load account discovery coverage: %w", err)
	}
	stateByAccount := make(map[string]models.AccountContentDiscoveryState, len(states))
	for _, state := range states {
		stateByAccount[state.SocialAccountID] = state
	}
	coverage := make([]AccountDiscoveryCoverage, 0, len(accounts))
	for _, account := range accounts {
		if accountID != "" && account.ID != accountID {
			continue
		}
		state, exists := stateByAccount[account.ID]
		if !exists {
			coverage = append(coverage, s.discoveryCoverageWithoutState(account))
			continue
		}
		coverage = append(coverage, AccountDiscoveryCoverage{
			AccountID: account.ID, Platform: account.Platform, Status: state.CoverageStatus,
			Description: state.CoverageDescription, BackfillWatermark: state.BackfillWatermark,
			InitialItemsDiscovered: state.InitialItemsDiscovered, InitialCompletedAt: state.InitialCompletedAt,
			LastSuccessAt: state.LastSuccessAt, LastAttemptedAt: state.LastAttemptedAt,
			FailureCode: state.FailureCode, FailureMessage: state.FailureMessage, NextEligibleAt: state.NextEligibleAt,
		})
	}
	return coverage, nil
}

func (s *Service) discoveryCoverageWithoutState(account models.SocialAccount) AccountDiscoveryCoverage {
	result := AccountDiscoveryCoverage{AccountID: account.ID, Platform: account.Platform}
	discoverer := s.accountContentDiscoverer(account)
	if discoverer == nil {
		result.Status = string(platform.AccountContentDiscoveryUnsupported)
		result.Description = "Account content discovery is not available for this provider."
		return result
	}
	support := discoverer.AccountContentDiscoverySupport(discoveryAccountContext(account))
	if !support.Supported {
		result.Status = string(platform.AccountContentDiscoveryUnsupported)
		result.Description = support.UnavailableReason
		return result
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
		result.Status = string(platform.AccountContentDiscoveryPermissionRequired)
		result.Description = missingScopeMessage(missing)
		return result
	}
	result.Status = string(platform.AccountContentDiscoveryPartial)
	result.Description = "Account history has not been collected yet."
	return result
}
