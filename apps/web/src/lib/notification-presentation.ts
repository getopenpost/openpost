import type { components } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';

type Notification = components['schemas']['UserNotification'];
type NotificationAction = components['schemas']['NotificationAction'];

const ownershipKind = 'organization_ownership_nomination';
const ownershipReviewAction = 'ownership_transfer.review';

interface NotificationPresentation {
	title: string;
	body: string;
	actions: NotificationAction[];
}

interface SemanticNotificationPayload {
	kind?: string;
	organization_name?: string;
}

interface SemanticPayloadRecord {
	kind?: unknown;
	organization_name?: unknown;
}

export function presentNotification(notification: Notification): NotificationPresentation {
	const actions = notification.actions ?? [];
	if (notification.type !== 'ownership_transfer') {
		return { title: notification.title, body: notification.body, actions };
	}
	const payload = parseSemanticPayload(notification.payload_json);
	if (payload.kind !== ownershipKind || !payload.organization_name) {
		return { title: notification.title, body: notification.body, actions };
	}
	return {
		title: m.notifications_ownership_transfer_title(),
		body: m.notifications_ownership_transfer_body({ organization: payload.organization_name }),
		actions: actions.map((action) =>
			action.label === ownershipReviewAction
				? { ...action, label: m.notifications_ownership_transfer_review() }
				: action
		)
	};
}

function parseOptionalPayloadString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parseSemanticPayload(raw: string): SemanticNotificationPayload {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		// SAFETY: The guard above proves JSON.parse returned a non-array object; the local
		// SemanticPayloadRecord keeps only the optional fields this parser accepts.
		const payload = parsed as SemanticPayloadRecord;
		return {
			kind: parseOptionalPayloadString(payload.kind),
			organization_name: parseOptionalPayloadString(payload.organization_name)
		};
	} catch {
		return {};
	}
}
