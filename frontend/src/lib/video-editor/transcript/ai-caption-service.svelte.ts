/**
 * Service for local AI captions: wraps scene detection + LFM captioning
 * and commits the result as a subtitle item with captionSource ai-captions.
 *
 * Reuses the existing local AI stack (scene-analysis-client,
 * analyzeSceneContent, sceneCaptionProvider via scene-browser) rather than
 * adding a bespoke model layer. Progress is surfaced through mediaTasks and
 * the service exposes per-clip cancel and queued state like the transcript
 * service, so the UI can show progress/cancel/error with shared controls.
 */

import { mediaPool } from '../media/pool.svelte';
import { mediaTaskId, mediaTasks } from '../media/media-tasks.svelte';
import type { MediaMetadata } from '../media/types';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { m } from '$lib/paraglide/messages';
import { analyzeMediaScenes, isSceneAnalyzableMedia } from '../media/scene-search/scene-analysis-client';
import { analyzeSceneContent } from '../media/scene-search/ai/analyze-scenes';
import { sceneBrowser } from '../media/scene-search/scene-browser.svelte';
import { addAiCaptionSubtitleItem, buildAiCaptionCues } from './ai-captions';
import { captureTranscriptionSource, transcriptionSourceWindow, type TranscriptionSourceSnapshot } from './transcribe-action';

export type AiCaptionJobStatus = 'queued' | 'running' | 'cancelling';

export interface AiCaptionJobView {
	id: string;
	itemId: string;
	mediaId: string;
	label: string;
	status: AiCaptionJobStatus;
	progress: { stage: string; percent: number; completed?: number; total?: number } | null;
}

export interface AiCaptionResult {
	sourceItemId: string;
	subtitleItemId: string;
}

interface AiCaptionTarget {
	id: string;
	item: TimelineItem;
	source: TranscriptionSourceSnapshot;
	taskId: string;
	taskRevision: number;
	promise: Promise<AiCaptionResult>;
	resolve: (value: AiCaptionResult) => void;
	reject: (error: Error) => void;
}

interface QueuedAiCaptionJob {
	id: string;
	media: MediaMetadata;
	item: TimelineItem;
	source: TranscriptionSourceSnapshot;
	controller: AbortController;
	status: Extract<AiCaptionJobStatus, 'queued' | 'running'>;
	progress: AiCaptionJobView['progress'];
	targets: Map<string, AiCaptionTarget>;
}

function abortError(): DOMException {
	return new DOMException('AI caption cancelled', 'AbortError');
}

export class AiCaptionService {
	private readonly pending: QueuedAiCaptionJob[] = [];
	private readonly targetByItemId = new Map<string, { job: QueuedAiCaptionJob; target: AiCaptionTarget }>();
	private active: QueuedAiCaptionJob | null = null;
	private resetting = false;
	private state = $state<Record<string, AiCaptionJobView>>({});

	get jobs(): AiCaptionJobView[] {
		return Object.values(this.state);
	}

	jobForItem(itemId: string): AiCaptionJobView | undefined {
		const owned = this.targetByItemId.get(itemId);
		return owned ? this.state[owned.target.id] : undefined;
	}

	queuePosition(viewId: string): number | null {
		const index = this.pending.findIndex((job) => [...job.targets.values()].some((target) => target.id === viewId));
		return index < 0 ? null : index + 1;
	}

	enqueue(itemId: string): Promise<AiCaptionResult> {
		const item = timelineStore.itemById.get(itemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return Promise.reject(new Error(m.video_editor_transcribe_select_media()));
		if (item.type !== 'video' && item.type !== 'audio') {
			return Promise.reject(new Error(m.video_editor_transcribe_media_only()));
		}
		if (!isSceneAnalyzableMedia(media)) {
			return Promise.reject(new Error(m.video_editor_ai_captions_unsupported_media()));
		}
		if (this.targetByItemId.has(itemId)) {
			return Promise.reject(new Error(m.video_editor_transcribe_already_queued()));
		}
		const source = captureTranscriptionSource(item);
		const job: QueuedAiCaptionJob = {
			id: crypto.randomUUID(),
			media,
			item: $state.snapshot(item),
			source,
			controller: new AbortController(),
			status: 'queued',
			progress: null,
			targets: new Map()
		};
		const target = this.createTarget(job);
		this.pending.push(job);
		void this.drain();
		return target.promise;
	}

	cancelForItem(itemId: string): boolean {
		const owned = this.targetByItemId.get(itemId);
		if (!owned) return false;
		const { job, target } = owned;
		if (this.active?.id === job.id) {
			this.updateTargetView(target, { status: 'cancelling' });
			mediaTasks.update(target.taskId, { status: 'cancelling', stage: 'cancelling' }, target.taskRevision);
			job.controller.abort();
			return true;
		}
		const index = this.pending.findIndex((candidate) => candidate.id === job.id);
		if (index >= 0) this.pending.splice(index, 1);
		this.finishJob(job, abortError());
		return true;
	}

	reset(): void {
		this.resetting = true;
		for (const job of [...this.pending]) this.finishJob(job, abortError());
		this.pending.length = 0;
		const active = this.active;
		active?.controller.abort();
		if (active) this.finishJob(active, abortError());
		this.resetting = false;
	}

	private createTarget(job: QueuedAiCaptionJob): AiCaptionTarget {
		let resolve!: (value: AiCaptionResult) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<AiCaptionResult>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const id = crypto.randomUUID();
		const taskId = mediaTaskId('ai-caption', job.item.id);
		const taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'ai-caption',
			mediaId: job.media.id,
			label: job.item.label || job.media.fileName,
			stage: 'queued',
			status: 'queued',
			progress: 0,
			onCancel: () => this.cancelForItem(job.item.id)
		});
		const target: AiCaptionTarget = {
			id,
			item: job.item,
			source: job.source,
			taskId,
			taskRevision,
			promise,
			resolve,
			reject
		};
		job.targets.set(id, target);
		this.targetByItemId.set(job.item.id, { job, target });
		this.state[id] = {
			id,
			itemId: job.item.id,
			mediaId: job.media.id,
			label: job.item.label || job.media.fileName,
			status: job.status,
			progress: job.progress
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
			mediaTasks.update(target.taskId, { status: 'running', stage: 'detecting', progress: null }, target.taskRevision);
		}
		try {
			const signal = job.controller.signal;
			const onProgress = (progress: { stage: string; percent: number; completed?: number; total?: number }) => {
				job.progress = progress;
				for (const target of job.targets.values()) {
					this.updateTargetView(target, { progress });
					mediaTasks.update(
						target.taskId,
						{ stage: progress.stage, progress: progress.percent / 100, completed: progress.completed, total: progress.total },
						target.taskRevision
					);
				}
			};
			if (signal.aborted) throw abortError();
			// 1. ensure scene detection (cached or fresh)
			const detection = await analyzeMediaScenes(job.media, {
				signal,
				onProgress: (progress) => onProgress({ stage: progress.stage, percent: progress.percent, completed: progress.completed, total: progress.total })
			});
			if (signal.aborted) throw abortError();
			// 2. ensure semantic captioning/indexing (reuses thumbnails, loads LFM model)
			let analysis = sceneBrowser.analysis(job.media.id) ?? detection;
			const needsCaption = !analysis.scenes.every((scene) => scene.text && scene.text.trim().length > 0);
			if (needsCaption) {
				analysis = await analyzeSceneContent(detection, {
					signal,
					onProgress: (progress) =>
						onProgress({ stage: progress.stage, percent: progress.percent, completed: progress.completed, total: progress.total })
				});
			} else {
				// Still ensure the browser state is hydrated for UI consistency.
				sceneBrowser.__setAnalysisForTesting(analysis);
			}
			if (signal.aborted) throw abortError();
			// Verify the source clip hasn't moved while we were analyzing.
			const current = timelineStore.itemById.get(job.item.id);
			if (!current) throw new Error(m.video_editor_transcribe_source_changed());
			const currentWindow = transcriptionSourceWindow(current);
			if (
				currentWindow.sourceStartSeconds !== job.source.sourceStartSeconds ||
				currentWindow.sourceEndSeconds !== job.source.sourceEndSeconds
			) {
				throw new Error(m.video_editor_transcribe_source_changed());
			}
			const cues = buildAiCaptionCues(analysis.scenes, current, timelineStore.fps);
			if (cues.length === 0) throw new Error(m.video_editor_ai_captions_empty());
			this.finishJob(job, undefined, analysis.scenes);
		} catch (error) {
			this.finishJob(job, error instanceof Error ? error : new Error(String(error)));
		}
	}

	private updateTargetView(target: AiCaptionTarget, patch: Partial<AiCaptionJobView>): void {
		const current = this.state[target.id];
		if (!current) return;
		this.state[target.id] = { ...current, ...patch };
	}

	private finishJob(job: QueuedAiCaptionJob, error?: Error, scenes?: readonly import('../media/scene-search/types').MediaScene[]): void {
		if (this.active?.id === job.id) this.active = null;
		for (const target of [...job.targets.values()]) {
			if (error || !scenes) {
				this.settleTarget(job, target, error ?? new Error(m.video_editor_ai_captions_failed()));
				continue;
			}
			try {
				const subtitleItemId = addAiCaptionSubtitleItem(target.item.id, scenes, target.source);
				this.settleTarget(job, target, undefined, { sourceItemId: target.item.id, subtitleItemId });
			} catch (targetError) {
				this.settleTarget(job, target, targetError instanceof Error ? targetError : new Error(String(targetError)));
			}
		}
		if (!this.resetting) void this.drain();
	}

	private settleTarget(
		job: QueuedAiCaptionJob,
		target: AiCaptionTarget,
		error?: Error,
		result?: AiCaptionResult
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

export const aiCaptionService = new AiCaptionService();
