// Package youtubeprofile refreshes authorized channel profiles independently of
// optional analytics and engagement collection.
package youtubeprofile

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountavatar"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

var (
	ErrIdentityChanged = errors.New("YouTube profile identity changed")
	ErrAccountChanged  = errors.New("YouTube account changed during profile refresh")
)

const RefreshAge = 21 * 24 * time.Hour
const sweepInterval = time.Hour

type TokenSource interface {
	GetValidAccessToken(context.Context, string) (string, error)
}
type Service struct {
	db        *bun.DB
	tokens    TokenSource
	avatars   accountavatar.Cache
	mu        sync.RWMutex
	providers map[string]platform.Adapter
	now       func() time.Time
}

func NewService(db *bun.DB, tokens TokenSource, avatars accountavatar.Cache) *Service {
	return &Service{db: db, tokens: tokens, avatars: avatars, providers: map[string]platform.Adapter{}, now: func() time.Time { return time.Now().UTC() }}
}
func (s *Service) SetAvatarCache(avatars accountavatar.Cache) { s.avatars = avatars }

func (s *Service) SetProvider(key string, adapter platform.Adapter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.providers[key] = adapter
}
func (s *Service) ScheduleSweep(ctx context.Context, at time.Time) error {
	return s.enqueue(ctx, jobregistry.TypeYouTubeProfileSweep, "", "", at)
}
func (s *Service) enqueue(ctx context.Context, kind, workspace, accountID string, at time.Time) error {
	payload, _ := json.Marshal(struct {
		AccountID string `json:"account_id"`
	}{accountID})
	job, err := jobregistry.NewJob(kind, string(payload), at)
	if err != nil {
		return err
	}
	job.ScopeID = workspace
	job.DedupeKey = accountID
	if accountID == "" {
		job.ScopeID = "youtube-profile"
		job.DedupeKey = at.UTC().Truncate(sweepInterval).Format(time.RFC3339)
	}
	_, err = s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}
func (s *Service) HandleJob(ctx context.Context, kind, payload string) error {
	if kind == jobregistry.TypeYouTubeProfileSweep {
		// Queue the next sweep first so provider outages cannot stop retention work.
		if err := s.ScheduleSweep(ctx, s.now().Add(sweepInterval)); err != nil {
			return err
		}
		if err := dataretention.ClearRevokedYouTubeMetadata(ctx, s.db, s.now(), ""); err != nil {
			return err
		}
		if err := dataretention.PurgeYouTube(ctx, s.db, s.now(), "", ""); err != nil {
			return err
		}
		var accounts []models.SocialAccount
		if err := s.db.NewSelect().Model(&accounts).Where("platform = ? AND is_active = ?", "youtube", true).Where("profile_fetched_at IS NULL OR profile_fetched_at <= ?", s.now().Add(-RefreshAge)).Scan(ctx); err != nil {
			return err
		}
		var result error
		for _, a := range accounts {
			result = errors.Join(result, s.enqueue(ctx, jobregistry.TypeYouTubeProfileAccount, a.WorkspaceID, a.ID, s.now()))
		}
		return result
	}
	if kind != jobregistry.TypeYouTubeProfileAccount {
		return fmt.Errorf("unsupported YouTube profile job %q", kind)
	}
	var input struct {
		AccountID string `json:"account_id"`
	}
	if err := json.Unmarshal([]byte(payload), &input); err != nil || input.AccountID == "" {
		return fmt.Errorf("invalid YouTube profile job")
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND platform = ? AND is_active = ?", input.AccountID, "youtube", true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if !account.ProfileFetchedAt.IsZero() && account.ProfileFetchedAt.After(s.now().Add(-RefreshAge)) {
		return nil
	}
	s.mu.RLock()
	adapter := s.providers[platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)]
	s.mu.RUnlock()
	if adapter == nil || s.tokens == nil {
		return fmt.Errorf("YouTube profile provider unavailable")
	}
	// Capture before token acquisition. A refresh or reconnect that rotates the
	// grant makes a later failure from this attempt obsolete.
	var version int64
	if account.OAuthGrantID != "" {
		if err := s.db.NewSelect().Model((*models.OAuthGrant)(nil)).Column("token_version").Where("id = ? AND workspace_id = ?", account.OAuthGrantID, account.WorkspaceID).Scan(ctx, &version); err != nil {
			return err
		}
	}
	token, err := s.tokens.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return errors.Join(err, dataretention.RetireYouTubeAccount(ctx, s.db, s.now(), account.WorkspaceID, account.ID))
	}
	err = s.Refresh(ctx, account, adapter, token)
	if err == nil {
		return nil
	}
	var providerError *platform.HTTPError
	if errors.As(err, &providerError) && providerError.StatusCode == 401 && account.OAuthGrantID != "" {
		if markErr := s.recordAuthorizationFailure(ctx, account, version); markErr != nil {
			return errors.Join(err, markErr)
		}
	}
	return errors.Join(err, dataretention.RetireYouTubeAccount(ctx, s.db, s.now(), account.WorkspaceID, account.ID))
}

// Refresh also owns explicit profile refreshes, sharing the same identity and
// authorization fences with background work. Only a successful fetch renews age.
func (s *Service) Refresh(ctx context.Context, account models.SocialAccount, adapter platform.Adapter, token string) error {
	refresher, ok := adapter.(platform.AccountMetadataRefresher)
	if !ok {
		return platform.ErrAccountMetadataRefreshUnsupported
	}
	state := map[string]string{}
	_ = json.Unmarshal([]byte(account.CapabilityState), &state)
	profile, err := refresher.RefreshAccountMetadata(ctx, token, platform.AccountMetadataRequest{AccountID: account.AccountID, CapabilityState: state})
	if err != nil {
		return err
	}
	if profile == nil || profile.ID != account.AccountID {
		return ErrIdentityChanged
	}
	fetchedAt := s.now()
	avatar := profile.AvatarURL
	if s.avatars != nil && avatar != "" {
		avatar, err = s.avatars.CacheAvatar(ctx, account.ID, avatar)
		if err != nil {
			return err
		}
	}
	err = organizationguard.WithWorkspace(ctx, s.db, account.WorkspaceID, func(ctx context.Context, db bun.IDB) error {
		q := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("account_username = ?", profile.Username).Set("account_avatar_url = ?", avatar).Set("profile_fetched_at = ?", fetchedAt).
			Where("id = ? AND workspace_id = ? AND account_id = ? AND oauth_grant_id = ? AND is_active = ?", account.ID, account.WorkspaceID, account.AccountID, account.OAuthGrantID, true).
			Where("account_username = ? AND account_avatar_url = ?", account.AccountUsername, account.AccountAvatarURL)
		if !account.ProfileFetchedAt.IsZero() {
			q = q.Where("profile_fetched_at = ?", account.ProfileFetchedAt)
		} else {
			q = q.Where("profile_fetched_at IS NULL")
		}
		if account.OAuthGrantID != "" {
			q = q.Where("EXISTS (SELECT 1 FROM oauth_grants g WHERE g.id = ? AND g.workspace_id = ? AND g.revoked_at IS NULL AND g.validation_status = ?)", account.OAuthGrantID, account.WorkspaceID, "valid")
		}
		result, err := q.Exec(ctx)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return ErrAccountChanged
		}
		if accountavatar.IsCached(account.AccountAvatarURL) && account.AccountAvatarURL != avatar {
			_, err = jobregistry.EnqueueStorageDeletes(ctx, db, []string{filepath.Base(account.AccountAvatarURL)})
			return err
		}
		return nil
	})
	if err != nil && s.avatars != nil && accountavatar.IsCached(avatar) {
		// Failed publication of the new cache still requires durable object cleanup.
		_, cleanupErr := jobregistry.EnqueueStorageDeletes(ctx, s.db, []string{filepath.Base(avatar)})
		return errors.Join(err, cleanupErr)
	}
	return err
}

// recordAuthorizationFailure records only the credential version used by this
// attempt. The retention owner decides whether its deadline requires retirement.
func (s *Service) recordAuthorizationFailure(ctx context.Context, account models.SocialAccount, version int64) error {
	return organizationguard.WithWorkspace(ctx, s.db, account.WorkspaceID, func(ctx context.Context, db bun.IDB) error {
		current := db.NewSelect().Model((*models.SocialAccount)(nil)).ColumnExpr("1").Where("id = ? AND workspace_id = ? AND account_id = ? AND oauth_grant_id = ? AND is_active = ?", account.ID, account.WorkspaceID, account.AccountID, account.OAuthGrantID, true)
		if account.ProfileFetchedAt.IsZero() {
			current = current.Where("profile_fetched_at IS NULL")
		} else {
			current = current.Where("profile_fetched_at = ?", account.ProfileFetchedAt)
		}
		_, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).Set("validation_status = ?", "refresh_failed").Set("last_refresh_error = ?", "profile_authorization_failed").Set("updated_at = ?", s.now()).
			Where("id = ? AND workspace_id = ? AND token_version = ? AND validation_status = ? AND revoked_at IS NULL AND refresh_lease_owner = ?", account.OAuthGrantID, account.WorkspaceID, version, "valid", "").Where("EXISTS (?)", current).Exec(ctx)
		return err
	})
}
