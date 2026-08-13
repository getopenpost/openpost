import { configureTelemetry } from '@openpost/telemetry';
import { getApiBase } from '$lib/stores/instance.svelte';

interface RuntimeTelemetryConfig {
	enabled: boolean;
	project_token?: string;
	api_host?: string;
	ui_host?: string;
	environment: string;
	edition: string;
	version?: string;
	revision?: string;
}

export async function initializeAppTelemetry(): Promise<void> {
	try {
		const response = await fetch(`${getApiBase()}/telemetry/config`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!response.ok) throw new Error(`telemetry config returned ${response.status}`);
		const config = (await response.json()) as RuntimeTelemetryConfig;
		configureTelemetry({
			enabled: config.enabled,
			projectToken: config.project_token,
			apiHost: config.api_host,
			uiHost: config.ui_host,
			environment: config.environment,
			edition: config.edition,
			version: config.version,
			revision: config.revision,
			surface: 'app'
		});
	} catch {
		configureTelemetry({
			enabled: false,
			environment: 'unknown',
			edition: 'unknown',
			surface: 'app'
		});
	}
}
