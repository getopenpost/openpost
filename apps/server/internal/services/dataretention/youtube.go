package dataretention

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/accountavatar"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

// YouTubeCacheAge leaves seven days for Hosted recovery copies and one day
// of scheduling margin before the 30-day deadline. Statistics use the same limit:
// OpenPost does not rely on the longer authorized-statistics exception.
const YouTubeCacheAge = 22 * 24 * time.Hour

// RetiredYouTubeIdentity permits an authenticated reconnect to restore the same
// local destination without retaining the channel ID after access is revoked.
func RetiredYouTubeIdentity(workspaceID, channelID string) string {
	if strings.HasPrefix(channelID, "retired-youtube:") {
		return channelID
	}
	digest := sha256.Sum256([]byte(workspaceID + "\x00" + channelID))
	return fmt.Sprintf("retired-youtube:%x", digest)
}

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
	// Notification payloads copy fetched author names. Keep notification IDs and
	// read state, but remove that copy before unreferenced comment rows disappear.
	links := db.NewSelect().Model((*models.EngagementItem)(nil)).
		ColumnExpr("? || id", "/inbox/engagement?item=").Where("id IN (?)", items)
	notifications := db.NewUpdate().Model((*models.UserNotification)(nil)).
		Set("payload_json = '{}'").Set("body = ''").Where("href IN (?)", links)
	if workspaceID != "" {
		notifications = notifications.Where("workspace_id = ?", workspaceID)
	}
	if _, err := notifications.Exec(ctx); err != nil {
		return fmt.Errorf("clear YouTube comment notification cache: %w", err)
	}
	if _, err := db.NewUpdate().Table("engagement_automation_replies").Set("item_body = ?", "").Where("item_id IN (?)", items).Exec(ctx); err != nil {
		return fmt.Errorf("clear YouTube automation source cache: %w", err)
	}
	q := db.NewUpdate().Model((*models.EngagementItem)(nil)).Where("id IN (?)", items).
		Set("author_remote_id = ''").Set("author_name = ''").Set("author_handle = ''").Set("author_avatar_url = ''").
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

// ClearRevokedYouTubeMetadata retires disconnected destinations and redacts
// profile fields that were not successfully refreshed before their deadline.
// Channel identity is retained for an active grant so a later refresh can run.
func ClearRevokedYouTubeMetadata(ctx context.Context, db bun.IDB, now time.Time, workspaceID string) error {
	var accounts []models.SocialAccount
	q := db.NewSelect().Model(&accounts).Where("platform = ?", "youtube").
		Where("is_active = ? OR profile_fetched_at IS NULL OR profile_fetched_at <= ? OR oauth_grant_id IN (SELECT id FROM oauth_grants WHERE validation_status = ?)", false, now.Add(-YouTubeCacheAge), "revoked")
	if workspaceID != "" {
		q = q.Where("workspace_id = ?", workspaceID)
	}
	if err := q.Scan(ctx); err != nil {
		return fmt.Errorf("find stale YouTube profiles: %w", err)
	}
	for _, account := range accounts {
		if err := organizationguard.WithWorkspace(ctx, db, account.WorkspaceID, func(ctx context.Context, tx bun.IDB) error {
			if err := retireYouTubeAccount(ctx, tx, now, account.WorkspaceID, account.ID); err != nil {
				return err
			}
			return clearYouTubeProfile(ctx, tx, now, account)
		}); err != nil {
			return err
		}
	}
	return nil
}

func clearYouTubeProfile(ctx context.Context, db bun.IDB, now time.Time, account models.SocialAccount) error {
	update := db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("account_username = ''").Set("account_avatar_url = ''").Set("profile_fetched_at = NULL").
		Where("id = ? AND workspace_id = ? AND platform = ?", account.ID, account.WorkspaceID, "youtube").
		Where("account_avatar_url = ?", account.AccountAvatarURL).
		Where("is_active = ? OR profile_fetched_at IS NULL OR profile_fetched_at <= ? OR oauth_grant_id IN (SELECT id FROM oauth_grants WHERE validation_status = ?)", false, now.Add(-YouTubeCacheAge), "revoked")
	result, err := update.Exec(ctx)
	if err != nil {
		return fmt.Errorf("redact stale YouTube profile: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 0 && accountavatar.IsCached(account.AccountAvatarURL) {
		_, err = jobregistry.EnqueueStorageDeletes(ctx, db, []string{filepath.Base(account.AccountAvatarURL)})
	}
	return err
}

// RetireYouTubeAccount requires the stored grant to already be revoked, or the
// destination already disconnected. A stale HTTP 401 cannot retire a new grant.
// Local publication content, operation identities and replay fences survive.
func RetireYouTubeAccount(ctx context.Context, db bun.IDB, now time.Time, workspaceID, accountID string) error {
	return organizationguard.WithWorkspace(ctx, db, workspaceID, func(ctx context.Context, tx bun.IDB) error {
		return retireYouTubeAccount(ctx, tx, now, workspaceID, accountID)
	})
}

func retireYouTubeAccount(ctx context.Context, db bun.IDB, now time.Time, workspaceID, accountID string) error {
	var account models.SocialAccount
	err := db.NewSelect().Model(&account).Where("id = ? AND workspace_id = ? AND platform = ?", accountID, workspaceID, "youtube").
		Where("is_active = ? OR oauth_grant_id IN (SELECT id FROM oauth_grants WHERE validation_status = ?) OR (COALESCE(profile_fetched_at, created_at) <= ? AND oauth_grant_id IN (SELECT id FROM oauth_grants WHERE validation_status = ?))", false, "revoked", now.Add(-YouTubeCacheAge), "refresh_failed").Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if account.IsActive && account.OAuthGrantID != "" {
		var grant models.OAuthGrant
		if err := db.NewSelect().Model(&grant).Where("id = ? AND workspace_id = ?", account.OAuthGrantID, workspaceID).Scan(ctx); err != nil {
			return err
		}
		if grant.ValidationStatus == "refresh_failed" {
			result, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).
				Set("validation_status = 'revoked'").Set("revoked_at = ?", now).
				Set("revocation_reason = 'youtube_profile_expired'").
				Set("access_token_encrypted = ?", []byte{}).Set("refresh_token_encrypted = ?", []byte{}).
				Set("access_token_expires_at = NULL").Set("refresh_token_expires_at = NULL").
				Set("token_version = token_version + 1").Set("refresh_lease_owner = ''").Set("refresh_lease_expires_at = NULL").
				Where("id = ? AND workspace_id = ? AND token_version = ? AND validation_status = ?", grant.ID, workspaceID, grant.TokenVersion, "refresh_failed").Exec(ctx)
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err != nil || n == 0 {
				return err
			}
		} else if grant.ValidationStatus != "revoked" {
			return nil
		}
	}
	if err := PurgeYouTube(ctx, db, now, workspaceID, accountID); err != nil {
		return err
	}
	if err := clearYouTubeProfile(ctx, db, now, account); err != nil {
		return err
	}
	for _, model := range []any{(*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.ProviderWriteAttempt)(nil), (*models.ProviderDelivery)(nil)} {
		q := db.NewUpdate().Model(model).Set("external_id = ''").Set("external_url = ''")
		switch model.(type) {
		case *models.RenditionSegment:
			q = q.Where("rendition_id IN (SELECT id FROM renditions WHERE social_account_id = ?)", accountID)
		default:
			q = q.Where("social_account_id = ?", accountID)
		}
		if _, err := q.Exec(ctx); err != nil {
			return fmt.Errorf("clear retired YouTube delivery metadata: %w", err)
		}
	}
	if _, err := db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).Set("provider_reference = ''").Where("social_account_id = ?", accountID).Exec(ctx); err != nil {
		return err
	}
	if _, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).Set("provider_subject = ''").Set("authorization_evidence_json = '{}' ").
		Where("id = ? AND workspace_id = ? AND validation_status = ?", account.OAuthGrantID, workspaceID, "revoked").Exec(ctx); err != nil {
		return err
	}
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).
		Set("account_id = ?", RetiredYouTubeIdentity(workspaceID, account.AccountID)).Set("capability_state_json = '{}' ").
		Set("slug = ?", "youtube-"+account.ID).Set("access_token_encrypted = ?", []byte{}).Set("refresh_token_encrypted = ?", []byte{}).Set("token_expires_at = NULL").
		Where("id = ? AND workspace_id = ? AND (is_active = ? OR oauth_grant_id IN (SELECT id FROM oauth_grants WHERE validation_status = ?))", accountID, workspaceID, false, "revoked").Exec(ctx)
	return err
}
