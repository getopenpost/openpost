package publisher

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/usage"
)

var providerContentURLPattern = regexp.MustCompile(`https?://[^\s]+`)

type jobExecutionContextKey struct{}

type jobExecutionContext struct {
	ID      string
	Attempt int
}

// WithJobExecution gives provider-cost events a stable operation key. A stale
// worker replay of the same job attempt records one event, while a scheduled
// retry with an incremented attempt records the new provider request.
func WithJobExecution(ctx context.Context, jobID string, attempt int) context.Context {
	return context.WithValue(ctx, jobExecutionContextKey{}, jobExecutionContext{
		ID:      strings.TrimSpace(jobID),
		Attempt: attempt,
	})
}

func (s *Service) recordProviderPublishCost(
	ctx context.Context,
	workspaceID, providerName, subject, suffix string,
	req *platform.PublishRequest,
) error {
	if s.usage == nil || providerName != usage.ProviderX {
		return nil
	}
	operation := usage.XOperationContentCreate
	if req != nil && providerContentURLPattern.MatchString(req.Content) {
		operation = usage.XOperationContentCreateWithURL
	}
	_, err := s.usage.RecordProviderCost(ctx, usage.ProviderCostEventInput{
		WorkspaceID:  workspaceID,
		Provider:     providerName,
		Operation:    operation,
		OperationKey: providerUsageOperationKey(ctx, providerName, subject, suffix),
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	return err
}

func providerUsageOperationKey(ctx context.Context, providerName, subject, suffix string) string {
	execution, _ := ctx.Value(jobExecutionContextKey{}).(jobExecutionContext)
	parts := []string{
		execution.ID,
		strconv.Itoa(execution.Attempt),
		providerName,
		subject,
		suffix,
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return providerName + ":" + hex.EncodeToString(sum[:])
}
