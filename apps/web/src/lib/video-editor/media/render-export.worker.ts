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
const sequenceBatchAcks = new Map<string, () => void>();

function sequenceBatchKey(requestId: string, batchId: number): string {
	return `${requestId}:${batchId}`;
}

function waitForSequenceBatchAck(
	requestId: string,
	batchId: number,
	signal: AbortSignal
): Promise<void> {
	if (signal.aborted) return Promise.reject(new DOMException('Export cancelled.', 'AbortError'));
	return new Promise<void>((resolve, reject) => {
		const key = sequenceBatchKey(requestId, batchId);
		const onAbort = (): void => {
			sequenceBatchAcks.delete(key);
			reject(new DOMException('Export cancelled.', 'AbortError'));
		};
		sequenceBatchAcks.set(key, () => {
			signal.removeEventListener('abort', onAbort);
			sequenceBatchAcks.delete(key);
			resolve();
		});
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

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
	if (message.type === 'sequence-batch-ack') {
		sequenceBatchAcks.get(sequenceBatchKey(message.requestId, message.batchId))?.();
		return;
	}
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

		const onProgress = (progress: RenderExportProgress): void => {
			respond({ type: 'progress', requestId: message.requestId, progress });
		};
		if (message.mode === 'image-sequence') {
			const { IMAGE_SEQUENCE_BATCH_SIZE, renderImageSequenceFrames } =
				await import('./image-sequence-export');
			let batch: import('./render-export-worker.types').WorkerSequenceBatchFrame[] = [];
			let batchId = 0;
			let totalBytes = 0;
			let frameCount = 0;
			for await (const frame of renderImageSequenceFrames(message.project, {
				...message.options,
				signal: controller.signal,
				onProgress
			})) {
				batch.push(frame);
				totalBytes += frame.blob.size;
				frameCount += 1;
				if (batch.length >= IMAGE_SEQUENCE_BATCH_SIZE) {
					respond({
						type: 'sequence-batch',
						requestId: message.requestId,
						batchId,
						frames: batch
					});
					await waitForSequenceBatchAck(message.requestId, batchId, controller.signal);
					batchId += 1;
					batch = [];
				}
			}
			if (batch.length > 0) {
				respond({
					type: 'sequence-batch',
					requestId: message.requestId,
					batchId,
					frames: batch
				});
				await waitForSequenceBatchAck(message.requestId, batchId, controller.signal);
			}
			respond({
				type: 'sequence-complete',
				requestId: message.requestId,
				frameCount,
				totalBytes
			});
			return;
		}
		const { renderMultiTrackVideoArtifact, renderTimelineAudioArtifact } =
			await import('./render-export');
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
		for (const key of sequenceBatchAcks.keys()) {
			if (key.startsWith(`${message.requestId}:`)) sequenceBatchAcks.delete(key);
		}
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
