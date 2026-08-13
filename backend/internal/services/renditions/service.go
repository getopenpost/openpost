package renditions

import (
	"context"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/uptrace/bun"
)

// TargetIdentity is the stable database identity for one provider destination.
// Keeping it structured prevents account and provider-target boundaries from
// depending on an ad-hoc string separator.
type TargetIdentity struct {
	SocialAccountID string
	TargetKey       string
}

func NewTargetIdentity(socialAccountID, targetKey string) TargetIdentity {
	return TargetIdentity{SocialAccountID: socialAccountID, TargetKey: targetKey}
}

// MatchingIDsTx resolves the rendition rows replaced by a target-aware upsert.
// The caller owns the surrounding publication revision transaction.
func MatchingIDsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	targets map[TargetIdentity]struct{},
	accounts map[string]models.SocialAccount,
) ([]string, error) {
	if len(targets) == 0 {
		return nil, nil
	}
	accountIDs := make([]string, 0, len(targets))
	seenAccounts := make(map[string]struct{}, len(targets))
	for target := range targets {
		if _, exists := seenAccounts[target.SocialAccountID]; exists {
			continue
		}
		seenAccounts[target.SocialAccountID] = struct{}{}
		accountIDs = append(accountIDs, target.SocialAccountID)
	}
	var existing []models.Rendition
	if err := tx.NewSelect().
		Model(&existing).
		Where("publication_id = ?", publicationID).
		Where("social_account_id IN (?)", bun.List(accountIDs)).
		Scan(ctx); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(existing))
	for _, rendition := range existing {
		account := accounts[rendition.SocialAccountID]
		identity := NewTargetIdentity(
			rendition.SocialAccountID,
			publicationauth.RenditionTargetKey(rendition, account),
		)
		if _, replace := targets[identity]; replace {
			ids = append(ids, rendition.ID)
		}
	}
	return ids, nil
}

// DeleteRowsTx removes only the exact rendition targets already fenced by the
// caller's active-job checks.
func DeleteRowsTx(ctx context.Context, tx bun.Tx, renditionIDs []string) error {
	if len(renditionIDs) == 0 {
		return nil
	}
	if _, err := tx.NewDelete().
		Model((*models.RenditionMedia)(nil)).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Exec(ctx); err != nil {
		return err
	}
	_, err := tx.NewDelete().
		Model((*models.Rendition)(nil)).
		Where("id IN (?)", bun.List(renditionIDs)).
		Exec(ctx)
	return err
}
