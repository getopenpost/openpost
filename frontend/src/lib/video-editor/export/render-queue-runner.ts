import type { Project } from '../project/types';
import type { RenderExportProgress } from '../media/render-export';
import { renderQueueStore, type RenderQueueJob, type RenderQueueStore } from './render-queue-store';

export type QueueExecutionResult =
	| { kind: 'artifact'; savedPath: string; outputLabel: string; fileSize: number }
	| { kind: 'directory'; savedPath: string; outputLabel: string; fileSize: number }
	| { kind: 'external-directory'; savedPath: null; outputLabel: string; fileSize: number }
	| { kind: 'download'; savedPath: null; outputLabel: string; fileSize: number };

export type RenderQueueExecutor = (
	job: RenderQueueJob,
	options: { signal: AbortSignal; onProgress: (progress: RenderExportProgress) => void }
) => Promise<QueueExecutionResult>;

function projectForJob(job: RenderQueueJob): Project {
	const { snapshot } = job;
	return {
		id: snapshot.projectId,
		name: job.name,
		description: '',
		createdAt: job.createdAt,
		updatedAt: job.createdAt,
		duration: (job.settings.range.endFrame - job.settings.range.startFrame) / snapshot.fps,
		metadata: {
			width: snapshot.width,
			height: snapshot.height,
			fps: snapshot.fps,
			backgroundColor: snapshot.backgroundColor
		},
		timeline: {
			tracks: snapshot.tracks,
			items: snapshot.items,
			transitions: snapshot.transitions,
			compositions: snapshot.compositions,
			masterVolumeDb: snapshot.masterVolumeDb ?? 0,
			masterMuted: snapshot.masterMuted ?? false,
			busAudioEq: snapshot.busAudioEq
		}
	};
}

async function executeRenderJob(
	job: RenderQueueJob,
	options: { signal: AbortSignal; onProgress: (progress: RenderExportProgress) => void }
): Promise<QueueExecutionResult> {
	const { renderVideoExport, renderAudioExport, renderImageSequenceExport } =
		await import('../media/render-execution');
	const project = projectForJob(job);
	const range = job.settings.range;
	if (
		job.settings.format === 'mp3' ||
		job.settings.format === 'aac' ||
		job.settings.format === 'wav'
	) {
		const artifact = await renderAudioExport(project, {
			format: job.settings.format,
			range,
			signal: options.signal,
			onProgress: options.onProgress
		});
		return {
			kind: 'artifact',
			savedPath: artifact.relPath,
			outputLabel: artifact.fileName,
			fileSize: artifact.blob.size
		};
	}
	if (
		job.settings.format === 'png-sequence' ||
		job.settings.format === 'jpeg-sequence' ||
		job.settings.format === 'webp-sequence'
	) {
		const format =
			job.settings.format === 'png-sequence'
				? 'png'
				: job.settings.format === 'webp-sequence'
					? 'webp'
					: 'jpeg';
		const { result } = await renderImageSequenceExport({
			project,
			options: {
				format,
				width: job.settings.width,
				height: job.settings.height,
				range,
				jpegQuality: job.settings.jpegQuality
			},
			signal: options.signal,
			onProgress: options.onProgress
		});
		if (result.kind === 'workspace-directory') {
			return {
				kind: 'directory',
				savedPath: result.relPath,
				outputLabel: result.directoryName,
				fileSize: result.totalBytes
			};
		}
		if (result.kind === 'zip') {
			if (result.savedToWorkspace && result.relPath) {
				return {
					kind: 'artifact',
					savedPath: result.relPath,
					outputLabel: result.fileName,
					fileSize: result.blob.size
				};
			}
			// Download-only: trigger download truthfully; surface failures instead of swallowing.
			if (typeof document === 'undefined') {
				throw new Error('Download not supported in this environment and workspace save failed');
			}
			const url = URL.createObjectURL(result.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = result.fileName;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			return {
				kind: 'download',
				savedPath: null,
				outputLabel: result.fileName,
				fileSize: result.blob.size
			};
		}
		// External directory-handle: truthfully no workspace path; expose directory name for display.
		return {
			kind: 'external-directory',
			savedPath: null,
			outputLabel: result.directoryName,
			fileSize: result.totalBytes
		};
	}
	const artifact = await renderVideoExport(project, {
		format: job.settings.format,
		codec: job.settings.codec,
		quality: job.settings.quality,
		width: job.settings.width,
		height: job.settings.height,
		subtitleMode: job.settings.subtitleMode,
		range,
		signal: options.signal,
		onProgress: options.onProgress
	});
	return {
		kind: 'artifact',
		savedPath: artifact.relPath,
		outputLabel: artifact.fileName,
		fileSize: artifact.blob.size
	};
}

export class RenderQueueRunner {
	#running = false;
	#scheduled = false;
	#unsubscribe: (() => void) | null = null;
	#controllers = new Map<string, AbortController>();

	constructor(
		private readonly queue: RenderQueueStore,
		private readonly execute: RenderQueueExecutor = executeRenderJob
	) {}

	start(): void {
		if (this.#unsubscribe) return;
		this.#unsubscribe = this.queue.subscribe(() => this.#schedule());
		this.#schedule();
	}

	stop(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		for (const controller of this.#controllers.values()) controller.abort();
		this.#controllers.clear();
	}

	cancel(jobId: string): void {
		const controller = this.#controllers.get(jobId);
		if (controller) controller.abort();
		else this.queue.cancel(jobId);
	}

	clearAll(): void {
		for (const controller of this.#controllers.values()) controller.abort();
		this.queue.clearAll();
	}

	#schedule(): void {
		if (this.#scheduled || this.#running) return;
		this.#scheduled = true;
		queueMicrotask(() => {
			this.#scheduled = false;
			void this.#drain();
		});
	}

	async #drain(): Promise<void> {
		if (this.#running) return;
		const job = this.queue.next();
		if (!job || !this.queue.markRendering(job.id)) return;
		this.#running = true;
		const controller = new AbortController();
		this.#controllers.set(job.id, controller);
		try {
			const result = await this.execute(job, {
				signal: controller.signal,
				onProgress: (progress) => this.queue.updateProgress(job.id, progress)
			});
			this.queue.markCompleted(job.id, {
				savedPath: result.savedPath,
				outputLabel: result.outputLabel,
				fileSize: result.fileSize
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				this.queue.markCancelled(job.id);
			} else {
				this.queue.markFailed(job.id, error instanceof Error ? error.message : String(error));
			}
		} finally {
			this.#controllers.delete(job.id);
			this.#running = false;
			this.#schedule();
		}
	}
}

export const renderQueueRunner = new RenderQueueRunner(renderQueueStore);
