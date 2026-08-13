import posthogRollupPlugin from '@posthog/rollup-plugin';
import type { PluginOption } from 'vite';

export function postHogSourceMaps(surface: 'app' | 'marketing' | 'docs') {
	const enabled = process.env.POSTHOG_SOURCEMAPS_ENABLED === '1';
	if (!enabled) return { enabled: false, plugins: [] as PluginOption[] };

	const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
	const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
	if (!personalApiKey || !projectId) {
		throw new Error(
			'POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required when PostHog source-map upload is enabled'
		);
	}
	const releaseVersion =
		process.env.OPENPOST_RELEASE_VERSION?.trim() ||
		process.env.GITHUB_SHA?.trim() ||
		process.env.VITE_OPENPOST_REVISION?.trim();
	if (!releaseVersion) {
		throw new Error(
			'OPENPOST_RELEASE_VERSION, GITHUB_SHA, or VITE_OPENPOST_REVISION is required when PostHog source-map upload is enabled'
		);
	}

	const plugin = posthogRollupPlugin({
		personalApiKey,
		projectId,
		host: process.env.POSTHOG_UI_HOST?.trim() || 'https://us.posthog.com',
		logLevel: 'info',
		sourcemaps: {
			enabled: true,
			releaseName: `openpost-${surface}`,
			releaseVersion,
			build: process.env.GITHUB_RUN_ID?.trim(),
			deleteAfterUpload: true
		}
	});
	return { enabled: true, plugins: [plugin as unknown as PluginOption] };
}
