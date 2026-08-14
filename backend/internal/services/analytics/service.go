package analytics

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

const (
	JobTypeSweep         = jobregistry.TypeAnalyticsSweep
	JobTypeAccountSync   = jobregistry.TypeAnalyticsAccount
	JobTypeRenditionSync = jobregistry.TypeAnalyticsRendition

	subjectAccount   = "account"
	subjectRendition = "rendition"

	sweepInterval  = 15 * time.Minute
	accountCadence = 24 * time.Hour
)

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Service struct {
	db          *bun.DB
	tokenSource TokenSource
	providersMu sync.RWMutex
	providers   map[string]platform.Adapter
	now         func() time.Time
}

func NewService(db *bun.DB, tokenSource TokenSource) *Service {
	return &Service{
		db:          db,
		tokenSource: tokenSource,
		providers:   make(map[string]platform.Adapter),
		now:         func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}

func (s *Service) ScheduleSweep(ctx context.Context, runAt time.Time) error {
	payload, err := json.Marshal(struct {
		ScheduledFor string `json:"scheduled_for"`
	}{ScheduledFor: runAt.UTC().Truncate(time.Minute).Format(time.RFC3339)})
	if err != nil {
		return fmt.Errorf("encode analytics sweep: %w", err)
	}
	_, err = s.enqueue(ctx, "", JobTypeSweep, string(payload), runAt)
	return err
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	switch jobType {
	case JobTypeSweep:
		return s.handleSweep(ctx)
	case JobTypeAccountSync:
		var input struct {
			AccountID string `json:"account_id"`
		}
		if err := json.Unmarshal([]byte(payload), &input); err != nil || strings.TrimSpace(input.AccountID) == "" {
			return fmt.Errorf("decode analytics account job")
		}
		return s.syncAccount(ctx, input.AccountID)
	case JobTypeRenditionSync:
		var input struct {
			RenditionID string `json:"rendition_id"`
		}
		if err := json.Unmarshal([]byte(payload), &input); err != nil || strings.TrimSpace(input.RenditionID) == "" {
			return fmt.Errorf("decode analytics rendition job")
		}
		return s.syncRendition(ctx, input.RenditionID)
	default:
		return fmt.Errorf("unsupported analytics job type %q", jobType)
	}
}

func (s *Service) RefreshWorkspace(ctx context.Context, workspaceID string) (int, error) {
	return s.enqueueWorkspace(ctx, workspaceID, true)
}

func (s *Service) handleSweep(ctx context.Context) error {
	var workspaces []string
	if err := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		ColumnExpr("DISTINCT workspace_id").
		Where("is_active = ?", true).
		Scan(ctx, &workspaces); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("list analytics workspaces: %w", err)
	}
	var sweepErr error
	for _, workspaceID := range workspaces {
		if _, err := s.enqueueWorkspace(ctx, workspaceID, false); err != nil {
			sweepErr = errors.Join(sweepErr, err)
		}
	}
	if err := s.ScheduleSweep(ctx, s.now().Add(sweepInterval)); err != nil {
		sweepErr = errors.Join(sweepErr, err)
	}
	return sweepErr
}

func (s *Service) enqueueWorkspace(ctx context.Context, workspaceID string, force bool) (int, error) {
	now := s.now()
	accounts, err := s.listAnalyticsAccounts(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	accountByID := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		accountByID[account.ID] = account
	}

	queued, err := s.enqueueAccountJobs(ctx, accounts, force, now)
	if err != nil {
		return queued, err
	}
	renditions, err := s.listAnalyticsRenditions(ctx, workspaceID, force, now)
	if err != nil {
		return queued, err
	}
	renditionJobs, err := s.enqueueRenditionJobs(ctx, renditions, accountByID, force, now)
	return queued + renditionJobs, err
}

func (s *Service) listAnalyticsAccounts(ctx context.Context, workspaceID string) ([]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().
		Model(&accounts).
		Where("workspace_id = ? AND is_active = ?", workspaceID, true).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list analytics accounts: %w", err)
	}
	return accounts, nil
}

func (s *Service) enqueueAccountJobs(ctx context.Context, accounts []models.SocialAccount, force bool, now time.Time) (int, error) {
	queued := 0
	for _, account := range accounts {
		inserted, err := s.enqueueAccountJob(ctx, account, force, now)
		if err != nil {
			return queued, err
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

func (s *Service) enqueueAccountJob(ctx context.Context, account models.SocialAccount, force bool, now time.Time) (bool, error) {
	adapter := s.analyticsAdapter(account)
	if adapter == nil {
		return false, s.recordUnavailable(ctx, subjectAccount, account.ID, account, platform.AnalyticsStatusUnsupported, "analytics_not_supported", "This provider does not expose account analytics in OpenPost.")
	}
	support := analyticsSupportForAccount(adapter, account)
	if !support.Account {
		return false, s.recordUnavailable(ctx, subjectAccount, account.ID, account, platform.AnalyticsStatusUnsupported, "account_analytics_not_supported", support.AccountUnavailable)
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.AccountRequiredScopes); len(missing) > 0 {
		return false, s.recordUnavailable(ctx, subjectAccount, account.ID, account, platform.AnalyticsStatusPermissionRequired, "missing_scope", missingScopeMessage(missing))
	}
	due, err := s.subjectDue(ctx, subjectAccount, account.ID, now)
	if err != nil {
		return false, err
	}
	if !force && !due {
		return false, nil
	}
	payload, err := json.Marshal(struct {
		AccountID string `json:"account_id"`
	}{AccountID: account.ID})
	if err != nil {
		return false, fmt.Errorf("encode analytics account job: %w", err)
	}
	return s.enqueue(ctx, account.WorkspaceID, JobTypeAccountSync, string(payload), now)
}

func (s *Service) listAnalyticsRenditions(ctx context.Context, workspaceID string, force bool, now time.Time) ([]models.Rendition, error) {
	cutoff := now.Add(-7 * 24 * time.Hour)
	if force {
		cutoff = now.Add(-90 * 24 * time.Hour)
	}
	var renditions []models.Rendition
	if err := s.db.NewSelect().
		Model(&renditions).
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Where("publication.workspace_id = ?", workspaceID).
		Where("COALESCE(publication.actual_run_at, publication.updated_at) >= ?", cutoff).
		Where("rendition.status = ?", models.RenditionStatusPublished).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list analytics renditions: %w", err)
	}
	return renditions, nil
}

func (s *Service) enqueueRenditionJobs(
	ctx context.Context,
	renditions []models.Rendition,
	accountByID map[string]models.SocialAccount,
	force bool,
	now time.Time,
) (int, error) {
	queued := 0
	for _, rendition := range renditions {
		account, ok := accountByID[rendition.SocialAccountID]
		if !ok {
			var err error
			account, err = s.resolveRenditionAnalyticsAccount(ctx, rendition.SocialAccountID)
			if err != nil {
				return queued, err
			}
			if account.ID == "" {
				continue
			}
		}
		inserted, err := s.enqueueRenditionJob(ctx, rendition, account, force, now)
		if err != nil {
			return queued, err
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

func (s *Service) enqueueRenditionJob(
	ctx context.Context,
	rendition models.Rendition,
	account models.SocialAccount,
	force bool,
	now time.Time,
) (bool, error) {
	adapter := s.analyticsAdapter(account)
	if adapter == nil {
		return false, s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusUnsupported, "analytics_not_supported", "This provider does not expose content analytics in OpenPost.")
	}
	support := analyticsSupportForAccount(adapter, account)
	if !support.Content {
		return false, s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusUnsupported, "content_analytics_not_supported", support.ContentUnavailable)
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.ContentRequiredScopes); len(missing) > 0 {
		return false, s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusPermissionRequired, "missing_scope", missingScopeMessage(missing))
	}
	if !force {
		due, err := s.subjectDue(ctx, subjectRendition, rendition.ID, now)
		if err != nil {
			return false, err
		}
		if !due {
			return false, nil
		}
		publishedAt, err := s.renditionPublishedAt(ctx, rendition.PublicationID)
		if err != nil {
			return false, err
		}
		if contentCadence(now.Sub(publishedAt)) == 0 {
			return false, nil
		}
	}
	payload, err := json.Marshal(struct {
		RenditionID string `json:"rendition_id"`
	}{RenditionID: rendition.ID})
	if err != nil {
		return false, fmt.Errorf("encode analytics rendition job: %w", err)
	}
	return s.enqueue(ctx, account.WorkspaceID, JobTypeRenditionSync, string(payload), now)
}

func (s *Service) syncAccount(ctx context.Context, accountID string) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", accountID, true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load analytics account: %w", err)
	}
	adapter := s.analyticsAdapter(account)
	if adapter == nil {
		return s.recordUnavailable(ctx, subjectAccount, account.ID, account, platform.AnalyticsStatusUnsupported, "analytics_not_supported", "")
	}
	support := analyticsSupportForAccount(adapter, account)
	if !support.Account {
		return s.recordUnavailable(ctx, subjectAccount, account.ID, account, platform.AnalyticsStatusUnsupported, "account_analytics_not_supported", support.AccountUnavailable)
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.AccountRequiredScopes); len(missing) > 0 {
		return s.recordUnavailable(ctx, subjectAccount, account.ID, account, platform.AnalyticsStatusPermissionRequired, "missing_scope", missingScopeMessage(missing))
	}
	token, err := s.accessToken(ctx, account.ID)
	if err != nil {
		return s.recordFailure(ctx, subjectAccount, account.ID, account, err)
	}
	values, err := adapter.FetchAccountAnalytics(ctx, token, platform.AccountAnalyticsRequest{
		AccountID:       account.AccountID,
		GrantedScopes:   strings.Fields(account.GrantedScopes),
		CapabilityState: analyticsCapabilityState(account.CapabilityState),
	})
	if err != nil {
		return s.recordFailure(ctx, subjectAccount, account.ID, account, err)
	}
	return s.recordSuccess(ctx, subjectAccount, account.ID, account, "", "", values, accountCadence)
}

func (s *Service) syncRendition(ctx context.Context, renditionID string) error {
	var rendition models.Rendition
	if err := s.db.NewSelect().Model(&rendition).Where("id = ? AND status = ?", renditionID, models.RenditionStatusPublished).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load analytics rendition: %w", err)
	}
	account, err := s.resolveRenditionAnalyticsAccount(ctx, rendition.SocialAccountID)
	if err != nil {
		return err
	}
	if account.ID == "" {
		return nil
	}
	adapter := s.analyticsAdapter(account)
	if adapter == nil {
		return s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusUnsupported, "analytics_not_supported", "")
	}
	support := analyticsSupportForAccount(adapter, account)
	if !support.Content {
		return s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusUnsupported, "content_analytics_not_supported", support.ContentUnavailable)
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.ContentRequiredScopes); len(missing) > 0 {
		return s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusPermissionRequired, "missing_scope", missingScopeMessage(missing))
	}
	externalIDs, err := s.renditionExternalIDs(ctx, rendition)
	if err != nil {
		return err
	}
	if len(externalIDs) == 0 {
		return s.recordUnavailable(ctx, subjectRendition, rendition.ID, account, platform.AnalyticsStatusNotFound, "missing_external_id", "The published provider ID is missing.")
	}
	publishedAt, err := s.renditionPublishedAt(ctx, rendition.PublicationID)
	if err != nil {
		return err
	}
	token, err := s.accessToken(ctx, account.ID)
	if err != nil {
		return s.recordFailure(ctx, subjectRendition, rendition.ID, account, err)
	}
	s.resolveAndStoreContentURL(ctx, adapter, token, account, &rendition)
	values, err := adapter.FetchContentAnalytics(ctx, token, platform.ContentAnalyticsRequest{
		AccountID:     account.AccountID,
		ExternalIDs:   externalIDs,
		Profile:       rendition.Profile,
		OutputProfile: rendition.OutputProfile,
		PublishedAt:   publishedAt,
		GrantedScopes: strings.Fields(account.GrantedScopes),
		OwnReplyCount: max(0, len(externalIDs)-1),
	})
	if err != nil {
		return s.recordFailure(ctx, subjectRendition, rendition.ID, account, err)
	}
	return s.recordSuccess(ctx, subjectRendition, rendition.ID, account, rendition.PublicationID, rendition.ID, values, contentCadence(s.now().Sub(publishedAt)))
}

func (s *Service) resolveAndStoreContentURL(
	ctx context.Context,
	adapter platform.AnalyticsAdapter,
	accessToken string,
	account models.SocialAccount,
	rendition *models.Rendition,
) {
	if platform.IsSafeContentURL(rendition.ExternalURL) {
		return
	}
	resolved := platform.DeterministicContentURL(
		account.Platform,
		account.AccountID,
		account.AccountUsername,
		account.InstanceURL,
		rendition.ExternalID,
	)
	if resolved == "" {
		resolver, ok := adapter.(platform.ContentURLResolver)
		if !ok {
			return
		}
		var err error
		resolved, err = resolver.ResolveContentURL(
			ctx,
			accessToken,
			account.AccountID,
			rendition.ExternalID,
		)
		if err != nil {
			return
		}
	}
	if !platform.IsSafeContentURL(resolved) {
		return
	}
	if _, err := s.db.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("external_url = ?", resolved).
		Where("id = ?", rendition.ID).
		Exec(ctx); err == nil {
		rendition.ExternalURL = resolved
	}
}

func (s *Service) recordSuccess(
	ctx context.Context,
	subjectType, subjectID string,
	account models.SocialAccount,
	publicationID, renditionID string,
	values platform.AnalyticsValues,
	baseCadence time.Duration,
) error {
	if values == nil {
		values = platform.AnalyticsValues{}
	}
	metricsJSON, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("encode analytics values: %w", err)
	}
	now := s.now()
	state, err := s.loadState(ctx, subjectType, subjectID)
	if err != nil {
		return fmt.Errorf("load analytics sync state: %w", err)
	}
	unchanged := state != nil && state.MetricsJSON == string(metricsJSON)
	streak := 0
	if unchanged {
		streak = state.UnchangedStreak + 1
	}
	multiplier := 1 << min(streak, 3)
	nextSyncAt := time.Time{}
	if baseCadence > 0 {
		nextSyncAt = now.Add(baseCadence * time.Duration(multiplier))
	}

	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		captureKey := subjectType + ":" + subjectID + ":" + now.Truncate(time.Minute).Format(time.RFC3339)
		if subjectType == subjectAccount {
			snapshot := &models.AnalyticsAccountSnapshot{
				ID:              uuid.NewString(),
				WorkspaceID:     account.WorkspaceID,
				SocialAccountID: account.ID,
				Platform:        account.Platform,
				MetricsJSON:     string(metricsJSON),
				CapturedAt:      now,
				CaptureKey:      captureKey,
			}
			if _, err := tx.NewInsert().Model(snapshot).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
				return fmt.Errorf("store account analytics snapshot: %w", err)
			}
		} else {
			snapshot := &models.AnalyticsRenditionSnapshot{
				ID:              uuid.NewString(),
				WorkspaceID:     account.WorkspaceID,
				PublicationID:   publicationID,
				RenditionID:     renditionID,
				SocialAccountID: account.ID,
				Platform:        account.Platform,
				MetricsJSON:     string(metricsJSON),
				CapturedAt:      now,
				CaptureKey:      captureKey,
			}
			if _, err := tx.NewInsert().Model(snapshot).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
				return fmt.Errorf("store rendition analytics snapshot: %w", err)
			}
		}
		return upsertState(ctx, tx, &models.AnalyticsSyncState{
			ID:              stateID(subjectType, subjectID),
			WorkspaceID:     account.WorkspaceID,
			SubjectType:     subjectType,
			SubjectID:       subjectID,
			SocialAccountID: account.ID,
			Platform:        account.Platform,
			Status:          string(platform.AnalyticsStatusOK),
			MetricsJSON:     string(metricsJSON),
			LastAttemptedAt: now,
			LastSuccessAt:   now,
			NextSyncAt:      nextSyncAt,
			UnchangedStreak: streak,
			CreatedAt:       now,
			UpdatedAt:       now,
		})
	})
}

func (s *Service) recordUnavailable(ctx context.Context, subjectType, subjectID string, account models.SocialAccount, status platform.AnalyticsStatus, code, message string) error {
	now := s.now()
	message = strings.TrimSpace(message)
	state, err := s.loadState(ctx, subjectType, subjectID)
	if err != nil {
		return fmt.Errorf("load unavailable analytics sync state: %w", err)
	}
	if state != nil && state.Status == string(status) && state.ErrorCode == code && state.ErrorMessage == message {
		return nil
	}
	next := time.Time{}
	if status == platform.AnalyticsStatusPermissionRequired {
		next = now.Add(accountCadence)
	}
	metricsJSON := "{}"
	lastSuccessAt := time.Time{}
	unchangedStreak := 0
	if state != nil {
		metricsJSON = state.MetricsJSON
		lastSuccessAt = state.LastSuccessAt
		unchangedStreak = state.UnchangedStreak
	}
	return upsertState(ctx, s.db, &models.AnalyticsSyncState{
		ID:              stateID(subjectType, subjectID),
		WorkspaceID:     account.WorkspaceID,
		SubjectType:     subjectType,
		SubjectID:       subjectID,
		SocialAccountID: account.ID,
		Platform:        account.Platform,
		Status:          string(status),
		ErrorCode:       code,
		ErrorMessage:    message,
		MetricsJSON:     metricsJSON,
		LastAttemptedAt: now,
		LastSuccessAt:   lastSuccessAt,
		NextSyncAt:      next,
		UnchangedStreak: unchangedStreak,
		CreatedAt:       now,
		UpdatedAt:       now,
	})
}

func (s *Service) recordFailure(ctx context.Context, subjectType, subjectID string, account models.SocialAccount, cause error) error {
	status, code, retryAfter := classifyAnalyticsError(cause)
	now := s.now()
	next := now.Add(time.Hour)
	switch status {
	case platform.AnalyticsStatusRateLimited:
		next = now.Add(max(sweepInterval, retryAfter))
	case platform.AnalyticsStatusPermissionRequired:
		next = now.Add(accountCadence)
	case platform.AnalyticsStatusUnsupported, platform.AnalyticsStatusNotFound:
		next = time.Time{}
	}
	state, err := s.loadState(ctx, subjectType, subjectID)
	if err != nil {
		return fmt.Errorf("load failed analytics sync state: %w", err)
	}
	metricsJSON := "{}"
	lastSuccessAt := time.Time{}
	unchangedStreak := 0
	if state != nil {
		metricsJSON = state.MetricsJSON
		lastSuccessAt = state.LastSuccessAt
		unchangedStreak = state.UnchangedStreak
	}
	err = upsertState(ctx, s.db, &models.AnalyticsSyncState{
		ID:              stateID(subjectType, subjectID),
		WorkspaceID:     account.WorkspaceID,
		SubjectType:     subjectType,
		SubjectID:       subjectID,
		SocialAccountID: account.ID,
		Platform:        account.Platform,
		Status:          string(status),
		ErrorCode:       code,
		ErrorMessage:    safeAnalyticsMessage(status),
		MetricsJSON:     metricsJSON,
		LastAttemptedAt: now,
		LastSuccessAt:   lastSuccessAt,
		NextSyncAt:      next,
		UnchangedStreak: unchangedStreak,
		CreatedAt:       now,
		UpdatedAt:       now,
	})
	if err != nil {
		return err
	}
	// Provider failures are persisted with their own retry time. Completing the
	// queue job avoids an immediate generic job retry that could amplify a rate
	// limit or repeatedly call a degraded provider.
	return nil
}

func upsertState(ctx context.Context, db bun.IDB, state *models.AnalyticsSyncState) error {
	_, err := db.NewInsert().
		Model(state).
		On("CONFLICT (id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("subject_type = EXCLUDED.subject_type").
		Set("subject_id = EXCLUDED.subject_id").
		Set("social_account_id = EXCLUDED.social_account_id").
		Set("platform = EXCLUDED.platform").
		Set("status = EXCLUDED.status").
		Set("error_code = EXCLUDED.error_code").
		Set("error_message = EXCLUDED.error_message").
		Set("metrics_json = EXCLUDED.metrics_json").
		Set("last_attempted_at = EXCLUDED.last_attempted_at").
		Set("last_success_at = EXCLUDED.last_success_at").
		Set("next_sync_at = EXCLUDED.next_sync_at").
		Set("unchanged_streak = EXCLUDED.unchanged_streak").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("store analytics sync state: %w", err)
	}
	return nil
}

func (s *Service) subjectDue(ctx context.Context, subjectType, subjectID string, now time.Time) (bool, error) {
	state, err := s.loadState(ctx, subjectType, subjectID)
	if err != nil {
		return false, fmt.Errorf("load analytics due state: %w", err)
	}
	if state == nil {
		return true, nil
	}
	if state.Status == string(platform.AnalyticsStatusPermissionRequired) ||
		state.Status == string(platform.AnalyticsStatusUnsupported) {
		return true, nil
	}
	if state.NextSyncAt.IsZero() {
		return false, nil
	}
	return !state.NextSyncAt.After(now), nil
}

func (s *Service) loadState(ctx context.Context, subjectType, subjectID string) (*models.AnalyticsSyncState, error) {
	var state models.AnalyticsSyncState
	err := s.db.NewSelect().Model(&state).Where("id = ?", stateID(subjectType, subjectID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &state, err
}

func (s *Service) enqueue(ctx context.Context, workspaceID, jobType, payload string, runAt time.Time) (bool, error) {
	job, err := jobregistry.NewJob(jobType, payload, runAt)
	if err != nil {
		return false, err
	}
	var inserted bool
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if workspaceID != "" {
			if err := organizationguard.LockWorkspace(txCtx, tx, workspaceID); err != nil {
				return err
			}
		}
		result, err := tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		inserted = rows > 0
		return err
	})
	if err != nil {
		return false, fmt.Errorf("enqueue %s: %w", jobType, err)
	}
	return inserted, nil
}

func (s *Service) analyticsAdapter(account models.SocialAccount) platform.AnalyticsAdapter {
	key := account.Platform
	if account.Platform == "mastodon" {
		key = "mastodon:" + account.InstanceURL
	}
	s.providersMu.RLock()
	adapter := s.providers[key]
	s.providersMu.RUnlock()
	if adapter == nil {
		return nil
	}
	analyticsAdapter, _ := adapter.(platform.AnalyticsAdapter)
	return analyticsAdapter
}

func analyticsSupportForAccount(adapter platform.AnalyticsAdapter, account models.SocialAccount) platform.AnalyticsSupport {
	if resolver, ok := adapter.(platform.AccountAnalyticsSupportResolver); ok {
		return resolver.AnalyticsSupportForAccount(platform.AnalyticsAccountContext{
			AccountID:       account.AccountID,
			GrantedScopes:   account.GrantedScopes,
			CapabilityState: analyticsCapabilityState(account.CapabilityState),
		})
	}
	return adapter.AnalyticsSupport()
}

func analyticsCapabilityState(raw string) map[string]string {
	state := map[string]string{}
	if json.Unmarshal([]byte(raw), &state) != nil {
		return map[string]string{}
	}
	return state
}

// resolveRenditionAnalyticsAccount preserves analytics continuity for
// historical renditions created before an OAuth reconnect. Current reconnects
// reuse the provider identity, but older installations may contain an inactive
// row and a newer active row for the same remote account.
func (s *Service) resolveRenditionAnalyticsAccount(ctx context.Context, accountID string) (models.SocialAccount, error) {
	var original models.SocialAccount
	if err := s.db.NewSelect().Model(&original).Where("id = ?", accountID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.SocialAccount{}, nil
		}
		return models.SocialAccount{}, fmt.Errorf("load rendition analytics account: %w", err)
	}
	if original.IsActive {
		return original, nil
	}

	query := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", original.WorkspaceID).
		Where("platform = ?", original.Platform).
		Where("account_id = ?", original.AccountID).
		Where("is_active = ?", true).
		Order("created_at DESC").
		Limit(1)
	if original.Platform == "mastodon" {
		query = query.Where("instance_url = ?", original.InstanceURL)
	}
	var replacement models.SocialAccount
	if err := query.Scan(ctx, &replacement); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.SocialAccount{}, nil
		}
		return models.SocialAccount{}, fmt.Errorf("load replacement analytics account: %w", err)
	}
	return replacement, nil
}

func (s *Service) accessToken(ctx context.Context, accountID string) (string, error) {
	if s.tokenSource == nil {
		return "", fmt.Errorf("analytics token service is unavailable")
	}
	return s.tokenSource.GetValidAccessToken(ctx, accountID)
}

func (s *Service) renditionExternalIDs(ctx context.Context, rendition models.Rendition) ([]string, error) {
	ids := []string{rendition.ExternalID}
	var segments []models.RenditionSegment
	if err := s.db.NewSelect().
		Model(&segments).
		Where("rendition_id = ? AND status = ?", rendition.ID, models.RenditionStatusPublished).
		Order("position ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list rendition analytics segments: %w", err)
	}
	for _, segment := range segments {
		ids = append(ids, segment.ExternalID)
	}
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}

func (s *Service) renditionPublishedAt(ctx context.Context, publicationID string) (time.Time, error) {
	var publication models.Publication
	if err := s.db.NewSelect().Model(&publication).Column("actual_run_at", "updated_at").Where("id = ?", publicationID).Scan(ctx); err != nil {
		return time.Time{}, fmt.Errorf("load analytics publication time: %w", err)
	}
	if !publication.ActualRunAt.IsZero() {
		return publication.ActualRunAt.UTC(), nil
	}
	return publication.UpdatedAt.UTC(), nil
}

func stateID(subjectType, subjectID string) string {
	return subjectType + ":" + subjectID
}

func contentCadence(age time.Duration) time.Duration {
	switch {
	case age < 0:
		return time.Hour
	case age < 6*time.Hour:
		return time.Hour
	case age < 24*time.Hour:
		return 3 * time.Hour
	case age < 72*time.Hour:
		return 12 * time.Hour
	case age < 7*24*time.Hour:
		return 24 * time.Hour
	default:
		return 0
	}
}

func classifyAnalyticsError(err error) (platform.AnalyticsStatus, string, time.Duration) {
	var analyticsErr *platform.AnalyticsError
	if errors.As(err, &analyticsErr) {
		return analyticsErr.Status, analyticsErr.Code, analyticsErr.RetryAfter
	}
	var httpErr *platform.HTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return platform.AnalyticsStatusPermissionRequired, httpErr.Code, httpErr.RetryAfter
		case http.StatusNotFound, http.StatusGone:
			return platform.AnalyticsStatusNotFound, httpErr.Code, httpErr.RetryAfter
		case http.StatusTooManyRequests:
			return platform.AnalyticsStatusRateLimited, httpErr.Code, httpErr.RetryAfter
		}
		return platform.AnalyticsStatusFailed, httpErr.Code, httpErr.RetryAfter
	}
	return platform.AnalyticsStatusFailed, "provider_request_failed", 0
}

func safeAnalyticsMessage(status platform.AnalyticsStatus) string {
	switch status {
	case platform.AnalyticsStatusPermissionRequired:
		return "Reconnect this account to grant analytics access."
	case platform.AnalyticsStatusRateLimited:
		return "The provider rate limit delayed analytics collection."
	case platform.AnalyticsStatusNotFound:
		return "The provider no longer returns this content."
	case platform.AnalyticsStatusUnsupported:
		return "Analytics are not available for this account."
	default:
		return "Analytics collection failed and will be retried."
	}
}

func missingScopeMessage(scopes []string) string {
	return "Reconnect this account to grant: " + strings.Join(scopes, ", ") + "."
}
