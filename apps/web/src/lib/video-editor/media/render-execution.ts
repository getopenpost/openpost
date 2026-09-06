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

function isDirectoryDestination(
	destination: ImageSequenceExecutionJob['destination']
): destination is FileSystemDirectoryHandle {
	return destination !== undefined && destination !== 'workspace' && destination !== 'zip';
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
	const directoryDestination = isDirectoryDestination(job.destination) ? job.destination : null;
	const isDirectoryHandle = directoryDestination !== null;
	const useWorkspace = !isDirectoryHandle && job.destination !== 'zip';
	let worker: RenderWorkerPort;
	try {
		worker = dependencies.createWorker();
	} catch (error) {
		throw new Error(`WORKER_UNAVAILABLE:create:${String(error)}`);
	}
	const imageSequence = await import('./image-sequence-export');
	let workspaceAllocation: { dirName: string; dirSegments: string[] } | null = null;
	let externalAllocation: {
		directoryName: string;
		directoryHandle: FileSystemDirectoryHandle;
	} | null = null;
	try {
		const baseName = imageSequence.sanitizeSequenceBaseName(job.project.name);
		if (useWorkspace) {
			workspaceAllocation = await imageSequence.allocateUniqueWorkspaceSequenceDirectory(
				workspaceRoot,
				job.project.id,
				baseName
			);
		} else if (isDirectoryHandle) {
			externalAllocation = await imageSequence.allocateUniqueSequenceSubdirectory(
				directoryDestination,
				baseName
			);
		}
	} catch (error) {
		worker.terminate();
		throw error;
	}

	return await new Promise<ImageSequenceResult>((resolve, reject) => {
		const requestId = crypto.randomUUID();
		let settled = false;
		let finalizing = false;
		let activeWrite = Promise.resolve();
		let batchInFlight = false;
		let expectedBatchId = 0;
		const writtenFiles: string[] = [];
		let totalBytes = 0;
		let frameCount = 0;
		const directoryName = workspaceAllocation?.dirName ?? externalAllocation?.directoryName ?? '';
		const cleanup = (): void => {
			job.signal?.removeEventListener('abort', onAbort);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('messageerror', onMessageError);
			worker.removeEventListener('error', onError);
			worker.terminate();
		};
		const finish = (fn: () => void): void => {
			if (settled || finalizing) return;
			settled = true;
			cleanup();
			fn();
		};
		const cleanupOwnedOutput = async (): Promise<void> => {
			await activeWrite.catch(() => undefined);
			if (workspaceAllocation) {
				const root = dependencies.workspaceRoot();
				if (!root) return;
				const { listDirectory, removeEntry } = await import('../workspace-fs/fs-primitives');
				for (const fileName of writtenFiles) {
					try {
						await removeEntry(root, [...workspaceAllocation.dirSegments, fileName]);
					} catch {
						// The export owns this unique directory; cleanup remains best-effort.
					}
				}
				try {
					if ((await listDirectory(root, workspaceAllocation.dirSegments)).length === 0) {
						await removeEntry(root, workspaceAllocation.dirSegments);
					}
				} catch {
					// Preserve the render error when empty-directory cleanup fails.
				}
				return;
			}
			if (externalAllocation && directoryDestination) {
				for (const fileName of writtenFiles) {
					try {
						await externalAllocation.directoryHandle.removeEntry(fileName);
					} catch {
						// The export owns this unique directory; cleanup remains best-effort.
					}
				}
				try {
					await directoryDestination.removeEntry(externalAllocation.directoryName);
				} catch {
					// Preserve the render error when empty-directory cleanup fails.
				}
			}
		};
		const failWithCleanup = (error: Error): void => {
			if (settled || finalizing) return;
			finalizing = true;
			try {
				worker.postMessage({ type: 'cancel', requestId } satisfies RenderExportWorkerRequest);
			} catch {
				// Termination after cleanup is the authoritative cancellation path.
			}
			void cleanupOwnedOutput().finally(() => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			});
		};
		const onAbort = (): void => failWithCleanup(abortError());
		const handleBatch = async (
			frames: import('./render-export-worker.types').WorkerSequenceBatchFrame[]
		): Promise<void> => {
			if (frames.length === 0 || frames.length > imageSequence.IMAGE_SEQUENCE_BATCH_SIZE) {
				throw new Error(`Invalid image-sequence batch size: ${frames.length}`);
			}
			for (const frame of frames) {
				throwIfAborted(job.signal);
				writtenFiles.push(frame.fileName);
				if (externalAllocation) {
					const fileHandle = await externalAllocation.directoryHandle.getFileHandle(
						frame.fileName,
						{
							create: true
						}
					);
					const writable = await fileHandle.createWritable();
					try {
						await writable.write(frame.blob);
						await writable.close();
					} catch (error) {
						try {
							await writable.abort();
						} catch {
							// The original write error is more useful than an abort failure.
						}
						throw error;
					}
				} else if (workspaceAllocation) {
					const { writeBlob } = await import('../workspace-fs/fs-primitives');
					const root = dependencies.workspaceRoot();
					if (!root) throw new Error('Workspace root lost during sequence write.');
					await writeBlob(root, [...workspaceAllocation.dirSegments, frame.fileName], frame.blob);
				} else {
					throw new Error('Image-sequence worker has no writable destination.');
				}
				totalBytes += frame.blob.size;
				frameCount += 1;
			}
		};
		const onMessage = (event: Event): void => {
			if (!(event instanceof MessageEvent) || settled || finalizing) return;
			const response: RenderExportWorkerResponse = event.data;
			if (response.requestId !== requestId) return;
			switch (response.type) {
				case 'progress':
					job.onProgress?.(response.progress);
					break;
				case 'sequence-batch': {
					if (batchInFlight || response.batchId !== expectedBatchId) {
						failWithCleanup(new Error('Image-sequence worker sent an out-of-order batch.'));
						break;
					}
					batchInFlight = true;
					activeWrite = handleBatch(response.frames);
					void activeWrite
						.then(() => {
							if (settled || finalizing) return;
							batchInFlight = false;
							expectedBatchId += 1;
							worker.postMessage({
								type: 'sequence-batch-ack',
								requestId,
								batchId: response.batchId
							} satisfies RenderExportWorkerRequest);
						})
						.catch((error) => {
							failWithCleanup(error instanceof Error ? error : new Error(String(error)));
						});
					break;
				}
				case 'sequence-complete':
					void activeWrite
						.then(() => {
							if (frameCount !== response.frameCount || totalBytes !== response.totalBytes) {
								throw new Error('Image-sequence worker output count did not match written output.');
							}
							if (workspaceAllocation) {
								finish(() =>
									resolve({
										kind: 'workspace-directory',
										directoryName,
										relPath: `projects/${job.project.id}/exports/${directoryName}`,
										frameCount,
										totalBytes
									})
								);
								return;
							}
							finish(() =>
								resolve({
									kind: 'directory-handle',
									directoryName,
									frameCount,
									totalBytes
								})
							);
						})
						.catch((error) => {
							failWithCleanup(error instanceof Error ? error : new Error(String(error)));
						});
					break;
				case 'complete':
					failWithCleanup(new Error('Unexpected complete for image sequence'));
					break;
				case 'cancelled':
					failWithCleanup(abortError());
					break;
				case 'error':
					failWithCleanup(new Error(response.error));
					break;
			}
		};
		const onError = (event: Event): void => {
			const message = event instanceof ErrorEvent ? event.message : 'unknown worker error';
			failWithCleanup(new Error(`WORKER_RUNTIME_ERROR:${message}`));
		};
		const onMessageError = (): void => {
			failWithCleanup(new Error('WORKER_RUNTIME_ERROR:message-deserialization'));
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('messageerror', onMessageError);
		worker.addEventListener('error', onError);
		job.signal?.addEventListener('abort', onAbort, { once: true });
		const request: RenderExportWorkerRequest = {
			type: 'start',
			requestId,
			mode: 'image-sequence',
			project: job.project,
			media: dependencies.media().map(cloneMedia),
			workspaceRoot,
			options: job.options
		};
		if (job.signal?.aborted) {
			onAbort();
			return;
		}
		try {
			worker.postMessage(request);
		} catch (error) {
			failWithCleanup(new Error(`WORKER_MESSAGE_ERROR:${String(error)}`));
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
		if (isDirectoryDestination(job.destination)) {
			const { renderImageSequenceToDirectoryHandle } = await import('./image-sequence-export');
			const dirResult = await renderImageSequenceToDirectoryHandle(job.destination, job.project, {
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
