import type { Project } from '../project/types';
import { getWorkspaceRoot } from '../workspace-fs/root';
import { mediaPool } from './pool.svelte';
import type {
	AudioExportOptions,
	RenderedExportArtifact,
	RenderExportOptions,
	RenderExportProgress,
	RenderExportResult
} from './render-export';
import { saveRenderedExportArtifact } from './persist-rendered-export';
import type {
	RenderExportWorkerRequest,
	RenderExportWorkerResponse,
	WorkerAudioExportOptions,
	WorkerImageSequenceExportOptions,
	WorkerVideoExportOptions
} from './render-export-worker.types';
import type { MediaMetadata } from './types';
import type { ImageSequenceExportOptions, ImageSequenceResult } from './image-sequence-export';

export interface RenderExecutionOutcome {
	artifact: RenderedExportArtifact;
	renderPath: 'smart-copy' | 'worker' | 'main-thread';
	fallbackReason?: string;
}

export interface RenderExecutionJob {
	mode: 'video' | 'audio';
	project: Project;
	videoOptions?: WorkerVideoExportOptions;
	audioOptions?: WorkerAudioExportOptions;
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

export interface ImageSequenceExecutionJob {
	project: Project;
	options: WorkerImageSequenceExportOptions;
	destination?: 'workspace' | 'zip' | FileSystemDirectoryHandle;
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

export interface RenderWorkerPort extends EventTarget {
	postMessage(message: RenderExportWorkerRequest): void;
	terminate(): void;
}

export interface RenderExecutionDependencies {
	workerAvailable: () => boolean;
	createWorker: () => RenderWorkerPort;
	workspaceRoot: () => FileSystemDirectoryHandle | null;
	media: () => MediaMetadata[];
	renderVideoMain: (
		project: Project,
		options?: RenderExportOptions
	) => Promise<RenderedExportArtifact>;
	renderAudioMain: (
		project: Project,
		options: AudioExportOptions
	) => Promise<RenderedExportArtifact>;
	renderImageSequenceMain: (
		project: Project,
		options: ImageSequenceExportOptions
	) => Promise<ImageSequenceResult>;
}

const defaultDependencies: RenderExecutionDependencies = {
	workerAvailable: () => typeof Worker !== 'undefined',
	createWorker: () =>
		new Worker(new URL('./render-export.worker.ts', import.meta.url), { type: 'module' }),
	workspaceRoot: getWorkspaceRoot,
	media: () => mediaPool.mediaList,
	renderVideoMain: async (project, options) =>
		(await import('./render-export')).renderMultiTrackVideoArtifact(project, options),
	renderAudioMain: async (project, options) =>
		(await import('./render-export')).renderTimelineAudioArtifact(project, options),
	renderImageSequenceMain: async (project, options) => {
		const { renderImageSequenceToWorkspace } = await import('./image-sequence-export');
		return renderImageSequenceToWorkspace(project, options);
	}
};

function cloneMedia(media: MediaMetadata): MediaMetadata {
	const { fileHandle, ...serializable } = media;
	return {
		// SAFETY: every metadata field except the separately restored file handle is JSON data.
		...(JSON.parse(JSON.stringify(serializable)) as Omit<MediaMetadata, 'fileHandle'>),
		fileHandle
	};
}

function abortError(): DOMException {
	return new DOMException('Render cancelled', 'AbortError');
}

function isAbort(error: Error | string): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function fallbackReason(error: Error | string): string | null {
	const message = error instanceof Error ? error.message : String(error);
	return message.startsWith('WORKER_REQUIRES_MAIN_THREAD:') ||
		message.startsWith('WORKER_UNAVAILABLE:') ||
		message.startsWith('WORKER_RUNTIME_ERROR:') ||
		message.startsWith('WORKER_MESSAGE_ERROR:')
		? message
		: null;
}

function renderInWorker(
	job: RenderExecutionJob,
	dependencies: RenderExecutionDependencies
): Promise<RenderedExportArtifact> {
	if (!dependencies.workerAvailable()) {
		return Promise.reject(new Error('WORKER_UNAVAILABLE:worker-api'));
	}
	const workspaceRoot = dependencies.workspaceRoot();
	if (!workspaceRoot) {
		return Promise.reject(new Error('WORKER_UNAVAILABLE:workspace-root'));
	}
	if (job.signal?.aborted) return Promise.reject(abortError());

	return new Promise<RenderedExportArtifact>((resolve, reject) => {
		let worker: RenderWorkerPort;
		try {
			worker = dependencies.createWorker();
		} catch (error) {
			reject(new Error(`WORKER_UNAVAILABLE:create:${String(error)}`));
			return;
		}
		const requestId = crypto.randomUUID();
		let settled = false;
		const cleanup = (): void => {
			job.signal?.removeEventListener('abort', onAbort);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('messageerror', onMessageError);
			worker.removeEventListener('error', onError);
			worker.terminate();
		};
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};
		const onAbort = (): void => {
			try {
				worker.postMessage({ type: 'cancel', requestId } satisfies RenderExportWorkerRequest);
			} catch {
				// Termination below is the authoritative cancellation path.
			} finally {
				finish(() => reject(abortError()));
			}
		};
		const onMessage = (event: Event): void => {
			if (!(event instanceof MessageEvent)) return;
			const response: RenderExportWorkerResponse = event.data;
			if (response.requestId !== requestId) return;
			switch (response.type) {
				case 'progress':
					job.onProgress?.(response.progress);
					break;
				case 'complete':
					finish(() => resolve(response.artifact));
					break;
				case 'cancelled':
					finish(() => reject(abortError()));
					break;
				case 'error':
					finish(() => reject(new Error(response.error)));
					break;
			}
		};
		const onError = (event: Event): void => {
			const message = event instanceof ErrorEvent ? event.message : 'unknown worker error';
			finish(() => reject(new Error(`WORKER_RUNTIME_ERROR:${message}`)));
		};
		const onMessageError = (): void => {
			finish(() => reject(new Error('WORKER_RUNTIME_ERROR:message-deserialization')));
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('messageerror', onMessageError);
		worker.addEventListener('error', onError);
		job.signal?.addEventListener('abort', onAbort, { once: true });

		const common = {
			type: 'start' as const,
			requestId,
			project: job.project,
			media: dependencies.media().map(cloneMedia),
			workspaceRoot
		};
		const request: RenderExportWorkerRequest =
			job.mode === 'video'
				? { ...common, mode: 'video', options: job.videoOptions ?? {} }
				: {
						...common,
						mode: 'audio',
						options: job.audioOptions ?? { format: 'wav' }
					};
		try {
			worker.postMessage(request);
		} catch (error) {
			finish(() => reject(new Error(`WORKER_MESSAGE_ERROR:${String(error)}`)));
		}
	});
}

export async function renderExportArtifact(
	job: RenderExecutionJob,
	dependencies: RenderExecutionDependencies = defaultDependencies
): Promise<RenderExecutionOutcome> {
	try {
		const artifact = await renderInWorker(job, dependencies);
		return {
			artifact,
			renderPath: artifact.renderMethod === 'smart-copy' ? 'smart-copy' : 'worker'
		};
	} catch (cause) {
		const error = cause instanceof Error ? cause : String(cause);
		if (isAbort(error)) throw error;
		const reason = fallbackReason(error);
		if (!reason) throw error;
		if (job.signal?.aborted) throw abortError();
		const artifact =
			job.mode === 'video'
				? await dependencies.renderVideoMain(job.project, {
						...(job.videoOptions ?? {}),
						signal: job.signal,
						onProgress: job.onProgress
					})
				: await dependencies.renderAudioMain(job.project, {
						...(job.audioOptions ?? { format: 'wav' }),
						signal: job.signal,
						onProgress: job.onProgress
					});
		return {
			artifact,
			renderPath: artifact.renderMethod === 'smart-copy' ? 'smart-copy' : 'main-thread',
			fallbackReason: reason
		};
	}
}

export async function renderVideoExport(
	project: Project,
	options: RenderExportOptions = {}
): Promise<RenderExportResult> {
	const { signal, onProgress, ...videoOptions } = options;
	const outcome = await renderExportArtifact({
		mode: 'video',
		project,
		videoOptions,
		signal,
		onProgress
	});
	return saveRenderedExportArtifact(project.id, outcome.artifact);
}

export async function renderAudioExport(
	project: Project,
	options: AudioExportOptions
): Promise<RenderExportResult> {
	const { signal, onProgress, ...audioOptions } = options;
	const outcome = await renderExportArtifact({
		mode: 'audio',
		project,
		audioOptions,
		signal,
		onProgress
	});
	return saveRenderedExportArtifact(project.id, outcome.artifact);
}

export interface ImageSequenceExecutionOutcome {
	result: ImageSequenceResult;
	renderPath: 'worker' | 'main-thread';
	fallbackReason?: string;
}

async function renderImageSequenceInWorker(
	job: ImageSequenceExecutionJob,
	dependencies: RenderExecutionDependencies
): Promise<ImageSequenceResult> {
	if (!dependencies.workerAvailable()) {
		throw new Error('WORKER_UNAVAILABLE:worker-api');
	}
	const workspaceRoot = dependencies.workspaceRoot();
	if (!workspaceRoot) {
		throw new Error('WORKER_UNAVAILABLE:workspace-root');
	}
	if (job.signal?.aborted) throw abortError();
	const isDirectoryHandle =
		typeof FileSystemDirectoryHandle !== 'undefined' &&
		job.destination instanceof FileSystemDirectoryHandle;
	const useWorkspace = !isDirectoryHandle && job.destination !== 'zip';

	return await new Promise<ImageSequenceResult>((resolve, reject) => {
		let worker: RenderWorkerPort;
		try {
			worker = dependencies.createWorker();
		} catch (error) {
			reject(new Error(`WORKER_UNAVAILABLE:create:${String(error)}`));
			return;
		}
		const requestId = crypto.randomUUID();
		let settled = false;
		const pendingWrites: Promise<void>[] = [];
		let writeError: Error | null = null;
		let sequenceMeta: { frameCount: number; totalBytes: number } | null = null;
		let directoryName = '';
		let totalBytes = 0;
		let frameCount = 0;
		const cleanup = (): void => {
			job.signal?.removeEventListener('abort', onAbort);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('messageerror', onMessageError);
			worker.removeEventListener('error', onError);
			worker.terminate();
		};
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};
		const onAbort = (): void => {
			try {
				worker.postMessage({ type: 'cancel', requestId } satisfies RenderExportWorkerRequest);
			} catch {
				// termination is authoritative
			} finally {
				finish(() => reject(abortError()));
			}
		};
		const handleBatch = async (frames: import('./render-export-worker.types').WorkerSequenceBatchFrame[]): Promise<void> => {
			if (writeError) return;
			try {
				if (isDirectoryHandle) {
					const dir = job.destination as unknown as FileSystemDirectoryHandle;
					if (!directoryName) directoryName = dir.name;
					for (const frame of frames) {
						throwIfAborted(job.signal);
						const fileHandle = await dir.getFileHandle(frame.fileName, { create: true });
						const writable = await fileHandle.createWritable();
						try {
							await writable.write(frame.blob);
							await writable.close();
						} catch (error) {
							try { await writable.abort(); } catch { /* ignore */ }
							throw error;
						}
						totalBytes += frame.blob.size;
						frameCount += 1;
					}
				} else if (useWorkspace) {
					const { sanitizeSequenceBaseName } = await import('./image-sequence-export');
					const baseName = sanitizeSequenceBaseName(job.project.name);
					if (!directoryName) directoryName = baseName;
					const { writeBlob } = await import('../workspace-fs/fs-primitives');
					const { projectExportsDir } = await import('../workspace-fs/paths');
					const root = dependencies.workspaceRoot();
					if (!root) throw new Error('Workspace root lost during sequence write.');
					for (const frame of frames) {
						throwIfAborted(job.signal);
						await writeBlob(root, [...projectExportsDir(job.project.id), baseName, frame.fileName], frame.blob);
						totalBytes += frame.blob.size;
						frameCount += 1;
					}
				} else {
					// ZIP destination is handled on main thread fallback path; worker batches are not used for ZIP.
					for (const frame of frames) {
						totalBytes += frame.blob.size;
						frameCount += 1;
					}
				}
			} catch (error) {
				writeError = error instanceof Error ? error : new Error(String(error));
			}
		};
		const onMessage = (event: Event): void => {
			if (!(event instanceof MessageEvent)) return;
			const response: RenderExportWorkerResponse = event.data;
			if (response.requestId !== requestId) return;
			switch (response.type) {
				case 'progress':
					job.onProgress?.(response.progress);
					break;
				case 'sequence-batch': {
					const p = handleBatch(response.frames);
					pendingWrites.push(p);
					p.catch((error) => {
						writeError = error instanceof Error ? error : new Error(String(error));
						try {
							worker.postMessage({ type: 'cancel', requestId } satisfies RenderExportWorkerRequest);
						} catch { /* ignore */ }
						finish(() => reject(writeError!));
					});
					break;
				}
				case 'sequence-complete':
					sequenceMeta = { frameCount: response.frameCount, totalBytes: response.totalBytes };
					Promise.all(pendingWrites).then(() => {
						if (writeError) {
							finish(() => reject(writeError!));
							return;
						}
						if (isDirectoryHandle) {
							finish(() =>
								resolve({
									kind: 'directory-handle',
									directoryName,
									frameCount: sequenceMeta!.frameCount,
									totalBytes: sequenceMeta!.totalBytes
								})
							);
						} else if (useWorkspace) {
							finish(() =>
								resolve({
									kind: 'workspace-directory',
									directoryName,
									relPath: `projects/${job.project.id}/exports/${directoryName}`,
									frameCount: sequenceMeta!.frameCount,
									totalBytes: sequenceMeta!.totalBytes
								})
							);
						} else {
							finish(() => reject(new Error('WORKER_REQUIRES_MAIN_THREAD:zip-unhandled')));
						}
					});
					break;
				case 'complete':
					finish(() => reject(new Error('Unexpected complete for image sequence')));
					break;
				case 'cancelled':
					finish(() => reject(abortError()));
					break;
				case 'error':
					finish(() => reject(new Error(response.error)));
					break;
			}
		};
		const onError = (event: Event): void => {
			const message = event instanceof ErrorEvent ? event.message : 'unknown worker error';
			finish(() => reject(new Error(`WORKER_RUNTIME_ERROR:${message}`)));
		};
		const onMessageError = (): void => {
			finish(() => reject(new Error('WORKER_RUNTIME_ERROR:message-deserialization')));
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('messageerror', onMessageError);
		worker.addEventListener('error', onError);
		job.signal?.addEventListener('abort', onAbort, { once: true });
		const common = {
			type: 'start' as const,
			requestId,
			project: job.project,
			media: dependencies.media().map(cloneMedia),
			workspaceRoot: workspaceRoot!
		};
		const request: RenderExportWorkerRequest = {
			...common,
			mode: 'image-sequence',
			options: job.options
		};
		try {
			worker.postMessage(request);
		} catch (error) {
			finish(() => reject(new Error(`WORKER_MESSAGE_ERROR:${String(error)}`)));
		}
	});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

export async function renderImageSequenceExport(
	job: ImageSequenceExecutionJob,
	dependencies: RenderExecutionDependencies = defaultDependencies
): Promise<ImageSequenceExecutionOutcome> {
	const destIsZip = job.destination === 'zip';
	if (destIsZip) {
		const { renderImageSequenceZip } = await import('./image-sequence-export');
		const result = await renderImageSequenceZip(job.project, {
			...job.options,
			signal: job.signal,
			onProgress: job.onProgress
		});
		return { result, renderPath: 'main-thread' };
	}
	try {
		const result = await renderImageSequenceInWorker(job, dependencies);
		return { result, renderPath: 'worker' };
	} catch (cause) {
		const error = cause instanceof Error ? cause : String(cause);
		if (isAbort(error)) throw error;
		const reason = fallbackReason(error);
		if (!reason) throw error;
		if (job.signal?.aborted) throw abortError();
		if (
			typeof FileSystemDirectoryHandle !== 'undefined' &&
			job.destination instanceof FileSystemDirectoryHandle
		) {
			const { renderImageSequenceToDirectoryHandle } = await import('./image-sequence-export');
			const dirResult = await renderImageSequenceToDirectoryHandle(
				job.destination as unknown as FileSystemDirectoryHandle,
				job.project,
				{
				...job.options,
				signal: job.signal,
				onProgress: job.onProgress
			});
			return { result: dirResult, renderPath: 'main-thread', fallbackReason: reason };
		}
		const result = await dependencies.renderImageSequenceMain(job.project, {
			...job.options,
			signal: job.signal,
			onProgress: job.onProgress
		});
		return { result, renderPath: 'main-thread', fallbackReason: reason };
	}
}
