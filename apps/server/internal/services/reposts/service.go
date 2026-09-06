package reposts

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Service struct {
	db          *bun.DB
	tokenSource TokenSource
	lifecycle   *lifecycle.Service
	usage       *usage.Service
	quota       entitlements.Service
	providersMu sync.RWMutex
	providers   map[string]platform.Adapter
}

func NewService(db *bun.DB, tokenSource TokenSource) *Service {
	return &Service{
		db:          db,
		tokenSource: tokenSource,
		lifecycle:   lifecycle.NewService(db),
		usage:       usage.NewService(db),
		quota:       entitlements.NewSelfHostedService(),
		providers:   make(map[string]platform.Adapter),
	}
}

func (s *Service) SetUsage(service *usage.Service) {
	if service != nil {
		s.usage = service
	}
}

func (s *Service) SetEntitlement(service entitlements.Service) {
	if service != nil {
		s.quota = service
	}
}

func (s *Service) checkProviderWriteQuota(ctx context.Context, workspaceID string) (bool, string, error) {
	if s.quota == nil || s.usage == nil || workspaceID == "" {
		return true, "", nil
	}
	current, err := s.usage.CurrentMonthly(ctx, workspaceID, entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	if err != nil {
		return false, "", fmt.Errorf("load repost provider-write usage: %w", err)
	}
	decision, err := s.quota.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       entitlements.LimitProviderWriteCallsMonthly,
		Current:     current,
		Amount:      1,
	})
	if err != nil {
		return false, "", fmt.Errorf("check repost provider-write quota: %w", err)
	}
	return decision.Allowed, decision.Reason, nil
}

func (s *Service) recordProviderWrite(ctx context.Context, workspaceID string) {
	if s.usage == nil || workspaceID == "" {
		return
	}
	if _, err := s.usage.IncrementMonthly(ctx, workspaceID, entitlements.LimitProviderWriteCallsMonthly, 1, time.Now().UTC()); err != nil {
		log.Printf("[Reposts] failed to record provider-write usage for workspace %s: %v", workspaceID, err)
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}
