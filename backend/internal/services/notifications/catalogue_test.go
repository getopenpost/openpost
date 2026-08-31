package notifications

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestTopicDefinitionsDeriveEveryPreferenceConstraint(t *testing.T) {
	definitions := TopicDefinitions()
	require.Len(t, definitions, len(DefaultPreferences()))

	byID := make(map[string]TopicDefinition, len(definitions))
	for _, definition := range definitions {
		byID[definition.ID] = definition
		require.NotEmpty(t, definition.Group)
		require.NotEmpty(t, definition.PresentationKey)
		require.NotEmpty(t, definition.EmailFrequencies)
	}

	publishFailed := byID[TypePublishFailed]
	require.True(t, publishFailed.CriticalInApp)
	require.False(t, publishFailed.InAppMutable)
	require.False(t, publishFailed.Transactional)
	require.True(t, publishFailed.EmailMutable)
	require.True(t, publishFailed.MuteApplies)
	require.Equal(t, DefaultPreferences()[TypePublishFailed], publishFailed.DefaultPreference)

	workspaceInvite := byID[TypeWorkspaceInvite]
	require.True(t, workspaceInvite.CriticalInApp)
	require.True(t, workspaceInvite.Transactional)
	require.False(t, workspaceInvite.InAppMutable)
	require.False(t, workspaceInvite.EmailMutable)
	require.False(t, workspaceInvite.MuteApplies)
	require.Equal(t, []EmailFrequency{EmailFrequencyImmediate}, workspaceInvite.EmailFrequencies)
}

func TestPreferenceProjectionIncludesTheAuthoritativeTopicDefinitions(t *testing.T) {
	db := notificationsTestDB(t)
	settings, err := NewService(db).GetPreferenceSettings(t.Context(), "user-1")
	require.NoError(t, err)
	require.Equal(t, TopicDefinitions(), settings.TopicDefinitions)
}

func TestTypedOwnershipOutcomeDerivesPresentationActionAndDeduplication(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	outcome, err := NewOwnershipTransferOutcome("nominee-1", "transfer-1", "Equipa Acores")
	require.NoError(t, err)

	require.NoError(t, service.Record(t.Context(), outcome))
	require.NoError(t, service.Record(t.Context(), outcome))

	page, err := service.List(t.Context(), "nominee-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	stored := page.Items[0]
	require.Equal(t, TypeOwnershipTransfer, stored.Type)
	require.Equal(t, "ownership-transfer:transfer-1", stored.DedupKey)
	require.Equal(t, "/ownership-transfer?id=transfer-1", stored.Href)
	require.Empty(t, stored.Title, "localized presentation is derived from semantic payload")
	require.Contains(t, stored.PayloadJSON, `"organization_name":"Equipa Acores"`)
	require.Equal(t, []models.NotificationAction{{
		Label: OwnershipTransferReviewAction,
		Href:  "/ownership-transfer?id=transfer-1",
		Kind:  "primary",
	}}, stored.Actions)
}

func TestTypedOutcomesRejectMissingOrUnsafeSemanticFacts(t *testing.T) {
	_, err := NewOwnershipTransferOutcome("nominee-1", "", "Organization")
	require.ErrorIs(t, err, ErrInvalidOutcome)

	_, err = NewOwnershipTransferOutcome("nominee-1", "transfer-1", "\x00secret")
	require.ErrorIs(t, err, ErrInvalidOutcome)
}

func TestTypedOutcomeConstructorsExposeOnlySemanticFacts(t *testing.T) {
	factTypes := []any{
		PublicationResultFacts{}, AccountAttentionFacts{}, EngagementReceivedFacts{},
		MessageReceivedFacts{}, ReplyFailedFacts{}, MessageSendFailedFacts{}, WorkspaceInvitationFacts{}, RequiredAccountOutcomeFacts{},
	}
	forbidden := []string{"topic", "title", "body", "href", "action", "dedup", "suppress", "urgency", "channel", "classification", "token", "url", "raw", "response", "failure_text"}
	for _, facts := range factTypes {
		typeOfFacts := reflect.TypeOf(facts)
		for index := range typeOfFacts.NumField() {
			name := strings.ToLower(typeOfFacts.Field(index).Name)
			for _, fragment := range forbidden {
				require.NotContains(t, name, fragment, "%s must not expose notification policy", typeOfFacts.Name())
			}
		}
	}
}

func TestNotificationProducerSurfaceIsSealedAndHasNoRawCreateMethod(t *testing.T) {
	serviceType := reflect.TypeOf((*Service)(nil))
	_, hasCreate := serviceType.MethodByName("Create")
	_, hasCreateWithDB := serviceType.MethodByName("CreateWithDB")
	require.False(t, hasCreate)
	require.False(t, hasCreateWithDB)

	outcomeType := reflect.TypeOf((*Outcome)(nil)).Elem()
	require.Equal(t, 1, outcomeType.NumMethod())
	method := outcomeType.Method(0)
	require.Equal(t, "notificationOutcome", method.Name)
	require.NotEmpty(t, method.PkgPath, "the outcome marker must remain unavailable to producers")
}

func TestSupportedDomainOutcomeConstructorsMaterializeFromTheCatalogue(t *testing.T) {
	constructors := map[string]func() (Outcome, error){
		TypePostPublished: func() (Outcome, error) {
			return NewPublicationResultOutcome(PublicationResultFacts{RecipientUserID: "user-1", WorkspaceID: "workspace-1", PublicationID: "publication-1", DeliveryID: "delivery-1", SuccessfulDestinations: []string{"Mastodon"}})
		},
		TypePublishFailed: func() (Outcome, error) {
			return NewPublicationResultOutcome(PublicationResultFacts{RecipientUserID: "user-1", WorkspaceID: "workspace-1", PublicationID: "publication-2", DeliveryID: "delivery-2", FailedDestinations: []string{"Bluesky"}, Retryable: true})
		},
		TypeAccountNeedsAttention: func() (Outcome, error) {
			return NewAccountNeedsAttentionOutcome(AccountAttentionFacts{RecipientUserID: "user-1", WorkspaceID: "workspace-1", AccountID: "account-1", PublicationID: "publication-1", Provider: "mastodon", AccountLabel: "Founder"})
		},
		TypeNewEngagement: func() (Outcome, error) {
			return NewEngagementReceivedOutcome(EngagementReceivedFacts{RecipientUserID: "user-1", WorkspaceID: "workspace-1", EngagementID: "engagement-1", PublicationID: "publication-1", RenditionID: "rendition-1", Provider: "mastodon", AuthorName: "Ada"})
		},
		TypeNewMessage: func() (Outcome, error) {
			return NewMessageReceivedOutcome(MessageReceivedFacts{RecipientUserID: "user-1", WorkspaceID: "workspace-1", ConversationID: "conversation-1", MessageID: "message-1", Provider: "instagram", SenderName: "Ada"})
		},
		TypeReplyFailed: func() (Outcome, error) {
			return NewReplyFailedOutcome(ReplyFailedFacts{RecipientUserID: "user-1", WorkspaceID: "workspace-1", EngagementID: "engagement-1", AttemptID: "attempt-1", Provider: "mastodon"})
		},
		TypeWorkspaceInvite: func() (Outcome, error) {
			return NewWorkspaceInvitationOutcome(WorkspaceInvitationFacts{RecipientUserID: "user-1", InvitationID: "invitation-1", DeliveryID: "generation-1", WorkspaceName: "Launch"})
		},
		TypeOwnershipTransfer: func() (Outcome, error) {
			return NewOwnershipTransferOutcome("user-1", "transfer-1", "OpenPost")
		},
		TypeSecurityAction: func() (Outcome, error) {
			return NewSecurityActionOutcome(RequiredAccountOutcomeFacts{RecipientUserID: "user-1", EventID: "security-1", Kind: "password_changed"})
		},
		TypeAccessChanged: func() (Outcome, error) {
			return NewAccessChangedOutcome(RequiredAccountOutcomeFacts{RecipientUserID: "user-1", EventID: "access-1", Kind: "session_revoked"})
		},
		TypeCriticalBilling: func() (Outcome, error) {
			return NewCriticalBillingOutcome(RequiredAccountOutcomeFacts{RecipientUserID: "user-1", EventID: "billing-1", Kind: "payment_failed"})
		},
	}
	require.Len(t, constructors, len(TopicDefinitions()))
	for topic, construct := range constructors {
		t.Run(topic, func(t *testing.T) {
			outcome, err := construct()
			require.NoError(t, err)
			materialized, err := materializeOutcome(outcome.notificationOutcome())
			require.NoError(t, err)
			require.Equal(t, topic, materialized.Type)
			require.NotEmpty(t, materialized.DedupKey)
			require.Equal(t, materialized.Actions, safeActions(materialized.Actions))
		})
	}
}

func TestFrontendPresentationIsExhaustiveForBackendTopicsInEnglishAndPortuguese(t *testing.T) {
	presentation, err := os.ReadFile("../../../../frontend/src/lib/notification-topics.ts")
	require.NoError(t, err)
	require.Contains(t, string(presentation), "notifications_type_unknown")

	for _, locale := range []string{"en", "pt"} {
		encoded, readErr := os.ReadFile("../../../../frontend/messages/" + locale + ".json")
		require.NoError(t, readErr)
		messages := map[string]any{}
		require.NoError(t, json.Unmarshal(encoded, &messages))
		for _, definition := range TopicDefinitions() {
			require.Contains(t, string(presentation), "\n\t"+definition.ID+": {", "%s icon mapping", definition.ID)
			require.Contains(t, messages, "notifications_event_"+definition.ID, "%s %s label", locale, definition.ID)
			require.Contains(t, messages, "notifications_event_"+definition.ID+"_description", "%s %s description", locale, definition.ID)
		}
	}
}

func TestScheduledAccountWarningNamesTheRiskAndAction(t *testing.T) {
	outcome, err := NewAccountNeedsAttentionOutcome(AccountAttentionFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", AccountID: "account-1",
		PublicationID: "publication-1", Provider: "x", AccountLabel: "Founder", ScheduledAtRisk: true,
	})
	require.NoError(t, err)

	materialized, err := materializeOutcome(outcome.notificationOutcome())
	require.NoError(t, err)
	require.Equal(t, "Scheduled publication at risk", materialized.Title)
	require.Equal(t, "Reconnect this account before the next scheduled publication.", materialized.Body)
	require.Equal(t, "/settings?tab=accounts", materialized.Href)
}

func TestScheduledAccountWarningDeduplicatesOneScheduleOccurrence(t *testing.T) {
	makeOutcome := func(occurrence string) Outcome {
		outcome, err := NewAccountNeedsAttentionOutcome(AccountAttentionFacts{
			RecipientUserID: "user-1", WorkspaceID: "workspace-1", AccountID: "account-1",
			PublicationID: "publication-1", Provider: "x", AccountLabel: "Founder",
			ScheduledAtRisk: true, ScheduleOccurrence: occurrence,
		})
		require.NoError(t, err)
		return outcome
	}

	first := makeOutcome("1:2026-08-31T13:00:00Z").notificationOutcome()
	retry := makeOutcome("1:2026-08-31T13:00:00Z").notificationOutcome()
	rescheduled := makeOutcome("2:2026-09-01T13:00:00Z").notificationOutcome()
	require.Equal(t, first.eventID, retry.eventID)
	require.NotEqual(t, first.eventID, rescheduled.eventID)
}
