package account_saver

import (
	"context"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/accountavatar"
	"github.com/uptrace/bun"
)

// Fetch before taking database locks. An unavailable picture must not prevent
// connecting an account or replace a previously stored picture with a dead URL.
func (s *AccountSaver) cacheAccountAvatars(ctx context.Context, accounts []*models.SocialAccount, inputs []SaveAccountInput) []string {
	cached := make([]string, len(accounts))
	if s.avatars == nil {
		return cached
	}
	for i, account := range accounts {
		rawURL := strings.TrimSpace(inputs[i].AccountAvatarURL)
		account.AccountAvatarURL = ""
		if rawURL == "" {
			continue
		}
		localURL, err := s.avatars.CacheAvatar(ctx, account.ID, rawURL)
		if err != nil {
			// Fetch errors can contain signed URLs, so do not log their text.
			log.Printf("[AccountSaver] Could not cache %s profile photo for account %s", account.Platform, account.ID)
			continue
		}
		account.AccountAvatarURL = localURL
		cached[i] = localURL
	}
	return cached
}

// Only retire objects after commit, or compensate for a failed save. Check
// references first so a concurrent connection cannot lose its current photo.
func (s *AccountSaver) deleteUnusedAvatars(ctx context.Context, urls []string) {
	if s.avatars == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	for _, avatarURL := range urls {
		if !accountavatar.IsCached(avatarURL) {
			continue
		}
		referenced, err := s.db.NewSelect().Model((*models.SocialAccount)(nil)).
			Where("account_avatar_url = ?", avatarURL).Exists(cleanupCtx)
		if err == nil && !referenced {
			_ = s.avatars.Delete(cleanupCtx, avatarURL)
		}
	}
}

// Called after reloading under the connection fence, so a failed download
// inherits the latest committed photo rather than the pre-download snapshot.
func (s *AccountSaver) reconcileAccountAvatar(account, existing *models.SocialAccount, cachedURL string) string {
	// A new YouTube profile cannot renew the retention age of a photo that
	// could not be fetched. The connection transaction queues the old object.
	if account.Platform == "youtube" && !account.ProfileFetchedAt.IsZero() {
		return existing.AccountAvatarURL
	}
	if s.avatars == nil {
		return ""
	}
	if cachedURL == "" {
		account.AccountAvatarURL = existing.AccountAvatarURL
		return ""
	}
	return existing.AccountAvatarURL
}

func (s *AccountSaver) retirePreviousAccountAvatar(ctx context.Context, db bun.IDB, account, existing *models.SocialAccount, cachedURL string) (string, error) {
	retiredAvatar := s.reconcileAccountAvatar(account, existing, cachedURL)
	if account.Platform == "youtube" && accountavatar.IsCached(retiredAvatar) && retiredAvatar != account.AccountAvatarURL {
		if _, err := jobregistry.EnqueueStorageDeletes(ctx, db, []string{filepath.Base(retiredAvatar)}); err != nil {
			return "", err
		}
	}
	return retiredAvatar, nil
}
