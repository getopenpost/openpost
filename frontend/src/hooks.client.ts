import { dev } from '$app/environment';
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_PROJECT_TOKEN } from '$env/static/public';
import type { HandleClientError } from '@sveltejs/kit';
import posthog from 'posthog-js';

const posthogConfigured = Boolean(PUBLIC_POSTHOG_PROJECT_TOKEN && PUBLIC_POSTHOG_HOST);

export async function init() {
	if (!PUBLIC_POSTHOG_PROJECT_TOKEN) {
		if (dev) {
			throw new Error(
				'PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once PUBLIC_POSTHOG_PROJECT_TOKEN is configured'
			);
		}

		return;
	}

	if (!PUBLIC_POSTHOG_HOST) {
		if (dev) {
			throw new Error(
				'PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once PUBLIC_POSTHOG_HOST is configured'
			);
		}

		return;
	}

	posthog.init(PUBLIC_POSTHOG_PROJECT_TOKEN, {
		api_host: PUBLIC_POSTHOG_HOST,
		defaults: '2026-05-30',
		capture_exceptions: {
			capture_unhandled_errors: true,
			capture_unhandled_rejections: true,
			capture_console_errors: false
		}
	});
}

export const handleError: HandleClientError = ({ error }) => {
	if (posthogConfigured) {
		posthog.captureException(error);
	}
};
