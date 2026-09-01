package analytics

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestResolveExternalRepurposeSourceBoundsStoredFieldsAndLeavesSourceUnchanged(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, time.September, 8, 12, 0, 0, 0, time.UTC)
	longText := strings.Repeat("界", platform.AccountContentMaxTextCharacters)
	source := models.AccountContent{
		ID: "external-1", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
		Platform: account.Platform, ProviderContentID: "provider-secret", ContentProfile: models.ContentProfileShortText,
		Title: "Stored source", Text: longText, PublishedAt: now.Add(-time.Hour),
		Origin: string(platform.AccountContentOriginExternal), OriginConfidence: string(platform.AccountContentOriginConfidenceExact),
		FirstDiscoveredAt: now.Add(-time.Hour), LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&source).Exec(t.Context())
	require.NoError(t, err)
	periodStart := now.AddDate(0, 0, -7)
	periodEnd := now
	metadata := `{"views":{"unit":"count","aggregation":"lifetime_total","source":"test"}}`
	_, err = db.NewInsert().Model(&models.AnalyticsAccountContentSnapshot{
		ID: "snapshot-1", WorkspaceID: account.WorkspaceID, AccountContentID: source.ID,
		SocialAccountID: account.ID, Platform: account.Platform, MetricsJSON: `{"views":42}`,
		MetricMetadataJSON: metadata, CapturedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	reference := ContentReference{Type: string(platform.AccountContentOriginExternal), AccountContentID: source.ID}

	first, err := service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, reference, RepurposeRange{Days: 7})
	require.NoError(t, err)
	second, err := service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, reference, RepurposeRange{Days: 7})
	require.NoError(t, err)
	require.NotEqual(t, first.HandoffID, second.HandoffID, "each invocation must produce fresh local state")
	require.Len(t, []rune(first.SourceText), platform.AccountContentMaxTextCharacters)
	require.Equal(t, []string{account.ID}, first.DestinationAccountIDs)
	require.Len(t, first.Evidence, 1)
	require.Equal(t, int64(42), first.Evidence[0].Value)
	require.Equal(t, platform.AnalyticsMetricAggregationLifetimeTotal, first.Evidence[0].Metadata.Aggregation)
	require.Equal(t, "lifetime", first.Evidence[0].Scope)
	require.Equal(t, periodStart, now.AddDate(0, 0, -first.Range.Days))
	require.Equal(t, periodEnd, now)

	var unchanged models.AccountContent
	require.NoError(t, db.NewSelect().Model(&unchanged).Where("id = ?", source.ID).Scan(t.Context()))
	require.Equal(t, longText, unchanged.Text)
	require.Equal(t, "provider-secret", unchanged.ProviderContentID)
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "resolving a handoff must not create a Publication")
}

func TestRepurposeEvidenceSelectsRequestedReportingPeriodInsteadOfNewestMismatch(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	sevenStart := now.AddDate(0, 0, -7)
	thirtyStart := now.AddDate(0, 0, -30)
	snapshot := func(value int64, captured, start time.Time) repurposeSnapshot {
		measurements := platform.AnalyticsMeasurements{platform.MetricEngagements: {
			Value: value, AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
				Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodTotal,
				Source: "pinterest", PeriodStart: &start, PeriodEnd: &now,
			},
		}}
		values, metadata, err := measurements.ValuesAndMetadata("pinterest")
		require.NoError(t, err)
		valuesJSON, err := encodeAnalyticsValues(values)
		require.NoError(t, err)
		metadataJSON, err := encodeMetricMetadata(metadata)
		require.NoError(t, err)
		return repurposeSnapshot{MetricsJSON: valuesJSON, MetricMetadataJSON: metadataJSON, CapturedAt: captured, Platform: "pinterest"}
	}
	selected := selectRepurposeSnapshot([]repurposeSnapshot{
		snapshot(30, now, thirtyStart), snapshot(7, now.Add(-time.Hour), sevenStart),
	}, sevenStart, now)
	evidence := repurposeEvidence(selected, sevenStart, now)
	require.Len(t, evidence, 1)
	require.Equal(t, int64(7), evidence[0].Value)
	require.Equal(t, "requested_range", evidence[0].Scope)
}

func TestResolveManagedRepurposeSourceFiltersInvalidDestinationsAndPreservesPublication(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, time.September, 8, 12, 0, 0, 0, time.UTC)
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-1", now)
	publication.SourceText = strings.Repeat("m", platform.AccountContentMaxTextCharacters+25)
	publication.SourceContent = publication.SourceText
	_, err := db.NewUpdate().Model(&publication).Column("source_text", "source_content").WherePK().Exec(t.Context())
	require.NoError(t, err)
	renditions := []models.Rendition{
		{ID: "rendition-valid", PublicationID: publication.ID, SocialAccountID: account.ID, Platform: account.Platform, Profile: models.ContentProfileShortText, Status: models.RenditionStatusPublished, SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now},
		{ID: "rendition-missing-account", PublicationID: publication.ID, SocialAccountID: "deleted-account", Platform: "x", Profile: models.ContentProfileShortText, Status: models.RenditionStatusPublished, SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now},
	}
	_, err = db.NewInsert().Model(&renditions).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }

	handoff, err := service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{
		Type: string(platform.AccountContentOriginOpenPost), PublicationID: publication.ID, RenditionID: renditions[0].ID,
	}, RepurposeRange{Days: 30})
	require.NoError(t, err)
	require.Equal(t, []string{account.ID}, handoff.DestinationAccountIDs)
	require.Len(t, handoff.SourceText, platform.AccountContentMaxTextCharacters)

	var unchanged models.Publication
	require.NoError(t, db.NewSelect().Model(&unchanged).Where("id = ?", publication.ID).Scan(t.Context()))
	require.Equal(t, models.PublicationStatusPublished, unchanged.Status)
	require.Equal(t, publication.SourceText, unchanged.SourceText)
	var unchangedRendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&unchangedRendition).Where("id = ?", renditions[0].ID).Scan(t.Context()))
	require.Equal(t, models.RenditionStatusPublished, unchangedRendition.Status)
}

func TestResolveRepurposeSourceRejectsUnavailableUnsupportedAndCrossWorkspaceSources(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	contents := []models.AccountContent{
		{ID: "gone", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: account.Platform, ProviderContentID: "gone", ContentProfile: models.ContentProfileShortText, Text: "gone", PublishedAt: now, Origin: string(platform.AccountContentOriginExternal), ProviderUnavailableAt: now, FirstDiscoveredAt: now, LastSeenAt: now},
		{ID: "unsupported", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: account.Platform, ProviderContentID: "unsupported", ContentProfile: "provider_unknown", Text: "text", PublishedAt: now, Origin: string(platform.AccountContentOriginExternal), FirstDiscoveredAt: now, LastSeenAt: now},
	}
	_, err := db.NewInsert().Model(&contents).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})

	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "external", AccountContentID: "gone"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceUnavailable)
	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "external", AccountContentID: "unsupported"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceUnsupported)
	_, err = service.ResolveRepurposeSource(t.Context(), "another-workspace", ContentReference{Type: "external", AccountContentID: "unsupported"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceNotFound)
}
