package postimport

import (
	"context"
	"database/sql"
	"encoding/base64"
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
	"github.com/uptrace/bun"
)

const (
	JobTypeSync = jobregistry.TypePostImportSync

	routineCadence   = 24 * time.Hour
	failureBackoff   = time.Hour
	permissionRetry  = 24 * time.Hour
	watermarkOverlap = time.Minute
	initialItemCap   = 250
	defaultPageSize  = 50
	dueSweepLimit    = 100
)

var ErrAccountNotFound = errors.New("post import account not found")
var ErrInvalidCursor = errors.New("invalid post import cursor")

// Policy is instance-owned rate policy. It is provider-overridable but never
// workspace-controlled. ReadRequestsPerDay counts every listing request that
// reaches the provider. X ships with zero: native X reads stay disabled until
// a metered x_read budget exists.
type Policy struct {
	ReadRequestsPerDay int
	PageSize           int
}

func DefaultPolicy(provider string) Policy {
	policy := Policy{ReadRequestsPerDay: 10, PageSize: defaultPageSize}
	if strings.EqualFold(strings.TrimSpace(provider), "x") {
		policy.ReadRequestsPerDay = 0
	}
	return policy
}

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Service struct {
	db       *bun.DB
	tokens   TokenSource
	now      func() time.Time
	maxPages int

	policiesMu sync.RWMutex
	policies   map[string]Policy
}

func NewService(db *bun.DB, tokens TokenSource) *Service {
	return &Service{
		db:       db,
		tokens:   tokens,
		now:      func() time.Time { return time.Now().UTC() },
		maxPages: 5,
		policies: make(map[string]Policy),
	}
}

func (s *Service) SetPolicy(provider string, policy Policy) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return
	}
	policy.ReadRequestsPerDay = max(0, policy.ReadRequestsPerDay)
	policy.PageSize = min(max(1, policy.PageSize), platform.NativePostMaxPageSize)
	s.policiesMu.Lock()
	s.policies[provider] = policy
	s.policiesMu.Unlock()
}

func (s *Service) policy(provider string) Policy {
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.policiesMu.RLock()
	policy, ok := s.policies[provider]
	s.policiesMu.RUnlock()
	if !ok {
		return DefaultPolicy(provider)
	}
	return policy
}

// Enable opts one account into native-post imports. The watermark is set to
// now, so activation never backfills provider history: only posts published
// after opt-in are importable. It enqueues the first sync job.
func (s *Service) Enable(ctx context.Context, workspaceID, accountID string) (*models.PostImportState, error) {
	now := s.now().UTC()
	account, err := s.loadAccount(ctx, workspaceID, accountID)
	if err != nil {
		return nil, err
	}
	support := platform.NativePostSupportFor(account.Platform)
	if !support.Supported {
		return nil, fmt.Errorf("native post imports are not supported for %s: %s", account.Platform, support.UnavailableReason)
	}
	existing, err := s.Status(ctx, account.WorkspaceID, account.ID)
	if err == nil && existing.Enabled {
		return existing, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("read post import state: %w", err)
	}
	state := &models.PostImportState{
		ID:              uuid.NewString(),
		WorkspaceID:     account.WorkspaceID,
		SocialAccountID: account.ID,
		Platform:        account.Platform,
		Enabled:         true,
		Status:          string(platform.NativePostPartial),
		ImportWatermark: now,
		CycleStartedAt:  now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	mutated := false
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewInsert().Model(state).
			On("CONFLICT (social_account_id) DO UPDATE SET enabled = EXCLUDED.enabled, status = EXCLUDED.status, cursor = '', import_watermark = EXCLUDED.import_watermark, cycle_started_at = EXCLUDED.cycle_started_at, initial_finished_at = NULL, initial_items_seen = 0, failure_code = '', failure_message = '', next_eligible_at = NULL, updated_at = EXCLUDED.updated_at WHERE enabled = FALSE").
			Exec(txCtx)
		if err != nil {
			return fmt.Errorf("enable post import: %w", err)
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("count enabled post import rows: %w", err)
		}
		mutated = rows > 0
		reloaded := &models.PostImportState{}
		if err := tx.NewSelect().Model(reloaded).Where("social_account_id = ?", account.ID).Scan(txCtx); err != nil {
			return fmt.Errorf("reload post import state: %w", err)
		}
		*state = *reloaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	if mutated {
		if _, err := s.enqueueSync(ctx, account.WorkspaceID, account.ID, now); err != nil {
			return nil, err
		}
	}
	return state, nil
}

// Disable stops future imports for one account. The imported library stays
// readable; rows are never deleted by disable.
func (s *Service) Disable(ctx context.Context, workspaceID, accountID string) error {
	if _, err := s.loadAccount(ctx, workspaceID, accountID); err != nil {
		return err
	}
	now := s.now().UTC()
	_, err := s.db.NewUpdate().Model((*models.PostImportState)(nil)).
		Set("enabled = ?", false).
		Set("cursor = ?", "").
		Set("next_eligible_at = ?", nil).
		Set("updated_at = ?", now).
		Where("social_account_id = ?", strings.TrimSpace(accountID)).
		Where("workspace_id = ?", strings.TrimSpace(workspaceID)).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("disable post import: %w", err)
	}
	return nil
}

func (s *Service) Status(ctx context.Context, workspaceID, accountID string) (*models.PostImportState, error) {
	state := &models.PostImportState{}
	err := s.db.NewSelect().Model(state).
		Where("social_account_id = ?", strings.TrimSpace(accountID)).
		Where("workspace_id = ?", strings.TrimSpace(workspaceID)).
		Scan(ctx)
	if err != nil {
		return nil, err
	}
	return state, nil
}

// ListImported serves the imported library from stored rows only. It makes
// no provider calls and never touches analytics tables.
func (s *Service) ListImported(ctx context.Context, workspaceID, accountID string, limit int) ([]models.ImportedPost, error) {
	posts, _, err := s.ListImportedPage(ctx, workspaceID, accountID, "", limit)
	return posts, err
}

type importedPostCursor struct {
	PublishedAt time.Time `json:"published_at"`
	ID          string    `json:"id"`
}

func (s *Service) ListImportedPage(ctx context.Context, workspaceID, accountID, cursor string, limit int) ([]models.ImportedPost, string, error) {
	limit = min(max(1, limit), 100)
	var posts []models.ImportedPost
	query := s.db.NewSelect().Model(&posts).
		Where("workspace_id = ?", strings.TrimSpace(workspaceID)).
		Where("social_account_id = ?", strings.TrimSpace(accountID))
	if cursor != "" {
		payload, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, "", ErrInvalidCursor
		}
		var after importedPostCursor
		if json.Unmarshal(payload, &after) != nil || after.PublishedAt.IsZero() || after.ID == "" {
			return nil, "", ErrInvalidCursor
		}
		query = query.Where("(published_at < ? OR (published_at = ? AND id < ?))", after.PublishedAt, after.PublishedAt, after.ID)
	}
	err := query.Order("published_at DESC", "id DESC").Limit(limit + 1).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, "", fmt.Errorf("list imported posts: %w", err)
	}
	if len(posts) <= limit {
		return posts, "", nil
	}
	posts = posts[:limit]
	last := posts[len(posts)-1]
	payload, err := json.Marshal(importedPostCursor{PublishedAt: last.PublishedAt.UTC(), ID: last.ID})
	if err != nil {
		return nil, "", fmt.Errorf("encode imported post cursor: %w", err)
	}
	return posts, base64.RawURLEncoding.EncodeToString(payload), nil
}

type Overview struct {
	Platform   string
	Support    platform.NativePostSupport
	State      *models.PostImportState
	Posts      []models.ImportedPost
	NextCursor string
}

// ReadOverview serves account import state and stored posts without calling a
// provider. An account that has never opted in has an empty library.
func (s *Service) ReadOverview(ctx context.Context, workspaceID, accountID, cursor string, limit int) (Overview, error) {
	account, err := s.loadAccount(ctx, workspaceID, accountID)
	if err != nil {
		return Overview{}, err
	}
	state, err := s.Status(ctx, workspaceID, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		state = nil
	} else if err != nil {
		return Overview{}, fmt.Errorf("read post import state: %w", err)
	}
	posts, nextCursor, err := s.ListImportedPage(ctx, workspaceID, accountID, cursor, limit)
	if err != nil {
		return Overview{}, err
	}
	return Overview{Platform: account.Platform, Support: platform.NativePostSupportFor(account.Platform), State: state, Posts: posts, NextCursor: nextCursor}, nil
}

// EnqueueDue recovers import work from the stored account checkpoints. It is
// safe to run on every worker: the active-job index admits one job per account.
func (s *Service) EnqueueDue(ctx context.Context) (int, error) {
	now := s.now().UTC()
	var states []models.PostImportState
	if err := s.db.NewSelect().Model(&states).
		Where("enabled = ?", true).
		Where("(next_eligible_at IS NULL OR next_eligible_at <= ?)", now).
		Where("social_account_id IN (SELECT id FROM social_accounts WHERE is_active = ?)", true).
		Where("social_account_id NOT IN (SELECT dedupe_key FROM jobs WHERE type = ? AND status IN (?, ?))", JobTypeSync, jobregistry.StatusPending, jobregistry.StatusProcessing).
		Order("next_eligible_at ASC").
		Limit(dueSweepLimit).
		Scan(ctx); err != nil {
		return 0, fmt.Errorf("list due post imports: %w", err)
	}
	queued := 0
	for _, state := range states {
		inserted, err := s.enqueueSync(ctx, state.WorkspaceID, state.SocialAccountID, now)
		if err != nil {
			return queued, err
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

func (s *Service) loadAccount(ctx context.Context, workspaceID, accountID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	err := s.db.NewSelect().Model(&account).
		Where("id = ? AND is_active = ?", strings.TrimSpace(accountID), true).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return account, ErrAccountNotFound
		}
		return account, fmt.Errorf("load post import account: %w", err)
	}
	if workspaceID != "" && account.WorkspaceID != strings.TrimSpace(workspaceID) {
		return account, ErrAccountNotFound
	}
	return account, nil
}

func (s *Service) loadState(ctx context.Context, accountID string) (*models.PostImportState, error) {
	state := &models.PostImportState{}
	err := s.db.NewSelect().Model(state).
		Where("social_account_id = ?", strings.TrimSpace(accountID)).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load post import state: %w", err)
	}
	return state, nil
}

// SyncAccount runs one bounded import cycle: at most maxPages provider reads,
// each page committed with its checkpoint so a crash resumes from the stored
// cursor on retry without duplicating committed pages.
func (s *Service) SyncAccount(ctx context.Context, workspaceID, accountID string) error {
	now := s.now().UTC()
	prepared, err := s.prepareSync(ctx, workspaceID, accountID, now)
	if err != nil || prepared == nil {
		return err
	}
	cursor := prepared.state.Cursor
	seen := prepared.state.InitialItemsSeen
	for pages := 0; pages < max(1, s.maxPages); pages++ {
		cost := 1
		if estimator, ok := prepared.reader.(platform.NativePostReadEstimator); ok {
			cost = max(1, estimator.NativePostReadCost(platform.NativePostRequest{PageSize: prepared.policy.PageSize}))
		}
		if !s.reserveBudget(prepared.state, prepared.policy.ReadRequestsPerDay, cost, now) {
			if err := s.persistBudget(ctx, prepared.state, now); err != nil {
				return err
			}
			return s.recordOutcome(ctx, prepared.state, platform.NativePostCostLimited,
				"provider_read_budget_exhausted", "The provider read budget for today is exhausted.", nextUTCDay(now), now)
		}
		page, err := prepared.reader.ListNativePosts(ctx, prepared.accessToken, platform.NativePostRequest{
			AccountID:      prepared.account.AccountID,
			AccountHandle:  prepared.account.AccountUsername,
			InstanceURL:    prepared.account.InstanceURL,
			Cursor:         cursor,
			PublishedAfter: prepared.publishedAfter,
			PageSize:       prepared.policy.PageSize,
		})
		if err != nil {
			// The reserved budget stays spent: the provider was called.
			if persistErr := s.persistBudget(ctx, prepared.state, now); persistErr != nil {
				return persistErr
			}
			return s.recordReadFailure(ctx, prepared.state, err, now)
		}
		committed, err := s.commitPage(ctx, prepared.account, prepared.state, filterOwnPosts(page.Items, prepared.ownPostIDs), page.NextCursor, now)
		if err != nil {
			return err
		}
		seen += committed
		prepared.state.InitialItemsSeen = seen
		cursor = page.NextCursor
		if strings.TrimSpace(cursor) == "" {
			return s.finishSync(ctx, prepared.state, coverageStatus(page.Coverage), now)
		}
		if prepared.state.InitialFinishedAt.IsZero() && seen >= initialItemCap {
			return s.finishSync(ctx, prepared.state, platform.NativePostPartial, now)
		}
		prepared.state.Cursor = cursor
		if err := s.saveState(ctx, prepared.state); err != nil {
			return err
		}
	}
	prepared.state.Cursor = cursor
	prepared.state.NextEligibleAt = now.Add(routineCadence)
	prepared.state.LastAttemptedAt = now
	prepared.state.UpdatedAt = now
	return s.saveState(ctx, prepared.state)
}

func (s *Service) finishSync(ctx context.Context, state *models.PostImportState, coverage platform.NativePostStatus, now time.Time) error {
	state.Cursor = ""
	state.InitialFinishedAt = coalesceTime(state.InitialFinishedAt, now)
	state.LastSuccessAt = coalesceTime(state.CycleStartedAt, now)
	state.CycleStartedAt = time.Time{}
	state.Status = string(coverage)
	state.FailureCode = ""
	state.FailureMessage = ""
	state.NextEligibleAt = now.Add(routineCadence)
	state.UpdatedAt = now
	return s.saveState(ctx, state)
}

type syncPreparation struct {
	account        models.SocialAccount
	state          *models.PostImportState
	policy         Policy
	reader         platform.NativePostReader
	accessToken    string
	publishedAfter time.Time
	ownPostIDs     map[string]struct{}
}

// prepareSync resolves the reader, credentials, and window for one import
// cycle. A nil preparation with a nil error means the account is not due;
// every recorded outcome leaves the account connected.
func (s *Service) prepareSync(ctx context.Context, workspaceID, accountID string, now time.Time) (*syncPreparation, error) {
	account, state, policy, proceed, err := s.loadImportEligibility(ctx, workspaceID, accountID, now)
	if err != nil || !proceed {
		return nil, err
	}
	reader, ok := platform.NewNativePostReader(account.Platform, account.InstanceURL)
	if !ok {
		return nil, s.recordOutcome(ctx, state, platform.NativePostUnsupported,
			"native_read_not_supported", "This provider does not expose native post reads in OpenPost.", now.Add(routineCadence), now)
	}
	if s.tokens == nil {
		return nil, s.recordOutcome(ctx, state, platform.NativePostFailed,
			"token_source_missing", "Post imports are not configured on this instance.", now.Add(failureBackoff), now)
	}
	accessToken, err := s.tokens.GetValidAccessToken(ctx, account.ID)
	if err != nil || strings.TrimSpace(accessToken) == "" {
		// A failed token read is recorded on the import checkpoint. The
		// account itself stays connected; imports never disconnect.
		return nil, s.recordOutcome(ctx, state, platform.NativePostPermissionRequired,
			"account_token_unavailable", "Reconnect this account to continue importing native posts.", now.Add(permissionRetry), now)
	}
	publishedAfter := state.ImportWatermark
	if !state.InitialFinishedAt.IsZero() && !state.LastSuccessAt.IsZero() {
		publishedAfter = state.LastSuccessAt.Add(-watermarkOverlap)
	}
	if state.Cursor == "" {
		state.CycleStartedAt = now
	}
	ownPostIDs, err := s.openPostPublishedIDs(ctx, account.ID)
	if err != nil {
		return nil, err
	}
	return &syncPreparation{
		account:        account,
		state:          state,
		policy:         policy,
		reader:         reader,
		accessToken:    accessToken,
		publishedAfter: publishedAfter,
		ownPostIDs:     ownPostIDs,
	}, nil
}

// loadImportEligibility centralizes the import gates: explicit opt-in,
// read-cost policy, provider support, and cadence. Proceed is false when the
// account is not due or when an outcome was already recorded; a recorded
// outcome surfaces as a nil error so the job does not retry a settled state.
func (s *Service) loadImportEligibility(ctx context.Context, workspaceID, accountID string, now time.Time) (models.SocialAccount, *models.PostImportState, Policy, bool, error) {
	account, err := s.loadAccount(ctx, workspaceID, accountID)
	if err != nil {
		return account, nil, Policy{}, false, err
	}
	state, err := s.loadState(ctx, account.ID)
	if err != nil {
		return account, nil, Policy{}, false, err
	}
	if state == nil || !state.Enabled {
		return account, state, Policy{}, false, nil
	}
	policy := s.policy(account.Platform)
	if policy.ReadRequestsPerDay == 0 {
		return account, state, policy, false, s.recordOutcome(ctx, state, platform.NativePostCostLimited,
			"provider_read_budget_disabled", "Native reads are disabled by the provider read-cost policy.", nextUTCDay(now), now)
	}
	support := platform.NativePostSupportFor(account.Platform)
	if !support.Supported {
		reason := strings.TrimSpace(support.UnavailableReason)
		if reason == "" {
			reason = "This provider does not expose native post reads in OpenPost."
		}
		return account, state, policy, false, s.recordOutcome(ctx, state, platform.NativePostUnsupported,
			"native_read_not_supported", boundedOutcomeMessage(reason), now.Add(routineCadence), now)
	}
	if !state.NextEligibleAt.IsZero() && state.NextEligibleAt.After(now) {
		return account, state, policy, false, nil
	}
	if state.Cursor == "" && !state.InitialFinishedAt.IsZero() && state.LastSuccessAt.Add(routineCadence).After(now) {
		return account, state, policy, false, nil
	}
	return account, state, policy, true, nil
}

// filterOwnPosts drops native items OpenPost already published (matched by
// the rendition's provider post ID). This is the loop guard: our own posts
// can never re-enter the library as external rows.
func filterOwnPosts(items []platform.NativePostItem, own map[string]struct{}) []platform.NativePostItem {
	if len(own) == 0 {
		return items
	}
	kept := items[:0]
	for _, item := range items {
		if _, isOwn := own[strings.TrimSpace(item.ProviderPostID)]; isOwn {
			continue
		}
		kept = append(kept, item)
	}
	return kept
}

func (s *Service) openPostPublishedIDs(ctx context.Context, accountID string) (map[string]struct{}, error) {
	var externalIDs []string
	err := s.db.NewSelect().
		Model((*models.Rendition)(nil)).
		Column("external_id").
		Where("social_account_id = ?", accountID).
		Where("external_id <> ''").
		Scan(ctx, &externalIDs)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load published post IDs: %w", err)
	}
	own := make(map[string]struct{}, len(externalIDs))
	for _, id := range externalIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			own[trimmed] = struct{}{}
		}
	}
	return own, nil
}

func (s *Service) commitPage(ctx context.Context, account models.SocialAccount, state *models.PostImportState, items []platform.NativePostItem, nextCursor string, now time.Time) (int, error) {
	committed := 0
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, item := range items {
			row := &models.ImportedPost{
				ID:               uuid.NewString(),
				WorkspaceID:      account.WorkspaceID,
				SocialAccountID:  account.ID,
				Platform:         account.Platform,
				ProviderPostID:   item.ProviderPostID,
				ProviderParentID: item.ProviderParentID,
				Title:            item.Title,
				Text:             item.Text,
				ExternalURL:      item.ExternalURL,
				PublishedAt:      item.PublishedAt.UTC(),
				Origin:           platform.ImportedPostOriginExternal,
				FirstSeenAt:      now,
				LastSeenAt:       now,
				CreatedAt:        now,
				UpdatedAt:        now,
			}
			if _, err := tx.NewInsert().Model(row).
				On("CONFLICT (social_account_id, provider_post_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at").
				Exec(txCtx); err != nil {
				return fmt.Errorf("store imported post: %w", err)
			}
			committed++
		}
		state.Cursor = strings.TrimSpace(nextCursor)
		state.LastAttemptedAt = now
		state.UpdatedAt = now
		if _, err := tx.NewUpdate().Model(state).WherePK().Exec(txCtx); err != nil {
			return fmt.Errorf("checkpoint import cursor: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return committed, nil
}

func (s *Service) reserveBudget(state *models.PostImportState, dailyLimit, cost int, now time.Time) bool {
	if state.ReadBudgetStart.IsZero() || now.Sub(state.ReadBudgetStart.UTC()) >= 24*time.Hour {
		state.ReadBudgetStart = now
		state.ReadBudgetUsed = 0
	}
	if state.ReadBudgetUsed+cost > dailyLimit {
		return false
	}
	state.ReadBudgetUsed += cost
	return true
}

func (s *Service) persistBudget(ctx context.Context, state *models.PostImportState, now time.Time) error {
	state.UpdatedAt = now
	_, err := s.db.NewUpdate().Model(state).
		Set("read_budget_start = ?", state.ReadBudgetStart).
		Set("read_budget_used = ?", state.ReadBudgetUsed).
		Set("updated_at = ?", now).
		WherePK().
		Exec(ctx)
	return err
}

func (s *Service) saveState(ctx context.Context, state *models.PostImportState) error {
	state.UpdatedAt = s.now().UTC()
	_, err := s.db.NewUpdate().Model(state).WherePK().Exec(ctx)
	return err
}

func (s *Service) recordOutcome(ctx context.Context, state *models.PostImportState, status platform.NativePostStatus, code, message string, eligibleAt, now time.Time) error {
	state.Status = string(status)
	state.FailureCode = strings.TrimSpace(code)
	state.FailureMessage = boundedOutcomeMessage(message)
	state.LastAttemptedAt = now
	state.NextEligibleAt = eligibleAt
	state.UpdatedAt = now
	if status == platform.NativePostComplete || status == platform.NativePostPartial {
		state.FailureCode = ""
		state.FailureMessage = ""
	}
	return s.saveState(ctx, state)
}

func (s *Service) recordReadFailure(ctx context.Context, state *models.PostImportState, err error, now time.Time) error {
	var nativeErr *platform.NativePostError
	if errors.As(err, &nativeErr) {
		switch nativeErr.Status {
		case platform.NativePostPermissionRequired:
			return s.recordOutcome(ctx, state, nativeErr.Status, firstNonEmpty(nativeErr.Code, "permission_required"),
				"Reconnect this account to continue importing native posts.", now.Add(permissionRetry), now)
		case platform.NativePostRateLimited:
			retryAfter := max(nativeErr.RetryAfter, time.Minute)
			return s.recordOutcome(ctx, state, nativeErr.Status, firstNonEmpty(nativeErr.Code, "rate_limited"),
				"The provider is rate limiting. OpenPost will retry.", now.Add(retryAfter), now)
		case platform.NativePostCostLimited:
			return s.recordOutcome(ctx, state, nativeErr.Status, firstNonEmpty(nativeErr.Code, "cost_limited"),
				"Native reads are disabled by the provider read-cost policy.", nextUTCDay(now), now)
		case platform.NativePostUnsupported:
			return s.recordOutcome(ctx, state, nativeErr.Status, firstNonEmpty(nativeErr.Code, "native_read_not_supported"),
				"This provider does not expose native post reads in OpenPost.", now.Add(routineCadence), now)
		default:
			return s.recordOutcome(ctx, state, platform.NativePostFailed, firstNonEmpty(nativeErr.Code, "provider_error"),
				"The provider is temporarily unavailable. OpenPost will retry.", now.Add(failureBackoff), now)
		}
	}
	return s.recordOutcome(ctx, state, platform.NativePostFailed, "provider_error",
		"The provider is temporarily unavailable. OpenPost will retry.", now.Add(failureBackoff), now)
}

func (s *Service) enqueueSync(ctx context.Context, workspaceID, accountID string, now time.Time) (bool, error) {
	payload := fmt.Sprintf(`{"workspace_id":%q,"social_account_id":%q}`, workspaceID, accountID)
	job, err := jobregistry.NewJob(JobTypeSync, payload, now)
	if err != nil {
		return false, err
	}
	job.ScopeID = workspaceID
	job.DedupeKey = accountID
	result, err := s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("enqueue post import sync: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func nextUTCDay(now time.Time) time.Time {
	next := now.UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	if !next.After(now.UTC()) {
		return now.UTC().Add(time.Minute)
	}
	return next
}

func coverageStatus(status platform.NativePostStatus) platform.NativePostStatus {
	switch status {
	case platform.NativePostComplete, platform.NativePostPartial:
		return status
	default:
		return platform.NativePostPartial
	}
}

func boundedOutcomeMessage(message string) string {
	const limit = 500
	runes := []rune(strings.TrimSpace(message))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func coalesceTime(primary, fallback time.Time) time.Time {
	if !primary.IsZero() {
		return primary
	}
	return fallback
}
