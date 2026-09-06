package analytics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const maxRepurposeEvidenceMetrics = 20

var (
	ErrInvalidRepurposeReference  = errors.New("invalid repurpose content reference")
	ErrRepurposeSourceNotFound    = errors.New("repurpose source not found")
	ErrRepurposeSourceUnavailable = errors.New("repurpose source is no longer available")
	ErrRepurposeSourceUnsupported = errors.New("repurpose source is unsupported")
)

type RepurposeRange struct {
	Days int `json:"days" enum:"7,30,90" doc:"Reporting window in days"`
}

type RepurposeProvenance struct {
	Reference   ContentReference `json:"reference"`
	Origin      string           `json:"origin" enum:"openpost,external"`
	Platform    string           `json:"platform"`
	PublishedAt time.Time        `json:"published_at"`
}

type RepurposeEvidence struct {
	Metric      string                           `json:"metric"`
	Value       int64                            `json:"value"`
	CollectedAt time.Time                        `json:"collected_at"`
	Scope       string                           `json:"scope" enum:"requested_range,lifetime,current_snapshot"`
	Metadata    platform.AnalyticsMetricMetadata `json:"metadata"`
}

// RepurposeSource is a bounded, read-only handoff. HandoffID identifies one
// fresh local composer invocation; it is never persisted and does not identify
// the provider item.
type RepurposeSource struct {
	HandoffID             string              `json:"handoff_id"`
	WorkspaceID           string              `json:"workspace_id"`
	Title                 string              `json:"title"`
	SourceText            string              `json:"source_text"`
	ContentProfile        string              `json:"content_profile"`
	DestinationAccountIDs []string            `json:"destination_account_ids"`
	Range                 RepurposeRange      `json:"range"`
	Provenance            RepurposeProvenance `json:"provenance"`
	Evidence              []RepurposeEvidence `json:"evidence"`
}

type repurposeSnapshot struct {
	MetricsJSON        string
	MetricMetadataJSON string
	CapturedAt         time.Time
	Platform           string
}

// ResolveRepurposeSource resolves an opaque analytics reference entirely from
// stored state. It performs no provider, model, Publication, or Rendition write.
func (s *Service) ResolveRepurposeSource(
	ctx context.Context,
	workspaceID string,
	reference ContentReference,
	rangeInput RepurposeRange,
) (RepurposeSource, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" || (rangeInput.Days != 7 && rangeInput.Days != 30 && rangeInput.Days != 90) {
		return RepurposeSource{}, ErrInvalidRepurposeReference
	}

	title, sourceText, profile, platformName, publishedAt, candidateAccountIDs, snapshot, err :=
		s.resolveRepurposeReference(ctx, workspaceID, reference, rangeInput.Days)
	if err != nil {
		return RepurposeSource{}, err
	}
	if !validAccountContentProfile(profile) || strings.TrimSpace(sourceText) == "" {
		return RepurposeSource{}, ErrRepurposeSourceUnsupported
	}

	sourceText = truncateRepurposeText(sourceText, platform.AccountContentMaxTextCharacters)
	title = truncateRepurposeText(title, platform.AccountContentMaxTitleCharacters)
	destinationIDs, err := s.filterRepurposeDestinations(ctx, workspaceID, candidateAccountIDs)
	if err != nil {
		return RepurposeSource{}, err
	}
	rangeEnd := s.now().UTC()
	rangeStart := rangeEnd.AddDate(0, 0, -rangeInput.Days)
	return RepurposeSource{
		HandoffID: uuid.NewString(), WorkspaceID: workspaceID, Title: title,
		SourceText: sourceText, ContentProfile: profile, DestinationAccountIDs: destinationIDs,
		Range: rangeInput,
		Provenance: RepurposeProvenance{
			Reference: reference, Origin: reference.Type, Platform: platformName, PublishedAt: publishedAt,
		},
		Evidence: repurposeEvidence(snapshot, rangeStart, rangeEnd),
	}, nil
}

func (s *Service) resolveRepurposeReference(
	ctx context.Context,
	workspaceID string,
	reference ContentReference,
	days int,
) (string, string, string, string, time.Time, []string, repurposeSnapshot, error) {
	switch strings.TrimSpace(reference.Type) {
	case string(platform.AccountContentOriginExternal):
		if strings.TrimSpace(reference.AccountContentID) == "" || reference.PublicationID != "" || reference.RenditionID != "" {
			return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrInvalidRepurposeReference
		}
		return s.resolveExternalRepurposeSource(ctx, workspaceID, reference.AccountContentID, days)
	case string(platform.AccountContentOriginOpenPost):
		if strings.TrimSpace(reference.PublicationID) == "" || strings.TrimSpace(reference.RenditionID) == "" || reference.AccountContentID != "" {
			return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrInvalidRepurposeReference
		}
		return s.resolveManagedRepurposeSource(ctx, workspaceID, reference, days)
	default:
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrInvalidRepurposeReference
	}
}

func (s *Service) resolveExternalRepurposeSource(
	ctx context.Context,
	workspaceID, accountContentID string,
	days int,
) (string, string, string, string, time.Time, []string, repurposeSnapshot, error) {
	var content models.AccountContent
	if err := s.db.NewSelect().Model(&content).
		Where("id = ? AND workspace_id = ?", strings.TrimSpace(accountContentID), workspaceID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrRepurposeSourceNotFound
		}
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, fmt.Errorf("load external repurpose source: %w", err)
	}
	if content.Origin != string(platform.AccountContentOriginExternal) {
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrRepurposeSourceNotFound
	}
	if !content.ProviderUnavailableAt.IsZero() {
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrRepurposeSourceUnavailable
	}
	var stored []models.AnalyticsAccountContentSnapshot
	if err := s.db.NewSelect().Model(&stored).
		Where("workspace_id = ? AND account_content_id = ?", workspaceID, content.ID).
		Order("captured_at DESC").Limit(50).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, fmt.Errorf("load external repurpose evidence: %w", err)
	}
	snapshots := make([]repurposeSnapshot, 0, len(stored))
	for _, item := range stored {
		snapshots = append(snapshots, repurposeSnapshot{MetricsJSON: item.MetricsJSON, MetricMetadataJSON: item.MetricMetadataJSON, CapturedAt: item.CapturedAt, Platform: content.Platform})
	}
	selected := selectRepurposeSnapshot(snapshots, s.now().AddDate(0, 0, -days), s.now())
	return content.Title, firstNonEmptyAnalyticsText(content.Text, content.Title), content.ContentProfile,
		content.Platform, content.PublishedAt, []string{content.SocialAccountID}, selected, nil
}

func (s *Service) resolveManagedRepurposeSource(
	ctx context.Context,
	workspaceID string,
	reference ContentReference,
	days int,
) (string, string, string, string, time.Time, []string, repurposeSnapshot, error) {
	var publication models.Publication
	if err := s.db.NewSelect().Model(&publication).
		Where("id = ? AND workspace_id = ?", reference.PublicationID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrRepurposeSourceNotFound
		}
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, fmt.Errorf("load managed repurpose publication: %w", err)
	}
	var sourceRendition models.Rendition
	if err := s.db.NewSelect().Model(&sourceRendition).
		Where("id = ? AND publication_id = ?", reference.RenditionID, publication.ID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, ErrRepurposeSourceNotFound
		}
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, fmt.Errorf("load managed repurpose rendition: %w", err)
	}
	var accountIDs []string
	if err := s.db.NewSelect().Model((*models.Rendition)(nil)).Column("social_account_id").
		Where("publication_id = ?", publication.ID).Scan(ctx, &accountIDs); err != nil {
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, fmt.Errorf("load managed repurpose destinations: %w", err)
	}
	var stored []models.AnalyticsRenditionSnapshot
	if err := s.db.NewSelect().Model(&stored).
		Where("workspace_id = ? AND publication_id = ? AND rendition_id = ?", workspaceID, publication.ID, sourceRendition.ID).
		Order("captured_at DESC").Limit(50).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", "", "", "", time.Time{}, nil, repurposeSnapshot{}, fmt.Errorf("load managed repurpose evidence: %w", err)
	}
	publishedAt := publication.ActualRunAt
	if publishedAt.IsZero() {
		publishedAt = publication.UpdatedAt
	}
	snapshots := make([]repurposeSnapshot, 0, len(stored))
	for _, item := range stored {
		snapshots = append(snapshots, repurposeSnapshot{MetricsJSON: item.MetricsJSON, MetricMetadataJSON: item.MetricMetadataJSON, CapturedAt: item.CapturedAt, Platform: sourceRendition.Platform})
	}
	selected := selectRepurposeSnapshot(snapshots, s.now().AddDate(0, 0, -days), s.now())
	return publication.Title, firstNonEmptyAnalyticsText(publication.SourceText, publication.SourceContent),
		publication.ContentProfile, sourceRendition.Platform, publishedAt, accountIDs, selected, nil
}

func (s *Service) filterRepurposeDestinations(ctx context.Context, workspaceID string, candidateIDs []string) ([]string, error) {
	candidateIDs = uniqueRepurposeStrings(candidateIDs)
	if len(candidateIDs) == 0 {
		return []string{}, nil
	}
	var ids []string
	if err := s.db.NewSelect().Model((*models.SocialAccount)(nil)).Column("id").
		Where("workspace_id = ? AND is_active = ? AND id IN (?)", workspaceID, true, bun.List(candidateIDs)).
		Order("id ASC").Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("filter repurpose destinations: %w", err)
	}
	return ids, nil
}

func repurposeEvidence(snapshot repurposeSnapshot, rangeStart, rangeEnd time.Time) []RepurposeEvidence {
	if snapshot.CapturedAt.IsZero() {
		return []RepurposeEvidence{}
	}
	values, metadata := decodeAnalyticsMetrics(snapshot.MetricsJSON, snapshot.MetricMetadataJSON, platform.AnalyticsMetricSubjectContent, snapshot.Platform)
	metrics := make([]string, 0, len(values))
	for metric := range values {
		if meta, described := metadata[metric]; described && repurposeEvidenceScope(meta, rangeStart, rangeEnd) != "" {
			metrics = append(metrics, metric)
		}
	}
	sort.Strings(metrics)
	if len(metrics) > maxRepurposeEvidenceMetrics {
		metrics = metrics[:maxRepurposeEvidenceMetrics]
	}
	evidence := make([]RepurposeEvidence, 0, len(metrics))
	for _, metric := range metrics {
		evidence = append(evidence, RepurposeEvidence{
			Metric: metric, Value: values[metric], CollectedAt: snapshot.CapturedAt,
			Scope: repurposeEvidenceScope(metadata[metric], rangeStart, rangeEnd), Metadata: metadata[metric],
		})
	}
	return evidence
}

func selectRepurposeSnapshot(snapshots []repurposeSnapshot, rangeStart, rangeEnd time.Time) repurposeSnapshot {
	var fallback repurposeSnapshot
	for _, snapshot := range snapshots {
		evidence := repurposeEvidence(snapshot, rangeStart, rangeEnd)
		if len(evidence) == 0 {
			continue
		}
		for _, item := range evidence {
			if item.Scope == "requested_range" {
				return snapshot
			}
		}
		if fallback.CapturedAt.IsZero() {
			fallback = snapshot
		}
	}
	return fallback
}

func repurposeEvidenceScope(metadata platform.AnalyticsMetricMetadata, rangeStart, rangeEnd time.Time) string {
	switch metadata.Aggregation {
	case platform.AnalyticsMetricAggregationLifetimeTotal:
		return "lifetime"
	case platform.AnalyticsMetricAggregationCurrentSnapshot:
		return "current_snapshot"
	case platform.AnalyticsMetricAggregationReportingPeriodTotal:
		if metadata.PeriodStart == nil || metadata.PeriodEnd == nil ||
			metadata.PeriodStart.UTC().Format(time.DateOnly) != rangeStart.UTC().Format(time.DateOnly) ||
			metadata.PeriodEnd.UTC().Format(time.DateOnly) != rangeEnd.UTC().Format(time.DateOnly) {
			return ""
		}
		return "requested_range"
	default:
		return ""
	}
}

func truncateRepurposeText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:maxRunes]))
}

func uniqueRepurposeStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}
