package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	JobTypeSweep        = jobregistry.TypeMessagingSweep
	JobTypeMessagesSync = jobregistry.TypeMessagesSync
	JobTypeMessageSend  = jobregistry.TypeMessageSend
	sweepInterval       = 5 * time.Minute
)

var (
	ErrAccessDenied = errors.New("workspace access denied")
	ErrNotFound     = errors.New("messaging resource not found")
)

type Actor = workspaceaccess.ActorFacts

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Provider interface {
	platform.MessagingAdapter
}

type FeatureGate interface {
	IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error)
}

type Service struct {
	db            *bun.DB
	tokens        TokenSource
	notifications *notifications.Service
	states        stateRepository
	providersMu   sync.RWMutex
	providers     map[string]Provider
	now           func() time.Time
	featureGate   FeatureGate
}

func NewService(db *bun.DB, tokens TokenSource, notificationService *notifications.Service) *Service {
	return &Service{
		db: db, tokens: tokens, notifications: notificationService,
		states: newStateRepository(db), providers: make(map[string]Provider),
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetProvider(name string, provider Provider) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[strings.ToLower(strings.TrimSpace(name))] = provider
}

func (s *Service) SetFeatureGate(g FeatureGate) {
	s.featureGate = g
}

func (s *Service) isMessagingEnabled(ctx context.Context, accountID string) bool {
	if s.featureGate == nil {
		return false
	}
	enabled, err := s.featureGate.IsEffectiveEnabled(ctx, accountID, "messaging")
	if err != nil {
		return false
	}
	return enabled
}

func (s *Service) provider(account models.SocialAccount) Provider {
	s.providersMu.RLock()
	defer s.providersMu.RUnlock()
	return s.providers[providerKey(account)]
}

func (s *Service) authorize(ctx context.Context, workspaceID string, actor Actor, level workspaceaccess.Level) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	return nil
}

func (s *Service) ScheduleSweep(ctx context.Context, runAt time.Time) error {
	payload, _ := json.Marshal(map[string]string{"scheduled_for": runAt.UTC().Truncate(time.Minute).Format(time.RFC3339)})
	_, err := s.enqueue(ctx, "", JobTypeSweep, string(payload), runAt)
	return err
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	var input subjectJob
	switch jobType {
	case JobTypeSweep:
		return s.handleSweep(ctx)
	case JobTypeMessagesSync, JobTypeMessageSend:
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode messaging job: %w", err)
		}
		if jobType == JobTypeMessagesSync {
			return s.syncMessages(ctx, input.ID)
		}
		return s.sendMessage(ctx, input.ID)
	default:
		return fmt.Errorf("unsupported messaging job type %q", jobType)
	}
}

type subjectJob struct {
	ID string `json:"id"`
}

func (s *Service) handleSweep(ctx context.Context) error {
	var workspaces []string
	if err := s.db.NewSelect().Model((*models.SocialAccount)(nil)).
		ColumnExpr("DISTINCT workspace_id").Where("is_active = ?", true).Scan(ctx, &workspaces); err != nil {
		return err
	}
	for _, workspaceID := range workspaces {
		if _, err := s.refreshWorkspace(ctx, workspaceID, false); err != nil {
			return err
		}
	}
	return s.ScheduleSweep(ctx, s.now().Add(sweepInterval))
}

func (s *Service) RefreshWorkspace(ctx context.Context, actor Actor, workspaceID string, force bool) (int, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return 0, err
	}
	return s.refreshWorkspace(ctx, workspaceID, force)
}

func (s *Service) refreshWorkspace(ctx context.Context, workspaceID string, force bool) (int, error) {
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("workspace_id = ? AND is_active = ?", workspaceID, true).Scan(ctx); err != nil {
		return 0, err
	}
	now := s.now()
	queued := 0
	for _, account := range accounts {
		if !s.isMessagingEnabled(ctx, account.ID) {
			_ = s.states.record(ctx, syncStateUpdate{
				account: account, status: syncStateDisabled,
				failure:     syncStateFailure{code: "opt_in_required", message: "Enable messaging for this account to collect messages."},
				attemptedAt: now,
			})
			continue
		}
		provider := s.provider(account)
		if provider == nil || !provider.MessagingSupport().Enabled {
			continue
		}
		support := provider.MessagingSupport()
		if support.RequiresOptIn && !accountMessagesEnabled(account) {
			_ = s.states.record(ctx, syncStateUpdate{
				account: account, status: syncStateDisabled,
				failure:     syncStateFailure{code: "opt_in_required", message: "Enable inbox sync for this account to collect messages."},
				attemptedAt: now,
			})
			continue
		}
		if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
			_ = s.states.record(ctx, syncStateUpdate{
				account: account, status: syncStatePermissionRequired,
				failure: syncStateFailure{code: "missing_scope", message: "Reconnect this account and grant messaging access."},
				cadence: 24 * time.Hour, attemptedAt: now,
			})
			continue
		}
		if !force && !s.states.due(ctx, account.ID, now) {
			continue
		}
		payload, _ := json.Marshal(subjectJob{ID: account.ID})
		inserted, err := s.enqueue(ctx, workspaceID, JobTypeMessagesSync, string(payload), now)
		if err != nil {
			return queued, err
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

func (s *Service) enqueue(ctx context.Context, workspaceID, jobType, payload string, runAt time.Time) (bool, error) {
	job, err := jobregistry.NewJob(jobType, payload, runAt)
	if err != nil {
		return false, err
	}
	job.ScopeID = workspaceID
	result, err := s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func accountMessagesEnabled(account models.SocialAccount) bool {
	state := map[string]string{}
	return json.Unmarshal([]byte(account.CapabilityState), &state) == nil && state["messages_enabled"] == "true"
}

func providerKey(account models.SocialAccount) string {
	key := strings.ToLower(strings.TrimSpace(account.Platform))
	if key == "mastodon" && strings.TrimSpace(account.InstanceURL) != "" {
		key += ":" + strings.ToLower(strings.TrimSpace(account.InstanceURL))
	}
	return key
}
