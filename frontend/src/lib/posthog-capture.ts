import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_PROJECT_TOKEN } from '$env/static/public';
import posthog from 'posthog-js';

type EventProperties = Record<string, boolean | number | string | undefined>;

export function capturePostHogEvent(event: string, properties?: EventProperties): void {
	if (!PUBLIC_POSTHOG_PROJECT_TOKEN || !PUBLIC_POSTHOG_HOST) return;
	posthog.capture(event, properties);
}
