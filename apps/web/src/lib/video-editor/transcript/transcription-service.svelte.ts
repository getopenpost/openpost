import { mediaPool } from '../media/pool.svelte';
import { mediaTaskId, mediaTasks } from '../media/media-tasks.svelte';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { MediaMetadata } from '../media/types';
import type { TimelineItem } from '../project/types';
import {
	deleteSourceTranscript,
	getSourceTranscript,
	saveSourceTranscript,
	sourceTranscriptMatchesMedia,
	sourceTranscriptMatchesSelection,
	type SourceTranscript
} from '../workspace-fs/source-transcripts';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { m } from '$lib/paraglide/messages';
import type { TranscriptWord } from './cues';
import type {
	ResolvedTranscriptionEngine,
	TranscribeOptions,
	TranscribeProgress,
	TranscriptionSelection
} from './engine/types';
import {
	addGeneratedSubtitleItem,
	captureTranscriptionSource,
	transcribeSource,
	type GeneratedCaptionCanvas,
	type TranscriptionSourceSnapshot
} from './transcribe-action';
import { isTranscriptionOutOfMemoryError } from './transcription-errors';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';

export type TranscriptionJobStatus = 'queued' | 'running' | 'cancelling';

export interface TranscriptionJobView {
	id: string;
	itemId: string;
	mediaId: string;
	label: string;
	status: TranscriptionJobStatus;
	progress: TranscribeProgress | null;
	backend: 'webgpu' | 'wasm' | null;
	fallback: ResolvedTranscriptionEngine | null;
}

export interface TranscriptionResult {
	sourceItemId: string;
	subtitleItemId: string;
}

export interface TranscriptionServiceDependencies {
	resolveSource: (media: MediaMetadata) => Promise<Blob>;
	transcribe: (file: File, options: TranscribeOptions) => Promise<TranscriptWord[]>;
	getSourceTranscript: typeof getSourceTranscript;
	saveSourceTranscript: typeof saveSourceTranscript;
	deleteSourceTranscript: typeof deleteSourceTranscript;
	getCanvas?: () => GeneratedCaptionCanvas;
}

interface TranscriptionTarget {
	id: string;
	item: TimelineItem;
	source: TranscriptionSourceSnapshot;
	taskId: string;
	taskRevision: number;
	promise: Promise<TranscriptionResult>;
	resolve: (result: TranscriptionResult) => void;
	reject: (error: Error) => void;
}

interface SourceTranscriptionTarget {
	id: string;
	mediaId: string;
	taskId: string;
	taskRevision: number;
	promise: Promise<SourceTranscript>;
	resolve: (transcript: SourceTranscript) => void;
	reject: (error: Error) => void;
}

interface QueuedTranscriptionJob {
	id: string;
	requestKey: string;
	media: MediaMetadata;
	selection: TranscriptionSelection;
	sourceStartSeconds: number;
	sourceEndSeconds: number;
	controller: AbortController;
	status: Extract<TranscriptionJobStatus, 'queued' | 'running'>;
	progress: TranscribeProgress | null;
	backend: 'webgpu' | 'wasm' | null;
	fallback: ResolvedTranscriptionEngine | null;
	targets: Map<string, TranscriptionTarget>;
	sourceTarget: SourceTranscriptionTarget | null;
}

const DEFAULT_DEPENDENCIES: TranscriptionServiceDependencies = {
	resolveSource: resolveMediaBlob,
	transcribe: transcribeSource,
	getSourceTranscript,
	saveSourceTranscript,
	deleteSourceTranscript,
	getCanvas: () => ({
		width: sequenceStore.activeWidth ?? editorSession.project?.metadata.width ?? 1920,
		height: sequenceStore.activeHeight ?? editorSession.project?.metadata.height ?? 1080
	})
};

function abortError(): DOMException {
	return new DOMException('Transcription cancelled', 'AbortError');
}

function requestKey(
	mediaId: string,
	sourceStartSeconds: number,
	sourceEndSeconds: number,
	selection: TranscriptionSelection
): string {
	return JSON.stringify([
		mediaId,
		sourceStartSeconds,
		sourceEndSeconds,
		selection.model,
		selection.language ?? 'auto',
		selection.quantization
	]);
}

function sourceWordsForWindow(
	words: readonly TranscriptWord[],
	sourceStartSeconds: number,
	sourceEndSeconds: number
): TranscriptWord[] {
	return words
		.filter((word) => word.endSeconds > sourceStartSeconds && word.startSeconds < sourceEndSeconds)
		.map((word) => ({
			...word,
			startSeconds: Math.max(0, word.startSeconds - sourceStartSeconds),
			endSeconds: Math.min(sourceEndSeconds, word.endSeconds) - sourceStartSeconds
		}))
		.filter((word) => word.endSeconds > word.startSeconds);
}

export type SourceTranscriptStatus = 'loading' | 'idle' | 'ready';

export function sourceTranscriptionTaskId(mediaId: string): string {
	return mediaTaskId('transcription', `source:${mediaId}`);
}

export class TranscriptionService {
	private readonly pending: QueuedTranscriptionJob[] = [];
	private readonly jobsByRequestKey = new Map<string, QueuedTranscriptionJob>();
	private readonly targetByItemId = new Map<
		string,
		{ job: QueuedTranscriptionJob; target: TranscriptionTarget }
	>();
	private readonly targetByMediaId = new Map<
		string,
		{ job: QueuedTranscriptionJob; target: SourceTranscriptionTarget }
	>();
	private readonly pendingClipEnqueues = new Map<
		string,
		{ requestKey: string; promise: Promise<TranscriptionResult> }
	>();
	private readonly sourceTranscriptLoads = new Map<string, Promise<SourceTranscript | null>>();
	private active: QueuedTranscriptionJob | null = null;
	private resetting = false;
	private resetGeneration = 0;
	private state = $state<Record<string, TranscriptionJobView>>({});
	private sourceTranscriptState = $state<
		Record<string, { status: SourceTranscriptStatus; transcript?: SourceTranscript }>
	>({});

	constructor(
		private readonly dependencies: TranscriptionServiceDependencies = DEFAULT_DEPENDENCIES
	) {}

	get jobs(): TranscriptionJobView[] {
		return Object.values(this.state);
	}

	jobForItem(itemId: string): TranscriptionJobView | undefined {
		const owned = this.targetByItemId.get(itemId);
		return owned ? this.state[owned.target.id] : undefined;
	}

	queuePosition(viewId: string): number | null {
		const index = this.pending.findIndex((job) => job.targets.has(viewId));
		return index < 0 ? null : index + 1;
	}

	sourceTranscriptStatus(mediaId: string): SourceTranscriptStatus {
		return this.sourceTranscriptState[mediaId]?.status ?? 'loading';
	}

	hydrateSourceTranscript(mediaId: string): Promise<SourceTranscript | null> {
		const media = mediaPool.get(mediaId);
		if (!media) return Promise.resolve(null);
		return this.loadSourceTranscript(media);
	}

	enqueue(itemId: string, selection: TranscriptionSelection): Promise<TranscriptionResult> {
		const item = timelineStore.itemById.get(itemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return Promise.reject(new Error(m.video_editor_transcribe_select_media()));
		if (item.type !== 'audio' && item.type !== 'video') {
			return Promise.reject(new Error(m.video_editor_transcribe_media_only()));
		}
		if (media.audioCodecSupported === false) {
			return Promise.reject(new Error(m.video_editor_transcribe_unsupported_audio()));
		}
		const source = captureTranscriptionSource(item);
		const key = requestKey(
			source.mediaId,
			source.sourceStartSeconds,
			source.sourceEndSeconds,
			selection
		);
		const currentTarget = this.targetByItemId.get(itemId);
		if (currentTarget) {
			return currentTarget.job.requestKey === key
				? currentTarget.target.promise
				: Promise.reject(new Error(m.video_editor_transcribe_already_queued()));
		}
		const pendingEnqueue = this.pendingClipEnqueues.get(itemId);
		if (pendingEnqueue) {
			return pendingEnqueue.requestKey === key
				? pendingEnqueue.promise
				: Promise.reject(new Error(m.video_editor_transcribe_already_queued()));
		}

		const generation = this.resetGeneration;
		const promise = this.enqueueAfterSourceCheck(item, media, source, selection, key, generation);
		this.pendingClipEnqueues.set(itemId, { requestKey: key, promise });
		void promise.then(
			() => this.clearPendingClipEnqueue(itemId, promise),
			() => this.clearPendingClipEnqueue(itemId, promise)
		);
		return promise;
	}

	enqueueMedia(mediaId: string, selection: TranscriptionSelection): Promise<SourceTranscript> {
		const media = mediaPool.get(mediaId);
		if (!media) return Promise.reject(new Error(m.video_editor_transcribe_select_media()));
		if (!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/')) {
			return Promise.reject(new Error(m.video_editor_transcribe_media_only()));
		}
		if (media.audioCodecSupported === false) {
			return Promise.reject(new Error(m.video_editor_transcribe_unsupported_audio()));
		}
		const sourceStartSeconds = 0;
		const sourceEndSeconds = Math.max(0, media.duration);
		const key = requestKey(media.id, sourceStartSeconds, sourceEndSeconds, selection);
		const current = this.targetByMediaId.get(media.id);
		if (current) {
			return current.job.requestKey === key
				? current.target.promise
				: Promise.reject(new Error(m.video_editor_transcribe_already_queued()));
		}

		let job = this.jobsByRequestKey.get(key);
		const isNewJob = job === undefined;
		if (!job) {
			job = this.createJob(media, selection, sourceStartSeconds, sourceEndSeconds, key);
			this.jobsByRequestKey.set(key, job);
		}
		const target = this.createSourceTarget(job);
		if (isNewJob) {
			this.pending.push(job);
			void this.drain();
		}
		return target.promise;
	}

	cancelForMedia(mediaId: string): boolean {
		const owned = this.targetByMediaId.get(mediaId);
		if (!owned) return false;
		const { job, target } = owned;
		if (job.targets.size > 0) {
			this.settleSourceTarget(job, target, abortError());
			return true;
		}
		if (this.active?.id === job.id) {
			mediaTasks.update(
				target.taskId,
				{ status: 'cancelling', stage: 'cancelling' },
				target.taskRevision
			);
			job.controller.abort();
			return true;
		}
		this.removePendingJob(job);
		void this.finishJob(job, abortError());
		return true;
	}

	async deleteMediaTranscript(mediaId: string): Promise<void> {
		await this.dependencies.deleteSourceTranscript(mediaId);
		this.sourceTranscriptState[mediaId] = { status: 'idle' };
	}

	cancelForItem(itemId: string): boolean {
		const owned = this.targetByItemId.get(itemId);
		if (!owned) return false;
		const { job, target } = owned;
		if (job.targets.size > 1 || job.sourceTarget) {
			job.targets.delete(target.id);
			this.settleTarget(job, target, abortError());
			return true;
		}
		if (this.active?.id === job.id) {
			this.updateTargetView(target, { status: 'cancelling' });
			mediaTasks.update(
				target.taskId,
				{ status: 'cancelling', stage: 'cancelling' },
				target.taskRevision
			);
			job.controller.abort();
			return true;
		}
		this.removePendingJob(job);
		void this.finishJob(job, abortError());
		return true;
	}

	reset(): void {
		this.resetting = true;
		this.resetGeneration += 1;
		for (const job of [...this.pending]) void this.finishJob(job, abortError());
		this.pending.length = 0;
		const active = this.active;
		active?.controller.abort();
		if (active) void this.finishJob(active, abortError());
		this.pendingClipEnqueues.clear();
		this.sourceTranscriptLoads.clear();
		this.sourceTranscriptState = {};
		this.resetting = false;
	}

	private async enqueueAfterSourceCheck(
		item: TimelineItem,
		media: MediaMetadata,
		source: TranscriptionSourceSnapshot,
		selection: TranscriptionSelection,
		key: string,
		generation: number
	): Promise<TranscriptionResult> {
		const transcript = await this.loadSourceTranscript(media);
		if (generation !== this.resetGeneration) throw abortError();
		if (
			transcript &&
			sourceTranscriptMatchesMedia(transcript, media) &&
			sourceTranscriptMatchesSelection(transcript, selection)
		) {
			const words = sourceWordsForWindow(
				transcript.words,
				source.sourceStartSeconds,
				source.sourceEndSeconds
			);
			const subtitleItemId = addGeneratedSubtitleItem(
				item.id,
				words,
				source,
				this.dependencies.getCanvas?.()
			);
			return { sourceItemId: item.id, subtitleItemId };
		}
		return this.enqueueUncached(item, media, source, selection, key);
	}

	private clearPendingClipEnqueue(itemId: string, promise: Promise<TranscriptionResult>): void {
		if (this.pendingClipEnqueues.get(itemId)?.promise === promise) {
			this.pendingClipEnqueues.delete(itemId);
		}
	}

	private enqueueUncached(
		item: TimelineItem,
		media: MediaMetadata,
		source: TranscriptionSourceSnapshot,
		selection: TranscriptionSelection,
		key: string
	): Promise<TranscriptionResult> {
		const currentTarget = this.targetByItemId.get(item.id);
		if (currentTarget) {
			return currentTarget.job.requestKey === key
				? currentTarget.target.promise
				: Promise.reject(new Error(m.video_editor_transcribe_already_queued()));
		}
		let job = this.jobsByRequestKey.get(key);
		const isNewJob = job === undefined;
		if (!job) {
			job = this.createJob(
				media,
				selection,
				source.sourceStartSeconds,
				source.sourceEndSeconds,
				key
			);
			this.jobsByRequestKey.set(key, job);
		}
		const target = this.createTarget(job, item, source);
		if (isNewJob) {
			this.pending.push(job);
			void this.drain();
		}
		return target.promise;
	}

	private createJob(
		media: MediaMetadata,
		selection: TranscriptionSelection,
		sourceStartSeconds: number,
		sourceEndSeconds: number,
		key: string
	): QueuedTranscriptionJob {
		return {
			id: crypto.randomUUID(),
			requestKey: key,
			media,
			selection,
			sourceStartSeconds,
			sourceEndSeconds,
			controller: new AbortController(),
			status: 'queued',
			progress: null,
			backend: null,
			fallback: null,
			targets: new Map(),
			sourceTarget: null
		};
	}

	private async loadSourceTranscript(media: MediaMetadata): Promise<SourceTranscript | null> {
		const current = this.sourceTranscriptState[media.id];
		if (current?.status === 'ready') return current.transcript ?? null;
		if (current?.status === 'idle') return null;
		const existingLoad = this.sourceTranscriptLoads.get(media.id);
		if (existingLoad) return existingLoad;
		const generation = this.resetGeneration;
		this.sourceTranscriptState[media.id] = { status: 'loading' };
		const load = this.dependencies
			.getSourceTranscript(media.id)
			.then(async (transcript) => {
				if (generation !== this.resetGeneration) return null;
				if (transcript && !sourceTranscriptMatchesMedia(transcript, media)) {
					await this.dependencies.deleteSourceTranscript(media.id);
					transcript = null;
				}
				this.sourceTranscriptState[media.id] = transcript
					? { status: 'ready', transcript }
					: { status: 'idle' };
				return transcript;
			})
			.catch((error) => {
				if (generation === this.resetGeneration) {
					this.sourceTranscriptState[media.id] = { status: 'idle' };
				}
				throw error;
			})
			.finally(() => {
				if (this.sourceTranscriptLoads.get(media.id) === load) {
					this.sourceTranscriptLoads.delete(media.id);
				}
			});
		this.sourceTranscriptLoads.set(media.id, load);
		return load;
	}

	private createSourceTarget(job: QueuedTranscriptionJob): SourceTranscriptionTarget {
		let resolve!: (transcript: SourceTranscript) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<SourceTranscript>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		const target = {
			id: crypto.randomUUID(),
			mediaId: job.media.id,
			taskId: sourceTranscriptionTaskId(job.media.id),
			taskRevision: 0,
			promise,
			resolve,
			reject
		} satisfies SourceTranscriptionTarget;
		target.taskRevision = mediaTasks.start({
			id: target.taskId,
			kind: 'transcription',
			mediaId: job.media.id,
			label: job.media.fileName,
			stage: job.status === 'running' ? (job.progress?.stage ?? 'preparing') : 'queued',
			status: job.status,
			progress: job.progress?.progress ?? (job.status === 'queued' ? 0 : null),
			onCancel: () => this.cancelForMedia(job.media.id)
		});
		job.sourceTarget = target;
		this.targetByMediaId.set(job.media.id, { job, target });
		return target;
	}

	private removePendingJob(job: QueuedTranscriptionJob): void {
		const index = this.pending.findIndex((candidate) => candidate.id === job.id);
		if (index >= 0) this.pending.splice(index, 1);
	}

	private createTarget(
		job: QueuedTranscriptionJob,
		item: TimelineItem,
		source: TranscriptionSourceSnapshot
	): TranscriptionTarget {
		let resolve!: (result: TranscriptionResult) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<TranscriptionResult>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		const id = crypto.randomUUID();
		const taskId = mediaTaskId('transcription', item.id);
		const target = {
			id,
			item: $state.snapshot(item),
			source,
			taskId,
			taskRevision: 0,
			promise,
			resolve,
			reject
		} satisfies TranscriptionTarget;
		target.taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'transcription',
			mediaId: job.media.id,
			label: item.label || job.media.fileName,
			stage: job.status === 'running' ? (job.progress?.stage ?? 'preparing') : 'queued',
			status: job.status,
			progress: job.progress?.progress ?? (job.status === 'queued' ? 0 : null),
			onCancel: () => this.cancelForItem(item.id)
		});
		job.targets.set(id, target);
		this.targetByItemId.set(item.id, { job, target });
		this.state[id] = {
			id,
			itemId: item.id,
			mediaId: job.media.id,
			label: item.label || job.media.fileName,
			status: job.status,
			progress: job.progress,
			backend: job.backend,
			fallback: job.fallback
		};
		return target;
	}

	private async drain(): Promise<void> {
		if (this.active || this.resetting) return;
		const job = this.pending.shift();
		if (!job) return;
		this.active = job;
		job.status = 'running';
		for (const target of job.targets.values()) {
			this.updateTargetView(target, { status: 'running' });
			mediaTasks.update(
				target.taskId,
				{ status: 'running', stage: 'preparing', progress: null },
				target.taskRevision
			);
		}
		if (job.sourceTarget) {
			mediaTasks.update(
				job.sourceTarget.taskId,
				{ status: 'running', stage: 'preparing', progress: null },
				job.sourceTarget.taskRevision
			);
		}
		try {
			const blob = await this.dependencies.resolveSource(job.media);
			if (job.controller.signal.aborted) throw abortError();
			const file =
				blob instanceof File
					? blob
					: new File([blob], job.media.fileName, {
							type: blob.type || job.media.mimeType
						});
			const run = (model = job.selection.model): Promise<TranscriptWord[]> =>
				this.dependencies.transcribe(file, {
					...job.selection,
					model,
					sourceStartSeconds: job.sourceStartSeconds,
					sourceEndSeconds: job.sourceEndSeconds,
					signal: job.controller.signal,
					onProgress: (progress) => this.publishProgress(job, progress),
					onRuntimeInfo: (runtime) => {
						if (!runtime.backend) return;
						job.backend = runtime.backend;
						for (const target of job.targets.values()) {
							this.updateTargetView(target, { backend: runtime.backend });
						}
					},
					onFallback: (fallback) => this.publishFallback(job, fallback)
				});
			let words: TranscriptWord[];
			try {
				words = await run();
			} catch (error) {
				if (
					job.selection.model !== 'whisper-large' ||
					job.controller.signal.aborted ||
					!isTranscriptionOutOfMemoryError(error)
				) {
					throw error;
				}
				this.publishFallback(job, {
					engine: 'whisper',
					model: 'whisper-small',
					fallbackReason: 'out-of-memory'
				});
				this.publishProgress(job, { stage: 'preparing', progress: 0, restarted: true });
				words = await run('whisper-small');
			}
			if (job.controller.signal.aborted) throw abortError();
			await this.finishJob(job, undefined, words);
		} catch (error) {
			await this.finishJob(job, error instanceof Error ? error : new Error(String(error)));
		}
	}

	private publishFallback(
		job: QueuedTranscriptionJob,
		fallback: ResolvedTranscriptionEngine
	): void {
		job.fallback = fallback;
		for (const target of job.targets.values()) {
			this.updateTargetView(target, { fallback });
		}
	}

	private publishProgress(job: QueuedTranscriptionJob, progress: TranscribeProgress): void {
		job.progress = progress;
		for (const target of job.targets.values()) {
			this.updateTargetView(target, { progress });
			mediaTasks.update(
				target.taskId,
				{
					stage: progress.stage,
					progress: progress.indeterminate ? null : progress.progress,
					receivedBytes: progress.receivedBytes,
					totalBytes: progress.totalBytes
				},
				target.taskRevision
			);
		}
		if (job.sourceTarget) {
			mediaTasks.update(
				job.sourceTarget.taskId,
				{
					stage: progress.stage,
					progress: progress.indeterminate ? null : progress.progress,
					receivedBytes: progress.receivedBytes,
					totalBytes: progress.totalBytes
				},
				job.sourceTarget.taskRevision
			);
		}
	}

	private updateTargetView(
		target: TranscriptionTarget,
		patch: Partial<TranscriptionJobView>
	): void {
		const current = this.state[target.id];
		if (!current) return;
		this.state[target.id] = { ...current, ...patch };
	}

	private async finishJob(
		job: QueuedTranscriptionJob,
		error?: Error,
		words?: TranscriptWord[]
	): Promise<void> {
		if (this.jobsByRequestKey.get(job.requestKey)?.id !== job.id) return;
		this.jobsByRequestKey.delete(job.requestKey);
		if (this.active?.id === job.id) this.active = null;
		let resultError = error;
		let sourceTranscript: SourceTranscript | undefined;
		if (!resultError && (!words || words.length === 0)) {
			resultError = new Error(m.video_editor_transcribe_no_result());
		}
		if (!resultError && words && job.sourceTarget) {
			try {
				sourceTranscript = await this.dependencies.saveSourceTranscript({
					media: job.media,
					selection: job.selection,
					resolvedModel: job.fallback?.model ?? job.selection.model,
					words
				});
				this.sourceTranscriptState[job.media.id] = {
					status: 'ready',
					transcript: sourceTranscript
				};
			} catch (saveError) {
				resultError = saveError instanceof Error ? saveError : new Error(String(saveError));
			}
		}
		for (const target of [...job.targets.values()]) {
			if (resultError || !words) {
				this.settleTarget(
					job,
					target,
					resultError ?? new Error(m.video_editor_transcribe_no_result())
				);
				continue;
			}
			try {
				const subtitleItemId = addGeneratedSubtitleItem(
					target.item.id,
					words,
					target.source,
					this.dependencies.getCanvas?.()
				);
				this.settleTarget(job, target, undefined, {
					sourceItemId: target.item.id,
					subtitleItemId
				});
			} catch (targetError) {
				this.settleTarget(
					job,
					target,
					targetError instanceof Error ? targetError : new Error(String(targetError))
				);
			}
		}
		if (job.sourceTarget) {
			this.settleSourceTarget(job, job.sourceTarget, resultError, sourceTranscript);
		}
		if (!this.resetting) void this.drain();
	}

	private settleSourceTarget(
		job: QueuedTranscriptionJob,
		target: SourceTranscriptionTarget,
		error?: Error,
		transcript?: SourceTranscript
	): void {
		if (job.sourceTarget?.id === target.id) job.sourceTarget = null;
		mediaTasks.finish(target.taskId, target.taskRevision);
		const owned = this.targetByMediaId.get(target.mediaId);
		if (owned?.target.id === target.id) this.targetByMediaId.delete(target.mediaId);
		if (error) target.reject(error);
		else if (transcript) target.resolve(transcript);
	}

	private settleTarget(
		job: QueuedTranscriptionJob,
		target: TranscriptionTarget,
		error?: Error,
		result?: TranscriptionResult
	): void {
		job.targets.delete(target.id);
		mediaTasks.finish(target.taskId, target.taskRevision);
		const owned = this.targetByItemId.get(target.item.id);
		if (owned?.target.id === target.id) this.targetByItemId.delete(target.item.id);
		delete this.state[target.id];
		if (error) target.reject(error);
		else if (result) target.resolve(result);
	}
}

export const transcriptionService = new TranscriptionService();
