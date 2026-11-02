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
)

type TokenSource interface {
	GetValidAccessToken(context.Context, string) (string, error)
}

type NotificationRecorder interface {
	Record(context.Context, notifications.Outcome) error
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
	seen := make(map[string]struct{}, len(candidates))
	var checkErr error
	for _, candidate := range candidates {
		if _, ok := seen[candidate.SocialAccountID]; ok {
			continue
		}
		seen[candidate.SocialAccountID] = struct{}{}
		if !candidate.PreflightCheckedAt.IsZero() && candidate.PreflightCheckedAt.After(now.Add(-checkCadence)) {
			continue
		}
		if err := s.checkCandidate(ctx, candidate, now); err != nil {
			checkErr = errors.Join(checkErr, err)
		}
	}
	return checkErr
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

func (s *Service) upcomingCandidates(ctx context.Context, start, end time.Time) ([]upcomingCandidate, error) {
	var candidates []upcomingCandidate
	err := s.db.NewSelect().TableExpr("renditions AS rendition").
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
		ColumnExpr("COALESCE(rendition.schedule_override, publication.actual_run_at, publication.scheduled_at) AS run_at").
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Join("JOIN social_accounts AS account ON account.id = rendition.social_account_id AND account.workspace_id = publication.workspace_id").
		Where("rendition.status = ?", models.RenditionStatusScheduled).
		Where("publication.status = ?", models.PublicationStatusScheduled).
		Where("COALESCE(rendition.schedule_override, publication.actual_run_at, publication.scheduled_at) > ?", start).
		Where("COALESCE(rendition.schedule_override, publication.actual_run_at, publication.scheduled_at) <= ?", end).
		OrderExpr("run_at ASC, publication.id ASC, account.id ASC").
		Scan(ctx, &candidates)
	if err != nil {
		return nil, fmt.Errorf("list upcoming scheduled destinations: %w", err)
	}
	return candidates, nil
}

func (s *Service) checkCandidate(ctx context.Context, candidate upcomingCandidate, now time.Time) error {
	if !candidate.IsActive {
		return s.handleFailure(ctx, candidate, now, fmt.Errorf("account is disconnected"))
	}
	adapter := s.provider(candidate)
	if adapter == nil || s.tokens == nil {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unsupported", false)
	}
	token, err := s.tokens.GetValidAccessToken(ctx, candidate.SocialAccountID)
	if err != nil {
		return s.handleFailure(ctx, candidate, now, err)
	}
	checkCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	profile, err := adapter.GetProfile(checkCtx, token)
	if err != nil {
		return s.handleFailure(ctx, candidate, now, err)
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

func (s *Service) handleFailure(ctx context.Context, candidate upcomingCandidate, now time.Time, err error) error {
	failure, confirmed := confirmedUserActionFailure(err)
	if !confirmed {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unknown", false)
	}
	claimed, claimErr := s.recordConfirmedFailure(ctx, candidate.SocialAccountID, now, failure)
	if claimErr != nil {
		return claimErr
	}
	if claimed {
		if notifyErr := s.recordCredentialFailureTransitions(ctx, candidate); notifyErr != nil {
			return notifyErr
		}
	}
	if s.notifications == nil || strings.TrimSpace(candidate.RecipientUserID) == "" ||
		(!candidate.PreflightWarnedAt.IsZero() && candidate.PreflightWarnedAt.After(now.Add(-warningCooldown))) {
		return nil
	}
	outcome, outcomeErr := notifications.NewAccountNeedsAttentionOutcome(notifications.AccountAttentionFacts{
		RecipientUserID:    candidate.RecipientUserID,
		WorkspaceID:        candidate.WorkspaceID,
		AccountID:          candidate.SocialAccountID,
		PublicationID:      candidate.PublicationID,
		Provider:           candidate.Platform,
		AccountLabel:       firstPreflightValue(candidate.AccountUsername, candidate.ProviderAccountID, candidate.Platform),
		ScheduledAtRisk:    true,
		ScheduleOccurrence: fmt.Sprintf("%d:%s", candidate.PublicationRevision, candidate.RunAt.UTC().Format(time.RFC3339Nano)),
	})
	if outcomeErr != nil {
		return outcomeErr
	}
	if err := s.notifications.Record(ctx, outcome); err != nil {
		return err
	}
	_, err = s.db.NewUpdate().Model((*models.SocialAccount)(nil)).
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

// recordConfirmedFailure stores a confirmed credential failure and claims the
// account's credential failure generation when this check transitions the
// account from healthy or unconfirmed to a confirmed failure. The claim and
// the stored failure state commit atomically, so a concurrent producer cannot
// observe a healthy account and notify the same break twice. A losing caller still
// records the failure state; only the claim winner reports the transition.
// A later successful recordCheck resets preflight_failure, so the next
// failure claims a fresh generation.
func (s *Service) recordConfirmedFailure(ctx context.Context, accountID string, now time.Time, failure string) (bool, error) {
	claimed := false
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		claimed = false
		result, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("credential_failure_generation = credential_failure_generation + 1").
			Where("id = ?", accountID).
			Where("COALESCE(preflight_failure, '') IN ('', 'unknown', 'unsupported')").
			Exec(ctx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		claimed = affected == 1
		return recordCheckWithDB(ctx, tx, accountID, now, failure, false)
	})
	return claimed, err
}

// recordCredentialFailureTransitions reports a claimed healthy-to-failing
// credential transition to the people who can reconnect the account: its
// connector and the active workspace administrators. The existing
// per-publication creator warning is separate and keeps its own cooldown.
func (s *Service) recordCredentialFailureTransitions(ctx context.Context, candidate upcomingCandidate) error {
	if s.notifications == nil {
		return nil
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", candidate.SocialAccountID).Scan(ctx); err != nil {
		return err
	}
	recipients, err := notifications.AccountCredentialFailureRecipients(ctx, s.db, &account)
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
		if err := s.notifications.Record(ctx, outcome); err != nil {
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
