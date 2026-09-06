package notifications

// TopicDefinition is the backend-owned behavioral projection consumed by the
// notification preferences interface. Presentation copy and icons remain
// localized in clients through PresentationKey.
type TopicDefinition struct {
	ID                string            `json:"id"`
	Group             string            `json:"group"`
	PresentationKey   string            `json:"presentation_key"`
	CriticalInApp     bool              `json:"critical_in_app"`
	Transactional     bool              `json:"transactional"`
	InAppMutable      bool              `json:"in_app_mutable"`
	EmailMutable      bool              `json:"email_mutable"`
	MuteApplies       bool              `json:"mute_applies"`
	EmailFrequencies  []EmailFrequency  `json:"email_frequencies"`
	DefaultPreference ChannelPreference `json:"default_preference"`
}

type topicPolicy struct {
	definition  TopicDefinition
	materialize func(semanticOutcome) (createInput, error)
}

var topicCatalogue = []topicPolicy{
	newOptionalTopic(TypePostPublished, "publishing", false, EmailFrequencyOff, materializePublicationOutcome),
	newOptionalTopic(TypePublishFailed, "publishing", true, EmailFrequencyImmediate, materializePublicationOutcome),
	newOptionalTopic(TypeAccountNeedsAttention, "publishing", true, EmailFrequencyOff, materializeAccountAttentionOutcome),
	newOptionalTopic(TypeNewEngagement, "conversations", false, EmailFrequencyOff, materializeEngagementOutcome),
	newOptionalTopic(TypeNewMessage, "conversations", false, EmailFrequencyOff, materializeMessageOutcome),
	newOptionalTopic(TypeReplyFailed, "conversations", true, EmailFrequencyImmediate, materializeReplyFailedOutcome),
	newTransactionalTopic(TypeWorkspaceInvite, "workspace", materializeWorkspaceInvitationOutcome),
	newTransactionalTopic(TypeOwnershipTransfer, "account", materializeOwnershipTransferOutcome),
	newTransactionalTopic(TypeSecurityAction, "account", materializeRequiredAccountOutcome),
	newTransactionalTopic(TypeAccessChanged, "account", materializeRequiredAccountOutcome),
	newTransactionalTopic(TypeCriticalBilling, "account", materializeRequiredAccountOutcome),
}

func newOptionalTopic(id, group string, critical bool, defaultEmail EmailFrequency, materialize func(semanticOutcome) (createInput, error)) topicPolicy {
	return topicPolicy{materialize: materialize, definition: TopicDefinition{
		ID: id, Group: group, PresentationKey: "notifications.event." + id,
		CriticalInApp: critical, InAppMutable: !critical, EmailMutable: true, MuteApplies: true,
		EmailFrequencies:  []EmailFrequency{EmailFrequencyOff, EmailFrequencyImmediate, EmailFrequencyDaily},
		DefaultPreference: ChannelPreference{InApp: true, EmailFrequency: defaultEmail},
	}}
}

func newTransactionalTopic(id, group string, materialize func(semanticOutcome) (createInput, error)) topicPolicy {
	return topicPolicy{materialize: materialize, definition: TopicDefinition{
		ID: id, Group: group, PresentationKey: "notifications.event." + id,
		CriticalInApp: true, Transactional: true, InAppMutable: false, EmailMutable: false,
		MuteApplies: false, EmailFrequencies: []EmailFrequency{EmailFrequencyImmediate},
		DefaultPreference: ChannelPreference{InApp: true, EmailFrequency: EmailFrequencyImmediate},
	}}
}

func topicPolicyFor(id string) (topicPolicy, bool) {
	for _, policy := range topicCatalogue {
		if policy.definition.ID == id {
			return policy, true
		}
	}
	return topicPolicy{}, false
}

// TopicDefinitions returns a detached, stable-order copy of the authoritative
// catalogue so callers cannot mutate notification policy.
func TopicDefinitions() []TopicDefinition {
	definitions := make([]TopicDefinition, 0, len(topicCatalogue))
	for _, policy := range topicCatalogue {
		definition := policy.definition
		definition.EmailFrequencies = append([]EmailFrequency(nil), definition.EmailFrequencies...)
		definitions = append(definitions, definition)
	}
	return definitions
}
