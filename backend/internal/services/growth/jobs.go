package growth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const discoveryTarget = 40

type growthDiscoveryPayload struct {
	WorkspaceID     string `json:"workspace_id"`
	SocialAccountID string `json:"social_account_id"`
	ActorUserID     string `json:"actor_user_id"`
}

type growthFollowPayload struct {
	WorkspaceID      string `json:"workspace_id"`
	RecommendationID string `json:"recommendation_id"`
	ActorUserID      string `json:"actor_user_id"`
}

func decodeDiscoveryPayload(payload string) (growthDiscoveryPayload, error) {
	var p growthDiscoveryPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return p, fmt.Errorf("decode growth discovery payload: %w", err)
	}
	p.WorkspaceID = strings.TrimSpace(p.WorkspaceID)
	p.SocialAccountID = strings.TrimSpace(p.SocialAccountID)
	p.ActorUserID = strings.TrimSpace(p.ActorUserID)
	if p.WorkspaceID == "" || p.SocialAccountID == "" {
		return p, errors.New("workspace_id and social_account_id are required for growth discovery")
	}
	return p, nil
}

func decodeFollowPayload(payload string) (growthFollowPayload, error) {
	var p growthFollowPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return p, fmt.Errorf("decode growth follow payload: %w", err)
	}
	p.WorkspaceID = strings.TrimSpace(p.WorkspaceID)
	p.RecommendationID = strings.TrimSpace(p.RecommendationID)
	p.ActorUserID = strings.TrimSpace(p.ActorUserID)
	if p.WorkspaceID == "" || p.RecommendationID == "" {
		return p, errors.New("workspace_id and recommendation_id are required for growth follow")
	}
	return p, nil
}

// HandleJob routes durable jobs.
func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	switch jobType {
	case jobregistry.TypeGrowthDiscovery:
		p, err := decodeDiscoveryPayload(payload)
		if err != nil {
			return err
		}
		return s.handleDiscovery(ctx, p)
	case jobregistry.TypeGrowthFollow:
		p, err := decodeFollowPayload(payload)
		if err != nil {
			return err
		}
		return s.handleFollow(ctx, p)
	default:
		return fmt.Errorf("unsupported growth job type %q", jobType)
	}
}

//nolint:gocyclo // Discovery owns state recovery, provider reads, normalization, and the atomic generation swap.
func (s *Service) handleDiscovery(ctx context.Context, p growthDiscoveryPayload) error {
	state, err := s.loadSyncState(ctx, p.SocialAccountID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	now := s.now()
	if state == nil {
		acct, err := s.resolveAccount(ctx, p.WorkspaceID, p.SocialAccountID)
		if err != nil {
			return err
		}
		state = &models.GrowthSyncState{
			ID:              uuid.NewString(),
			WorkspaceID:     acct.WorkspaceID,
			SocialAccountID: acct.ID,
			Platform:        acct.Platform,
			Status:          models.GrowthSyncStatusRefreshing,
			LastAttemptedAt: now,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			_, err := tx.NewInsert().Model(state).On("CONFLICT DO NOTHING").Exec(txCtx)
			if err != nil {
				return err
			}
			reloaded, reloadErr := s.loadSyncStateDB(txCtx, tx, p.SocialAccountID)
			if reloadErr != nil {
				return reloadErr
			}
			*state = *reloaded
			_, err = tx.NewUpdate().Model(state).Set("status = ?", models.GrowthSyncStatusRefreshing).Set("last_attempted_at = ?", now).Set("updated_at = ?", now).WherePK().Exec(txCtx)
			if err != nil {
				return fmt.Errorf("mark growth refreshing: %w", err)
			}
			return nil
		})
		if err != nil {
			return err
		}
	} else {
		if _, err := s.db.NewUpdate().Model(state).Set("status = ?", models.GrowthSyncStatusRefreshing).Set("last_attempted_at = ?", now).Set("updated_at = ?", now).WherePK().Exec(ctx); err != nil {
			return fmt.Errorf("mark growth refreshing: %w", err)
		}
	}

	account, err := s.resolveAccount(ctx, p.WorkspaceID, p.SocialAccountID)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		s.recordDiscoveryFailure(ctx, state, status, code, msg)
		return err
	}
	if !s.isGrowEnabled(ctx, account.ID) {
		s.recordDiscoveryFailure(ctx, state, "feature_disabled", "feature_disabled", "Grow is disabled for this account.")
		return fmt.Errorf("grow is disabled for this account")
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		s.recordDiscoveryFailure(ctx, state, status, code, msg)
		return err
	}
	adapter, err := s.growthDiscovererForAccount(account)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		s.recordDiscoveryFailure(ctx, state, status, code, msg)
		return err
	}
	input := platform.GrowthDiscoveryInput{
		AccessToken: token,
		ViewerID:    account.AccountID,
		Limit:       discoveryTarget,
	}
	candidates, err := adapter.DiscoverGrowthCandidates(ctx, input)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		s.recordDiscoveryFailure(ctx, state, status, code, msg)
		return err
	}

	normalized := make([]platform.GrowthCandidate, 0, len(candidates))
	for _, c := range candidates {
		n := normalizeCandidate(c)
		if n.RemoteID == "" || n.Handle == "" {
			continue
		}
		normalized = append(normalized, n)
	}
	ranked := scoreRanked(normalized)
	if len(ranked) > discoveryTarget {
		ranked = ranked[:discoveryTarget]
	}

	newGeneration := uuid.NewString()
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, sc := range ranked {
			c := sc.candidate
			score := sc.score
			mutualsJSON, _ := json.Marshal(c.Mutuals)
			if len(c.Mutuals) == 0 {
				mutualsJSON = []byte("[]")
			}
			signalsJSON, _ := json.Marshal(c.Signals)
			if len(c.Signals) == 0 {
				signalsJSON = []byte("[]")
			}
			bio := boundedText(c.Bio, 500)
			displayName := boundedText(c.DisplayName, 200)
			handle := boundedText(c.Handle, 200)
			avatarURL := safeURL(c.AvatarURL)
			profileURL := safeURL(c.ProfileURL)

			var existing models.GrowthRecommendation
			err := tx.NewSelect().Model(&existing).Where("social_account_id = ? AND remote_account_id = ?", account.ID, c.RemoteID).Scan(txCtx)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if err == nil {
				dismissed := existing.DismissedAt
				followState := existing.FollowState
				followCode := existing.FollowErrorCode
				followMsg := existing.FollowErrorMessage
				preserveFollowState := followState == models.GrowthRecommendationFollowFollowing ||
					followState == models.GrowthRecommendationFollowRequested || !dismissed.IsZero()
				if !preserveFollowState {
					followState = models.GrowthRecommendationFollowIdle
					followCode = ""
					followMsg = ""
				}
				_, err = tx.NewUpdate().Model(&existing).
					Set("workspace_id = ?", account.WorkspaceID).
					Set("platform = ?", account.Platform).
					Set("handle = ?", handle).
					Set("display_name = ?", displayName).
					Set("bio = ?", bio).
					Set("avatar_url = ?", avatarURL).
					Set("profile_url = ?", profileURL).
					Set("followers_count = ?", c.FollowersCount).
					Set("following_count = ?", c.FollowingCount).
					Set("mutual_count = ?", c.MutualCount).
					Set("mutuals_json = ?", string(mutualsJSON)).
					Set("mutual_exact = ?", c.MutualsExact).
					Set("follows_viewer = ?", c.FollowedBy).
					Set("signals_json = ?", string(signalsJSON)).
					Set("score = ?", score).
					Set("generation_id = ?", newGeneration).
					Set("dismissed_at = ?", dismissed).
					Set("follow_state = ?", followState).
					Set("follow_error_code = ?", followCode).
					Set("follow_error_message = ?", followMsg).
					Set("last_seen_at = ?", now).
					Set("updated_at = ?", now).
					WherePK().
					Exec(txCtx)
				if err != nil {
					return err
				}
				continue
			}
			rec := &models.GrowthRecommendation{
				ID:              uuid.NewString(),
				WorkspaceID:     account.WorkspaceID,
				SocialAccountID: account.ID,
				Platform:        account.Platform,
				RemoteAccountID: c.RemoteID,
				Handle:          handle,
				DisplayName:     displayName,
				Bio:             bio,
				AvatarURL:       avatarURL,
				ProfileURL:      profileURL,
				FollowersCount:  c.FollowersCount,
				FollowingCount:  c.FollowingCount,
				MutualCount:     c.MutualCount,
				MutualsJSON:     string(mutualsJSON),
				MutualExact:     c.MutualsExact,
				FollowsViewer:   c.FollowedBy,
				SignalsJSON:     string(signalsJSON),
				Score:           score,
				GenerationID:    newGeneration,
				FollowState:     models.GrowthRecommendationFollowIdle,
				LastSeenAt:      now,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			if _, err := tx.NewInsert().Model(rec).Exec(txCtx); err != nil {
				return err
			}
		}
		if _, err := tx.NewUpdate().Model(state).
			Set("status = ?", models.GrowthSyncStatusOK).
			Set("error_code = ''").
			Set("error_message = ''").
			Set("current_generation_id = ?", newGeneration).
			Set("last_success_at = ?", now).
			Set("updated_at = ?", now).
			WherePK().
			Exec(txCtx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		s.recordDiscoveryFailure(ctx, state, status, code, msg)
		return err
	}
	if s.telemetry != nil {
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthRefreshCompleted,
			DistinctID:  p.ActorUserID,
			WorkspaceID: p.WorkspaceID,
			Properties:  map[string]any{"platform": account.Platform, "recommendation_count": len(ranked)},
		})
	}
	return nil
}

func (s *Service) recordDiscoveryFailure(ctx context.Context, state *models.GrowthSyncState, status, code, message string) {
	now := s.now()
	if state == nil {
		return
	}
	_, _ = s.db.NewUpdate().Model(state).
		Set("status = ?", status).
		Set("error_code = ?", boundedText(code, 96)).
		Set("error_message = ?", boundedText(message, 500)).
		Set("updated_at = ?", now).
		WherePK().Exec(ctx)
	if s.telemetry != nil {
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthRefreshCompleted,
			DistinctID:  "",
			WorkspaceID: state.WorkspaceID,
			Properties:  map[string]any{"platform": state.Platform, "recommendation_count": 0},
		})
	}
}

func (s *Service) handleFollow(ctx context.Context, p growthFollowPayload) error {
	exec, ok := providerwrite.JobExecutionFromContext(ctx)
	if !ok || exec.ID == "" {
		return fmt.Errorf("growth follow requires durable job execution context")
	}
	rec, account, err := s.loadFollowTargets(ctx, p)
	if err != nil {
		return err
	}
	if err := s.ensureFollowEnabled(ctx, &rec, account); err != nil {
		return err
	}
	token, adapter, err := s.resolveFollowProvider(ctx, &rec, account)
	if err != nil {
		return err
	}
	input, err := s.buildFollowInput(rec, account, exec.ID)
	if err != nil {
		return s.persistFollowFailure(ctx, &rec, "failed", "fingerprint_error", "could not fingerprint")
	}
	result, err := s.executeFollowWrite(ctx, input, adapter, token, account, rec)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		return s.persistFollowFailure(ctx, &rec, status, code, msg)
	}
	return s.persistFollowSuccess(ctx, rec, account, p.ActorUserID, result.ProviderState)
}

func (s *Service) loadFollowTargets(ctx context.Context, p growthFollowPayload) (models.GrowthRecommendation, models.SocialAccount, error) {
	var rec models.GrowthRecommendation
	if err := s.db.NewSelect().Model(&rec).Where("id = ? AND workspace_id = ?", p.RecommendationID, p.WorkspaceID).Scan(ctx); err != nil {
		return rec, models.SocialAccount{}, err
	}
	account, err := s.resolveAccount(ctx, p.WorkspaceID, rec.SocialAccountID)
	if err != nil {
		return rec, models.SocialAccount{}, err
	}
	return rec, account, nil
}

func (s *Service) ensureFollowEnabled(ctx context.Context, rec *models.GrowthRecommendation, account models.SocialAccount) error {
	if !s.isGrowEnabled(ctx, account.ID) {
		return s.persistFollowFailure(ctx, rec, "feature_disabled", "feature_disabled", "Grow is disabled for this account.")
	}
	return nil
}

func (s *Service) resolveFollowProvider(ctx context.Context, rec *models.GrowthRecommendation, account models.SocialAccount) (string, platform.GrowthFollower, error) {
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		return "", nil, s.persistFollowFailure(ctx, rec, status, code, msg)
	}
	adapter, err := s.growthFollowerForAccount(account)
	if err != nil {
		status, code, msg := classifyGrowthError(err)
		return "", nil, s.persistFollowFailure(ctx, rec, status, code, msg)
	}
	return token, adapter, nil
}

func (s *Service) buildFollowInput(rec models.GrowthRecommendation, account models.SocialAccount, execID string) (providerwrite.Input, error) {
	fingerprint, err := providerwrite.Fingerprint("growth_follow_v1", map[string]string{
		"workspace_id": rec.WorkspaceID, "social_account_id": account.ID, "remote_account_id": rec.RemoteAccountID, "action": "growth_follow",
	})
	if err != nil {
		return providerwrite.Input{}, err
	}
	return providerwrite.Input{
		OperationID: "growth_follow:" + execID, JobID: execID, WorkspaceID: rec.WorkspaceID,
		SocialAccountID: account.ID, TargetKey: providerKeyForAccount(account),
		Provider: account.Platform, Operation: "growth_follow",
		PayloadFingerprint: fingerprint,
	}, nil
}

func (s *Service) executeFollowWrite(ctx context.Context, input providerwrite.Input, adapter platform.GrowthFollower, token string, account models.SocialAccount, rec models.GrowthRecommendation) (platform.PublishResult, error) {
	return providerwrite.New(s.db).Execute(ctx, input, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		if err := control.Begin(platform.PublishResult{
			ProviderState: "growth_follow",
			RetrySafety:   platform.PublishRetryNever,
		}); err != nil {
			return platform.PublishResult{}, err
		}
		followResult, err := adapter.FollowGrowthCandidate(sendCtx, token, account.AccountID, rec.RemoteAccountID)
		if err != nil {
			return platform.PublishResult{}, err
		}
		state := strings.ToLower(strings.TrimSpace(followResult.ProviderState))
		if state == "requested" {
			return platform.PublishResult{
				ExternalID:      boundedText(followResult.ProviderReference, 512),
				SubmissionState: platform.PublishSubmissionAccepted,
				ProviderState:   "requested",
				RetrySafety:     platform.PublishRetryNever,
			}, nil
		}
		return platform.PublishResult{
			ExternalID:      boundedText(followResult.ProviderReference, 512),
			SubmissionState: platform.PublishSubmissionAccepted,
			ProviderState:   "following",
			RetrySafety:     platform.PublishRetryNever,
		}, nil
	}, nil)
}

func (s *Service) persistFollowSuccess(ctx context.Context, rec models.GrowthRecommendation, account models.SocialAccount, actorUserID, providerState string) error {
	newState := models.GrowthRecommendationFollowFollowing
	if strings.EqualFold(providerState, "requested") {
		newState = models.GrowthRecommendationFollowRequested
	}
	now := s.now()
	if _, err := s.db.NewUpdate().Model(&rec).Set("follow_state = ?", newState).Set("follow_error_code = ''").Set("follow_error_message = ''").Set("updated_at = ?", now).WherePK().Exec(ctx); err != nil {
		return err
	}
	if s.telemetry != nil {
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthFollowSucceeded,
			DistinctID:  actorUserID,
			WorkspaceID: rec.WorkspaceID,
			Properties:  map[string]any{"platform": account.Platform, "follow_state": newState},
		})
	}
	return nil
}

func (s *Service) persistFollowFailure(ctx context.Context, rec *models.GrowthRecommendation, status, code, msg string) error {
	now := s.now()
	errorClass := status
	if code != "" {
		errorClass = code
	}
	_, err := s.db.NewUpdate().Model(rec).
		Set("follow_state = ?", models.GrowthRecommendationFollowFailed).
		Set("follow_error_code = ?", boundedText(errorClass, 96)).
		Set("follow_error_message = ?", boundedText(msg, 500)).
		Set("updated_at = ?", now).
		WherePK().Exec(ctx)
	if s.telemetry != nil {
		_ = s.telemetry.Capture(ctx, telemetry.Event{
			Name:        telemetry.EventGrowthFollowFailed,
			DistinctID:  "",
			WorkspaceID: rec.WorkspaceID,
			Properties:  map[string]any{"platform": rec.Platform, "follow_state": models.GrowthRecommendationFollowFailed, "error_class": boundedText(errorClass, 96)},
		})
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("growth follow failed: %s", boundedText(msg, 200))
}

func normalizeCandidate(c platform.GrowthCandidate) platform.GrowthCandidate {
	c.RemoteID = strings.TrimSpace(c.RemoteID)
	c.Handle = strings.TrimSpace(c.Handle)
	c.DisplayName = strings.TrimSpace(c.DisplayName)
	c.Bio = strings.TrimSpace(c.Bio)
	c.AvatarURL = strings.TrimSpace(c.AvatarURL)
	c.ProfileURL = strings.TrimSpace(c.ProfileURL)
	if c.FollowersCount < 0 {
		c.FollowersCount = 0
	}
	if c.FollowingCount < 0 {
		c.FollowingCount = 0
	}
	if c.MutualCount < 0 {
		c.MutualCount = 0
	}
	dedup := make(map[string]struct{})
	out := []string{}
	for _, sig := range c.Signals {
		norm := strings.ToLower(strings.TrimSpace(sig))
		if norm == "" {
			continue
		}
		if _, ok := dedup[norm]; ok {
			continue
		}
		dedup[norm] = struct{}{}
		out = append(out, norm)
	}
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	c.Signals = out
	if len(c.Mutuals) > 3 {
		c.Mutuals = c.Mutuals[:3]
	}
	for i := range c.Mutuals {
		c.Mutuals[i].RemoteID = strings.TrimSpace(c.Mutuals[i].RemoteID)
		c.Mutuals[i].Handle = strings.TrimSpace(c.Mutuals[i].Handle)
		c.Mutuals[i].DisplayName = strings.TrimSpace(c.Mutuals[i].DisplayName)
		c.Mutuals[i].AvatarURL = strings.TrimSpace(c.Mutuals[i].AvatarURL)
	}
	return c
}

func (s *Service) loadSyncState(ctx context.Context, socialAccountID string) (*models.GrowthSyncState, error) {
	return s.loadSyncStateDB(ctx, s.db, socialAccountID)
}

func (s *Service) loadSyncStateDB(ctx context.Context, db bun.IDB, socialAccountID string) (*models.GrowthSyncState, error) {
	var state models.GrowthSyncState
	if err := db.NewSelect().Model(&state).Where("social_account_id = ?", socialAccountID).Scan(ctx); err != nil {
		return nil, err
	}
	return &state, nil
}

