import { m } from '$lib/paraglide/messages';
import type { components } from '$lib/api/types';
import type { ThemeIconRole } from '$lib/themes';
import type { ProtectedIconRole } from '$lib/themes/icons';

export type NotificationTopicDefinition = components['schemas']['TopicDefinition'];
export type NotificationEmailFrequency = 'off' | 'immediate' | 'daily';

const notificationPresentation = {
	post_published: {
		label: m.notifications_event_post_published,
		description: m.notifications_event_post_published_description,
		icon: { kind: 'protected', role: 'success' }
	},
	publish_failed: {
		label: m.notifications_event_publish_failed,
		description: m.notifications_event_publish_failed_description,
		icon: { kind: 'protected', role: 'error' }
	},
	account_needs_attention: {
		label: m.notifications_event_account_needs_attention,
		description: m.notifications_event_account_needs_attention_description,
		icon: { kind: 'theme', role: 'user' }
	},
	new_engagement: {
		label: m.notifications_event_new_engagement,
		description: m.notifications_event_new_engagement_description,
		icon: { kind: 'theme', role: 'feedback' }
	},
	new_message: {
		label: m.notifications_event_new_message,
		description: m.notifications_event_new_message_description,
		icon: { kind: 'theme', role: 'mail' }
	},
	reply_failed: {
		label: m.notifications_event_reply_failed,
		description: m.notifications_event_reply_failed_description,
		icon: { kind: 'theme', role: 'reply' }
	},
	workspace_invite: {
		label: m.notifications_event_workspace_invite,
		description: m.notifications_event_workspace_invite_description,
		icon: { kind: 'theme', role: 'growth' }
	},
	ownership_transfer: {
		label: m.notifications_event_ownership_transfer,
		description: m.notifications_event_ownership_transfer_description,
		icon: { kind: 'theme', role: 'growth' }
	},
	security_action: {
		label: m.notifications_event_security_action,
		description: m.notifications_event_security_action_description,
		icon: { kind: 'theme', role: 'notification' }
	},
	access_changed: {
		label: m.notifications_event_access_changed,
		description: m.notifications_event_access_changed_description,
		icon: { kind: 'theme', role: 'notification' }
	},
	critical_billing: {
		label: m.notifications_event_critical_billing,
		description: m.notifications_event_critical_billing_description,
		icon: { kind: 'theme', role: 'notification' }
	}
} as const;

type KnownNotificationTopic = keyof typeof notificationPresentation;

export function notificationTopicGroups(definitions: NotificationTopicDefinition[]) {
	const groups = new Map<string, NotificationTopicDefinition[]>();
	for (const definition of definitions) {
		groups.set(definition.group, [...(groups.get(definition.group) ?? []), definition]);
	}
	return [...groups].map(([id, topics]) => ({ id, label: groupLabel(id), topics }));
}

export function notificationTopicEmailFrequencies(
	definition: NotificationTopicDefinition
): NotificationEmailFrequency[] {
	return (definition.email_frequencies ?? []).filter(
		(frequency): frequency is NotificationEmailFrequency =>
			frequency === 'off' || frequency === 'immediate' || frequency === 'daily'
	);
}

function groupLabel(group: string): string {
	if (group === 'publishing') return m.notifications_group_publishing();
	if (group === 'conversations') return m.notifications_group_conversations();
	if (group === 'workspace') return m.notifications_group_workspace();
	if (group === 'account') return m.notifications_group_account();
	return m.notifications_type_unknown();
}

export function notificationTopicLabel(type: string): string {
	return isKnownNotificationTopic(type)
		? notificationPresentation[type].label()
		: m.notifications_type_unknown();
}

export function notificationTopicDescription(type: string): string {
	return isKnownNotificationTopic(type)
		? notificationPresentation[type].description()
		: m.notifications_type_unknown();
}

export type NotificationTopicIcon =
	| { kind: 'theme'; role: ThemeIconRole }
	| { kind: 'protected'; role: ProtectedIconRole };

export function notificationTopicIcon(type: string): NotificationTopicIcon {
	return isKnownNotificationTopic(type)
		? notificationPresentation[type].icon
		: { kind: 'theme', role: 'notification' };
}

function isKnownNotificationTopic(type: string): type is KnownNotificationTopic {
	return type in notificationPresentation;
}
