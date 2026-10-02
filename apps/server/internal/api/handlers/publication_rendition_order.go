package handlers

import (
	"context"

	"github.com/danielgtaylor/huma/v2"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	renditionservice "github.com/openpost/backend/internal/services/renditions"
	"github.com/uptrace/bun"
)

func renditionUpsertPositionsTx(ctx context.Context, tx bun.Tx, publicationID string, inputs []RenditionInput, accounts map[string]models.SocialAccount) (map[renditionservice.TargetIdentity]int, error) {
	var existing []models.Rendition
	if err := tx.NewSelect().Model(&existing).Where("publication_id = ?", publicationID).Order("position ASC", "id ASC").Scan(ctx); err != nil {
		return nil, err
	}
	positions := make(map[renditionservice.TargetIdentity]int, len(inputs))
	next := 0
	for _, rendition := range existing {
		if rendition.Position >= next {
			next = rendition.Position + 1
		}
		account, available := accounts[rendition.SocialAccountID]
		if !available {
			continue
		}
		identity := renditionservice.NewTargetIdentity(rendition.SocialAccountID, publicationauth.RenditionTargetKey(rendition, account))
		positions[identity] = rendition.Position
	}
	for _, input := range inputs {
		target, err := normalizeRenditionTargetKey(accounts[input.SocialAccountID], input.TargetKey, input.Settings)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		identity := renditionservice.NewTargetIdentity(input.SocialAccountID, target)
		if _, exists := positions[identity]; exists {
			continue
		}
		positions[identity] = next
		next++
	}
	return positions, nil
}
