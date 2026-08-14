import { m } from '$lib/paraglide/messages';
import BellIcon from '@lucide/svelte/icons/bell';
import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
import MailIcon from '@lucide/svelte/icons/mail';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import ReplyIcon from '@lucide/svelte/icons/reply';
import UserPlusIcon from '@lucide/svelte/icons/user-plus';
import UserRoundXIcon from '@lucide/svelte/icons/user-round-x';

export type NotificationTopic = keyof typeof notificationTopics;
type NotificationTopicGroup = 'publishing' | 'conversations' | 'workspace' | 'account';

const notificationTopics = {
	post_published: {
		group: 'publishing',
		label: m.notifications_event_post_published,
		description: m.notifications_event_post_published_description,
		icon: CheckCircleIcon,
		criticalInApp: false,
		immediateEmail: false,
		transactionalEmail: false
	},
	publish_failed: {
		group: 'publishing',
		label: m.notifications_event_publish_failed,
		description: m.notifications_event_publish_failed_description,
		icon: CircleAlertIcon,
		criticalInApp: true,
		immediateEmail: true,
		transactionalEmail: false
	},
	account_needs_attention: {
		group: 'publishing',
		label: m.notifications_event_account_needs_attention,
		description: m.notifications_event_account_needs_attention_description,
		icon: UserRoundXIcon,
		criticalInApp: true,
		immediateEmail: false,
		transactionalEmail: false
	},
	new_engagement: {
		group: 'conversations',
		label: m.notifications_event_new_engagement,
		description: m.notifications_event_new_engagement_description,
		icon: MessageCircleIcon,
		criticalInApp: false,
		immediateEmail: false,
		transactionalEmail: false
	},
	new_message: {
		group: 'conversations',
		label: m.notifications_event_new_message,
		description: m.notifications_event_new_message_description,
		icon: MailIcon,
		criticalInApp: false,
		immediateEmail: false,
		transactionalEmail: false
	},
	reply_failed: {
		group: 'conversations',
		label: m.notifications_event_reply_failed,
		description: m.notifications_event_reply_failed_description,
		icon: ReplyIcon,
		criticalInApp: true,
		immediateEmail: true,
		transactionalEmail: false
	},
	workspace_invite: {
		group: 'workspace',
		label: m.notifications_event_workspace_invite,
		description: m.notifications_event_workspace_invite_description,
		icon: UserPlusIcon,
		criticalInApp: true,
		immediateEmail: true,
		transactionalEmail: true
	},
	security_action: {
		group: 'account',
		label: m.notifications_event_security_action,
		description: m.notifications_event_security_action_description,
		icon: BellIcon,
		criticalInApp: true,
		immediateEmail: true,
		transactionalEmail: true
	},
	access_changed: {
		group: 'account',
		label: m.notifications_event_access_changed,
		description: m.notifications_event_access_changed_description,
		icon: BellIcon,
		criticalInApp: true,
		immediateEmail: true,
		transactionalEmail: true
	},
	critical_billing: {
		group: 'account',
		label: m.notifications_event_critical_billing,
		description: m.notifications_event_critical_billing_description,
		icon: BellIcon,
		criticalInApp: true,
		immediateEmail: true,
		transactionalEmail: true
	}
} as const satisfies Record<
	string,
	{
		group: NotificationTopicGroup;
		label: () => string;
		description: () => string;
		icon: typeof BellIcon;
		criticalInApp: boolean;
		immediateEmail: boolean;
		transactionalEmail: boolean;
	}
>;

const topicEntries = Object.entries(notificationTopics) as [
	NotificationTopic,
	(typeof notificationTopics)[NotificationTopic]
][];

export const criticalInAppTopics = new Set(
	topicEntries.filter(([, topic]) => topic.criticalInApp).map(([type]) => type)
);
export const immediateEmailTopics = new Set(
	topicEntries.filter(([, topic]) => topic.immediateEmail).map(([type]) => type)
);
export const transactionalEmailTopics = new Set(
	topicEntries.filter(([, topic]) => topic.transactionalEmail).map(([type]) => type)
);

export function notificationTopicGroups() {
	return [
		{ id: 'publishing', label: m.notifications_group_publishing() },
		{ id: 'conversations', label: m.notifications_group_conversations() },
		{ id: 'workspace', label: m.notifications_group_workspace() },
		{ id: 'account', label: m.notifications_group_account() }
	].map((group) => ({
		...group,
		events: topicEntries.filter(([, topic]) => topic.group === group.id).map(([type]) => type)
	}));
}

export function notificationTopicLabel(type: string): string {
	return isNotificationTopic(type)
		? notificationTopics[type].label()
		: m.notifications_type_unknown();
}

export function notificationTopicDescription(type: NotificationTopic): string {
	return notificationTopics[type].description();
}

export function notificationTopicIcon(type: string) {
	return isNotificationTopic(type) ? notificationTopics[type].icon : BellIcon;
}

function isNotificationTopic(type: string): type is NotificationTopic {
	return type in notificationTopics;
}
