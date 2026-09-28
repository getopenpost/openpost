package workflows

import (
	"context"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/uptrace/bun"
)

func intervalItems(source Source, since time.Time) ([]SourceItem, error) {
	if source.IntervalMinutes < 5 || source.IntervalMinutes > 43200 {
		return nil, invalid("choose an interval between 5 minutes and 30 days")
	}
	now := time.Now().UTC()
	if since.IsZero() {
		since = now.Add(-time.Duration(source.IntervalMinutes) * time.Minute)
	}
	interval := time.Duration(source.IntervalMinutes) * time.Minute
	elapsed := now.Sub(since) / interval
	if elapsed < 1 {
		return nil, nil
	}
	at := since.Add(elapsed * interval)
	return []SourceItem{{ID: fmt.Sprint(at.UnixNano()), Title: "Scheduled workflow", Body: "", URL: "", PublishedAt: at.Format(time.RFC3339)}}, nil
}
func (s *Service) publicationItems(ctx context.Context, workspaceID string, since time.Time, record *workflowRecord) ([]SourceItem, error) {
	var rows []models.Publication
	query := s.db.NewSelect().Model(&rows).Where("workspace_id = ? AND created_at >= ? AND creation_source <> ?", workspaceID, since, "autopost").Order("created_at DESC").Limit(maxSourceItems)
	if record != nil {
		query = query.Where("NOT EXISTS (SELECT 1 FROM workflow_events AS event WHERE event.workflow_id = ? AND event.source_fingerprint = ? AND event.event_key = publication.id)", record.ID, record.SourceFingerprint)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	result := make([]SourceItem, 0, len(rows))
	for _, row := range rows {
		result = append(result, SourceItem{ID: row.ID, PublicationID: row.ID, Title: row.Title, Body: row.SourceText, URL: row.SourceURL, PublishedAt: row.CreatedAt.UTC().Format(time.RFC3339)})
	}
	return result, nil
}
func (s *Service) failedItems(ctx context.Context, workspaceID string, accounts []string, since time.Time, record *workflowRecord) ([]SourceItem, error) {
	type row struct {
		ID              string
		PublicationID   string
		Title           string
		SourceText      string
		SocialAccountID string
		CreatedAt       time.Time
		RenditionID     string
	}
	var rows []row
	query := s.db.NewSelect().TableExpr("publication_lifecycle_events AS failure").Join("JOIN renditions AS rendition ON rendition.id = failure.rendition_id").Join("JOIN publications AS publication ON publication.id = failure.publication_id").ColumnExpr("failure.id, failure.rendition_id, failure.publication_id, rendition.social_account_id, failure.created_at, publication.title, publication.source_text").Where("failure.workspace_id = ? AND failure.type = ? AND failure.created_at >= ?", workspaceID, lifecycle.EventFailed, since).OrderExpr("failure.created_at ASC, failure.id ASC").Limit(maxSourceItems)
	if len(accounts) > 0 {
		query = query.Where("rendition.social_account_id IN (?)", bun.List(accounts))
	}
	if record != nil {
		query = query.Where("NOT EXISTS (SELECT 1 FROM workflow_events AS event WHERE event.workflow_id = ? AND event.source_fingerprint = ? AND event.event_key = failure.id)", record.ID, record.SourceFingerprint)
	}
	if err := query.Scan(ctx, &rows); err != nil {
		return nil, err
	}
	result := make([]SourceItem, 0, len(rows))
	for _, row := range rows {
		result = append(result, SourceItem{ID: row.ID, PublicationID: row.PublicationID, RenditionID: row.RenditionID, AccountID: row.SocialAccountID, Title: row.Title, Body: row.SourceText, PublishedAt: row.CreatedAt.UTC().Format(time.RFC3339)})
	}
	return result, nil
}
