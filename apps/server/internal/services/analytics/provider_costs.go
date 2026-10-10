package analytics

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/usage"
)

// Reserve the full requested resource count before I/O. Partial responses and
// transport failures retain conservative exposure; provider invoices remain
// authoritative. We do not assume X's owner discount or best-effort daily dedup.
func (s *Service) reserveAnalyticsReadCost(ctx context.Context, account models.SocialAccount, operation string, units int64) (func(error), error) {
	if account.Platform != "x" || s.usage == nil {
		return func(error) {}, nil
	}
	key := "analytics:" + uuid.NewString()
	reserved, err := s.usage.ReserveProviderCost(ctx, usage.ProviderCostEventInput{WorkspaceID: account.WorkspaceID, Provider: usage.ProviderX, Operation: operation, OperationKey: key, Units: units, OccurredAt: s.now()})
	if errors.Is(err, usage.ErrProviderCostBudgetExceeded) {
		return nil, &platform.AnalyticsError{Status: platform.AnalyticsStatusRateLimited, Code: "provider_budget_exceeded", RetryAfter: 24 * time.Hour}
	}
	if err != nil {
		return nil, err
	}
	return func(readErr error) {
		if !reserved.Enabled {
			return
		}
		settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		var settleErr error
		var httpErr *platform.HTTPError
		var analyticsErr *platform.AnalyticsError
		switch {
		case readErr == nil:
			_, settleErr = s.usage.ConfirmProviderCost(settleCtx, key)
		case errors.As(readErr, &httpErr) && httpErr.StatusCode >= http.StatusBadRequest && httpErr.StatusCode < http.StatusInternalServerError:
			settleErr = s.usage.ReleaseProviderCost(settleCtx, key)
		case errors.As(readErr, &analyticsErr) && analyticsErr.Code == "credits_depleted":
			settleErr = s.usage.ReleaseProviderCost(settleCtx, key)
		default:
			settleErr = s.usage.MarkProviderCostUnknown(settleCtx, key)
		}
		if settleErr != nil {
			log.Printf("[Analytics] provider cost settlement failed: %v", settleErr)
		}
	}, nil
}
