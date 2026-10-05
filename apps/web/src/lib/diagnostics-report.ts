import { page } from '$app/state';
import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';

export type BrowserFailureKind = 'error' | 'unhandledrejection';
type BrowserErrorKind = NonNullable<
	components['schemas']['SubmitDiagnosticsInputBody']['error_kind']
>;

export interface NormalizedBrowserFailure {
	code: 'browser_uncaught' | 'browser_unhandled_rejection';
	location: string;
	errorKind?: BrowserErrorKind;
	frames?: components['schemas']['SubmitDiagnosticsInputBody']['frames'];
}

export interface BrowserDiagnosticsGate {
	doNotTrack: string | null | undefined;
	globalPrivacyControl: boolean | undefined;
	configEnabled: boolean;
}

export interface MaintainerDiagnosticsTransport {
	postReport(body: {
		surface: 'browser';
		operation: string;
		error_code: NormalizedBrowserFailure['code'];
		error_kind?: BrowserErrorKind;
		frames?: NormalizedBrowserFailure['frames'];
	}): Promise<void>;
}

export const MAX_BROWSER_DIAGNOSTICS_PER_SESSION = 10;

// Chunk-load failures are deployment skew with their own bounded recovery;
// they must not become maintainer bug reports.
const CHUNK_LOAD_SIGNALS = [
	'Failed to fetch dynamically imported module',
	// Firefox wording for the same stale-deployment failure.
	'error loading dynamically imported module',
	'Importing a module script failed',
	'Loading chunk',
	'Loading CSS chunk'
];

const browserErrorKinds = new Map<string, BrowserErrorKind>([
	['TypeError', 'type_error'],
	['ReferenceError', 'reference_error'],
	['RangeError', 'range_error'],
	['SyntaxError', 'syntax_error'],
	['QuotaExceededError', 'quota_exceeded'],
	['SecurityError', 'security_error'],
	['NotSupportedError', 'not_supported'],
	['InvalidStateError', 'invalid_state'],
	['AbortError', 'abort_error'],
	['NetworkError', 'network_error']
]);

const maxBrowserFrames = 24;

// Free-form messages stay local because they can contain authored content,
// URLs and tokens. Only known types and compiled application callsites leave.
export function normalizeBrowserFailure(
	kind: BrowserFailureKind,
	name: string,
	message: string,
	stack: string | undefined,
	routePath: string,
	appOrigin?: string
): NormalizedBrowserFailure | null {
	const text = `${name} ${message}`;
	if (CHUNK_LOAD_SIGNALS.some((signal) => text.includes(signal))) return null;
	const frames = firstPartyFrames(stack, appOrigin);
	const first = frames[0];
	let location = first ? `${first.module}:${first.line}` : safeOperation(routePath);
	if (first?.column) location += `:${first.column}`;
	if (!location) return null;
	const failure: NormalizedBrowserFailure = {
		code: kind === 'unhandledrejection' ? 'browser_unhandled_rejection' : 'browser_uncaught',
		location,
		errorKind: browserErrorKinds.get(name)
	};
	if (frames.length) failure.frames = frames;
	return failure;
}

// maintainerDiagnosticsAllowed is the browser-side reporting gate. Browser
// privacy signals always win: Do Not Track or Global Privacy Control forces
// the channel off regardless of the instance switch.
export function maintainerDiagnosticsAllowed(gate: BrowserDiagnosticsGate): boolean {
	if (gate.doNotTrack === '1' || gate.doNotTrack === 'yes') return false;
	if (gate.globalPrivacyControl === true) return false;
	return gate.configEnabled === true;
}

const reportedKeys = new Set<string>();

export function resetBrowserDiagnosticsForTests() {
	reportedKeys.clear();
}

// maybeReportBrowserFailure sends one normalized failure per session key
// (code + kind + location) with a small session cap, so a render loop cannot flood
// the instance. A send is attempted at most once per key; transport failures
// stay silent and never surface in the UI.
export async function maybeReportBrowserFailure(
	failure: NormalizedBrowserFailure,
	transport: MaintainerDiagnosticsTransport
): Promise<boolean> {
	const key = `${failure.code}|${failure.errorKind ?? ''}|${failure.location}`;
	if (reportedKeys.has(key) || reportedKeys.size >= MAX_BROWSER_DIAGNOSTICS_PER_SESSION) {
		return false;
	}
	reportedKeys.add(key);
	try {
		const body: Parameters<MaintainerDiagnosticsTransport['postReport']>[0] = {
			surface: 'browser',
			operation: failure.location,
			error_code: failure.code
		};
		if (failure.errorKind) body.error_kind = failure.errorKind;
		if (failure.frames?.length) body.frames = failure.frames;
		await transport.postReport(body);
		return true;
	} catch {
		return false;
	}
}

function firstPartyFrames(
	stack: string | undefined,
	appOrigin: string | undefined
): NonNullable<NormalizedBrowserFailure['frames']> {
	if (!stack) return [];
	const frames: NonNullable<NormalizedBrowserFailure['frames']> = [];
	for (const line of stack.split('\n')) {
		if (!/^\s*at\s/.test(line) && !/^[A-Za-z0-9_.$<>]*@/.test(line)) continue;
		const location = appRelativeLocation(line, appOrigin);
		if (!location) continue;
		const [module, sourceLine, sourceColumn] = location.split(':');
		const frame: NonNullable<NormalizedBrowserFailure['frames']>[number] = {
			module,
			function: 'browser',
			line: Number(sourceLine ?? 0)
		};
		if (sourceColumn) frame.column = Number(sourceColumn);
		frames.push(frame);
		if (frames.length === maxBrowserFrames) break;
	}
	return frames;
}

function appRelativeLocation(line: string, appOrigin: string | undefined): string | null {
	// Capture the script path and an optional :line[:col] suffix. The path
	// match stops before query strings, fragments, and closing parens; the
	// suffix is parsed separately because URL parsers keep :line:col as path.
	const match = /((?:https?:\/\/|\/)[^\s)]*?\.js)((?::\d+){1,2})?/.exec(line);
	if (!match) return null;
	let path = match[1];
	if (/^https?:\/\//.test(path)) {
		try {
			const url = new URL(path);
			if (!appOrigin || url.origin !== appOrigin) return null;
			path = url.pathname;
		} catch {
			return null;
		}
	}
	path = path.split('?')[0].split('#')[0];
	if (!path.startsWith('/_app/immutable/')) return null;
	const candidate = `${path}${match[2] ?? ''}`.slice(0, 160);
	return /^[A-Za-z0-9_/.:-]{1,160}$/.test(candidate) ? candidate : null;
}

function safeOperation(routePath: string): string | null {
	// Callers supply route templates, never pathname. Remove SvelteKit groups
	// and parameter names before restricting the remaining static route text.
	const cleaned = routePath
		.replace(/\/\([^/]+\)/g, '')
		.replace(/\[[^/]+\]/g, ':param')
		.split('?')[0]
		.split('#')[0]
		.replace(/[^A-Za-z0-9_/.:-]/g, '-')
		.slice(0, 160);
	if (!cleaned.startsWith('/') || cleaned === '/') return cleaned === '/' ? '/' : null;
	return cleaned;
}

let configPromise: Promise<boolean> | null = null;

function readPrivacySignals(): Pick<BrowserDiagnosticsGate, 'doNotTrack' | 'globalPrivacyControl'> {
	if (typeof navigator === 'undefined') return { doNotTrack: null, globalPrivacyControl: false };
	return {
		doNotTrack: typeof navigator.doNotTrack === 'string' ? navigator.doNotTrack : null,
		// SAFETY: globalPrivacyControl is a documented optional Navigator field;
		// the assertion only reads it and treats every non-true value as absent.
		globalPrivacyControl:
			(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
	};
}

async function maintainerDiagnosticsEnabled(): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	const signals = readPrivacySignals();
	if (signals.doNotTrack === '1' || signals.doNotTrack === 'yes') return false;
	if (signals.globalPrivacyControl === true) return false;
	configPromise ??= client.GET('/diagnostics/public-config', {}).then(
		({ data }) =>
			maintainerDiagnosticsAllowed({
				...signals,
				configEnabled: data?.enabled === true
			}),
		() => false
	);
	return configPromise;
}

async function sendNormalized(kind: BrowserFailureKind, error: Error): Promise<void> {
	if (!(await maintainerDiagnosticsEnabled())) return;
	const failure = normalizeBrowserFailure(
		kind,
		error.name,
		error.message,
		error.stack,
		page.route.id ?? '/unknown',
		page.url.origin
	);
	if (!failure) return;
	await maybeReportBrowserFailure(failure, {
		postReport: (body) => client.POST('/diagnostics/report', { body }).then(() => undefined)
	});
}

// installMaintainerDiagnosticsCapture reports uncaught browser failures
// through the viewer's own instance, parallel to (never replacing) the
// operator's analytics channel. No direct external path exists: when the
// backend is down, browser reports are lost rather than rerouted.
export function installMaintainerDiagnosticsCapture(): () => void {
	if (typeof window === 'undefined') return () => undefined;
	let active = true;
	const onError = (event: ErrorEvent) => {
		if (!active || event.defaultPrevented) return;
		const error = event.error instanceof Error ? event.error : new Error(event.message);
		void sendNormalized('error', error);
	};
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		if (!active || event.defaultPrevented) return;
		const reason =
			event.reason instanceof Error ? event.reason : new Error('Unhandled promise rejection');
		void sendNormalized('unhandledrejection', reason);
	};
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onUnhandledRejection);
	return () => {
		active = false;
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onUnhandledRejection);
	};
}
