package analytics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

// RecordAccountContentObservation stores one bounded provider event and applies
// its semantic measurements to the matching inventory item when present.
//
//nolint:gocyclo // Validation, deduplication, optional inventory linking, and semantic persistence share one transaction.
func (s *Service) RecordAccountContentObservation(
	ctx context.Context,
	accountID, providerObservationID, providerContentID, observationType string,
	measurements platform.AnalyticsMeasurements,
	observedAt time.Time,
) error {
	accountID = strings.TrimSpace(accountID)
	providerObservationID = strings.TrimSpace(providerObservationID)
	providerContentID = strings.TrimSpace(providerContentID)
	observationType = strings.TrimSpace(observationType)
	if accountID == "" || providerObservationID == "" || providerContentID == "" || observationType == "" || observedAt.IsZero() {
		return fmt.Errorf("account content observation identity is required")
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		return fmt.Errorf("load account content observation owner: %w", err)
	}
	values, metadata, err := measurements.ValuesAndMetadata(account.Platform)
	if err != nil {
		return fmt.Errorf("validate account content observation: %w", err)
	}
	metricsJSON, err := encodeAnalyticsValues(values)
	if err != nil {
		return err
	}
	metadataJSON, err := encodeMetricMetadata(metadata)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var content models.AccountContent
		contentErr := tx.NewSelect().Model(&content).
			Where("social_account_id = ? AND provider_content_id = ?", account.ID, providerContentID).Scan(txCtx)
		if contentErr != nil && !errors.Is(contentErr, sql.ErrNoRows) {
			return contentErr
		}
		contentID := ""
		if contentErr == nil {
			contentID = content.ID
		}
		observation := &models.AccountContentObservation{
			ID: uuid.NewString(), WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
			AccountContentID: contentID, Platform: account.Platform,
			ProviderObservationID: providerObservationID, ProviderContentID: providerContentID,
			ObservationType: observationType, MetricsJSON: metricsJSON,
			MetricMetadataJSON: metadataJSON, ObservedAt: observedAt.UTC(), CreatedAt: now,
		}
		result, err := tx.NewInsert().Model(observation).
			On("CONFLICT (social_account_id, provider_observation_id) DO NOTHING").Exec(txCtx)
		if err != nil {
			return fmt.Errorf("store account content observation: %w", err)
		}
		rows, err := result.RowsAffected()
		if err != nil || rows == 0 || contentID == "" {
			return err
		}
		return recordAccountContentMeasurements(txCtx, tx, account, content, measurements, observedAt.UTC())
	})
}
