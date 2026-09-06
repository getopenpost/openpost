import { configureTelemetry } from '@openpost/telemetry';

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

type RuntimeTelemetryValue =
	| string
	| number
	| boolean
	| null
	| RuntimeTelemetryValue[]
	| { [key: string]: RuntimeTelemetryValue };

function telemetryFields(
	value: RuntimeTelemetryValue
): { [key: string]: RuntimeTelemetryValue } | null {
	if (value === null || Array.isArray(value) || Object(value) !== value) return null;
	// SAFETY: The recursive JSON union and checks above establish a non-array object.
	return value as { [key: string]: RuntimeTelemetryValue };
}

function telemetryString(value: RuntimeTelemetryValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

function parseRuntimeTelemetryConfig(value: RuntimeTelemetryValue): RuntimeTelemetryConfig | null {
	const fields = telemetryFields(value);
	if (!fields || Boolean(fields.enabled) !== fields.enabled) return null;
	const environment = telemetryString(fields.environment);
	const edition = telemetryString(fields.edition);
	if (!environment || !edition) return null;
	return {
		enabled: Boolean(fields.enabled),
		environment,
		edition,
		project_token: telemetryString(fields.project_token),
		api_host: telemetryString(fields.api_host),
		ui_host: telemetryString(fields.ui_host),
		version: telemetryString(fields.version),
		revision: telemetryString(fields.revision)
	};
}

export async function initializeAppTelemetry(): Promise<void> {
	try {
		const response = await fetch('/api/v1/telemetry/config', {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!response.ok) throw new Error(`telemetry config returned ${response.status}`);
		const payload: RuntimeTelemetryValue = await response.json();
		const config = parseRuntimeTelemetryConfig(payload);
		if (!config) throw new Error('telemetry config response was invalid');
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
