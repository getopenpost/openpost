import posthog from 'posthog-js';

export type TelemetrySurface = 'app' | 'marketing' | 'docs';

export interface BrowserTelemetryConfig {
	enabled: boolean;
	projectToken?: string;
	apiHost?: string;
	uiHost?: string;
	environment: string;
	edition: string;
	version?: string;
	revision?: string;
	surface: TelemetrySurface;
}

export interface TelemetryEventMap {
	'publication publish requested': { account_count: number; is_thread: boolean };
	'publication schedule requested': { account_count: number; is_thread: boolean };
	'media uploaded': { count: number; source: 'upload' | 'camera' | 'stock_import' };
	'image design created': { source: 'custom' | 'preset' | 'template' | 'media' };
	'image design exported': { mode: string; pages: number };
	'social account connected': { account_count: number; platform: string };
	'billing checkout opened': { billing_period: string; plan_id: string };
	'workspace created': Record<string, never>;
	'video project created': {
		source: 'openpost_media' | 'files' | 'blank' | 'recording' | 'stock';
		editing_mode?: string;
		file_count?: number;
	};
	'video export completed': { format: string; variant_count: number };
	'public editor opened': { editor: 'image' | 'video'; source: 'marketing_tool' };
	'public image editor viewed': Record<string, string | number | boolean>;
	'public image design started': Record<string, string | number | boolean>;
	'public image editor meaningful edit': Record<string, string | number | boolean>;
	'public image export completed': Record<string, string | number | boolean>;
	'public image editor signup clicked': Record<string, string | number | boolean>;
	'public image editor signup completed': Record<string, string | number | boolean>;
	'public image workspace import completed': Record<string, string | number | boolean>;
	'docs search used': { result_count?: number };
	'docs code copied': { language?: string };
}

export type TelemetryEventName = keyof TelemetryEventMap;

interface BrowserSDK {
	init(token: string, options: Record<string, unknown>): unknown;
	capture(event: string, properties?: Record<string, unknown>): unknown;
	captureException(error: Error, properties?: Record<string, unknown>): unknown;
	identify(distinctID: string): unknown;
	register(properties: Record<string, unknown>): unknown;
	reset(): unknown;
	opt_out_capturing(): unknown;
	get_distinct_id?(): string;
	get_session_id?(): string;
}

type PendingEvent = {
	name: TelemetryEventName;
	properties: Record<string, unknown>;
};

type PendingPageView = { pathname: string; title: string };
type PendingException = { error: Error; properties: Record<string, unknown> };

const maxPendingEvents = 100;

export class BrowserTelemetry {
	private configured = false;
	private disabled = false;
	private activeUserID: string | null = null;
	private pendingUserID: string | null = null;
	private pendingEvents: PendingEvent[] = [];
	private pendingPageViews: PendingPageView[] = [];
	private pendingExceptions: PendingException[] = [];
	private capturedErrors = new WeakSet<object>();

	constructor(
		private readonly sdk: BrowserSDK,
		private readonly runtimeAvailable: () => boolean = () => typeof window !== 'undefined'
	) {}

	configure(config: BrowserTelemetryConfig): void {
		if (!this.runtimeAvailable()) return;
		if (!config.enabled || !config.projectToken?.trim() || !config.apiHost?.trim()) {
			this.disabled = true;
			this.pendingEvents = [];
			this.pendingPageViews = [];
			this.pendingExceptions = [];
			if (this.configured) this.sdk.opt_out_capturing();
			return;
		}

		this.sdk.init(config.projectToken.trim(), {
			api_host: config.apiHost.trim().replace(/\/+$/, ''),
			...(config.uiHost?.trim()
				? { ui_host: config.uiHost.trim().replace(/\/+$/, '') }
				: {}),
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			capture_heatmaps: false,
			capture_performance: false,
			capture_exceptions: false,
			disable_session_recording: true,
			disable_surveys: true,
			cross_subdomain_cookie: false,
			persistence: 'memory',
			cookieless_mode: 'always',
			person_profiles: config.surface === 'app' ? 'identified_only' : 'never',
			respect_dnt: true
		});
		this.sdk.register(compactProperties({
			surface: config.surface,
			environment: config.environment,
			edition: config.edition,
			version: config.version,
			revision: config.revision
		}));
		this.configured = true;
		this.disabled = false;

		if (this.pendingUserID) {
			this.identify(this.pendingUserID);
		}
		for (const event of this.pendingEvents.splice(0)) {
			this.sdk.capture(event.name, event.properties);
		}
		for (const pageView of this.pendingPageViews.splice(0)) {
			this.capturePageView(pageView.pathname, pageView.title);
		}
		for (const exception of this.pendingExceptions.splice(0)) {
			this.sdk.captureException(exception.error, exception.properties);
		}
	}

	capture<Name extends TelemetryEventName>(
		name: Name,
		...args: TelemetryEventMap[Name] extends Record<string, never>
			? [properties?: TelemetryEventMap[Name]]
			: [properties: TelemetryEventMap[Name]]
	): void {
		if (this.disabled) return;
		const properties = compactProperties((args[0] ?? {}) as Record<string, unknown>);
		if (!this.configured) {
			if (this.pendingEvents.length < maxPendingEvents) this.pendingEvents.push({ name, properties });
			return;
		}
		this.sdk.capture(name, properties);
	}

	capturePageView(pathname: string, title = document.title): void {
		if (this.disabled || typeof window === 'undefined') return;
		if (!this.configured) {
			if (this.pendingPageViews.length < maxPendingEvents) {
				this.pendingPageViews.push({ pathname, title });
			}
			return;
		}
		const path = cleanPath(pathname);
		this.sdk.capture('$pageview', {
			$current_url: `${window.location.origin}${path}`,
			path,
			title
		});
	}

	identify(userID: string): void {
		const normalized = userID.trim();
		if (!normalized) {
			this.resetIdentity();
			return;
		}
		this.pendingUserID = normalized;
		if (!this.configured || this.disabled || this.activeUserID === normalized) return;
		if (this.activeUserID !== null) this.sdk.reset();
		this.sdk.identify(normalized);
		this.activeUserID = normalized;
	}

	resetIdentity(): void {
		this.pendingUserID = null;
		this.activeUserID = null;
		if (this.configured) this.sdk.reset();
	}

	captureException(error: unknown, properties: Record<string, unknown> = {}): void {
		if (this.disabled) return;
		if (typeof error === 'object' && error !== null) {
			if (this.capturedErrors.has(error)) return;
			this.capturedErrors.add(error);
		}
		const sanitized = sanitizeError(error);
		const compacted = compactProperties(properties);
		if (!this.configured) {
			if (this.pendingExceptions.length < maxPendingEvents) {
				this.pendingExceptions.push({ error: sanitized, properties: compacted });
			}
			return;
		}
		this.sdk.captureException(sanitized, compacted);
	}

	requestHeaders(): Record<string, string> {
		if (!this.configured || this.disabled) return {};
		const distinctID = this.sdk.get_distinct_id?.();
		const sessionID = this.sdk.get_session_id?.();
		return compactProperties({
			'X-PostHog-Distinct-ID': distinctID,
			'X-PostHog-Session-ID': sessionID
		}) as Record<string, string>;
	}
}

const telemetry = new BrowserTelemetry(posthog as unknown as BrowserSDK);

export function configureTelemetry(config: BrowserTelemetryConfig): void {
	telemetry.configure(config);
}

export function captureTelemetryEvent<Name extends TelemetryEventName>(
	name: Name,
	...args: TelemetryEventMap[Name] extends Record<string, never>
		? [properties?: TelemetryEventMap[Name]]
		: [properties: TelemetryEventMap[Name]]
): void {
	telemetry.capture(name, ...(args as never));
}

export function captureTelemetryPageView(pathname: string, title?: string): void {
	telemetry.capturePageView(pathname, title);
}

export function identifyTelemetryUser(userID: string): void {
	telemetry.identify(userID);
}

export function resetTelemetryIdentity(): void {
	telemetry.resetIdentity();
}

export function captureClientException(
	error: unknown,
	properties: Record<string, unknown> = {}
): void {
	telemetry.captureException(error, properties);
}

export function telemetryRequestHeaders(): Record<string, string> {
	return telemetry.requestHeaders();
}

export function installGlobalErrorCapture(): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const onError = (event: ErrorEvent) => {
		captureClientException(event.error ?? new Error(event.message), {
			error_boundary: 'window_error'
		});
	};
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		captureClientException(event.reason, { error_boundary: 'unhandled_rejection' });
	};
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onUnhandledRejection);
	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onUnhandledRejection);
	};
}

function compactProperties(properties: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(properties)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, sanitizePropertyValue(value)])
	);
}

function cleanPath(pathname: string): string {
	try {
		return new URL(pathname, 'https://openpost.invalid').pathname;
	} catch {
		return '/';
	}
}

function sanitizeError(value: unknown): Error {
	const source = value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Unknown client error');
	const result = new Error(scrubPropertyString(source.message || 'Unknown client error'));
	result.name = source.name || 'Error';
	if (source.stack) result.stack = scrubStack(source.stack);
	return result;
}

function sanitizePropertyValue(value: unknown): unknown {
	if (typeof value === 'string') return scrubPropertyString(value);
	if (Array.isArray(value)) return value.map(sanitizePropertyValue);
	if (value && typeof value === 'object') {
		return compactProperties(value as Record<string, unknown>);
	}
	return value;
}

function scrubPropertyString(value: string): string {
	return truncate(scrubSensitiveText(value).replace(/https?:\/\/[^\s)\]}]+/gi, '[redacted-url]'), 200);
}

function scrubStack(value: string): string {
	return scrubSensitiveText(value).replace(/(https?:\/\/[^\s?#)\]}]+)[?#][^\s)\]}]+/gi, '$1');
}

function scrubSensitiveText(value: string): string {
	return value
		.replace(/([?&](?:token|code|secret|key|signature|state)=)[^&\s)]+/gi, '$1[redacted]')
		.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]');
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
