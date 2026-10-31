package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// Outcome is sealed so only notification-owned constructors can create domain
// outcomes. Producers provide semantic facts and cannot select policy or copy.
type Outcome interface {
	notificationOutcome() semanticOutcome
}

type semanticOutcome struct {
	recipientID string
	workspaceID string
	topic       string
	eventID     string
	payload     map[string]any
}

type sealedOutcome struct{ value semanticOutcome }

func (outcome sealedOutcome) notificationOutcome() semanticOutcome { return outcome.value }

type PublicationResultFacts struct {
	RecipientUserID        string
	WorkspaceID            string
	PublicationID          string
	DeliveryID             string
	SuccessfulDestinations []string
	FailedDestinations     []string
	Retryable              bool
	RequiresReconnect      bool
}

func NewPublicationResultOutcome(facts PublicationResultFacts) (Outcome, error) {
	topic := TypePostPublished
	if len(facts.FailedDestinations) > 0 {
		topic = TypePublishFailed
	} else if len(facts.SuccessfulDestinations) == 0 {
		return nil, ErrInvalidOutcome
	}
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID, topic: topic,
		eventID: facts.PublicationID + ":" + facts.DeliveryID,
		payload: map[string]any{
			"publication_id": facts.PublicationID, "successful_destinations": facts.SuccessfulDestinations,
			"failed_destinations": facts.FailedDestinations, "retryable": facts.Retryable,
			"requires_reconnect": facts.RequiresReconnect,
		},
	})
}

type AccountAttentionFacts struct {
	RecipientUserID    string
	WorkspaceID        string
	AccountID          string
	PublicationID      string
	Provider           string
	AccountLabel       string
	ScheduledAtRisk    bool
	ScheduleOccurrence string
}

func NewAccountNeedsAttentionOutcome(facts AccountAttentionFacts) (Outcome, error) {
	eventID := facts.AccountID + ":" + facts.PublicationID
	if occurrence := strings.TrimSpace(facts.ScheduleOccurrence); occurrence != "" {
		eventID += ":" + occurrence
	}
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeAccountNeedsAttention, eventID: eventID,
		payload: map[string]any{
			"account_id": facts.AccountID, "publication_id": facts.PublicationID,
			"provider": facts.Provider, "account_label": facts.AccountLabel,
			"scheduled_at_risk": facts.ScheduledAtRisk,
		},
	})
}

// AccountCredentialFailureFacts reports one healthy-to-failing credential
// transition for a connected account. Generation scopes the event so every
// failure inside one break coalesces per recipient, while a reconnected
// account that breaks again starts a fresh generation.
type AccountCredentialFailureFacts struct {
	RecipientUserID string
	WorkspaceID     string
	AccountID       string
	Generation      int64
	Provider        string
	AccountLabel    string
}

// NewAccountCredentialFailureOutcome records the account-scoped credential
// break that routes to the people who can reconnect the account. It shares
// the account attention topic and copy, but its event identity is the
// account plus the claimed generation instead of a publication.
func NewAccountCredentialFailureOutcome(facts AccountCredentialFailureFacts) (Outcome, error) {
	generation := strconv.FormatInt(facts.Generation, 10)
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeAccountNeedsAttention, eventID: facts.AccountID + ":" + generation,
		payload: map[string]any{
			"account_id": facts.AccountID, "provider": facts.Provider,
			"account_label": facts.AccountLabel, "credential_generation": generation,
		},
	})
}

// AccountCredentialFailureRecipients resolves who can reconnect an account:
// the user who consented to its OAuth grant plus every active administrator
// of the account's workspace. The set is deduplicated, keeps the connector
// first, and may be empty; producers fall back to their existing recipients.
func AccountCredentialFailureRecipients(ctx context.Context, db bun.IDB, account *models.SocialAccount) ([]string, error) {
	recipients := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	addRecipient := func(userID string) {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			return
		}
		if _, ok := seen[userID]; ok {
			return
		}
		seen[userID] = struct{}{}
		recipients = append(recipients, userID)
	}
	if grantID := strings.TrimSpace(account.OAuthGrantID); grantID != "" {
		grant := struct {
			ConsentedByID string `bun:"consented_by_id"`
		}{}
		err := db.NewSelect().Model((*models.OAuthGrant)(nil)).
			Column("consented_by_id").
			Where("id = ?", grantID).
			Scan(ctx, &grant)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("resolve account connector: %w", err)
		}
		if err == nil {
			addRecipient(grant.ConsentedByID)
		}
	}
	var admins []models.WorkspaceMember
	if err := db.NewSelect().Model(&admins).
		Column("user_id").
		Where("workspace_id = ?", account.WorkspaceID).
		Where("role = ?", models.WorkspaceRoleAdmin).
		Where("status = ?", models.WorkspaceMemberStatusActive).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("resolve workspace administrators: %w", err)
	}
	for _, admin := range admins {
		addRecipient(admin.UserID)
	}
	return recipients, nil
}

// putOptionalFact keeps an empty descriptive fact out of the payload entirely.
// Semantic payloads reject empty strings, and a missing detail must never be
// able to fail the transition that is reporting it.
func putOptionalFact(payload map[string]any, key, value string) {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		payload[key] = trimmed
	}
}

type EngagementReceivedFacts struct {
	Kind            string
	RecipientUserID string
	WorkspaceID     string
	EngagementID    string
	PublicationID   string
	RenditionID     string
	Provider        string
	AuthorName      string
}

func NewEngagementReceivedOutcome(facts EngagementReceivedFacts) (Outcome, error) {
	kind := strings.TrimSpace(facts.Kind)
	if kind == "" {
		kind = "comment"
	}
	payload := map[string]any{"engagement_id": facts.EngagementID, "provider": facts.Provider, "activity_kind": kind}
	putOptionalFact(payload, "publication_id", facts.PublicationID)
	putOptionalFact(payload, "rendition_id", facts.RenditionID)
	putOptionalFact(payload, "author_name", facts.AuthorName)
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeNewEngagement, eventID: facts.EngagementID,
		payload: payload,
	})
}

type MessageReceivedFacts struct {
	RecipientUserID string
	WorkspaceID     string
	ConversationID  string
	MessageID       string
	Provider        string
	SenderName      string
}

func NewMessageReceivedOutcome(facts MessageReceivedFacts) (Outcome, error) {
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeNewMessage, eventID: facts.MessageID,
		payload: map[string]any{"conversation_id": facts.ConversationID, "message_id": facts.MessageID, "provider": facts.Provider, "sender_name": facts.SenderName},
	})
}

type ReplyFailedFacts struct {
	RecipientUserID string
	WorkspaceID     string
	EngagementID    string
	AttemptID       string
	Provider        string
}

func NewReplyFailedOutcome(facts ReplyFailedFacts) (Outcome, error) {
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeReplyFailed, eventID: facts.AttemptID,
		payload: map[string]any{"engagement_id": facts.EngagementID, "attempt_id": facts.AttemptID, "provider": facts.Provider},
	})
}

type MessageSendFailedFacts struct {
	RecipientUserID string
	WorkspaceID     string
	ConversationID  string
	MessageID       string
	Provider        string
}

func NewMessageSendFailedOutcome(facts MessageSendFailedFacts) (Outcome, error) {
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeReplyFailed, eventID: facts.MessageID,
		payload: map[string]any{
			"conversation_id": facts.ConversationID, "message_id": facts.MessageID, "provider": facts.Provider,
		},
	})
}

type WorkspaceInvitationFacts struct {
	RecipientUserID string
	InvitationID    string
	DeliveryID      string
	WorkspaceName   string
}

func NewWorkspaceInvitationOutcome(facts WorkspaceInvitationFacts) (Outcome, error) {
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, topic: TypeWorkspaceInvite,
		eventID: facts.InvitationID + ":" + facts.DeliveryID,
		payload: map[string]any{"invitation_id": facts.InvitationID, "workspace_name": facts.WorkspaceName},
	})
}

// NewOwnershipTransferOutcome records a nomination for one Organization
// ownership transfer. The transfer identifier is the semantic idempotency key.
func NewOwnershipTransferOutcome(recipientUserID, transferID, organizationName string) (Outcome, error) {
	return newOutcome(semanticOutcome{
		recipientID: recipientUserID,
		topic:       TypeOwnershipTransfer,
		eventID:     transferID,
		payload: map[string]any{
			"kind":              OwnershipTransferSemanticKind,
			"organization_name": organizationName,
		},
	})
}

func newOutcome(value semanticOutcome) (Outcome, error) {
	value.recipientID = strings.TrimSpace(value.recipientID)
	value.workspaceID = strings.TrimSpace(value.workspaceID)
	value.eventID = strings.TrimSpace(value.eventID)
	if value.recipientID == "" || value.eventID == "" {
		return nil, ErrInvalidOutcome
	}
	if _, ok := topicPolicyFor(value.topic); !ok {
		return nil, ErrInvalidOutcome
	}
	payload, err := normalizeSemanticPayload(value.payload)
	if err != nil {
		return nil, err
	}
	value.payload = payload
	return sealedOutcome{value: value}, nil
}

func normalizeSemanticPayload(payload map[string]any) (map[string]any, error) {
	cleanPayload := make(map[string]any, len(payload))
	for key, raw := range payload {
		switch typed := raw.(type) {
		case string:
			text := strings.TrimSpace(typed)
			if text == "" || len([]rune(text)) > 500 || containsUnsafeControl(text) {
				return nil, fmt.Errorf("%w: invalid %s", ErrInvalidOutcome, key)
			}
			cleanPayload[key] = text
		case []string:
			clean := make([]string, 0, len(typed))
			if len(typed) > 50 {
				return nil, fmt.Errorf("%w: invalid %s", ErrInvalidOutcome, key)
			}
			for _, item := range typed {
				item = strings.TrimSpace(item)
				if item == "" || len([]rune(item)) > 160 || containsUnsafeControl(item) {
					return nil, fmt.Errorf("%w: invalid %s", ErrInvalidOutcome, key)
				}
				clean = append(clean, item)
			}
			cleanPayload[key] = clean
		case bool:
			cleanPayload[key] = typed
		default:
			return nil, fmt.Errorf("%w: invalid %s", ErrInvalidOutcome, key)
		}
	}
	return cleanPayload, nil
}

func containsUnsafeControl(value string) bool {
	return strings.IndexFunc(value, func(character rune) bool {
		return unicode.IsControl(character) && character != '\n' && character != '\t'
	}) >= 0
}

// Record stores a typed semantic outcome through the notification policy.
func (s *Service) Record(ctx context.Context, outcome Outcome) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		return s.RecordWithDB(ctx, tx, outcome)
	})
}

// RecordWithDB stores a typed outcome atomically with its producing change.
func (s *Service) RecordWithDB(ctx context.Context, db bun.IDB, outcome Outcome) error {
	if outcome == nil {
		return ErrInvalidOutcome
	}
	value := outcome.notificationOutcome()
	input, err := materializeOutcome(value)
	if err != nil {
		return err
	}
	return s.createWithDB(ctx, db, input)
}

func materializeOutcome(value semanticOutcome) (createInput, error) {
	policy, ok := topicPolicyFor(value.topic)
	if !ok || policy.materialize == nil {
		return createInput{}, ErrInvalidOutcome
	}
	return policy.materialize(value)
}

func baseOutcomeInput(value semanticOutcome) createInput {
	return createInput{
		UserID: value.recipientID, WorkspaceID: value.workspaceID, Type: value.topic,
		DedupKey: value.topic + ":" + value.eventID, Payload: value.payload,
	}
}

func materializePublicationOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	publicationID, _ := value.payload["publication_id"].(string)
	input.Href = "/publications?publication=" + url.QueryEscape(publicationID)
	input.DedupKey = "publication:" + value.eventID + ":" + value.topic
	if value.topic == TypePostPublished {
		input.Title = "Publication completed"
		input.Body = "Your publication finished on every selected destination."
	} else {
		input.Title = "Publication needs attention"
		input.Body = "One or more destinations could not publish."
	}
	input.Actions = []models.NotificationAction{{Label: "View results", Href: input.Href, Kind: "primary"}}
	return input, nil
}

func materializeAccountAttentionOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	if scheduledAtRisk, _ := value.payload["scheduled_at_risk"].(bool); scheduledAtRisk {
		input.Title = "Scheduled publication at risk"
		input.Body = "Reconnect this account before the next scheduled publication."
	} else {
		input.Title = "Connected account needs attention"
		input.Body = "Publishing is paused until the account is reconnected."
	}
	input.Href = "/settings?tab=accounts"
	input.Actions = []models.NotificationAction{{Label: "Reconnect account", Href: input.Href, Kind: "primary"}}
	return input, nil
}

func materializeEngagementOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	engagementID, _ := value.payload["engagement_id"].(string)
	input.Title = "New engagement"
	input.Body = "Someone replied to your post."
	switch value.payload["activity_kind"] {
	case "mention":
		input.Title, input.Body = "New mention", "Someone mentioned your account."
	case "review":
		input.Title, input.Body = "New review", "Your business received a review."
	}
	input.Href = "/inbox/engagement?item=" + url.QueryEscape(engagementID)
	input.Actions = []models.NotificationAction{{Label: "Open reply", Href: input.Href, Kind: "primary"}}
	if value.payload["activity_kind"] == "mention" || value.payload["activity_kind"] == "review" {
		input.Actions[0].Label = "Open item"
	}
	return input, nil
}

func materializeMessageOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	conversationID, _ := value.payload["conversation_id"].(string)
	input.Title = "New message"
	input.Body = "A connected inbox received a new message."
	input.Href = "/inbox/messages?conversation=" + url.QueryEscape(conversationID)
	input.Actions = []models.NotificationAction{{Label: "Open conversation", Href: input.Href, Kind: "primary"}}
	return input, nil
}

func materializeReplyFailedOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	if conversationID, ok := value.payload["conversation_id"].(string); ok {
		input.Title = "Message failed"
		input.Body = "OpenPost could not send a direct message."
		input.Href = "/inbox/messages?conversation=" + url.QueryEscape(conversationID)
		input.Actions = []models.NotificationAction{{Label: "Review message", Href: input.Href, Kind: "primary"}}
		return input, nil
	}
	engagementID, _ := value.payload["engagement_id"].(string)
	input.Title = "Reply failed"
	input.Body = "OpenPost could not send a reply or engagement action."
	input.Href = "/inbox/engagement?item=" + url.QueryEscape(engagementID)
	input.Actions = []models.NotificationAction{{Label: "Review reply", Href: input.Href, Kind: "primary"}}
	return input, nil
}

func materializeWorkspaceInvitationOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	// Workspace team enqueues the encrypted Transactional invitation email.
	// This outcome adds the account-wide in-app record for registered users.
	input.SuppressEmail = true
	invitationID, _ := value.payload["invitation_id"].(string)
	input.Title = "Workspace invitation"
	input.Body = "You were invited to a Workspace."
	input.Href = "/invite?id=" + url.QueryEscape(invitationID)
	input.Actions = []models.NotificationAction{{Label: "Review invitation", Href: input.Href, Kind: "primary"}}
	return input, nil
}

func materializeOwnershipTransferOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	input.DedupKey = "ownership-transfer:" + value.eventID
	input.Href = "/ownership-transfer?id=" + value.eventID
	input.Actions = []models.NotificationAction{{
		Label: OwnershipTransferReviewAction, Href: input.Href, Kind: "primary",
	}}
	return input, nil
}

func materializeRequiredAccountOutcome(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	input.Title = "Account action required"
	input.Body = "Review this required account action in OpenPost."
	input.Href = "/settings"
	input.Actions = []models.NotificationAction{{Label: "Review settings", Href: input.Href, Kind: "primary"}}
	return input, nil
}
