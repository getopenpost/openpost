import { createLogger } from '../../../workspace-fs/logger';
import { localAiRuntimeRegistry } from '../../../local-ai/runtime-registry';
import { importGeneratedVideo, rollbackNewGeneratedMedia } from '../../import.svelte';
import { mediaTaskId, mediaTasks } from '../../media-tasks.svelte';
import { resolveMediaBlob } from '../../resolve-media-blob';
import type { MediaMetadata } from '../../types';
import { gpuMediaJobScheduler } from '../gpu-media-job-scheduler';
import { abortable } from '../abortable';
import type { UpscaleWorkerRequest, UpscaleWorkerResponse } from '../workers/upscale-worker';
import {
	UPSCALED_MEDIA_TAG,
	UPSCALE_TMP_DIR,
	upscaledFileName,
	type UpscaleStage
} from './constants';
import { canUpscale } from './upscale-size';
import type { UpscaleVariant } from './upscale-variant';

const logger = createLogger('UpscaleService');
const PROGRESS_EMIT_INTERVAL_MS = 150;
const PROGRESS_EMIT_MIN_DELTA = 0.01;

interface UpscaleJob {
	jobId: string;
	media: MediaMetadata;
	projectId: string;
	variant: UpscaleVariant;
	taskId: string;
	taskRevision: number;
	cancelled: boolean;
	dispatched: boolean;
	controller: AbortController;
	releaseGpu?: () => void;
	resolve: (media: MediaMetadata) => void;
	reject: (error: Error) => void;
}

async function readTmpFile(jobId: string): Promise<File | null> {
	try {
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle(UPSCALE_TMP_DIR, {
			create: true
		});
		return await (await dir.getFileHandle(`${jobId}.mp4`)).getFile();
	} catch {
		return null;
	}
}

async function removeTmpFile(jobId: string): Promise<void> {
	try {
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle(UPSCALE_TMP_DIR, {
			create: true
		});
		await dir.removeEntry(`${jobId}.mp4`);
	} catch {
		// The worker may already have removed a partial result.
	}
}

function abortError(): DOMException {
	return new DOMException('Video upscaling was cancelled.', 'AbortError');
}

export interface UpscaleServiceDependencies {
	createWorker: () => Worker;
	resolveSource: (media: MediaMetadata) => Promise<Blob>;
	importVideo: (
		file: File,
		options: { projectId: string; tags?: string[] }
	) => Promise<MediaMetadata>;
	rollbackImport: (projectId: string, mediaId: string) => Promise<void>;
	readScratch: (jobId: string) => Promise<File | null>;
	removeScratch: (jobId: string) => Promise<void>;
}

const DEFAULT_DEPENDENCIES: UpscaleServiceDependencies = {
	createWorker: () =>
		new Worker(new URL('../workers/upscale-worker.ts', import.meta.url), { type: 'module' }),
	resolveSource: resolveMediaBlob,
	importVideo: importGeneratedVideo,
	rollbackImport: rollbackNewGeneratedMedia,
	readScratch: readTmpFile,
	removeScratch: removeTmpFile
};

export class UpscaleService {
	private readonly pendingJobs: UpscaleJob[] = [];
	private readonly jobsByMediaId = new Map<string, UpscaleJob>();
	private readonly lastEmit = new Map<string, { at: number; progress: number }>();
	private activeJob: UpscaleJob | null = null;
	private worker: Worker | null = null;

	constructor(private readonly dependencies: UpscaleServiceDependencies = DEFAULT_DEPENDENCIES) {}

	canUpscaleMedia(media: MediaMetadata): boolean {
		return media.mimeType.startsWith('video/') && canUpscale(media.width, media.height);
	}

	isGenerating(mediaId: string): boolean {
		return this.jobsByMediaId.has(mediaId);
	}

	generate(
		media: MediaMetadata,
		projectId: string,
		variant: UpscaleVariant
	): Promise<MediaMetadata> {
		if (!this.canUpscaleMedia(media)) {
			return Promise.reject(
				new Error('This video is already too large for a safe 2x browser encode.')
			);
		}
		if (this.jobsByMediaId.has(media.id)) {
			return Promise.reject(new Error('This video already has an upscale job.'));
		}

		return new Promise((resolve, reject) => {
			const jobId = crypto.randomUUID();
			const taskId = mediaTaskId('upscale', media.id);
			const job = {
				jobId,
				media,
				projectId,
				variant,
				taskId,
				taskRevision: 0,
				cancelled: false,
				dispatched: false,
				controller: new AbortController(),
				resolve,
				reject
			} satisfies UpscaleJob;
			job.taskRevision = mediaTasks.start({
				id: taskId,
				kind: 'upscale',
				mediaId: media.id,
				label: media.fileName,
				stage: 'queued',
				status: 'queued',
				progress: 0,
				onCancel: () => this.cancel(media.id)
			});
			this.jobsByMediaId.set(media.id, job);
			this.pendingJobs.push(job);
			void this.drain();
		});
	}

	cancel(mediaId: string): void {
		const job = this.jobsByMediaId.get(mediaId);
		if (!job || job.cancelled) return;
		job.cancelled = true;
		job.controller.abort();
		const queuedIndex = this.pendingJobs.findIndex((candidate) => candidate.jobId === job.jobId);
		if (queuedIndex >= 0) {
			this.pendingJobs.splice(queuedIndex, 1);
			this.settle(job, abortError());
			return;
		}
		if (this.activeJob?.jobId === job.jobId && job.dispatched) {
			this.post({ type: 'cancel', jobId: job.jobId });
		}
	}

	cancelAll(): void {
		for (const mediaId of [...this.jobsByMediaId.keys()]) this.cancel(mediaId);
	}

	isLoaded(): boolean {
		return this.worker !== null || this.activeJob !== null || this.pendingJobs.length > 0;
	}

	/** Cancel active work and release compiled Anime4K sessions held by the worker. */
	unload(): void {
		this.cancelAll();
		const active = this.activeJob;
		this.activeJob = null;
		this.worker?.terminate();
		this.worker = null;
		if (!active) return;
		active.releaseGpu?.();
		if (this.jobsByMediaId.has(active.media.id)) this.settle(active, abortError());
		void this.dependencies.removeScratch(active.jobId);
		void this.drain();
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = this.dependencies.createWorker();
		worker.onmessage = (event: MessageEvent<UpscaleWorkerResponse>) => {
			void this.handleWorkerMessage(event.data);
		};
		worker.onerror = (event) => {
			logger.error('Upscale worker crashed', event);
			const active = this.activeJob;
			this.activeJob = null;
			worker.terminate();
			this.worker = null;
			if (active) {
				active.releaseGpu?.();
				this.settle(active, new Error(event.message || 'Upscale worker crashed.'));
				void this.dependencies.removeScratch(active.jobId);
			}
			void this.drain();
		};
		this.worker = worker;
		return worker;
	}

	private post(message: UpscaleWorkerRequest): void {
		this.getWorker().postMessage(message);
	}

	private emitProgress(
		job: UpscaleJob,
		progress: number,
		stage: UpscaleStage,
		etaSeconds?: number | null
	): void {
		const last = this.lastEmit.get(job.jobId);
		const now = Date.now();
		if (
			last &&
			now - last.at < PROGRESS_EMIT_INTERVAL_MS &&
			Math.abs(progress - last.progress) < PROGRESS_EMIT_MIN_DELTA &&
			progress < 1
		) {
			return;
		}
		this.lastEmit.set(job.jobId, { at: now, progress });
		mediaTasks.update(
			job.taskId,
			{ stage, status: 'running', progress, etaSeconds },
			job.taskRevision
		);
	}

	private settle(job: UpscaleJob, result: MediaMetadata | Error): void {
		this.jobsByMediaId.delete(job.media.id);
		this.lastEmit.delete(job.jobId);
		mediaTasks.finish(job.taskId, job.taskRevision);
		if (result instanceof Error) job.reject(result);
		else job.resolve(result);
	}

	private async drain(): Promise<void> {
		if (this.activeJob) return;
		const job = this.pendingJobs.shift();
		if (!job) return;
		this.activeJob = job;
		try {
			job.releaseGpu = await gpuMediaJobScheduler.acquire(job.controller.signal);
			mediaTasks.update(
				job.taskId,
				{ stage: 'preparing', status: 'running', progress: 0 },
				job.taskRevision
			);
			const source = await abortable(
				this.dependencies.resolveSource(job.media),
				job.controller.signal,
				abortError
			);
			if (job.cancelled) throw abortError();
			job.dispatched = true;
			this.post({
				type: 'upscale',
				jobId: job.jobId,
				source,
				sourceFps: job.media.fps || 30,
				variant: job.variant
			});
		} catch (error) {
			this.activeJob = null;
			job.releaseGpu?.();
			this.settle(job, error instanceof Error ? error : new Error(String(error)));
			void this.drain();
		}
	}

	private async handleWorkerMessage(message: UpscaleWorkerResponse): Promise<void> {
		const job = this.activeJob;
		if (!job || job.jobId !== message.jobId) return;
		if (message.type === 'progress') {
			if (!job.cancelled) {
				this.emitProgress(job, message.progress, message.stage, message.etaSeconds);
			}
			return;
		}

		this.activeJob = null;
		job.releaseGpu?.();
		try {
			if (job.cancelled || message.type === 'cancelled') {
				this.settle(job, abortError());
			} else if (message.type === 'error') {
				this.settle(job, new Error(message.error));
			} else {
				this.emitProgress(job, 1, 'rendering', 0);
				const rendered = await this.dependencies.readScratch(job.jobId);
				if (!rendered?.size) throw new Error('Upscale render produced no file.');
				if (job.cancelled) throw abortError();
				const file = new File(
					[rendered],
					upscaledFileName(job.media.fileName, message.result.width, message.result.height),
					{ type: 'video/mp4' }
				);
				const imported = await this.dependencies.importVideo(file, {
					projectId: job.projectId,
					tags: [UPSCALED_MEDIA_TAG, `upscale-${job.variant}`]
				});
				if (job.cancelled) {
					await this.dependencies.rollbackImport(job.projectId, imported.id);
					throw abortError();
				}
				this.settle(job, imported);
			}
		} catch (error) {
			if (this.jobsByMediaId.has(job.media.id)) {
				this.settle(job, error instanceof Error ? error : new Error(String(error)));
			}
		} finally {
			await this.dependencies.removeScratch(job.jobId);
			void this.drain();
		}
	}
}

export const upscaleService = new UpscaleService();
localAiRuntimeRegistry.register({
	id: 'anime4k-upscale',
	label: 'Anime4K upscaling',
	isLoaded: () => upscaleService.isLoaded(),
	unload: () => upscaleService.unload()
});
