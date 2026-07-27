package publisher

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/usage"
)

type jobExecutionContextKey struct{}

type jobExecution struct {
	ID       string
	Attempt  int
	LockedAt time.Time
}

var xProviderURLPattern = regexp.MustCompile(
	`(?i)(?:https?://|www\.)[^\s<>{}\[\]"']+|(?:^|[\s(])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?:[/?#][^\s<>{}\[\]"']*)?`,
)

func WithJobExecution(ctx context.Context, jobID string, attempt int, lockedAt time.Time) context.Context {
	return context.WithValue(ctx, jobExecutionContextKey{}, jobExecution{
		ID:       strings.TrimSpace(jobID),
		Attempt:  attempt,
		LockedAt: lockedAt.UTC(),
	})
}

func (s *Service) recordProviderPublishCost(
	ctx context.Context,
	workspaceID, providerName, subject, phase string,
	req *platform.PublishRequest,
) error {
	if s == nil || s.usage == nil {
		return nil
	}
	operation := usage.XOperationPostCreate
	if req != nil && xProviderURLPattern.MatchString(req.Content) {
		operation = usage.XOperationPostCreateWithURL
	}
	_, err := s.usage.RecordProviderCost(ctx, usage.ProviderCostEventInput{
		WorkspaceID:  workspaceID,
		Provider:     providerName,
		Operation:    operation,
		OperationKey: providerCostOperationKey(ctx, workspaceID, providerName, subject, phase),
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	if err != nil {
		return fmt.Errorf("recording hosted provider cost: %w", err)
	}
	return nil
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
