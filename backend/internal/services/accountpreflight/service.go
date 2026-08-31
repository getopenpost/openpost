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
	if profile == nil {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unknown", false)
	}
	return s.recordCheck(ctx, candidate.SocialAccountID, now, "", true)
}

func (s *Service) provider(candidate upcomingCandidate) platform.Adapter {
	key := candidate.Platform
	if candidate.Platform == "mastodon" {
		key = "mastodon:" + candidate.InstanceURL
	}
	s.providersMu.RLock()
	defer s.providersMu.RUnlock()
	return s.providers[key]
}

func (s *Service) handleFailure(ctx context.Context, candidate upcomingCandidate, now time.Time, err error) error {
	failure, confirmed := confirmedUserActionFailure(err)
	if !confirmed {
		return s.recordCheck(ctx, candidate.SocialAccountID, now, "unknown", false)
	}
	if updateErr := s.recordCheck(ctx, candidate.SocialAccountID, now, failure, false); updateErr != nil {
		return updateErr
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

func (s *Service) recordCheck(ctx context.Context, accountID string, now time.Time, failure string, success bool) error {
	query := s.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("preflight_checked_at = ?", now).
		Set("preflight_failure = ?", failure).
		Where("id = ?", accountID)
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
	if strings.Contains(message, "account is disconnected") || strings.Contains(message, "oauth grant is revoked") {
		return "authentication", true
	}
	return "", false
}
