/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion -- Browser error events and persisted JSON are untyped I/O boundaries; this module narrows their fields before use. */

const reloadStateKey = 'openpost:chunk-reload';
const retryWindowMs = 15_000;
const maxRetries = 3;

interface RecoveryRuntime extends EventTarget {
	location: { reload: () => void };
	setTimeout: (callback: () => void, delay: number) => number;
	sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
}

interface RetryState {
	count: number;
	at: number;
}

function parseErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		const message = error.message;
		if (typeof message === 'string') return message;
	}
	return '';
}

function isStaleModuleMessage(message: string): boolean {
	return (
		message.includes('Importing a module script failed') ||
		message.includes('Failed to fetch dynamically imported module') ||
		(message.includes('Failed to fetch') && message.includes('/_app/immutable/'))
	);
}

function parseErrorEventMessage(event: Event): string {
	// SAFETY: Browser error events add these optional fields to the base Event delivered to this listener.
	const errorEvent = event as Event & { error?: unknown; message?: string };
	return parseErrorMessage(errorEvent.error ?? errorEvent.message);
}

function parseUnhandledRejectionMessage(event: Event): string {
	// SAFETY: Browser unhandledrejection events add reason to the base Event delivered to this listener.
	const rejectionEvent = event as Event & { reason?: unknown };
	return parseErrorMessage(rejectionEvent.reason);
}

function parsePreloadErrorMessage(event: Event): string {
	// SAFETY: Vite preload error events use payload or detail for the failed import error.
	const preloadEvent = event as Event & { payload?: unknown; detail?: unknown };
	return parseErrorMessage(preloadEvent.payload ?? preloadEvent.detail);
}

function isRetryState(value: unknown): value is RetryState {
	return (
		value !== null &&
		typeof value === 'object' &&
		'count' in value &&
		typeof value.count === 'number' &&
		'at' in value &&
		typeof value.at === 'number'
	);
}

function retryState(runtime: RecoveryRuntime): RetryState {
	try {
		const raw = runtime.sessionStorage.getItem(reloadStateKey);
		if (!raw) return { count: 0, at: 0 };
		const state: unknown = JSON.parse(raw);
		if (!isRetryState(state)) return { count: 0, at: 0 };
		if (Date.now() - state.at > retryWindowMs) return { count: 0, at: 0 };
		return state;
	} catch {
		return { count: 0, at: 0 };
	}
}

export function installStaleModuleRecovery(runtime: RecoveryRuntime = window): () => void {
	const reload = () => {
		const state = retryState(runtime);
		const count = state.count + 1;
		if (count > maxRetries) return;
		try {
			runtime.sessionStorage.setItem(reloadStateKey, JSON.stringify({ count, at: Date.now() }));
		} catch {
			// Storage can be unavailable in private browsing. A single page reload still recovers.
		}
		runtime.setTimeout(
			() => runtime.location.reload(),
			count === 1 ? 300 : count === 2 ? 800 : 1500
		);
	};
	const recover = (event: Event, message: string) => {
		if (!isStaleModuleMessage(message)) return;
		event.preventDefault();
		reload();
	};
	const onError = (event: Event) => {
		recover(event, parseErrorEventMessage(event));
	};
	const onUnhandledRejection = (event: Event) => {
		recover(event, parseUnhandledRejectionMessage(event));
	};
	const onPreloadError = (event: Event) => {
		recover(event, parsePreloadErrorMessage(event));
	};

	runtime.addEventListener('error', onError);
	runtime.addEventListener('unhandledrejection', onUnhandledRejection);
	runtime.addEventListener('vite:preloadError', onPreloadError);
	return () => {
		runtime.removeEventListener('error', onError);
		runtime.removeEventListener('unhandledrejection', onUnhandledRejection);
		runtime.removeEventListener('vite:preloadError', onPreloadError);
	};
}
