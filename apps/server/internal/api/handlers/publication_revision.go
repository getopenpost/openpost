package handlers

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/uptrace/bun"
)

type publicationRevisionSnapshot struct {
	response PublicationResponse
	authored PublicationResponse
}

func (h *PublicationHandler) loadPublicationRevisionResponseTx(ctx context.Context, tx bun.Tx, publication *models.Publication) (publicationRevisionSnapshot, error) {
	responses, err := h.loadPublicationResponsesWithDB(ctx, tx, []models.Publication{*publication})
	if err != nil {
		return publicationRevisionSnapshot{}, err
	}
	if len(responses) != 1 {
		return publicationRevisionSnapshot{}, errors.New("failed to load publication revision")
	}
	snapshot := publicationRevisionSnapshot{response: responses[0], authored: responses[0]}
	snapshot.authored.Renditions = slices.Clone(snapshot.authored.Renditions)
	response := &snapshot.authored
	missingTargets := make([]string, 0)
	for _, rendition := range response.Renditions {
		if strings.TrimSpace(rendition.TargetKey) == "" {
			missingTargets = append(missingTargets, rendition.SocialAccountID)
		}
	}
	if len(missingTargets) == 0 {
		return snapshot, nil
	}
	var accounts []models.SocialAccount
	if err := tx.NewSelect().Model(&accounts).Where("workspace_id = ?", publication.WorkspaceID).Where("id IN (?)", bun.List(missingTargets)).Scan(ctx); err != nil {
		return publicationRevisionSnapshot{}, err
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		byID[account.ID] = account
	}
	for index := range response.Renditions {
		rendition := &response.Renditions[index]
		if strings.TrimSpace(rendition.TargetKey) != "" {
			continue
		}
		account, found := byID[rendition.SocialAccountID]
		if !found {
			continue
		}
		// Legacy default targets and their materialized keys are one destination.
		target, err := normalizeRenditionTargetKey(account, "", rendition.Settings)
		if err != nil {
			target = publicationauth.TargetKey(account)
		}
		rendition.TargetKey = target
	}
	return snapshot, nil
}
