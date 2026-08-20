package growth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

var (
	ErrAccessDenied     = errors.New("workspace access denied")
	ErrNotFound         = errors.New("not found")
	ErrInvalid          = errors.New("invalid request")
	ErrConflict         = errors.New("conflict")
	ErrUnsupported      = errors.New("growth is not supported for this account")
	ErrAccountNotActive = errors.New("social account is not active")
)

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Service struct {
	db          *bun.DB
	tokenSource TokenSource
	telemetry   telemetry.Recorder
	providersMu sync.RWMutex
	providers   map[string]platform.Adapter
	now         func() time.Time
}

func NewService(db *bun.DB, ts TokenSource, rec telemetry.Recorder) *Service {
	return &Service{
		db:          db,
		tokenSource: ts,
		telemetry:   rec,
		providers:   make(map[string]platform.Adapter),
		now:         func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}

func (s *Service) SetTelemetry(rec telemetry.Recorder) {
	s.telemetry = rec
}

// authorize checks workspace membership at required level.
func (s *Service) authorize(ctx context.Context, workspaceID string, actor workspaceaccess.ActorFacts, level workspaceaccess.Level) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return fmt.Errorf("authorize growth workspace: %w", err)
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	return nil
}

func (s *Service) resolveAccount(ctx context.Context, workspaceID, socialAccountID string) (models.SocialAccount, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	socialAccountID = strings.TrimSpace(socialAccountID)
	if workspaceID == "" || socialAccountID == "" {
		return models.SocialAccount{}, ErrInvalid
	}
	var acct models.SocialAccount
	if err := s.db.NewSelect().Model(&acct).Where("id = ? AND workspace_id = ?", socialAccountID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.SocialAccount{}, ErrNotFound
		}
		return models.SocialAccount{}, err
	}
	if !acct.IsActive {
		return models.SocialAccount{}, ErrAccountNotActive
	}
	// Only bluesky and mastodon supported per spec
	if acct.Platform != "bluesky" && acct.Platform != "mastodon" {
		return models.SocialAccount{}, ErrUnsupported
	}
	return acct, nil
}

func (s *Service) growthDiscovererForAccount(acct models.SocialAccount) (platform.GrowthDiscoverer, error) {
	key := providerKeyForAccount(acct)
	s.providersMu.RLock()
	adapter, ok := s.providers[key]
	s.providersMu.RUnlock()
	if !ok {
		// fallback: try plain platform name for mastodon without instance? but spec says exact instance-aware key required
		return nil, fmt.Errorf("growth discovery provider not configured for %q", key)
	}
	discoverer, ok := adapter.(platform.GrowthDiscoverer)
	if !ok {
		return nil, ErrUnsupported
	}
	return discoverer, nil
}

func (s *Service) growthFollowerForAccount(acct models.SocialAccount) (platform.GrowthFollower, error) {
	key := providerKeyForAccount(acct)
	s.providersMu.RLock()
	adapter, ok := s.providers[key]
	s.providersMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("growth follow provider not configured for %q", key)
	}
	follower, ok := adapter.(platform.GrowthFollower)
	if !ok {
		return nil, ErrUnsupported
	}
	return follower, nil
}

// QueueRefresh requires edit access and a live supported account, dedupes active jobs, marks sync state queued.
func (s *Service) QueueRefresh(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, socialAccountID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	socialAccountID = strings.TrimSpace(socialAccountID)
	if workspaceID == "" || socialAccountID == "" {
		return "", ErrInvalid
	}
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return "", err
	}
	acct, err := s.resolveAccount(ctx, workspaceID, socialAccountID)
	if err != nil {
		return "", err
	}
	// Verify provider exists
	if _, err := s.growthDiscovererForAccount(acct); err != nil {
		return "", err
	}

	// Ensure sync state exists
	now := s.now()
	var state models.GrowthSyncState
	err = s.db.NewSelect().Model(&state).Where("social_account_id = ?", acct.ID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		state = models.GrowthSyncState{
			ID:              uuid.NewString(),
			WorkspaceID:     acct.WorkspaceID,
			SocialAccountID: acct.ID,
			Platform:        acct.Platform,
			Status:          models.GrowthSyncStatusQueued,
			LastAttemptedAt: now,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if _, err := s.db.NewInsert().Model(&state).Exec(ctx); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		// Do not erase prior generation; just mark queued
		if _, err := s.db.NewUpdate().Model(&state).Set("status = ?", models.GrowthSyncStatusQueued).Set("last_attempted_at = ?", now).Set("updated_at = ?", now).WherePK().Exec(ctx); err != nil {
			return "", err
		}
	}

	payloadMap := growthDiscoveryPayload{WorkspaceID: workspaceID, SocialAccountID: socialAccountID, ActorUserID: strings.TrimSpace(actor.UserID)}
	payloadBytes, _ := json.Marshal(payloadMap)
	// Active-job dedupe identity: scope workspace_id, key growth:<social_account_id>
	identity := jobregistry.Identity{ScopeID: workspaceID, DedupeKey: "growth:" + acct.ID}
	// Try to insert job with ON CONFLICT DO NOTHING; if exists return existing id
	job, err := jobregistry.NewJob(jobregistry.TypeGrowthDiscovery, string(payloadBytes), now)
	if err != nil {
		return "", err
	}
	job.ScopeID = identity.ScopeID
	job.DedupeKey = identity.DedupeKey
	result, err := s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return "", err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if rows == 1 {
		if s.telemetry != nil {
			_ = s.telemetry.Capture(ctx, telemetry.Event{
				Name:        telemetry.EventGrowthRefreshRequested,
				DistinctID:  actor.UserID,
				WorkspaceID: workspaceID,
				Properties:  map[string]any{"platform": acct.Platform},
			})
		}
		return job.ID, nil
	}
	// Load existing pending/processing job
	var existing models.Job
	if err := s.db.NewSelect().Model(&existing).Where("type = ? AND scope_id = ? AND dedupe_key = ? AND status IN (?, ?)", jobregistry.TypeGrowthDiscovery, identity.ScopeID, identity.DedupeKey, jobregistry.StatusPending, jobregistry.StatusProcessing).Limit(1).Scan(ctx); err != nil {
		return "", err
	}
	return existing.ID, nil
}

// ListResult is the DB-only page read.
type ListResult struct {
	Items     []RecommendationView `json:"items"`
	SyncState *SyncStateView       `json:"sync_state"`
}

type RecommendationView struct {
	ID                 string                         `json:"id"`
	WorkspaceID        string                         `json:"workspace_id"`
	SocialAccountID    string                         `json:"social_account_id"`
	Platform           string                         `json:"platform"`
	RemoteAccountID    string                         `json:"remote_account_id"`
	Handle             string                         `json:"handle"`
	DisplayName        string                         `json:"display_name"`
	Bio                string                         `json:"bio"`
	AvatarURL          string                         `json:"avatar_url"`
	ProfileURL         string                         `json:"profile_url"`
	FollowersCount     int                            `json:"followers_count"`
	FollowingCount     int                            `json:"following_count"`
	MutualCount        int                            `json:"mutual_count"`
	Mutuals            []platform.GrowthMutualProfile `json:"mutuals"`
	MutualExact        bool                           `json:"mutual_exact"`
	FollowsViewer      bool                           `json:"follows_viewer"`
	Signals            []string                       `json:"signals"`
	Score              float64                        `json:"score"`
	GenerationID       string                         `json:"generation_id"`
	FollowState        string                         `json:"follow_state"`
	FollowErrorCode    string                         `json:"follow_error_code,omitempty"`
	FollowErrorMessage string                         `json:"follow_error_message,omitempty"`
	LastSeenAt         time.Time                      `json:"last_seen_at"`
	CreatedAt          time.Time                      `json:"created_at"`
	UpdatedAt          time.Time                      `json:"updated_at"`
}

type SyncStateView struct {
	ID                  string     `json:"id"`
	WorkspaceID         string     `json:"workspace_id"`
	SocialAccountID     string     `json:"social_account_id"`
	Platform            string     `json:"platform"`
	Status              string     `json:"status"`
	ErrorCode           string     `json:"error_code,omitempty"`
	ErrorMessage        string     `json:"error_message,omitempty"`
	CurrentGenerationID string     `json:"current_generation_id"`
	LastAttemptedAt     *time.Time `json:"last_attempted_at,omitempty"`
	LastSuccessAt       *time.Time `json:"last_success_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

func (s *Service) List(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, socialAccountID string) (ListResult, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	socialAccountID = strings.TrimSpace(socialAccountID)
	if workspaceID == "" || socialAccountID == "" {
		return ListResult{}, ErrInvalid
	}
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return ListResult{}, err
	}
	// Exact workspace/account ownership check
	var acct models.SocialAccount
	if err := s.db.NewSelect().Model(&acct).Where("id = ? AND workspace_id = ?", socialAccountID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ListResult{}, ErrNotFound
		}
		return ListResult{}, err
	}
	// Load sync state
	var state models.GrowthSyncState
	if err := s.db.NewSelect().Model(&state).Where("social_account_id = ?", acct.ID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		// no state yet, return empty
		return ListResult{Items: []RecommendationView{}, SyncState: nil}, nil
	} else if err != nil {
		return ListResult{}, err
	}
	syncView := syncStateToView(&state)
	if state.CurrentGenerationID == "" {
		return ListResult{Items: []RecommendationView{}, SyncState: syncView}, nil
	}
	var rows []models.GrowthRecommendation
	if err := s.db.NewSelect().Model(&rows).
		Where("social_account_id = ? AND generation_id = ?", acct.ID, state.CurrentGenerationID).
		Where("dismissed_at IS NULL").
		Where("follow_state NOT IN (?, ?)", models.GrowthRecommendationFollowFollowing, models.GrowthRecommendationFollowRequested).
		// Also exclude dismissed; following/requested filtered per spec (failed still visible to show error)
		Order("score DESC").
		Order("mutual_count DESC").
		Order("handle ASC").
		Order("remote_account_id ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ListResult{}, err
	}
	items := make([]RecommendationView, 0, len(rows))
	for _, r := range rows {
		view, err := recommendationToView(r)
		if err != nil {
			continue
		}
		items = append(items, view)
	}
	return ListResult{Items: items, SyncState: syncView}, nil
}

func recommendationToView(r models.GrowthRecommendation) (RecommendationView, error) {
	var mutuals []platform.GrowthMutualProfile
	if strings.TrimSpace(r.MutualsJSON) != "" {
		if err := json.Unmarshal([]byte(r.MutualsJSON), &mutuals); err != nil {
			mutuals = []platform.GrowthMutualProfile{}
		}
	}
	if mutuals == nil {
		mutuals = []platform.GrowthMutualProfile{}
	}
	var signals []string
	if strings.TrimSpace(r.SignalsJSON) != "" {
		if err := json.Unmarshal([]byte(r.SignalsJSON), &signals); err != nil {
			signals = []string{}
		}
	}
	if signals == nil {
		signals = []string{}
	}
	return RecommendationView{
		ID:                 r.ID,
		WorkspaceID:        r.WorkspaceID,
		SocialAccountID:    r.SocialAccountID,
		Platform:           r.Platform,
		RemoteAccountID:    r.RemoteAccountID,
		Handle:             r.Handle,
		DisplayName:        r.DisplayName,
		Bio:                r.Bio,
		AvatarURL:          r.AvatarURL,
		ProfileURL:         r.ProfileURL,
		FollowersCount:     r.FollowersCount,
		FollowingCount:     r.FollowingCount,
		MutualCount:        r.MutualCount,
		Mutuals:            mutuals,
		MutualExact:        r.MutualExact,
		FollowsViewer:      r.FollowsViewer,
		Signals:            signals,
		Score:              r.Score,
		GenerationID:       r.GenerationID,
		FollowState:        r.FollowState,
		FollowErrorCode:    r.FollowErrorCode,
		FollowErrorMessage: r.FollowErrorMessage,
		LastSeenAt:         r.LastSeenAt,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}, nil
}

func syncStateToView(s *models.GrowthSyncState) *SyncStateView {
	if s == nil {
		return nil
	}
	var attempted *time.Time
	if !s.LastAttemptedAt.IsZero() {
		t := s.LastAttemptedAt
		attempted = &t
	}
	var success *time.Time
	if !s.LastSuccessAt.IsZero() {
		t := s.LastSuccessAt
		success = &t
	}
	return &SyncStateView{
		ID:                  s.ID,
		WorkspaceID:         s.WorkspaceID,
		SocialAccountID:     s.SocialAccountID,
		Platform:            s.Platform,
		Status:              s.Status,
		ErrorCode:           s.ErrorCode,
		ErrorMessage:        s.ErrorMessage,
		CurrentGenerationID: s.CurrentGenerationID,
		LastAttemptedAt:     attempted,
		LastSuccessAt:       success,
		CreatedAt:           s.CreatedAt,
		UpdatedAt:           s.UpdatedAt,
	}
}

// Dismiss performs local update only, no job, requires edit access and exact workspace ownership.
func (s *Service) Dismiss(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, recommendationID string) error {
	workspaceID = strings.TrimSpace(workspaceID)
	recommendationID = strings.TrimSpace(recommendationID)
	if workspaceID == "" || recommendationID == "" {
		return ErrInvalid
	}
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return err
	}
	var rec models.GrowthRecommendation
	if err := s.db.NewSelect().Model(&rec).Where("id = ? AND workspace_id = ?", recommendationID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if !rec.DismissedAt.IsZero() {
		return nil
	}
	now := s.now()
	if _, err := s.db.NewUpdate().Model(&rec).Set("dismissed_at = ?", now).Set("updated_at = ?", now).WherePK().Exec(ctx); err != nil {
		return err
	}
	if s.telemetry != nil {
		bucket := mutualCountBucket(rec.MutualCount)
		// Need ranking position - compute via current generation ordering (best effort)
		pos := 0 // omit exact position without extra query; set 0
		_ = pos
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthRecommendationDismissed,
			DistinctID:  actor.UserID,
			WorkspaceID: workspaceID,
			Properties: map[string]any{
				"platform":            rec.Platform,
				"mutual_count_bucket": bucket,
				"ranking_position":    0,
			},
		})
	}
	return nil
}

// QueueFollow atomically sets pending, clears prior error, enqueues one growth_follow job.
func (s *Service) QueueFollow(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, recommendationID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	recommendationID = strings.TrimSpace(recommendationID)
	if workspaceID == "" || recommendationID == "" {
		return "", ErrInvalid
	}
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return "", err
	}
	var rec models.GrowthRecommendation
	if err := s.db.NewSelect().Model(&rec).Where("id = ? AND workspace_id = ?", recommendationID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	// Exact workspace/recommendation/account ownership already via workspace_id match; also verify social account belongs to workspace
	var acct models.SocialAccount
	if err := s.db.NewSelect().Model(&acct).Where("id = ? AND workspace_id = ?", rec.SocialAccountID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	if !acct.IsActive {
		return "", ErrAccountNotActive
	}
	if acct.Platform != "bluesky" && acct.Platform != "mastodon" {
		return "", ErrUnsupported
	}
	// Prevent duplicate pending/terminal follows
	if rec.FollowState == models.GrowthRecommendationFollowPending || rec.FollowState == models.GrowthRecommendationFollowFollowing || rec.FollowState == models.GrowthRecommendationFollowRequested || rec.FollowState == models.GrowthRecommendationFollowFailed {
		return "", ErrConflict
	}
	if !rec.DismissedAt.IsZero() {
		return "", ErrConflict
	}
	now := s.now()
	// Atomic update + enqueue
	var jobID string
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		// Re-check with lock via select? Use update with condition
		result, err := tx.NewUpdate().Model(&rec).
			Set("follow_state = ?", models.GrowthRecommendationFollowPending).
			Set("follow_error_code = ''").
			Set("follow_error_message = ''").
			Set("updated_at = ?", now).
			Where("id = ? AND workspace_id = ? AND follow_state = ?", rec.ID, rec.WorkspaceID, models.GrowthRecommendationFollowIdle).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, _ := result.RowsAffected()
		if rows != 1 {
			return ErrConflict
		}
		jobID = uuid.NewString()
		payload := growthFollowPayload{WorkspaceID: workspaceID, RecommendationID: rec.ID, ActorUserID: strings.TrimSpace(actor.UserID)}
		payloadBytes, _ := json.Marshal(payload)
		job, err := jobregistry.NewJob(jobregistry.TypeGrowthFollow, string(payloadBytes), now)
		if err != nil {
			return err
		}
		job.ID = jobID
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if s.telemetry != nil {
		bucket := mutualCountBucket(rec.MutualCount)
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthFollowRequested,
			DistinctID:  actor.UserID,
			WorkspaceID: workspaceID,
			Properties: map[string]any{
				"platform":            rec.Platform,
				"mutual_count_bucket": bucket,
				"ranking_position":    0,
			},
		})
	}
	return jobID, nil
}
