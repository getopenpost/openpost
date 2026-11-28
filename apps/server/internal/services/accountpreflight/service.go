package accountpreflight

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

const (
	JobType = jobregistry.TypeScheduledAccountCheck

	upcomingWindow  = 2 * time.Hour
	checkCadence    = 15 * time.Minute
	warningCooldown = 6 * time.Hour
	requestTimeout  = 10 * time.Second
	// accountsPerRun bounds provider profile checks per job so a burst of
	// upcoming schedules cannot hold the worker for minutes. Accounts with
	// the soonest scheduled destination are checked first; the rest follow
	// on later runs.
	accountsPerRun = 100
)

type TokenSource interface {
	GetValidAccessToken(context.Context, string) (string, error)
}

// NotificationRecorder stores typed outcomes atomically with the state change
// that produced them.
type NotificationRecorder interface {
	RecordWithDB(context.Context, bun.IDB, notifications.Outcome) error
}

type Service struct {
	db            *bun.DB
	tokens        TokenSource
	notifications NotificationRecorder
	now           func() time.Time
	providersMu   sync.RWMutex
	providers     map[string]platform.Adapter
}

func NewService(db *bun.DB, tokens TokenSource, notificationRecorder NotificationRecorder) *Service {
	return &Service{
		db: db, tokens: tokens, notifications: notificationRecorder,
		now: func() time.Time { return time.Now().UTC() }, providers: make(map[string]platform.Adapter),
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}

func (s *Service) Schedule(ctx context.Context, runAt time.Time) error {
	job, err := jobregistry.NewJob(JobType, `{}`, runAt)
	if err != nil {
		return err
	}
	job.ScopeID = "system"
	job.DedupeKey = "upcoming-destinations"
	_, err = s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (s *Service) HandleJob(ctx context.Context, jobType string) error {
	if jobType != JobType {
		return fmt.Errorf("unsupported scheduled account preflight job type %q", jobType)
	}
	now := s.now()
	candidates, err := s.upcomingCandidates(ctx, now, now.Add(upcomingWindow))
	if err != nil {
		return err
	}
	var checkErr error
	for _, group := range groupByAccount(candidates) {
		if err := s.checkAccount(ctx, group, now); err != nil {
			checkErr = errors.Join(checkErr, err)
		}
	}
	return checkErr
}

// groupByAccount collects every upcoming destination of an account, keeping
// the soonest-first order of both accounts and their publications. One
// provider check then covers every publication that depends on the account.
func groupByAccount(candidates []upcomingCandidate) [][]upcomingCandidate {
	index := make(map[string]int, len(candidates))
	var groups [][]upcomingCandidate
	for _, candidate := range candidates {
		position, ok := index[candidate.SocialAccountID]
		if !ok {
			position = len(groups)
			index[candidate.SocialAccountID] = position
			groups = append(groups, nil)
		}
		groups[position] = append(groups[position], candidate)
	}
	return groups
}

type upcomingCandidate struct {
	SocialAccountID     string    `bun:"social_account_id"`
	WorkspaceID         string    `bun:"workspace_id"`
	Platform            string    `bun:"platform"`
	ProviderAccountID   string    `bun:"provider_account_id"`
	AccountUsername     string    `bun:"account_username"`
	InstanceURL         string    `bun:"instance_url"`
	CapabilityState     string    `bun:"capability_state"`
	PublicationID       string    `bun:"publication_id"`
	PublicationRevision int       `bun:"publication_revision"`
	RecipientUserID     string    `bun:"recipient_user_id"`
	RunAt               time.Time `bun:"run_at"`
	PreflightCheckedAt  time.Time `bun:"preflight_checked_at"`
	PreflightWarnedAt   time.Time `bun:"preflight_warned_at"`
	IsActive            bool      `bun:"is_active"`
}

const upcomingRunAt = "COALESCE(rendition.schedule_override, publication.actual_run_at, publication.scheduled_at)"

// upcomingDestinations selects scheduled destinations in the window whose
// account is due for a check.
func (s *Service) upcomingDestinations(start, end time.Time) *bun.SelectQuery {
	return s.db.NewSelect().TableExpr("renditions AS rendition").
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Join("JOIN social_accounts AS account ON account.id = rendition.social_account_id AND account.workspace_id = publication.workspace_id").
		Where("rendition.status = ?", models.RenditionStatusScheduled).
		Where("publication.status = ?", models.PublicationStatusScheduled).
		Where(upcomingRunAt+" > ?", start).
		Where(upcomingRunAt+" <= ?", end).
		Where("(account.preflight_checked_at IS NULL OR account.preflight_checked_at <= ?)", start.Add(-checkCadence))
}

func (s *Service) upcomingCandidates(ctx context.Context, start, end time.Time) ([]upcomingCandidate, error) {
	var accountIDs []string
	if err := s.upcomingDestinations(start, end).
		ColumnExpr("account.id").
		GroupExpr("account.id").
		OrderExpr("MIN("+upcomingRunAt+") ASC, account.id ASC").
		Limit(accountsPerRun).
		Scan(ctx, &accountIDs); err != nil {
		return nil, fmt.Errorf("list upcoming scheduled accounts: %w", err)
	}
	if len(accountIDs) == 0 {
		return nil, nil
	}
	var candidates []upcomingCandidate
	err := s.upcomingDestinations(start, end).
		ColumnExpr("account.id AS social_account_id").
		ColumnExpr("account.workspace_id AS workspace_id").
		ColumnExpr("account.platform AS platform").
		ColumnExpr("account.account_id AS provider_account_id").
		ColumnExpr("account.account_username AS account_username").
		ColumnExpr("account.instance_url AS instance_url").
		ColumnExpr("account.capability_state_json AS capability_state").
		ColumnExpr("account.preflight_checked_at AS preflight_checked_at").
		ColumnExpr("account.preflight_warned_at AS preflight_warned_at").
		ColumnExpr("account.is_active AS is_active").
		ColumnExpr("publication.id AS publication_id").
		ColumnExpr("publication.revision AS publication_revision").
		ColumnExpr("publication.created_by AS recipient_user_id").
		ColumnExpr(upcomingRunAt+" AS run_at").
		Where("account.id IN (?)", bun.List(accountIDs)).
		OrderExpr("run_at ASC, publication.id ASC, account.id ASC").
		Scan(ctx, &candidates)
	if err != nil {
		return nil, fmt.Errorf("list upcoming scheduled destinations: %w", err)
	}
	return candidates, nil
}

// checkAccount checks one account once and reports a confirmed failure to
// every publication in the group that depends on it.
func (s *Service) checkAccount(ctx context.Context, group []upcomingCandidate, now time.Time) error {
	candidate := group[0]
	if !candidate.IsActive {
		return s.handleFailure(ctx, group, now, fmt.Errorf("account is disconnected"))
	}
	adapter := s.provider(candidate)
	if adapter == nil || s.tokens == nil {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unsupported", false)
	}
	token, err := s.tokens.GetValidAccessToken(ctx, candidate.SocialAccountID)
	if err != nil {
		return s.handleFailure(ctx, group, now, err)
	}
	checkCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	profile, err := adapter.GetProfile(checkCtx, token)
	if err != nil {
		return s.handleFailure(ctx, group, now, err)
	}
	if profile == nil || strings.TrimSpace(profile.ID) == "" {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unknown", false)
	}
	return s.recordCheck(ctx, candidate.SocialAccountID, now, "", true)
}

// provider resolves the adapter registered for the candidate's
// account-specific provider key, or nil when none matches.
func (s *Service) provider(candidate upcomingCandidate) platform.Adapter {
	key := platform.AccountProviderKey(candidate.Platform, candidate.InstanceURL, candidate.CapabilityState)
	s.providersMu.RLock()
	defer s.providersMu.RUnlock()
	return s.providers[key]
}

func (s *Service) handleFailure(ctx context.Context, group []upcomingCandidate, now time.Time, err error) error {
	candidate := group[0]
	failure, confirmed := confirmedUserActionFailure(err)
	if !confirmed {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unknown", false)
	}
	warnCreators := s.notifications != nil &&
		(candidate.PreflightWarnedAt.IsZero() || !candidate.PreflightWarnedAt.After(now.Add(-warningCooldown)))
	return s.recordConfirmedFailure(ctx, group, now, failure, warnCreators)
}

// warnScheduledCreatorsWithDB tells the creator of every at-risk publication in
// the group inside the caller's transaction so a transient persistence error
// rolls back preflight_checked_at and keeps the warnings immediately retryable.
func (s *Service) warnScheduledCreatorsWithDB(ctx context.Context, tx bun.Tx, group []upcomingCandidate, now time.Time) error {
	candidate := group[0]
	warned := make(map[string]struct{}, len(group))
	for _, destination := range group {
		if strings.TrimSpace(destination.RecipientUserID) == "" {
			continue
		}
		occurrence := fmt.Sprintf("%d:%s", destination.PublicationRevision, destination.RunAt.UTC().Format(time.RFC3339Nano))
		key := destination.PublicationID + "\x00" + occurrence
		if _, ok := warned[key]; ok {
			continue
		}
		warned[key] = struct{}{}
		outcome, err := notifications.NewAccountNeedsAttentionOutcome(notifications.AccountAttentionFacts{
			RecipientUserID:    destination.RecipientUserID,
			WorkspaceID:        destination.WorkspaceID,
			AccountID:          destination.SocialAccountID,
			PublicationID:      destination.PublicationID,
			Provider:           destination.Platform,
			AccountLabel:       firstPreflightValue(destination.AccountUsername, destination.ProviderAccountID, destination.Platform),
			ScheduledAtRisk:    true,
			ScheduleOccurrence: occurrence,
		})
		if err != nil {
			return err
		}
		if err := s.notifications.RecordWithDB(ctx, tx, outcome); err != nil {
			return err
		}
	}
	if len(warned) == 0 {
		return nil
	}
	_, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("preflight_warned_at = ?", now).
		Where("id = ? AND workspace_id = ?", candidate.SocialAccountID, candidate.WorkspaceID).
		Exec(ctx)
	return err
}

func firstPreflightValue(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return "Connected account"
}

// recordConfirmedFailure stores a confirmed credential failure, claims the
// account's credential failure generation on healthy-to-failing transitions,
// and records both transition and creator warnings in one transaction so a
// transient DB failure never drops alerts or locks out retries for 15 minutes.
func (s *Service) recordConfirmedFailure(ctx context.Context, group []upcomingCandidate, now time.Time, failure string, warnCreators bool) error {
	candidate := group[0]
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("credential_failure_generation = credential_failure_generation + 1").
			Where("id = ?", candidate.SocialAccountID).
			Where("COALESCE(preflight_failure, '') IN ('', 'unknown', 'unsupported')").
			Exec(ctx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if err := recordCheckWithDB(ctx, tx, candidate.SocialAccountID, now, failure, false); err != nil {
			return err
		}
		if affected == 1 {
			if err := s.recordCredentialFailureTransitions(ctx, tx, candidate); err != nil {
				return err
			}
		}
		if warnCreators {
			return s.warnScheduledCreatorsWithDB(ctx, tx, group, now)
		}
		return nil
	})
}

// recordCredentialFailureTransitions reports a claimed healthy-to-failing
// credential transition to the people who can reconnect the account: its
// connector and the active workspace administrators. The existing
// per-publication creator warning is separate and keeps its own cooldown.
func (s *Service) recordCredentialFailureTransitions(ctx context.Context, db bun.IDB, candidate upcomingCandidate) error {
	if s.notifications == nil {
		return nil
	}
	var account models.SocialAccount
	if err := db.NewSelect().Model(&account).Where("id = ?", candidate.SocialAccountID).Scan(ctx); err != nil {
		return err
	}
	recipients, err := notifications.AccountCredentialFailureRecipients(ctx, db, &account)
	if err != nil {
		return err
	}
	label := firstPreflightValue(candidate.AccountUsername, candidate.ProviderAccountID, candidate.Platform)
	for _, recipientID := range recipients {
		outcome, outcomeErr := notifications.NewAccountCredentialFailureOutcome(notifications.AccountCredentialFailureFacts{
			RecipientUserID: recipientID,
			WorkspaceID:     account.WorkspaceID,
			AccountID:       account.ID,
			Generation:      account.CredentialFailureGeneration,
			Provider:        candidate.Platform,
			AccountLabel:    label,
		})
		if outcomeErr != nil {
			return outcomeErr
		}
		if err := s.notifications.RecordWithDB(ctx, db, outcome); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) recordCheck(ctx context.Context, accountID string, now time.Time, failure string, success bool) error {
	return recordCheckWithDB(ctx, s.db, accountID, now, failure, success)
}

func recordCheckWithDB(ctx context.Context, db bun.IDB, accountID string, now time.Time, failure string, success bool) error {
	query := db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("preflight_checked_at = ?", now).
		Where("id = ?", accountID)
	if !success && (failure == "unknown" || failure == "unsupported") {
		// An inconclusive check cannot heal confirmed broken credentials. Keep
		// that episode claimed until a successful provider check resets it.
		query = query.Set("preflight_failure = CASE WHEN COALESCE(preflight_failure, '') IN ('', 'unknown', 'unsupported') THEN ? ELSE preflight_failure END", failure)
	} else {
		query = query.Set("preflight_failure = ?", failure)
	}
	if success {
		query = query.Set("preflight_success_at = ?", now)
	}
	_, err := query.Exec(ctx)
	return err
}

func confirmedUserActionFailure(err error) (string, bool) {
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) {
		code := strings.ToLower(providerErr.Code)
		// Normalized provider codes name a reconnect or role action even when
		// their HTTP status alone would be inconclusive.
		switch {
		case strings.HasPrefix(code, "meta:missing_page_role:"):
			return "permission", true
		case strings.HasPrefix(code, "meta:checkpoint:"),
			code == "google:invalid_rapt",
			code == "devnull:signature_rejected",
			code == "devnull:key_or_user_unknown":
			return "authentication", true
		}
		switch {
		case providerErr.StatusCode == http.StatusUnauthorized,
			providerErr.Code == "190",
			strings.Contains(code, "token_expired"),
			strings.Contains(code, "invalid_token"),
			strings.Contains(code, "unauthorized"):
			return "authentication", true
		case providerErr.Code == "10",
			providerErr.Code == "200",
			strings.Contains(code, "permission"):
			return "permission", true
		default:
			return "", false
		}
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "account is disconnected") ||
		strings.Contains(message, "token expired for account") ||
		strings.Contains(message, "no refresh token available") ||
		(strings.Contains(message, "oauth grant") && strings.Contains(message, "revoked")) {
		return "authentication", true
	}
	return "", false
}
