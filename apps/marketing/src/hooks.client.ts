/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- SvelteKit delivers untyped errors to this boundary; the helpers below narrow them before use. */
import { updated } from '$app/state';
import type { HandleClientError } from '@sveltejs/kit';
import {
	captureClientException,
	createChunkRecovery,
	extractFirstPartyAssetPath,
	isChunkLoadError,
	isUnsupportedBrowserError
} from '@openpost/telemetry';
import { captureIfUnrecovered } from './chunk-error-reporting';

function createMarketingChunkRecovery() {
	return createChunkRecovery({
		// Marketing pages hold no unsaved state, so verified failures can
		// reload automatically within the shared bounded budget. Anything
		// else keeps the error boundary's explicit retry.
		runningBuild: import.meta.env.VITE_OPENPOST_REVISION || undefined,
		// SvelteKit's own deployment check backs URL-less import failures
		// (for example a bare "Importing a module script failed"), where no
		// asset URL exists to probe. It reads the non-immutable
		// _app/version.json with no-cache headers: true means a newer
		// deployment is confirmed, false means we are current.
		checkForUpdate: async () => {
			try {
				return await updated.check();
			} catch {
				return null;
			}
		}
	});
}

let chunkRecovery = createMarketingChunkRecovery();
let uninstallChunkRecovery: (() => void) | null = null;

export function init() {
	// Page imports can fail before the root layout mounts during hydration.
	uninstallChunkRecovery?.();
	chunkRecovery = createMarketingChunkRecovery();
	uninstallChunkRecovery = chunkRecovery.install();
}

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

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	// The preload listener covers some import failures, but recovery must not
	// depend on a separate event having fired first.
	void captureIfUnrecovered(error, chunkRecovery.recover, (cause) =>
		captureClientException(cause, { error_boundary: 'sveltekit', status, ...diagnosticsFor(cause) })
	);
};
