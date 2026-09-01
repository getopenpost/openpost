import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException, installGlobalErrorCapture } from '@openpost/telemetry';

export async function init() {
	initializeClientErrors(installGlobalErrorCapture);
}

type ErrorCaptureInstaller = () => () => void;

export function initializeClientErrors(installErrorCapture: ErrorCaptureInstaller) {
	detectStaleChunks();
	installErrorCapture();
}

/**
 * Chunk load failures have two distinct causes that look identical in the
 * browser:
 *
 * 1. **Stale deployment** - old Vite chunk hashes are no longer on the server.
 *    Any dynamic `import()` fails with "Failed to fetch dynamically imported
 *    module".
 * 2. **Dev race (F-007)** - on the first `vite dev` load the browser requests a
 *    generated SvelteKit client node (/_app/immutable/nodes/… or
 *    .svelte-kit/generated/…) before Vite has finished transforming it. Vite
 *    returns a temporary 500 / transform error and the import rejects with the
 *    same message plus a URL suffix, or with "Importing a module script failed".
 *
 * Both cases are transient and recover after the module is available. We
 * handle them in two ways:
 *
 * 1. **Proactive** - reload when a new service-worker controller takes over
 *    (fresh deployment).
 * 2. **Reactive** - intercept chunk-load errors/rejections and reload with
 *    exponential back-off and a session-storage guard (covers both stale chunks
 *    and the dev race). The broad substring check is intentional: Chrome and
 *    Firefox append the failing URL to the message, so an exact equality check
 *    misses the real error.
 */
function detectStaleChunks() {
	// --- proactive: reload when a new service-worker controller takes over ---
	if ('serviceWorker' in navigator) {
		let hadController = navigator.serviceWorker.controller !== null;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (!hadController) {
				hadController = true;
				return;
			}
			window.location.reload();
		});
	}

	// --- reactive: catch stale-chunk / dev-race errors and reload ---
	const isChunkLoadError = (error: unknown): boolean => {
		// SAFETY: narrowing unknown error to extract message for chunk-load detection; checked via typeof and existence before access
		const raw =
			error instanceof Error
				? error.message
				: typeof error === 'string'
					? error
					: error != null &&
						  // SAFETY: checked that error is object-like with message property before reading
						  typeof (error as { message?: unknown }).message === 'string'
						? // SAFETY: same narrowed check ensures message is string
							String((error as { message: unknown }).message)
						: String(error ?? '');
		if (raw.includes('Failed to fetch dynamically imported module')) return true;
		if (raw.includes('Importing a module script failed')) return true;
		// Vite dev transform failure that surfaces through a dynamic import
		// (e.g. "Failed to load url /_app/immutable/nodes/…" during first compile).
		if (raw.includes('Failed to load url') && raw.includes('_app/')) return true;
		if (raw.includes('Failed to fetch') && raw.includes('_app/immutable')) return true;
		return false;
	};

	const CHUNK_RELOAD_KEY = 'openpost:chunk-reload';
	const MAX_RETRIES = 3;
	const RETRY_WINDOW_MS = 15_000;

	type RetryState = { count: number; at: number };
	function getRetryState(): RetryState {
		try {
			const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
			if (!raw) return { count: 0, at: 0 };
			// SAFETY: JSON parsed from our own storage key, validated by shape check below before use
			const parsed = JSON.parse(raw) as RetryState;
			if (Date.now() - parsed.at > RETRY_WINDOW_MS) return { count: 0, at: 0 };
			return parsed;
		} catch {
			return { count: 0, at: 0 };
		}
	}

	const reloadWithBackoff = () => {
		const state = getRetryState();
		const nextCount = state.count + 1;
		if (nextCount > MAX_RETRIES) return;
		try {
			sessionStorage.setItem(
				CHUNK_RELOAD_KEY,
				JSON.stringify({ count: nextCount, at: Date.now() })
			);
		} catch {
			// ignore storage failures
		}
		// Exponential back-off: dev race usually resolves within one Vite transform
		// cycle (~200-600ms). Stagger retries so we do not hammer the dev server.
		const delayMs = nextCount === 1 ? 300 : nextCount === 2 ? 800 : 1500;
		window.setTimeout(() => {
			const doReload = () => window.location.reload();
			void caches
				?.keys()
				?.then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
				?.then(doReload, doReload);
		}, delayMs);
	};

	// Clear retry state on successful load so a later unrelated failure gets a
	// fresh budget. Also handles the case where the user manually reloaded.
	window.addEventListener('load', () => {
		const state = getRetryState();
		if (state.count > 0 && Date.now() - state.at > 2000) {
			try {
				sessionStorage.removeItem(CHUNK_RELOAD_KEY);
			} catch {
				// ignore
			}
		}
	});

	// Vite emits `vite:preloadError` for failed preloads (SvelteKit route nodes).
	// Use it as an additional signal alongside error/unhandledrejection.
	window.addEventListener('vite:preloadError', (event) => {
		// SAFETY: Vite attaches the rejected import to its custom `payload` field.
		const payload = (event as Event & { payload?: unknown }).payload;
		if (isChunkLoadError(payload)) {
			// SAFETY: preventDefault is safe on Event, narrowed from CustomEvent
			(event as Event).preventDefault();
			reloadWithBackoff();
		}
	});

	window.addEventListener('error', (event) => {
		if (isChunkLoadError(event.error ?? event.message)) {
			// Prevent SvelteKit from rendering +error.svelte for a transient chunk
			// failure; the reload will recover the page without showing a failure
			// state (F-007 graceful reload).
			// SAFETY: error event is an ErrorEvent, preventDefault exists on Event
			(event as Event).preventDefault();
			reloadWithBackoff();
		}
	});
	window.addEventListener('unhandledrejection', (event) => {
		if (isChunkLoadError(event.reason)) {
			// SAFETY: unhandledrejection event is PromiseRejectionEvent, preventDefault exists
			(event as Event).preventDefault();
			reloadWithBackoff();
		}
	});
}

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	captureClientException(error, { error_boundary: 'sveltekit', status });
};
