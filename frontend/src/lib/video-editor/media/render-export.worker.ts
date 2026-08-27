import type { RenderExportProgress } from './render-export';
import type {
	RenderExportWorkerRequest,
	RenderExportWorkerResponse
} from './render-export-worker.types';

type WorkerGlobalWithWindow = typeof globalThis & { window?: typeof globalThis };
// SAFETY: dedicated-worker globalThis accepts the optional compatibility alias declared above.
const workerGlobal = globalThis as WorkerGlobalWithWindow;
if (workerGlobal.window === undefined) {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: globalThis
	});
}

const activeRequests = new Map<string, AbortController>();

function respond(message: RenderExportWorkerResponse): void {
	self.postMessage(message);
}

function abortError(error: Error | string): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function fallbackError(error: Error | string): string {
	const message = error instanceof Error ? error.message : String(error);
	if (
		error instanceof ReferenceError &&
		/\b(document|navigator|HTML\w*Element|AudioContext|OfflineAudioContext)\b/.test(message)
	) {
		return `WORKER_REQUIRES_MAIN_THREAD:dom-dependency:${message}`;
	}
	return message;
}

self.onmessage = async (event: MessageEvent<RenderExportWorkerRequest>) => {
	const message = event.data;
	if (message.type === 'cancel') {
		activeRequests.get(message.requestId)?.abort();
		return;
	}

	const controller = new AbortController();
	activeRequests.set(message.requestId, controller);
	try {
		const { setWorkspaceRoot } = await import('../workspace-fs/root');
		const { mediaPool } = await import('./pool.svelte');
		setWorkspaceRoot(message.workspaceRoot);
		mediaPool.loadAll(message.media);

		const { planNestedMixdown } = await import('./render-plan');
		const { assessSmartCopy } = await import('./smart-copy-plan');
		const timeline = message.project.timeline;
		const smartCopyEligible =
			message.mode === 'video' &&
			assessSmartCopy(message.project, message.options, message.media).eligible;
		const mediaWithAudio = new Set(
			message.media
				.filter(
					(media) =>
						media.audioCodecSupported !== false &&
						(Boolean(media.audioCodec) || media.tags.includes('audio'))
				)
				.map((media) => media.id)
		);
		const plannedAudio = planNestedMixdown(
			timeline?.items ?? [],
			timeline?.tracks ?? [],
			message.project.metadata.fps,
			timeline?.transitions ?? [],
			timeline?.compositions ?? [],
			new Set(),
			timeline?.busAudioEq
		);
		const hasAudio =
			!smartCopyEligible &&
			(message.mode === 'audio' || plannedAudio.some((entry) => mediaWithAudio.has(entry.mediaId)));
		if (hasAudio && !('OfflineAudioContext' in globalThis)) {
			throw new Error('WORKER_REQUIRES_MAIN_THREAD:audio-context');
		}

		const { renderMultiTrackVideoArtifact, renderTimelineAudioArtifact } =
			await import('./render-export');
		const onProgress = (progress: RenderExportProgress): void => {
			respond({ type: 'progress', requestId: message.requestId, progress });
		};
		const artifact =
			message.mode === 'video'
				? await renderMultiTrackVideoArtifact(message.project, {
						...message.options,
						signal: controller.signal,
						onProgress
					})
				: await renderTimelineAudioArtifact(message.project, {
						...message.options,
						signal: controller.signal,
						onProgress
					});
		respond({ type: 'complete', requestId: message.requestId, artifact });
	} catch (cause) {
		const error = cause instanceof Error ? cause : String(cause);
		respond(
			abortError(error)
				? { type: 'cancelled', requestId: message.requestId }
				: { type: 'error', requestId: message.requestId, error: fallbackError(error) }
		);
	} finally {
		activeRequests.delete(message.requestId);
		try {
			const { setWorkspaceRoot } = await import('../workspace-fs/root');
			const { mediaPool } = await import('./pool.svelte');
			mediaPool.clear();
			setWorkspaceRoot(null);
		} catch {
			// A failed module load left no worker-owned workspace state to clear.
		}
	}
};

export {};
