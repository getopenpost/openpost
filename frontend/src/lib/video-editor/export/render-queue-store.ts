import { get, writable, type Writable } from 'svelte/store';
import type { VideoCodec } from 'mediabunny';
import type {
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import type { AudioEqSettings } from '../audio/types';
import type { RenderExportProgress } from '../media/render-export';

export type RenderQueueJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';

export interface RenderQueueSnapshot {
	projectId: string;
	projectName: string;
	fps: number;
	width: number;
	height: number;
	backgroundColor?: string;
	tracks: TimelineTrack[];
	items: TimelineItem[];
	transitions: TimelineTransition[];
	compositions: SubComposition[];
	masterVolumeDb?: number;
	masterMuted?: boolean;
	busAudioEq?: AudioEqSettings;
}

export type ImageSequenceQueueFormat = 'png-sequence' | 'jpeg-sequence' | 'webp-sequence';

export interface RenderQueueSettings {
	format: 'webm' | 'mp4' | 'mov' | 'mkv' | 'mp3' | 'aac' | 'wav' | ImageSequenceQueueFormat;
	codec?: VideoCodec;
	quality: 'draft' | 'standard' | 'high';
	width: number;
	height: number;
	subtitleMode: 'none' | 'burn' | 'sidecar' | 'embedded';
	range: { startFrame: number; endFrame: number };
	jpegQuality?: number;
}

export interface RenderQueueJob {
	id: string;
	projectId: string;
	name: string;
	status: RenderQueueJobStatus;
	progress: number;
	phase?: RenderExportProgress['phase'];
	framesDone?: number;
	totalFrames?: number;
	settings: RenderQueueSettings;
	snapshot: RenderQueueSnapshot;
	savedPath?: string;
	fileSize?: number;
	error?: string;
	createdAt: number;
	startedAt?: number;
	finishedAt?: number;
}

export interface RenderQueueState {
	jobs: RenderQueueJob[];
	isPaused: boolean;
	activeJobId: string | null;
}

export interface RenderQueueStore extends Writable<RenderQueueState> {
	enqueue(jobs: readonly RenderQueueJob[]): void;
	next(): RenderQueueJob | null;
	setPaused(paused: boolean): void;
	move(id: string, direction: -1 | 1): void;
	cancel(id: string): void;
	retry(id: string): void;
	remove(id: string): void;
	clearFinished(): void;
	clearAll(): void;
	hydrate(jobs: readonly RenderQueueJob[], paused: boolean): void;
	markRendering(id: string): boolean;
	updateProgress(id: string, progress: RenderExportProgress): void;
	markCompleted(id: string, output: { savedPath: string; fileSize: number }): void;
	markFailed(id: string, error: string): void;
	markCancelled(id: string): void;
}

const terminalStatuses = new Set<RenderQueueJobStatus>(['completed', 'failed', 'cancelled']);

function updateJob(
	state: RenderQueueState,
	id: string,
	update: (job: RenderQueueJob) => RenderQueueJob
): RenderQueueState {
	return { ...state, jobs: state.jobs.map((job) => (job.id === id ? update(job) : job)) };
}

export function createRenderQueueStore(): RenderQueueStore {
	const store = writable<RenderQueueState>({ jobs: [], isPaused: false, activeJobId: null });
	return {
		...store,
		enqueue(jobs) {
			store.update((state) => ({ ...state, jobs: [...state.jobs, ...jobs] }));
		},
		next() {
			const state = get(store);
			return state.isPaused || state.activeJobId
				? null
				: (state.jobs.find((job) => job.status === 'queued') ?? null);
		},
		setPaused(isPaused) {
			store.update((state) => ({ ...state, isPaused }));
		},
		move(id, direction) {
			store.update((state) => {
				const index = state.jobs.findIndex((job) => job.id === id && job.status === 'queued');
				if (index < 0) return state;
				let target = index + direction;
				while (
					target >= 0 &&
					target < state.jobs.length &&
					state.jobs[target]?.status !== 'queued'
				) {
					target += direction;
				}
				if (target < 0 || target >= state.jobs.length) return state;
				const jobs = [...state.jobs];
				[jobs[index], jobs[target]] = [jobs[target]!, jobs[index]!];
				return { ...state, jobs };
			});
		},
		cancel(id) {
			store.update((state) =>
				updateJob(state, id, (job) =>
					job.status === 'queued' ? { ...job, status: 'cancelled', finishedAt: Date.now() } : job
				)
			);
		},
		retry(id) {
			store.update((state) =>
				updateJob(state, id, (job) =>
					terminalStatuses.has(job.status)
						? {
								...job,
								status: 'queued',
								progress: 0,
								phase: undefined,
								framesDone: undefined,
								totalFrames: undefined,
								error: undefined,
								savedPath: undefined,
								fileSize: undefined,
								startedAt: undefined,
								finishedAt: undefined
							}
						: job
				)
			);
		},
		remove(id) {
			store.update((state) => ({
				...state,
				jobs: state.jobs.filter((job) => job.id !== id || !terminalStatuses.has(job.status))
			}));
		},
		clearFinished() {
			store.update((state) => ({
				...state,
				jobs: state.jobs.filter((job) => !terminalStatuses.has(job.status))
			}));
		},
		clearAll() {
			store.update((state) => ({ ...state, jobs: [], activeJobId: null }));
		},
		hydrate(jobs, paused) {
			const restored = jobs.map((job) =>
				job.status === 'rendering'
					? {
							...job,
							status: 'queued' as const,
							progress: 0,
							phase: undefined,
							framesDone: undefined,
							totalFrames: undefined,
							startedAt: undefined
						}
					: job
			);
			store.set({
				jobs: restored,
				isPaused: paused || restored.some((job) => job.status === 'queued'),
				activeJobId: null
			});
		},
		markRendering(id) {
			const state = get(store);
			if (
				state.activeJobId ||
				state.isPaused ||
				state.jobs.find((job) => job.id === id)?.status !== 'queued'
			)
				return false;
			store.set({
				...state,
				activeJobId: id,
				jobs: state.jobs.map((job) =>
					job.id === id
						? {
								...job,
								status: 'rendering',
								progress: 0,
								phase: 'preparing',
								framesDone: 0,
								totalFrames: Math.max(
									0,
									job.settings.range.endFrame - job.settings.range.startFrame
								),
								startedAt: Date.now()
							}
						: job
				)
			});
			return true;
		},
		updateProgress(id, progress) {
			store.update((state) =>
				updateJob(state, id, (job) => ({
					...job,
					phase: progress.phase,
					progress: progress.progress,
					framesDone: progress.framesDone,
					totalFrames: progress.totalFrames
				}))
			);
		},
		markCompleted(id, output) {
			store.update((state) => ({
				...updateJob(state, id, (job) => ({
					...job,
					...output,
					status: 'completed',
					progress: 1,
					finishedAt: Date.now()
				})),
				activeJobId: state.activeJobId === id ? null : state.activeJobId
			}));
		},
		markFailed(id, error) {
			store.update((state) => ({
				...updateJob(state, id, (job) => ({
					...job,
					status: 'failed',
					error,
					finishedAt: Date.now()
				})),
				activeJobId: state.activeJobId === id ? null : state.activeJobId
			}));
		},
		markCancelled(id) {
			store.update((state) => ({
				...updateJob(state, id, (job) => ({
					...job,
					status: 'cancelled',
					finishedAt: Date.now()
				})),
				activeJobId: state.activeJobId === id ? null : state.activeJobId
			}));
		}
	};
}

export const renderQueueStore = createRenderQueueStore();
