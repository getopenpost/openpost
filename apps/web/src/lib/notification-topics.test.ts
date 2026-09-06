import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import {
	notificationTopicDescription,
	notificationTopicEmailFrequencies,
	notificationTopicGroups,
	notificationTopicLabel,
	type NotificationTopicDefinition
} from './notification-topics';

const backendDefinition: NotificationTopicDefinition = {
	id: 'future_provider_alert',
	group: 'future_group',
	presentation_key: 'notifications.event.future_provider_alert',
	critical_in_app: true,
	transactional: true,
	in_app_mutable: false,
	email_mutable: false,
	mute_applies: false,
	email_frequencies: ['immediate', 'unsupported'],
	default_preference: { in_app: true, email_frequency: 'immediate' }
};

describe('notification topic presentation', () => {
	afterEach(() => setLocale('en', { reload: false }));

	it('keeps backend topic policy while presenting unknown topics safely', () => {
		setLocale('en', { reload: false });
		expect(notificationTopicGroups([backendDefinition])).toEqual([
			{ id: 'future_group', label: 'Notification', topics: [backendDefinition] }
		]);
		expect(notificationTopicEmailFrequencies(backendDefinition)).toEqual(['immediate']);
		expect(notificationTopicLabel(backendDefinition.id)).toBe('Notification');
		expect(notificationTopicDescription(backendDefinition.id)).toBe('Notification');
	});

	it('uses the Portuguese fallback without changing backend policy', () => {
		setLocale('pt', { reload: false });
		expect(notificationTopicGroups([backendDefinition])[0]?.label).toBe('Notificação');
		expect(notificationTopicLabel(backendDefinition.id)).toBe('Notificação');
		expect(notificationTopicEmailFrequencies(backendDefinition)).toEqual(['immediate']);
	});
});
