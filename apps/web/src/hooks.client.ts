/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- SvelteKit delivers untyped errors to this boundary; the helpers below narrow them before use. */
import type { HandleClientError } from '@sveltejs/kit';
import { installMaintainerDiagnosticsCapture } from '$lib/diagnostics-report';
import { installCryptoRandomUUID } from '$lib/crypto-random-uuid';
import {
	captureClientException,
	createChunkRecovery,
	extractFirstPartyAssetPath,
	installGlobalErrorCapture,
	isChunkLoadError,
	isUnsupportedBrowserError
} from '@openpost/telemetry';

type ErrorCaptureInstaller = () => () => void;

function createAppChunkRecovery() {
	return createChunkRecovery({
		// Editors must never silently discard work: while the layout reports
		// unsaved changes, chunk failures fall back to the error boundary's
		// explicit retry instead of an automatic reload.
		canAutoReload: () =>
			typeof document === 'undefined' || document.documentElement.dataset.unsavedChanges !== '1',
		scheduleReload: (delayMs) => {
			window.setTimeout(() => {
				const doReload = () => window.location.reload();
				if (!('caches' in window)) {
					doReload();
					return;
				}
				void window.caches
					.keys()
					.then((keys) =>
						Promise.all(
							keys
								.filter((key) => key.startsWith('openpost-pages-'))
								.map((key) => window.caches.delete(key))
						)
					)
					.then(doReload, doReload);
			}, delayMs);
		}
	});
}

let chunkRecovery = createAppChunkRecovery();
let uninstallChunkRecovery: (() => void) | null = null;
let uninstallErrorCapture: (() => void) | null = null;

export function initializeClientErrors(installErrorCapture: ErrorCaptureInstaller) {
	uninstallChunkRecovery?.();
	uninstallErrorCapture?.();
	// A fresh controller per initialization keeps single-flight state scoped
	// to its listeners; the persisted attempt budget still carries over.
	chunkRecovery = createAppChunkRecovery();
	uninstallChunkRecovery = chunkRecovery.install();
	uninstallErrorCapture = installErrorCapture();
}

/**
 * Chunk load failures have two distinct causes that look identical in the
 * browser:
 *
 * 1. **Stale deployment** - old Vite chunk hashes are no longer on the server.
 *    Any dynamic `import()` fails (Chrome: "Failed to fetch dynamically imported
 *    module", Firefox: "error loading dynamically imported module").
 * 2. **Dev race (F-007)** - on the first `vite dev` load the browser requests a
 *    generated SvelteKit client node (/_app/immutable/nodes/… or
 *    .svelte-kit/generated/…) before Vite has finished transforming it. Vite
 *    returns a temporary 500 / transform error and the import rejects with the
 *    same message plus a URL suffix, or with "Importing a module script failed".
 *
 * Recovery is evidence-based and shared with the marketing site: the failure
 * is probed (missing asset means deployment skew, a served asset means a
 * transient failure worth one bounded retry) and automatic reloads are bounded
 * per asset and overall, with no time-window reset. Offline, same-build, and
 * unclassified failures keep the error boundary's explicit retry. Rejected
 * imports stay rejected so SvelteKit can render its boundary while recovery
 * is pending. Service-worker updates wait for open windows to close, so an
 * update cannot interrupt an edit or export.
 */
interface ChunkFailureDiagnostics {
	chunk_asset?: string;
	unsupported_browser?: string;
}

function chunkDiagnostics(error: Error | string): ChunkFailureDiagnostics {
	if (!isChunkLoadError(error)) return {};
	const message = typeof error === 'string' ? error : error.message;
	const diagnostics: ChunkFailureDiagnostics = {};
	const asset = extractFirstPartyAssetPath(message);
	if (asset) diagnostics.chunk_asset = asset;
	if (isUnsupportedBrowserError(error)) diagnostics.unsupported_browser = 'true';
	return diagnostics;
}

function diagnosticsFor(error: unknown): ChunkFailureDiagnostics {
	if (error instanceof Error || typeof error === 'string') return chunkDiagnostics(error);
	return {};
}

async function init() {
	installCryptoRandomUUID();
	initializeClientErrors(installGlobalErrorCapture);
	// Maintainer diagnostics ride a separate channel to the viewer's own
	// instance: uncaught failures arrive as normalized codes and locations,
	// never message text, and only when the instance switch is on and no
	// browser privacy signal refuses.
	installMaintainerDiagnosticsCapture();
}

export { init };

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	// Route boundary-only failures (for example a rejected route import that
	// never reaches a global listener) through the same bounded recovery.
	void chunkRecovery.recover(error);
	captureClientException(error, { error_boundary: 'sveltekit', status, ...diagnosticsFor(error) });
};
