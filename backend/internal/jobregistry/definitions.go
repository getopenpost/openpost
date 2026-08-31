package jobregistry

import (
	"sort"
	"time"
)

// Type is a durable Job kind stored in jobs.type.
const (
	TypePublishPost             = "publish_post"
	TypePublishPublication      = "publish_publication"
	TypeRefreshToken            = "refresh_token"
	TypeMediaCleanup            = "media_cleanup"
	TypeStorageDelete           = "storage_delete"
	TypeFeedbackDelivery        = "deliver_feedback"
	TypeAnalyticsSweep          = "analytics_sweep"
	TypeAnalyticsAccount        = "analytics_account_sync"
	TypeAnalyticsRendition      = "analytics_rendition_sync"
	TypeBillingWebhook          = "billing_paddle_webhook"
	TypeEngagementSweep         = "engagement_sweep"
	TypeMessagingSweep          = "messaging_sweep"
	TypeEngagementSync          = "engagement_sync"
	TypeMessagesSync            = "messages_sync"
	TypeEngagementAction        = "engagement_action"
	TypeMessageSend             = "message_send"
	TypeNotificationEmail       = "notification_email"
	TypeOwnershipTransferExpiry = "organization_ownership_transfer_expiry"
	TypeRepostSweep             = "repost_sweep"
	TypeRepostEvaluate          = "repost_evaluate"
	TypeRepostExecute           = "repost_execute"
	TypeMediaAnalyze            = "media_analyze"
	TypeGrowthDiscovery         = "growth_discovery"
	TypeGrowthFollow            = "growth_follow"
	TypePublicationBuild        = "publication_build"
)

// ExecutionKind selects the injected implementation for a registered Job.
// Multiple Job kinds can share one execution implementation without exposing
// that internal seam to enqueue callers.
type ExecutionKind string

const (
	ExecutePublishPublication    ExecutionKind = "publish_publication"
	ExecuteRefreshToken          ExecutionKind = "refresh_token"
	ExecuteMediaCleanup          ExecutionKind = "media_cleanup"
	ExecuteStorageDelete         ExecutionKind = "storage_delete"
	ExecuteFeedback              ExecutionKind = "feedback"
	ExecuteAnalytics             ExecutionKind = "analytics"
	ExecuteBilling               ExecutionKind = "billing"
	ExecuteEngagement            ExecutionKind = "engagement"
	ExecuteMessaging             ExecutionKind = "messaging"
	ExecuteNotification          ExecutionKind = "notification"
	ExecuteOrganizationOwnership ExecutionKind = "organization_ownership"
	ExecuteRepost                ExecutionKind = "repost"
	ExecuteVideo                 ExecutionKind = "video"
	ExecuteGrowth                ExecutionKind = "growth"
	ExecutePublicationBuild      ExecutionKind = "publication_build"
)

// FailurePolicy describes how the runtime interprets an execution error.
type FailurePolicy string

const (
	FailureDefault       FailurePolicy = "default"
	FailurePublish       FailurePolicy = "publish"
	FailureProviderRead  FailurePolicy = "provider_read"
	FailureProviderWrite FailurePolicy = "provider_write"
	FailureMediaCleanup  FailurePolicy = "media_cleanup"
)

// RecoveryPolicy describes what an interrupted processing Job becomes after
// its lock expires.
type RecoveryPolicy string

const (
	RecoveryRequeue              RecoveryPolicy = "requeue"
	RecoveryReconcilePublication RecoveryPolicy = "reconcile_publication"
	RecoveryFailAmbiguous        RecoveryPolicy = "fail_ambiguous"
	RecoverySupersedeSweep       RecoveryPolicy = "supersede_sweep"
)

// Definition owns the durable policy that enqueue callers and the runtime
// must agree on for one Job kind.
type Definition struct {
	Type               string
	DefaultMaxAttempts int
	Recurrence         time.Duration
	Execution          ExecutionKind
	Failure            FailurePolicy
	Recovery           RecoveryPolicy
	FailureMessage     string
	RecoveryMessage    string
	identity           func(string) (Identity, error)
}

var definitions = map[string]Definition{
	TypePublishPublication: definition(TypePublishPublication, 3, ExecutePublishPublication, FailurePublish, RecoveryReconcilePublication),
	TypeRefreshToken:       definition(TypeRefreshToken, 5, ExecuteRefreshToken, FailureProviderRead, RecoveryRequeue),
	TypeMediaCleanup: {
		Type: TypeMediaCleanup, DefaultMaxAttempts: 3, Recurrence: 24 * time.Hour,
		Execution: ExecuteMediaCleanup, Failure: FailureMediaCleanup, Recovery: RecoveryRequeue,
		identity: mediaCleanupIdentity,
	},
	TypeStorageDelete:    definition(TypeStorageDelete, 10, ExecuteStorageDelete, FailureDefault, RecoveryRequeue),
	TypeFeedbackDelivery: definition(TypeFeedbackDelivery, 3, ExecuteFeedback, FailureDefault, RecoveryRequeue),
	TypeAnalyticsSweep: providerReadDefinition(TypeAnalyticsSweep, 3, ExecuteAnalytics, RecoverySupersedeSweep,
		"Analytics collection failed. OpenPost will retry when the failure is temporary.",
		"A later analytics sweep remains queued; this sweep will not retry."),
	TypeAnalyticsAccount: providerReadDefinition(TypeAnalyticsAccount, 3, ExecuteAnalytics, RecoveryRequeue,
		"Analytics collection failed. OpenPost will retry when the failure is temporary.", ""),
	TypeAnalyticsRendition: providerReadDefinition(TypeAnalyticsRendition, 3, ExecuteAnalytics, RecoveryRequeue,
		"Analytics collection failed. OpenPost will retry when the failure is temporary.", ""),
	TypeBillingWebhook: definition(TypeBillingWebhook, 8, ExecuteBilling, FailureDefault, RecoveryRequeue),
	TypeEngagementSweep: providerReadDefinition(TypeEngagementSweep, 5, ExecuteEngagement, RecoverySupersedeSweep,
		"Engagement collection failed. OpenPost will retry when the failure is temporary.",
		"A later engagement sweep remains queued; this sweep will not retry."),
	TypeEngagementSync: providerReadDefinition(TypeEngagementSync, 5, ExecuteEngagement, RecoveryRequeue,
		"Engagement collection failed. OpenPost will retry when the failure is temporary.", ""),
	TypeMessagingSweep: providerReadDefinition(TypeMessagingSweep, 5, ExecuteMessaging, RecoverySupersedeSweep,
		"Messaging collection failed. OpenPost will retry when the failure is temporary.",
		"A later Messaging sweep remains queued; this sweep will not retry."),
	TypeMessagesSync: providerReadDefinition(TypeMessagesSync, 5, ExecuteMessaging, RecoveryRequeue,
		"Messaging collection failed. OpenPost will retry when the failure is temporary.", ""),
	TypeEngagementAction: providerWriteDefinition(TypeEngagementAction, ExecuteEngagement,
		"The provider write failed. OpenPost did not retry because the provider result may be ambiguous."),
	TypeMessageSend: providerWriteDefinition(TypeMessageSend, ExecuteMessaging,
		"The provider write failed. OpenPost did not retry because the provider result may be ambiguous."),
	TypeNotificationEmail:       definition(TypeNotificationEmail, 5, ExecuteNotification, FailureDefault, RecoveryRequeue),
	TypeOwnershipTransferExpiry: definition(TypeOwnershipTransferExpiry, 5, ExecuteOrganizationOwnership, FailureDefault, RecoveryRequeue),
	TypeRepostSweep: providerReadDefinition(TypeRepostSweep, 3, ExecuteRepost, RecoverySupersedeSweep,
		"Repost evaluation failed. OpenPost will retry when the failure is temporary.",
		"A later repost sweep remains queued; this sweep will not retry."),
	TypeRepostEvaluate: providerReadDefinition(TypeRepostEvaluate, 3, ExecuteRepost, RecoveryRequeue,
		"Repost evaluation failed. OpenPost will retry when the failure is temporary.", ""),
	TypeRepostExecute: providerWriteDefinition(TypeRepostExecute, ExecuteRepost,
		"The provider repost failed. OpenPost did not retry because the provider result may be ambiguous."),
	TypeMediaAnalyze: definition(TypeMediaAnalyze, 3, ExecuteVideo, FailureDefault, RecoveryRequeue),
	TypeGrowthDiscovery: providerReadDefinition(TypeGrowthDiscovery, 3, ExecuteGrowth, RecoveryRequeue,
		"Growth discovery failed. OpenPost will retry when the failure is temporary.", ""),
	TypeGrowthFollow: providerWriteDefinition(TypeGrowthFollow, ExecuteGrowth,
		"The provider follow failed. OpenPost did not retry because the provider result may be ambiguous."),
	TypePublicationBuild: {
		Type: TypePublicationBuild, DefaultMaxAttempts: 2,
		Execution: ExecutePublicationBuild, Failure: FailureDefault, Recovery: RecoveryRequeue,
		identity: publicationBuildIdentity,
	},
}

func definition(jobType string, attempts int, execution ExecutionKind, failure FailurePolicy, recovery RecoveryPolicy) Definition {
	return Definition{Type: jobType, DefaultMaxAttempts: attempts, Execution: execution, Failure: failure, Recovery: recovery}
}

func providerReadDefinition(jobType string, attempts int, execution ExecutionKind, recovery RecoveryPolicy, failureMessage, recoveryMessage string) Definition {
	result := definition(jobType, attempts, execution, FailureProviderRead, recovery)
	result.FailureMessage = failureMessage
	result.RecoveryMessage = recoveryMessage
	return result
}

func providerWriteDefinition(jobType string, execution ExecutionKind, message string) Definition {
	result := definition(jobType, 1, execution, FailureProviderWrite, RecoveryFailAmbiguous)
	result.FailureMessage = message
	result.RecoveryMessage = message
	return result
}

// Definitions returns every executable durable Job kind in stable order.
func Definitions() []Definition {
	out := make([]Definition, 0, len(definitions))
	for _, item := range definitions {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}

// TypesByRecovery returns the registered Job kinds with one recovery policy.
func TypesByRecovery(policy RecoveryPolicy) []string {
	var out []string
	for _, item := range Definitions() {
		if item.Recovery == policy {
			out = append(out, item.Type)
		}
	}
	return out
}
