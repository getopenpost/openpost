const reloadStateKey = 'openpost:chunk-reload';
const retryWindowMs = 15_000;
const maxRetries = 3;

interface RecoveryRuntime extends EventTarget {
	location: { reload: () => void };
	setTimeout: (callback: () => void, delay: number) => unknown;
	sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
}

interface RetryState {
	count: number;
	at: number;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string') return message;
	}
	return '';
}

function isStaleModuleError(error: unknown): boolean {
	const message = errorMessage(error);
	return (
		message.includes('Importing a module script failed') ||
		message.includes('Failed to fetch dynamically imported module') ||
		(message.includes('Failed to fetch') && message.includes('/_app/immutable/'))
	);
}

function retryState(runtime: RecoveryRuntime): RetryState {
	try {
		const raw = runtime.sessionStorage.getItem(reloadStateKey);
		if (!raw) return { count: 0, at: 0 };
		const state = JSON.parse(raw) as Partial<RetryState>;
		if (typeof state.count !== 'number' || typeof state.at !== 'number') return { count: 0, at: 0 };
		if (Date.now() - state.at > retryWindowMs) return { count: 0, at: 0 };
		return state as RetryState;
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
	const recover = (event: Event, error: unknown) => {
		if (!isStaleModuleError(error)) return;
		event.preventDefault();
		reload();
	};
	const onError = (event: Event) => {
		const errorEvent = event as Event & { error?: unknown; message?: string };
		recover(event, errorEvent.error ?? errorEvent.message);
	};
	const onUnhandledRejection = (event: Event) => {
		recover(event, (event as Event & { reason?: unknown }).reason);
	};
	const onPreloadError = (event: Event) => {
		const preloadEvent = event as Event & {
			payload?: unknown;
			detail?: unknown;
		};
		recover(event, preloadEvent.payload ?? preloadEvent.detail);
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
