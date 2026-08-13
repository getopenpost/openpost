package publisher

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/usage"
)

type jobExecutionContextKey struct{}

type jobExecution struct {
	ID       string
	Attempt  int
	LockedAt time.Time
}

type providerCostReservation struct {
	enabled      bool
	operationKey string
}

var xProviderURLPattern = regexp.MustCompile(
	`(?i)(?:https?://|www\.)[^\s<>{}\[\]"']+|(?:^|[\s(])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?:[/?#][^\s<>{}\[\]"']*)?`,
)

func WithJobExecution(ctx context.Context, jobID string, attempt int, lockedAt time.Time) context.Context {
	ctx = context.WithValue(ctx, jobExecutionContextKey{}, jobExecution{
		ID:       strings.TrimSpace(jobID),
		Attempt:  attempt,
		LockedAt: lockedAt.UTC(),
	})
	return providerwrite.WithJobExecution(ctx, jobID, attempt, lockedAt)
}

func (s *Service) reserveProviderPublishCost(
	ctx context.Context,
	workspaceID, providerName, subject, phase string,
	req *platform.PublishRequest,
) (providerCostReservation, error) {
	if s == nil || s.usage == nil {
		return providerCostReservation{}, nil
	}
	operation := usage.XOperationPostCreate
	if req != nil && xProviderURLPattern.MatchString(platform.ContentWithSettingURL(req.Content, req.Settings)) {
		operation = usage.XOperationPostCreateWithURL
	}
	operationKey := providerCostOperationKey(ctx, workspaceID, providerName, subject, phase)
	result, err := s.usage.ReserveProviderCost(ctx, usage.ProviderCostEventInput{
		WorkspaceID:  workspaceID,
		Provider:     providerName,
		Operation:    operation,
		OperationKey: operationKey,
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	if err != nil {
		return providerCostReservation{}, fmt.Errorf("reserving hosted provider cost: %w", err)
	}
	return providerCostReservation{enabled: result.Enabled, operationKey: operationKey}, nil
}

func (s *Service) settleProviderPublishCost(
	ctx context.Context,
	reservation providerCostReservation,
	publishErr error,
) {
	if !reservation.enabled || s == nil || s.usage == nil {
		return
	}

	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	var err error
	switch {
	case publishErr == nil:
		_, err = s.usage.ConfirmProviderCost(settleCtx, reservation.operationKey)
	case isDefiniteUnbilledProviderFailure(publishErr):
		err = s.usage.ReleaseProviderCost(settleCtx, reservation.operationKey)
	default:
		err = s.usage.MarkProviderCostUnknown(settleCtx, reservation.operationKey)
	}
	if err != nil {
		// Metering settlement must not turn a confirmed provider success into a
		// retryable publish. The durable reservation remains conservative and
		// startup reconciliation keeps it visible as unresolved exposure.
		log.Printf("[Publisher] hosted provider cost settlement failed: %v", err)
		if publishErr == nil {
			_ = s.usage.MarkProviderCostUnknown(settleCtx, reservation.operationKey)
		}
	}
}

func isDefiniteUnbilledProviderFailure(err error) bool {
	var providerErr *platform.HTTPError
	return errors.As(err, &providerErr)
}

func providerCostOperationKey(ctx context.Context, workspaceID, providerName, subject, phase string) string {
	execution, _ := ctx.Value(jobExecutionContextKey{}).(jobExecution)
	seed := strings.Join([]string{
		workspaceID,
		providerName,
		execution.ID,
		strconv.Itoa(execution.Attempt),
		execution.LockedAt.Format(time.RFC3339Nano),
		subject,
		phase,
	}, "\x00")
	digest := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(digest[:])
}
