package dataretention

import (
	"context"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// YouTubeCacheAge leaves one day for the durable cleanup sweep to run before
// YouTube's 30-day refresh-or-delete deadline. Statistics use the same limit:
// OpenPost does not rely on the longer authorized-statistics exception.
const YouTubeCacheAge = 29 * 24 * time.Hour

// PurgeYouTube removes expired fetched data, or all fetched data for one
// disconnected account. Authored publications and delivery receipts survive.
// An empty workspace runs the scheduled, instance-wide sweep.
func PurgeYouTube(ctx context.Context, db bun.IDB, now time.Time, workspaceID, accountID string) error {
	if workspaceID != "" {
		exists, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Where("workspace_id = ? AND platform = ?", workspaceID, "youtube").Exists(ctx)
		if err != nil {
			return fmt.Errorf("find YouTube cache scope: %w", err)
		}
		if !exists {
			return nil
		}
	}
	cutoff := now.Add(-YouTubeCacheAge)
	for _, entry := range []struct {
		model any
		age   string
	}{
		{(*models.AnalyticsAccountSnapshot)(nil), "captured_at"},
		{(*models.AnalyticsRenditionSnapshot)(nil), "captured_at"},
		{(*models.AnalyticsSyncState)(nil), "COALESCE(last_success_at, created_at)"},
		{(*models.ImportedPost)(nil), "last_seen_at"},
	} {
		q := db.NewDelete().Model(entry.model).Where("platform = ?", "youtube")
		if workspaceID != "" {
			q = q.Where("workspace_id = ?", workspaceID)
		}
		if accountID != "" {
			q = q.Where("social_account_id = ?", accountID)
		} else {
			q = q.Where(entry.age+" <= ?", cutoff)
		}
		if _, err := q.Exec(ctx); err != nil {
			return fmt.Errorf("purge YouTube cache: %w", err)
		}
	}
	// Keep comment operation receipts stable. Delete ordinary fetched comments;
	// receipt-backed items retain only their identity and authored operation state.
	items := db.NewSelect().Model((*models.EngagementItem)(nil)).Column("id").Where("platform = ?", "youtube")
	if workspaceID != "" {
		items = items.Where("workspace_id = ?", workspaceID)
	}
	if accountID != "" {
		items = items.Where("social_account_id = ?", accountID)
	} else {
		items = items.Where("last_seen_at <= ?", cutoff)
	}
	if _, err := db.NewUpdate().Table("engagement_automation_replies").Set("item_body = ?", "").Where("item_id IN (?)", items).Exec(ctx); err != nil {
		return fmt.Errorf("clear YouTube automation source cache: %w", err)
	}
	q := db.NewUpdate().Model((*models.EngagementItem)(nil)).Where("id IN (?)", items).
		Set("author_name = ''").Set("author_handle = ''").Set("author_avatar_url = ''").
		Set("body = ''").Set("attachments_json = '[]'").Set("subject_json = '{}'").
		Set("can_reply = ?", false).Set("can_hide = ?", false).Set("can_delete = ?", false).
		Set("can_like = ?", false).Set("can_unlike = ?", false).
		Set("last_seen_at = ?", cutoff)
	if _, err := q.Exec(ctx); err != nil {
		return fmt.Errorf("clear YouTube comment cache: %w", err)
	}
	if _, err := db.NewDelete().Model((*models.EngagementItem)(nil)).Where("id IN (?)", items).
		Where("NOT EXISTS (SELECT 1 FROM engagement_operations AS op WHERE op.item_id = engagement_item.id)").
		Where("NOT EXISTS (SELECT 1 FROM engagement_automation_replies AS reply WHERE reply.item_id = engagement_item.id)").Exec(ctx); err != nil {
		return fmt.Errorf("purge YouTube comments: %w", err)
	}
	return nil
}
