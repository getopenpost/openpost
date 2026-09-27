package analytics

import (
	"context"
	"errors"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

type ContentObservation struct {
	Values     platform.AnalyticsValues
	Metadata   map[string]platform.AnalyticsMetricMetadata
	ObservedAt time.Time
}

// ObserveContent reads the collected observation without issuing a provider
// request. Missing and stale metrics remain unavailable, never zero counts.
func (s *Service) ObserveContent(ctx context.Context, workspaceID, renditionID string, maxAge time.Duration) (ContentObservation, error) {
	var state models.AnalyticsSyncState
	if err := s.db.NewSelect().Model(&state).Where("workspace_id = ? AND subject_type = ? AND subject_id = ?", workspaceID, "rendition", renditionID).Scan(ctx); err != nil {
		return ContentObservation{}, errors.New("no collected metrics are available for this variant")
	}
	if state.Status != string(platform.AnalyticsStatusOK) || state.LastSuccessAt.IsZero() || time.Since(state.LastSuccessAt) > maxAge {
		return ContentObservation{}, errors.New("metrics are unavailable or older than the permitted age. Check Analytics before running again")
	}
	values, metadata := decodeAnalyticsMetrics(state.MetricsJSON, state.MetricMetadataJSON, platform.AnalyticsMetricSubjectContent, state.Platform)
	return ContentObservation{Values: values, Metadata: metadata, ObservedAt: state.LastSuccessAt}, nil
}
