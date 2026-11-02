package engagement

import (
	"context"
	"database/sql"
	"errors"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

//nolint:revive // This name identifies the detail in the shared API schema.
type EngagementDetail struct {
	Item    models.EngagementItem   `json:"item"`
	Parents []models.EngagementItem `json:"parents"`
}

func (s *Service) GetEngagement(ctx context.Context, actor Actor, workspaceID, itemID string) (EngagementDetail, error) {
	result := EngagementDetail{Parents: []models.EngagementItem{}}
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return result, err
	}
	if err := dataretention.PurgeYouTube(ctx, s.db, s.now(), workspaceID, ""); err != nil {
		return result, err
	}
	if err := s.db.NewSelect().Model(&result.Item).Where("id=? AND workspace_id=?", itemID, workspaceID).Where("(platform <> ? OR last_seen_at > ?)", "youtube", s.now().Add(-dataretention.YouTubeCacheAge)).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return result, ErrNotFound
	} else if err != nil {
		return result, err
	}
	all := []models.EngagementItem{result.Item}
	seen := map[string]bool{result.Item.RemoteID: true}
	parentID := result.Item.ParentRemoteID
	for len(all) < 20 && parentID != "" && !seen[parentID] {
		var parent models.EngagementItem
		err := s.db.NewSelect().Model(&parent).Where("workspace_id=? AND social_account_id=? AND remote_id=?", workspaceID, result.Item.SocialAccountID, parentID).Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return result, err
		}
		all = append(all, parent)
		seen[parentID] = true
		parentID = parent.ParentRemoteID
	}
	if err := s.hydrateEngagementProviderURLs(ctx, all); err != nil {
		return result, err
	}
	result.Item = all[0]
	result.Parents = all[1:]
	return result, nil
}
