package engagement

import (
	"context"
	"fmt"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

// The provider write fence has already confirmed the action. Its local state
// and the feed wakeup commit together, including after a fence replay.
func (s *Service) commitEngagementActionReceipt(ctx context.Context, item *models.EngagementItem, action, automationID string) error {
	return s.db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(txCtx, tx, item.WorkspaceID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(item).WherePK().Scan(txCtx); err != nil {
			return err
		}
		now := s.now()
		query := tx.NewUpdate().Model(item).Set("updated_at=?", now).WherePK()
		switch action {
		case "reply", "private_reply":
			if _, err := tx.NewUpdate().Model(item).Set("replied_at = ?", now).WherePK().Exec(txCtx); err != nil {
				return err
			}
			if err := recordAutomationAcceptance(txCtx, tx, *item, automationID, now); err != nil {
				return err
			}
			// The receipt is inspectable through its job; also wake stored thread reads.
			return appendEngagementChange(txCtx, tx, *item)
		case "hide":
			query = query.Set("hidden=?", true)
		case "like", "unlike":
			liked := action == "like"
			query = query.Set("liked=?", liked).Set("can_like=?", !liked).Set("can_unlike=?", liked)
		case "delete":
			item.DeletedAt = now
			query = query.Set("body=''").Set("attachments_json='[]'").Set("author_remote_id=''").
				Set("author_name=''").Set("author_handle=''").Set("author_avatar_url=''").
				Set("deleted_at=?", now).Set("can_reply=?", false).Set("can_hide=?", false).
				Set("can_delete=?", false).Set("can_like=?", false).Set("can_unlike=?", false)
		default:
			return fmt.Errorf("unsupported engagement action %q", action)
		}
		if _, err := query.Exec(txCtx); err != nil {
			return err
		}
		return appendEngagementChange(txCtx, tx, *item)
	})
}
