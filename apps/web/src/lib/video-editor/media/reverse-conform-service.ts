import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { readBlob, writeBlob } from '../workspace-fs/fs-primitives';
import { mediaReversePreviewPath } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import { renderMultiTrackVideoBlob, type RenderExportProgress } from './render-export';
import type { MediaMetadata } from './types';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';

const PREVIEW_MAX_WIDTH = 1280;
const PREVIEW_MAX_HEIGHT = 720;
const CONFORM_VERSION = 1;

export interface ReverseConformSize {
	width: number;
	height: number;
}

export interface ReverseConformStatus {
	state: 'idle' | 'preparing' | 'rendering' | 'ready' | 'error' | 'canceled';
	progress: number;
	error?: string;
}

export interface ReverseConformResult {
	key: string;
	blob: Blob;
	width: number;
	height: number;
	fps: number;
	durationFrames: number;
}

/** Map an original source timestamp to the matching forward conform timestamp. */
export function sourceSecondsToReverseConformSeconds(
	result: Pick<ReverseConformResult, 'durationFrames' | 'fps'>,
	sourceSeconds: number
): number {
	return Math.max(0, (result.durationFrames - 1) / result.fps - sourceSeconds);
}

interface ReverseConformJob {
	mediaId: string;
	controller: AbortController;
	waiters: Set<symbol>;
	promise: Promise<ReverseConformResult>;
}

interface TemporaryReverseProject {
	project: Project;
	size: ReverseConformSize;
	fps: number;
	durationFrames: number;
}

const jobs = new Map<string, ReverseConformJob>();
const statuses = new Map<string, ReverseConformStatus>();
const listeners = new Map<string, Set<(status: ReverseConformStatus) => void>>();
const objectUrls = new Map<string, string>();

export function fitReverseConformSize(width: number, height: number): ReverseConformSize {
	const safeWidth = Math.max(2, width || PREVIEW_MAX_WIDTH);
	const safeHeight = Math.max(2, height || PREVIEW_MAX_HEIGHT);
	const scale = Math.min(1, PREVIEW_MAX_WIDTH / safeWidth, PREVIEW_MAX_HEIGHT / safeHeight);
	return {
		width: Math.max(2, Math.floor((safeWidth * scale) / 2) * 2),
		height: Math.max(2, Math.floor((safeHeight * scale) / 2) * 2)
	};
}

export function reverseConformKey(media: MediaMetadata): string {
	const size = fitReverseConformSize(media.width, media.height);
	const fingerprint =
		media.contentHash ??
		`${media.fileSize}-${media.fileLastModified ?? 0}-${media.duration.toFixed(3)}`;
	return [
		`v${CONFORM_VERSION}`,
		fingerprint,
		Math.max(1, media.fps || 30).toFixed(3),
		`${size.width}x${size.height}`
	]
		.join('-')
		.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function publish(mediaId: string, status: ReverseConformStatus): void {
	statuses.set(mediaId, status);
	for (const listener of listeners.get(mediaId) ?? []) listener(status);
}

export function reverseConformStatus(mediaId: string): ReverseConformStatus {
	return statuses.get(mediaId) ?? { state: 'idle', progress: 0 };
}

export function subscribeReverseConform(
	mediaId: string,
	listener: (status: ReverseConformStatus) => void
): () => void {
	let mediaListeners = listeners.get(mediaId);
	if (!mediaListeners) {
		mediaListeners = new Set();
		listeners.set(mediaId, mediaListeners);
	}
	mediaListeners.add(listener);
	listener(reverseConformStatus(mediaId));
	return () => {
		mediaListeners?.delete(listener);
		if (mediaListeners?.size === 0) listeners.delete(mediaId);
	};
}

function temporaryReverseProject(media: MediaMetadata): TemporaryReverseProject {
	const size = fitReverseConformSize(media.width, media.height);
	const fps = Math.min(60, Math.max(1, media.fps || 30));
	const durationFrames = Math.max(1, Math.round(media.duration * fps));
	const track: TimelineTrack = {
		id: 'reverse-video',
		name: 'Reverse conform',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
	const item: TimelineItem = {
		id: 'reverse-source',
		trackId: track.id,
		from: 0,
		durationInFrames: durationFrames,
		label: media.fileName,
		type: 'video',
		mediaId: media.id,
		sourceStart: 0,
		sourceEnd: durationFrames,
		sourceDuration: durationFrames,
		sourceFps: fps,
		sourceWidth: media.width,
		sourceHeight: media.height,
		isReversed: true
	};
	return {
		project: {
			id: `reverse-${media.id}`,
			name: `reverse-${media.id}`,
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: media.duration,
			metadata: {
				width: size.width,
				height: size.height,
				fps,
				backgroundColor: '#000000'
			},
			timeline: { tracks: [track], items: [item], transitions: [] }
		},
		size,
		fps,
		durationFrames
	};
}

function startJob(media: MediaMetadata, key: string): ReverseConformJob {
	const controller = new AbortController();
	const taskId = mediaTaskId('reverse-conform', media.id);
	let taskRevision: number | undefined;
	const promise = (async () => {
		try {
			publish(media.id, { state: 'preparing', progress: 0 });
			const root = requireWorkspaceRoot();
			const path = mediaReversePreviewPath(media.id, key);
			const cached = await readBlob(root, path);
			const { project, size, fps, durationFrames } = temporaryReverseProject(media);
			if (cached) {
				publish(media.id, { state: 'ready', progress: 1 });
				return { key, blob: cached, ...size, fps, durationFrames };
			}
			taskRevision = mediaTasks.start({
				id: taskId,
				kind: 'reverse-conform',
				mediaId: media.id,
				label: media.fileName,
				stage: 'preparing',
				progress: 0,
				onCancel: () => controller.abort()
			});
			const blob = await renderMultiTrackVideoBlob(project, {
				format: 'webm',
				codec: 'vp9',
				quality: 'draft',
				width: size.width,
				height: size.height,
				subtitleMode: 'none',
				signal: controller.signal,
				onProgress: (progress: RenderExportProgress) => {
					mediaTasks.update(
						taskId,
						{
							stage: progress.phase === 'preparing' ? 'preparing' : 'rendering',
							progress: progress.progress,
							completed: progress.framesDone,
							total: progress.totalFrames
						},
						taskRevision
					);
					publish(media.id, {
						state: progress.phase === 'preparing' ? 'preparing' : 'rendering',
						progress: progress.progress
					});
				}
			});
			await writeBlob(root, path, blob);
			publish(media.id, { state: 'ready', progress: 1 });
			return { key, blob, ...size, fps, durationFrames };
		} catch (error) {
			const canceled =
				controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
			publish(media.id, {
				state: canceled ? 'canceled' : 'error',
				progress: 0,
				error: canceled ? undefined : error instanceof Error ? error.message : String(error)
			});
			throw error;
		} finally {
			if (taskRevision !== undefined) mediaTasks.finish(taskId, taskRevision);
			if (jobs.get(key)?.controller === controller) jobs.delete(key);
		}
	})();
	const job: ReverseConformJob = {
		mediaId: media.id,
		controller,
		waiters: new Set(),
		promise
	};
	jobs.set(key, job);
	return job;
}

function waitForJob(job: ReverseConformJob, signal?: AbortSignal): Promise<ReverseConformResult> {
	if (signal?.aborted) return Promise.reject(new DOMException('Canceled', 'AbortError'));
	const waiter = Symbol('reverse-conform-waiter');
	job.waiters.add(waiter);
	return new Promise((resolve, reject) => {
		const release = () => {
			job.waiters.delete(waiter);
			signal?.removeEventListener('abort', abort);
		};
		const abort = () => {
			release();
			if (job.waiters.size === 0) job.controller.abort();
			reject(new DOMException('Canceled', 'AbortError'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		job.promise.then(
			(result) => {
				release();
				resolve(result);
			},
			(error) => {
				release();
				reject(error);
			}
		);
	});
}

/** Get or create the shared, fingerprinted 720p reverse preview for one source. */
export function conformReversePreview(
	media: MediaMetadata,
	options: { signal?: AbortSignal } = {}
): Promise<ReverseConformResult> {
	const key = reverseConformKey(media);
	const job = jobs.get(key) ?? startJob(media, key);
	return waitForJob(job, options.signal);
}

export function reverseConformObjectUrl(result: ReverseConformResult): string {
	let url = objectUrls.get(result.key);
	if (!url) {
		url = URL.createObjectURL(result.blob);
		objectUrls.set(result.key, url);
	}
	return url;
}

/** Explicit user cancellation aborts the shared render, including all current waiters. */
export function cancelReverseConform(mediaId: string): void {
	for (const job of jobs.values()) {
		if (job.mediaId === mediaId) job.controller.abort();
	}
}
