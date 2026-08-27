import type { Project } from '../project/types';
import type { RenderExportProgress, RenderExportResult } from '../media/render-export';
import { renderQueueStore, type RenderQueueJob, type RenderQueueStore } from './render-queue-store';

export type RenderQueueExecutor = (
	job: RenderQueueJob,
	options: { signal: AbortSignal; onProgress: (progress: RenderExportProgress) => void }
) => Promise<RenderExportResult>;

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
): Promise<RenderExportResult> {
	const { renderVideoExport, renderAudioExport } = await import('../media/render-execution');
	const project = projectForJob(job);
	const range = job.settings.range;
	if (
		job.settings.format === 'mp3' ||
		job.settings.format === 'aac' ||
		job.settings.format === 'wav'
	) {
		return renderAudioExport(project, {
			format: job.settings.format,
			range,
			signal: options.signal,
			onProgress: options.onProgress
		});
	}
	return renderVideoExport(project, {
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
				savedPath: result.relPath,
				fileSize: result.blob.size
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
