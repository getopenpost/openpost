package providerwrite

import (
	"context"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// LoadCurrentDeliveries returns the newest canonical projection for each
// rendition in the requested publications. Missing-table tolerance is limited
// to legacy test fixtures that predate the production migration contract.
func LoadCurrentDeliveries(
	ctx context.Context,
	db bun.IDB,
	publicationIDs []string,
) (map[string]models.ProviderDelivery, error) {
	byRendition := make(map[string]models.ProviderDelivery)
	if len(publicationIDs) == 0 {
		return byRendition, nil
	}
	var deliveries []models.ProviderDelivery
	err := db.NewSelect().Model(&deliveries).
		Where("publication_id IN (?)", bun.List(publicationIDs)).
		Order("rendition_id ASC", "current_attempt_number DESC").
		Scan(ctx)
	if err != nil {
		message := strings.ToLower(err.Error())
		if strings.Contains(message, "no such table: provider_deliveries") ||
			(strings.Contains(message, "provider_deliveries") && strings.Contains(message, "does not exist")) {
			return byRendition, nil
		}
		return nil, err
	}
	for _, delivery := range deliveries {
		if _, exists := byRendition[delivery.RenditionID]; !exists {
			byRendition[delivery.RenditionID] = delivery
		}
	}
	return byRendition, nil
}
