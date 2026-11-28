package publisher

import (
	"context"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

func (s *Service) providerUsagePolicy(ctx context.Context, db bun.IDB, workspaceID string, metric entitlements.LimitKey) (entitlements.Decision, error) {
	return entitlements.CheckWithDB(ctx, s.quota, db, entitlements.Request{WorkspaceID: workspaceID, Limit: metric, Amount: 1})
}

func (s *Service) admitProviderUsage(ctx context.Context, workspaceID string, scope providerWriteScope) error {
	if s.quota == nil || s.usage == nil || workspaceID == "" {
		return nil
	}
	// Stored subscriptions always admit inside the locked transaction below, so
	// only the self-hosted shortcut evaluates the policies up front.
	if _, stored := s.quota.(*entitlements.SubscriptionService); !stored {
		calls, err := s.providerUsagePolicy(ctx, s.db, workspaceID, entitlements.LimitProviderWriteCallsMonthly)
		if err != nil {
			return err
		}
		posts := entitlements.Decision{Allowed: true, Unlimited: true}
		if scope.operation == "publish" {
			if posts, err = s.providerUsagePolicy(ctx, s.db, workspaceID, entitlements.LimitPublishedPostsMonthly); err != nil {
				return err
			}
		}
		if calls.Unlimited && posts.Unlimited {
			s.recordUsage(ctx, workspaceID, entitlements.LimitProviderWriteCallsMonthly)
			return nil
		}
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := s.reservePublishedQuota(ctx, tx, workspaceID, scope, now); err != nil {
			return err
		}

		decision, err := s.providerUsagePolicy(ctx, tx, workspaceID, entitlements.LimitProviderWriteCallsMonthly)
		if err != nil {
			return err
		}
		_, err = usage.IncrementMonthlyLimitedInTransaction(ctx, tx, workspaceID, entitlements.LimitProviderWriteCallsMonthly, 1, now, decision)
		return err
	})
}
func (s *Service) reservePublishedQuota(ctx context.Context, db bun.IDB, workspaceID string, scope providerWriteScope, now time.Time) error {
	if scope.operation != "publish" {
		return nil
	}
	decision, err := s.providerUsagePolicy(ctx, db, workspaceID, entitlements.LimitPublishedPostsMonthly)
	if err != nil {
		return err
	}
	if decision.Unlimited {
		return nil
	}
	if err := usage.ReserveMonthlyInTransaction(ctx, db, scope.operationID, workspaceID, entitlements.LimitPublishedPostsMonthly, now, decision); err != nil {
		return fmt.Errorf("published post quota: %w", err)
	}
	return nil
}

func (s *Service) settleProviderUsage(ctx context.Context, workspaceID string, scope providerWriteScope) error {
	if s.quota == nil || s.usage == nil || scope.operation != "publish" {
		return nil
	}
	if _, stored := s.quota.(*entitlements.SubscriptionService); !stored {
		policy, err := s.providerUsagePolicy(ctx, s.db, workspaceID, entitlements.LimitPublishedPostsMonthly)
		if err != nil {
			return err
		}
		if policy.Unlimited {
			return nil
		}
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		var attempts []models.ProviderWriteAttempt
		if err := tx.NewSelect().Model(&attempts).Where("operation_id = ? AND workspace_id = ?", scope.operationID, workspaceID).Scan(ctx); err != nil {
			return err
		}
		accepted, unresolved := false, false
		for _, attempt := range attempts {
			switch attempt.Status {
			case providerwrite.StatusAccepted:
				accepted = true
			case providerwrite.StatusSending, providerwrite.StatusAmbiguous, providerwrite.StatusPrepared:
				unresolved = true
			}
		}
		if !accepted && unresolved {
			return nil
		}
		return usage.SettleMonthlyReservationInTransaction(ctx, tx, scope.operationID, workspaceID, accepted)
	})
}
