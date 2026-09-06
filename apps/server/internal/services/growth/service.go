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
	ErrFeatureDisabled  = errors.New("grow is disabled for this account")
)

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type FeatureGate interface {
	IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error)
}

type Service struct {
	db          *bun.DB
	tokenSource TokenSource
	telemetry   telemetry.Recorder
	providersMu sync.RWMutex
	providers   map[string]platform.Adapter
	now         func() time.Time
	featureGate FeatureGate
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

func (s *Service) SetFeatureGate(g FeatureGate) {
	s.featureGate = g
}

func (s *Service) isGrowEnabled(ctx context.Context, accountID string) bool {
	if s.featureGate == nil {
		return false
	}
	enabled, err := s.featureGate.IsEffectiveEnabled(ctx, accountID, "grow")
	if err != nil {
		return false
	}
	return enabled
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
// The sync-state update and job dedupe are atomic in one transaction so a crash cannot leave queued with no job.
func (s *Service) QueueRefresh(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, socialAccountID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	socialAccountID = strings.TrimSpace(socialAccountID)
	if workspaceID == "" || socialAccountID == "" {
		return "", ErrInvalid
	}
	acct, err := s.prepareRefreshAccount(ctx, actor, workspaceID, socialAccountID)
	if err != nil {
		return "", err
	}
	now := s.now()
	payload := s.buildDiscoveryPayload(workspaceID, socialAccountID, actor.UserID)
	identity := jobregistry.Identity{ScopeID: workspaceID, DedupeKey: "growth:" + acct.ID}
	jobID, isNewJob, err := s.executeRefreshTx(ctx, acct, payload, identity, now)
	if err != nil {
		return "", err
	}
	if isNewJob && s.telemetry != nil {
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthRefreshRequested,
			DistinctID:  actor.UserID,
			WorkspaceID: workspaceID,
			Properties:  map[string]any{"platform": acct.Platform},
		})
	}
	return jobID, nil
}

func (s *Service) prepareRefreshAccount(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, socialAccountID string) (models.SocialAccount, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return models.SocialAccount{}, err
	}
	acct, err := s.resolveAccount(ctx, workspaceID, socialAccountID)
	if err != nil {
		return models.SocialAccount{}, err
	}
	if !s.isGrowEnabled(ctx, acct.ID) {
		return models.SocialAccount{}, ErrFeatureDisabled
	}
	if _, err := s.growthDiscovererForAccount(acct); err != nil {
		return models.SocialAccount{}, err
	}
	return acct, nil
}

func (s *Service) buildDiscoveryPayload(workspaceID, socialAccountID, actorUserID string) string {
	payloadMap := growthDiscoveryPayload{WorkspaceID: workspaceID, SocialAccountID: socialAccountID, ActorUserID: strings.TrimSpace(actorUserID)}
	payloadBytes, _ := json.Marshal(payloadMap)
	return string(payloadBytes)
}

func (s *Service) executeRefreshTx(ctx context.Context, acct models.SocialAccount, payload string, identity jobregistry.Identity, now time.Time) (string, bool, error) {
	var jobID string
	var isNewJob bool
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.upsertGrowthSyncQueued(txCtx, tx, acct, now); err != nil {
			return err
		}
		inserted, err := s.insertDiscoveryJob(txCtx, tx, payload, identity, now)
		if err != nil {
			return err
		}
		if inserted != "" {
			jobID = inserted
			isNewJob = true
			return nil
		}
		existingID, err := s.findExistingDiscoveryJob(txCtx, tx, identity)
		if err != nil {
			return err
		}
		jobID = existingID
		return nil
	})
	return jobID, isNewJob, err
}

func (s *Service) upsertGrowthSyncQueued(ctx context.Context, tx bun.Tx, acct models.SocialAccount, now time.Time) error {
	state := models.GrowthSyncState{
		ID:              uuid.NewString(),
		WorkspaceID:     acct.WorkspaceID,
		SocialAccountID: acct.ID,
		Platform:        acct.Platform,
		Status:          models.GrowthSyncStatusQueued,
		LastAttemptedAt: now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err := tx.NewInsert().Model(&state).
		On("CONFLICT (social_account_id) DO UPDATE").
		Set("status = EXCLUDED.status").
		Set("last_attempted_at = EXCLUDED.last_attempted_at").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Service) insertDiscoveryJob(ctx context.Context, tx bun.Tx, payload string, identity jobregistry.Identity, now time.Time) (string, error) {
	job, err := jobregistry.NewJob(jobregistry.TypeGrowthDiscovery, payload, now)
	if err != nil {
		return "", err
	}
	job.ScopeID = identity.ScopeID
	job.DedupeKey = identity.DedupeKey
	result, err := tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return "", err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if rows == 1 {
		return job.ID, nil
	}
	return "", nil
}

func (s *Service) findExistingDiscoveryJob(ctx context.Context, tx bun.Tx, identity jobregistry.Identity) (string, error) {
	var existing models.Job
	if err := tx.NewSelect().Model(&existing).Where("type = ? AND scope_id = ? AND dedupe_key = ? AND status IN (?, ?)", jobregistry.TypeGrowthDiscovery, identity.ScopeID, identity.DedupeKey, jobregistry.StatusPending, jobregistry.StatusProcessing).Limit(1).Scan(ctx); err != nil {
		return "", err
	}
	return existing.ID, nil
}

// ListResult is the DB-only page read.
type ListResult struct {
	Items         []RecommendationView `json:"items"`
	SyncState     *SyncStateView       `json:"sync_state"`
	FollowUpdates []FollowUpdateView   `json:"follow_updates"`
}

type FollowUpdateView struct {
	ID                 string    `json:"id"`
	FollowState        string    `json:"follow_state" enum:"following,requested"`
	FollowErrorCode    string    `json:"follow_error_code,omitempty"`
	FollowErrorMessage string    `json:"follow_error_message,omitempty"`
	UpdatedAt          time.Time `json:"updated_at"`
	GenerationID       string    `json:"generation_id"`
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
	FollowState        string                         `json:"follow_state" enum:"idle,pending,following,requested,failed"`
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
	Status              string     `json:"status" enum:"idle,queued,refreshing,ok,permission_required,rate_limited,temporarily_unavailable,failed"`
	ErrorCode           string     `json:"error_code,omitempty"`
	ErrorMessage        string     `json:"error_message,omitempty"`
	CurrentGenerationID string     `json:"current_generation_id"`
	LastAttemptedAt     *time.Time `json:"last_attempted_at,omitempty"`
	LastSuccessAt       *time.Time `json:"last_success_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

//nolint:gocyclo // One DB-only read validates ownership, loads state, and projects stored recommendations.
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
		return ListResult{Items: []RecommendationView{}, SyncState: nil, FollowUpdates: []FollowUpdateView{}}, nil
	} else if err != nil {
		return ListResult{}, err
	}
	syncView := syncStateToView(&state)
	if state.CurrentGenerationID == "" {
		return ListResult{Items: []RecommendationView{}, SyncState: syncView, FollowUpdates: []FollowUpdateView{}}, nil
	}
	var rows []models.GrowthRecommendation
	if err := s.db.NewSelect().Model(&rows).
		Where("social_account_id = ? AND generation_id = ?", acct.ID, state.CurrentGenerationID).
		Where("dismissed_at IS NULL").
		Order("score DESC").
		Order("mutual_count DESC").
		Order("handle ASC").
		Order("remote_account_id ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ListResult{}, err
	}
	items := make([]RecommendationView, 0, len(rows))
	followUpdates := make([]FollowUpdateView, 0)
	for _, row := range rows {
		if row.FollowState == models.GrowthRecommendationFollowFollowing || row.FollowState == models.GrowthRecommendationFollowRequested {
			followUpdates = append(followUpdates, FollowUpdateView{
				ID:                 row.ID,
				FollowState:        row.FollowState,
				FollowErrorCode:    row.FollowErrorCode,
				FollowErrorMessage: row.FollowErrorMessage,
				UpdatedAt:          row.UpdatedAt,
				GenerationID:       row.GenerationID,
			})
			continue
		}
		items = append(items, recommendationToView(row))
	}
	if followUpdates == nil {
		followUpdates = []FollowUpdateView{}
	}
	if items == nil {
		items = []RecommendationView{}
	}
	return ListResult{Items: items, SyncState: syncView, FollowUpdates: followUpdates}, nil
}

func recommendationToView(r models.GrowthRecommendation) RecommendationView {
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
	}
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
		properties := map[string]any{
			"platform":            rec.Platform,
			"mutual_count_bucket": mutualCountBucket(rec.MutualCount),
		}
		if bucket, rankErr := s.recommendationRankBucket(ctx, rec); rankErr == nil {
			properties["rank_bucket"] = bucket
		}
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthRecommendationDismissed,
			DistinctID:  actor.UserID,
			WorkspaceID: workspaceID,
			Properties:  properties,
		})
	}
	return nil
}

// QueueFollow atomically sets pending, clears prior error, enqueues one growth_follow job.
//
//nolint:gocyclo // Follow queueing keeps authorization, ownership, state transition, and job insert in one boundary.
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
	if !s.isGrowEnabled(ctx, acct.ID) {
		return "", ErrFeatureDisabled
	}
	if rec.FollowState == models.GrowthRecommendationFollowPending || rec.FollowState == models.GrowthRecommendationFollowFollowing || rec.FollowState == models.GrowthRecommendationFollowRequested {
		return "", ErrConflict
	}
	if !rec.DismissedAt.IsZero() {
		return "", ErrConflict
	}
	now := s.now()
	var jobID string
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model(&rec).
			Set("follow_state = ?", models.GrowthRecommendationFollowPending).
			Set("follow_error_code = ''").
			Set("follow_error_message = ''").
			Set("updated_at = ?", now).
			Where("id = ? AND workspace_id = ?", rec.ID, rec.WorkspaceID).
			Where("dismissed_at IS NULL").
			Where("follow_state IN (?, ?)", models.GrowthRecommendationFollowIdle, models.GrowthRecommendationFollowFailed).
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
		properties := map[string]any{
			"platform":            rec.Platform,
			"mutual_count_bucket": mutualCountBucket(rec.MutualCount),
		}
		if bucket, rankErr := s.recommendationRankBucket(ctx, rec); rankErr == nil {
			properties["rank_bucket"] = bucket
		}
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthFollowRequested,
			DistinctID:  actor.UserID,
			WorkspaceID: workspaceID,
			Properties:  properties,
		})
	}
	return jobID, nil
}

func (s *Service) recommendationRankBucket(ctx context.Context, recommendation models.GrowthRecommendation) (string, error) {
	query := s.db.NewSelect().Model((*models.GrowthRecommendation)(nil)).
		Where("social_account_id = ? AND generation_id = ?", recommendation.SocialAccountID, recommendation.GenerationID).
		Where("dismissed_at IS NULL").
		Where("follow_state NOT IN (?, ?)", models.GrowthRecommendationFollowFollowing, models.GrowthRecommendationFollowRequested).
		Where(`
			score > ? OR
			(score = ? AND mutual_count > ?) OR
			(score = ? AND mutual_count = ? AND handle < ?) OR
			(score = ? AND mutual_count = ? AND handle = ? AND remote_account_id < ?)
		`,
			recommendation.Score,
			recommendation.Score, recommendation.MutualCount,
			recommendation.Score, recommendation.MutualCount, recommendation.Handle,
			recommendation.Score, recommendation.MutualCount, recommendation.Handle, recommendation.RemoteAccountID,
		)
	count, err := query.Count(ctx)
	if err != nil {
		return "", err
	}
	return growthRankBucket(count + 1), nil
}
