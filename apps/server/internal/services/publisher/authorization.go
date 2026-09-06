package publisher

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
)

type publicationAuthorizationPreflight struct {
	BatchID         string
	PublicationID   string
	RenditionID     string
	Action          string
	ScheduledAt     string
	Content         any
	Media           any
	Settings        any
	Explicit        bool
	ReadinessIntent string
}

func (s *Service) preflightPublicationAuthorization(
	ctx context.Context,
	input publicationAuthorizationPreflight,
) ([]models.PublicationAuthorization, error) {
	execution, ok := jobExecutionFromContext(ctx)
	if !ok || strings.TrimSpace(execution.ID) == "" {
		return nil, fmt.Errorf("publication authorization validation required: job identity is missing")
	}
	scheduledAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ScheduledAt))
	if err != nil {
		return nil, fmt.Errorf("publication authorization validation required: invalid scheduled time")
	}
	action := strings.TrimSpace(input.Action)
	if action == "" {
		action = publicationauth.ActionPublish
	}
	intent, err := strictPublisherReadinessIntent(input.ReadinessIntent)
	if err != nil {
		return nil, err
	}
	receipts, err := publicationauth.ValidateBatch(ctx, s.db, publicationauth.ValidateInput{
		BatchID: input.BatchID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, JobID: execution.ID, Action: action,
		Content: input.Content, Media: input.Media, Settings: input.Settings,
		Explicit: input.Explicit, ScheduledAt: scheduledAt, ExecutionIntent: string(intent),
	})
	if err != nil {
		return nil, fmt.Errorf("publication authorization validation failed: %w", err)
	}
	if err := s.revalidateCertificationActor(ctx, receipts, intent); err != nil {
		return nil, err
	}
	return receipts, nil
}

func strictPublisherReadinessIntent(raw string) (providerreadiness.ExecutionIntent, error) {
	switch providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) {
	case "", providerreadiness.ExecutionIntentProduction:
		return providerreadiness.ExecutionIntentProduction, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		return providerreadiness.ExecutionIntentCertificationTest, nil
	default:
		return "", fmt.Errorf("publication authorization validation required: invalid readiness intent")
	}
}

func (s *Service) revalidateCertificationActor(
	ctx context.Context,
	receipts []models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
) error {
	if intent != providerreadiness.ExecutionIntentCertificationTest {
		return nil
	}
	seenUsers := make(map[string]struct{})
	seenTokens := make(map[string]struct{})
	for _, receipt := range receipts {
		if receipt.ExecutionIntent != string(intent) || strings.TrimSpace(receipt.ActorUserID) == "" {
			return fmt.Errorf("publication authorization validation required: certification actor is missing")
		}
		if !validCertificationActorReceipt(receipt) {
			return fmt.Errorf("publication authorization validation required: certification actor origin is not privileged")
		}
		if _, seen := seenUsers[receipt.ActorUserID]; !seen {
			var user models.User
			if err := s.db.NewSelect().Model(&user).
				Where("id = ? AND is_admin = ?", receipt.ActorUserID, true).
				Scan(ctx); err != nil {
				return fmt.Errorf("publication authorization validation required: certification administrator is no longer authorized")
			}
			seenUsers[receipt.ActorUserID] = struct{}{}
		}
		if receipt.ActorTokenID == "" {
			continue
		}
		if _, seen := seenTokens[receipt.ActorTokenID]; seen {
			continue
		}
		var token models.APIToken
		if err := s.db.NewSelect().Model(&token).
			Where("id = ? AND user_id = ?", receipt.ActorTokenID, receipt.ActorUserID).
			Scan(ctx); err != nil || token.WorkspaceID != "" || !token.RevokedAt.IsZero() ||
			(!token.ExpiresAt.IsZero() && !token.ExpiresAt.After(time.Now().UTC())) {
			return fmt.Errorf("publication authorization validation required: certification token is no longer unscoped")
		}
		seenTokens[receipt.ActorTokenID] = struct{}{}
	}
	return nil
}

func validCertificationActorReceipt(receipt models.PublicationAuthorization) bool {
	switch receipt.ActorOrigin {
	case publicationauth.OriginBrowser:
		return receipt.ActorSessionID != "" && receipt.ActorTokenID == ""
	case publicationauth.OriginAPI, publicationauth.OriginCLI:
		return receipt.ActorTokenID != ""
	case publicationauth.OriginMCP:
		return receipt.ActorSessionID != "" || receipt.ActorTokenID != ""
	default:
		return false
	}
}

func jobExecutionFromContext(ctx context.Context) (jobExecution, bool) {
	execution, ok := ctx.Value(jobExecutionContextKey{}).(jobExecution)
	return execution, ok
}
