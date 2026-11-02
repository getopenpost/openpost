package publisher

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
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

func WithJobExecution(ctx context.Context, jobID string, attempt int, lockedAt time.Time, generation ...int64) context.Context {
	ctx = context.WithValue(ctx, jobExecutionContextKey{}, jobExecution{
		ID:       strings.TrimSpace(jobID),
		Attempt:  attempt,
		LockedAt: lockedAt.UTC(),
	})
	return providerwrite.WithJobExecution(ctx, jobID, attempt, lockedAt, generation...)
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

// Each uncached lookup is a new provider request, including retries after an
// ambiguous response. Price all requested users before I/O, as analytics does.
func (s *Service) reserveTaggedUserLookupCost(ctx context.Context, workspaceID string, units int64) (providerCostReservation, error) {
	if s == nil || s.usage == nil {
		return providerCostReservation{}, nil
	}
	key := "tagged-users:" + uuid.NewString()
	result, err := s.usage.ReserveProviderCost(ctx, usage.ProviderCostEventInput{
		WorkspaceID: workspaceID, Provider: usage.ProviderX, Operation: usage.XOperationUserRead,
		OperationKey: key, Units: units, OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		return providerCostReservation{}, fmt.Errorf("reserving hosted user lookup cost: %w", err)
	}
	return providerCostReservation{enabled: result.Enabled, operationKey: key}, nil
}

func (s *Service) settleTaggedUserLookupCost(ctx context.Context, reservation providerCostReservation, lookupErr error) {
	var httpErr *platform.HTTPError
	definiteFailure := errors.As(lookupErr, &httpErr) && httpErr.StatusCode >= http.StatusBadRequest && httpErr.StatusCode < http.StatusInternalServerError
	s.settleProviderCost(ctx, reservation, lookupErr, definiteFailure)
}

func (s *Service) settleProviderPublishCost(
	ctx context.Context,
	reservation providerCostReservation,
	publishErr error,
) {
	s.settleProviderCost(ctx, reservation, publishErr, isDefiniteUnbilledProviderFailure(publishErr))
}

func (s *Service) settleProviderCost(ctx context.Context, reservation providerCostReservation, providerErr error, definiteFailure bool) {
	if !reservation.enabled || s == nil || s.usage == nil {
		return
	}

	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	var err error
	switch {
	case providerErr == nil:
		_, err = s.usage.ConfirmProviderCost(settleCtx, reservation.operationKey)
	case definiteFailure:
		err = s.usage.ReleaseProviderCost(settleCtx, reservation.operationKey)
	default:
		err = s.usage.MarkProviderCostUnknown(settleCtx, reservation.operationKey)
	}
	if err != nil {
		// Metering settlement must not turn a confirmed provider success into a
		// retryable publish. The durable reservation remains conservative and
		// startup reconciliation keeps it visible as unresolved exposure.
		log.Printf("[Publisher] hosted provider cost settlement failed: %v", err)
		if providerErr == nil {
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

// Product quota admission can fail after the cost reservation, before any
// adapter dispatch. Such a request has no uncertain provider outcome.
func (s *Service) releaseUnsentProviderCost(ctx context.Context, reservation providerCostReservation) error {
	if !reservation.enabled || s.usage == nil {
		return nil
	}
	releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return s.usage.ReleaseProviderCost(releaseCtx, reservation.operationKey)
}

// Reserve both the provider cost exposure and product usage before dispatch.
// A product quota denial cannot leave an unsent request recorded as uncertain.
func (s *Service) reserveProviderDispatch(ctx context.Context, workspaceID, providerName, subject, phase string, scope providerWriteScope, req *platform.PublishRequest) (providerCostReservation, error) {
	reservation, err := s.reserveProviderPublishCost(ctx, workspaceID, providerName, subject, phase, req)
	if err != nil {
		return providerCostReservation{}, err
	}
	if err := s.admitProviderUsage(ctx, workspaceID, scope); err != nil {
		return providerCostReservation{}, errors.Join(err, s.releaseUnsentProviderCost(ctx, reservation))
	}
	return reservation, nil
}
