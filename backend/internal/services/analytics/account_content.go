package analytics

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const subjectAccountContent = "account_content"

// UpsertAccountContent normalizes and stores one provider item by its stable
// identity within a Social Account. Repeated discovery updates the one inventory
// row and appends an immutable measurement snapshot when measurements are
// present.
func (s *Service) UpsertAccountContent(
	ctx context.Context,
	accountID string,
	item platform.AccountContentItem,
) (*models.AccountContent, error) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return nil, fmt.Errorf("social account ID is required")
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("social account not found")
		}
		return nil, fmt.Errorf("load account content owner: %w", err)
	}

	normalized, err := platform.NormalizeAccountContentItem(account.Platform, item)
	if err != nil {
		return nil, err
	}
	if normalized.ContentProfile == "" {
		normalized.ContentProfile = models.ContentProfileShortText
	}
	if !validAccountContentProfile(normalized.ContentProfile) {
		return nil, fmt.Errorf("unsupported account content profile %q", normalized.ContentProfile)
	}
	if normalized.RenditionID != "" {
		var count int
		count, err = s.db.NewSelect().Model((*models.Rendition)(nil)).
			Where("id = ? AND social_account_id = ? AND platform = ?", normalized.RenditionID, account.ID, account.Platform).
			Count(ctx)
		if err != nil {
			return nil, fmt.Errorf("validate account content rendition: %w", err)
		}
		if count != 1 {
			return nil, fmt.Errorf("rendition link is not an exact match for this social account")
		}
	}

	now := s.now().UTC()
	content := &models.AccountContent{
		ID: uuid.NewString(), WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
		Platform: account.Platform, ProviderContentID: normalized.ProviderContentID,
		ProviderParentID: normalized.ProviderParentID, ContentProfile: normalized.ContentProfile,
		Title: normalized.Title, Text: normalized.Text, ExternalURL: normalized.ExternalURL,
		PublishedAt: normalized.PublishedAt, Origin: string(normalized.Origin),
		OriginConfidence: string(normalized.OriginConfidence), RenditionID: normalized.RenditionID,
		FirstDiscoveredAt: now, LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}

	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, insertErr := tx.NewInsert().Model(content).
			On("CONFLICT (social_account_id, provider_content_id) DO UPDATE").
			Set("workspace_id = EXCLUDED.workspace_id").
			Set("platform = EXCLUDED.platform").
			Set("provider_parent_id = EXCLUDED.provider_parent_id").
			Set("content_profile = EXCLUDED.content_profile").
			Set("title = EXCLUDED.title").
			Set("text = EXCLUDED.text").
			Set("external_url = EXCLUDED.external_url").
			Set("published_at = EXCLUDED.published_at").
			Set("origin = CASE WHEN rendition_id IS NOT NULL AND EXCLUDED.rendition_id IS NULL THEN origin ELSE EXCLUDED.origin END").
			Set("origin_confidence = CASE WHEN rendition_id IS NOT NULL AND EXCLUDED.rendition_id IS NULL THEN origin_confidence ELSE EXCLUDED.origin_confidence END").
			Set("rendition_id = COALESCE(EXCLUDED.rendition_id, rendition_id)").
			Set("last_seen_at = EXCLUDED.last_seen_at").
			Set("provider_unavailable_at = NULL").
			Set("updated_at = EXCLUDED.updated_at").
			Exec(txCtx); insertErr != nil {
			return fmt.Errorf("store account content: %w", insertErr)
		}
		if scanErr := tx.NewSelect().Model(content).
			Where("social_account_id = ? AND provider_content_id = ?", account.ID, normalized.ProviderContentID).
			Scan(txCtx); scanErr != nil {
			return fmt.Errorf("load stored account content: %w", scanErr)
		}
		if normalized.Measurements == nil {
			return nil
		}
		return recordAccountContentMeasurements(txCtx, tx, account, *content, normalized.Measurements, now)
	})
	if err != nil {
		return nil, err
	}
	return content, nil
}

func recordAccountContentMeasurements(
	ctx context.Context,
	db bun.IDB,
	account models.SocialAccount,
	content models.AccountContent,
	measurements platform.AnalyticsMeasurements,
	capturedAt time.Time,
) error {
	values, metadata, err := measurements.ValuesAndMetadata(account.Platform)
	if err != nil {
		return fmt.Errorf("validate account content measurements: %w", err)
	}
	metricsJSON, err := encodeAnalyticsValues(values)
	if err != nil {
		return err
	}
	metadataJSON, err := encodeMetricMetadata(metadata)
	if err != nil {
		return err
	}
	captureKey := subjectAccountContent + ":" + content.ID + ":" + capturedAt.Truncate(time.Minute).Format(time.RFC3339)
	snapshot := &models.AnalyticsAccountContentSnapshot{
		ID: uuid.NewString(), WorkspaceID: account.WorkspaceID, AccountContentID: content.ID,
		SocialAccountID: account.ID, Platform: account.Platform, MetricsJSON: metricsJSON,
		MetricMetadataJSON: metadataJSON, CaptureKey: captureKey, CapturedAt: capturedAt,
	}
	if _, err := db.NewInsert().Model(snapshot).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
		return fmt.Errorf("store account content analytics snapshot: %w", err)
	}
	return upsertState(ctx, db, &models.AnalyticsSyncState{
		ID: stateID(subjectAccountContent, content.ID), WorkspaceID: account.WorkspaceID,
		SubjectType: subjectAccountContent, SubjectID: content.ID, SocialAccountID: account.ID,
		Platform: account.Platform, Status: string(platform.AnalyticsStatusOK),
		MetricsJSON: metricsJSON, MetricMetadataJSON: metadataJSON,
		LastAttemptedAt: capturedAt, LastSuccessAt: capturedAt,
		CreatedAt: capturedAt, UpdatedAt: capturedAt,
	})
}

func encodeAnalyticsValues(values platform.AnalyticsValues) (string, error) {
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", fmt.Errorf("encode account content analytics values: %w", err)
	}
	return string(encoded), nil
}

func validAccountContentProfile(profile string) bool {
	switch profile {
	case models.ContentProfileShortText, models.ContentProfileThread, models.ContentProfileLinkShare,
		models.ContentProfileImagePost, models.ContentProfileCarousel, models.ContentProfileStory,
		models.ContentProfileShortVideo, models.ContentProfileLongVideo:
		return true
	default:
		return false
	}
}
