import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import { mediaPool } from '../media/pool.svelte';
import { mediaTasks } from '../media/media-tasks.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { TranscriptWord } from './cues';
import type { TranscribeOptions, TranscriptionSelection } from './engine/types';
import type { SourceTranscript } from '../workspace-fs/source-transcripts';
import {
	TranscriptionService,
	type TranscriptionServiceDependencies
} from './transcription-service.svelte';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const firstItem: TimelineItem = {
	id: 'first',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'First interview',
	type: 'video',
	mediaId: 'media',
	sourceStart: 0,
	sourceEnd: 90,
	sourceFps: 30
};

const secondItem: TimelineItem = {
	...firstItem,
	id: 'second',
	from: 120,
	label: 'Second interview',
	sourceStart: 90,
	sourceEnd: 180
};

const repeatedItem: TimelineItem = {
	...firstItem,
	id: 'repeat',
	from: 240,
	label: 'Repeated interview'
};

const media: MediaMetadata = {
	id: 'media',
	storageType: 'workspace',
	fileName: 'interview.mp4',
	fileSize: 100,
	mimeType: 'video/mp4',
	duration: 6,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'avc',
	bitrate: 1_000,
	tags: ['video']
};

const selection: TranscriptionSelection = {
	model: 'whisper-base',
	language: 'en',
	quantization: 'hybrid'
};

interface PendingTranscription {
	options: TranscribeOptions;
	resolve: (words: TranscriptWord[]) => void;
	reject: (error: Error) => void;
}

interface ControlledDependencies {
	dependencies: TranscriptionServiceDependencies;
	pending: PendingTranscription[];
	get storedTranscript(): SourceTranscript | null;
}

function controlledDependencies(): ControlledDependencies {
	const pending: PendingTranscription[] = [];
	let storedTranscript: SourceTranscript | null = null;
	return {
		pending,
		get storedTranscript() {
			return storedTranscript;
		},
		dependencies: {
			resolveSource: vi.fn(async () => new Blob(['source'], { type: 'video/mp4' })),
			transcribe: vi.fn((_file, options) => {
				return new Promise<TranscriptWord[]>((resolve, reject) => {
					const entry = { options, resolve, reject };
					pending.push(entry);
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Transcription cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}),
			getSourceTranscript: vi.fn(async () => storedTranscript),
			saveSourceTranscript: vi.fn(async (input) => {
				const now = Date.now();
				storedTranscript = {
					schemaVersion: 1,
					mediaId: input.media.id,
					contentHash: input.media.contentHash,
					sourceFileSize: input.media.fileSize,
					sourceLastModified: input.media.fileLastModified,
					model: input.selection.model,
					resolvedModel: input.resolvedModel,
					language: input.selection.language,
					quantization: input.selection.quantization,
					words: input.words,
					createdAt: storedTranscript?.createdAt ?? now,
					updatedAt: now
				};
				return storedTranscript;
			}),
			deleteSourceTranscript: vi.fn(async () => {
				storedTranscript = null;
			})
		}
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	mediaTasks.reset();
	mediaPool.clear();
	mediaPool.upsert(media, 'ready');
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [track],
		items: [firstItem, secondItem, repeatedItem],
		fps: 30
	});
});

describe('TranscriptionService', () => {
	it('coalesces identical requests and serializes distinct clip windows', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const duplicate = service.enqueue(firstItem.id, selection);
		const second = service.enqueue(secondItem.id, selection);

		expect(duplicate).toBe(first);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(pending[0]?.options.sourceStartSeconds).toBe(0);
		expect(service.jobForItem(firstItem.id)).toMatchObject({ status: 'running' });
		expect(service.jobForItem(secondItem.id)).toMatchObject({ status: 'queued' });
		expect(service.queuePosition(service.jobForItem(secondItem.id)!.id)).toBe(1);

		pending[0]!.resolve([{ text: 'First', startSeconds: 0, endSeconds: 1 }]);
		await expect(first).resolves.toMatchObject({ sourceItemId: firstItem.id });
		await expect(duplicate).resolves.toMatchObject({ sourceItemId: firstItem.id });
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		expect(pending[1]?.options.sourceStartSeconds).toBe(3);

		pending[1]!.resolve([{ text: 'Second', startSeconds: 0, endSeconds: 1 }]);
		await expect(second).resolves.toMatchObject({ sourceItemId: secondItem.id });
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(2);
		expect(service.jobs).toHaveLength(0);
		expect(mediaTasks.list).toHaveLength(0);
	});

	it('shares one decode across repeated placements of the same source window', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const repeated = service.enqueue(repeatedItem.id, selection);

		await vi.waitFor(() => expect(pending).toHaveLength(1));
		pending[0]!.resolve([{ text: 'Shared', startSeconds: 0, endSeconds: 1 }]);
		await expect(first).resolves.toMatchObject({ sourceItemId: firstItem.id });
		await expect(repeated).resolves.toMatchObject({ sourceItemId: repeatedItem.id });
		expect(dependencies.transcribe).toHaveBeenCalledOnce();
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(2);
	});

	it('cancels one coalesced placement without aborting the shared decode', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const repeated = service.enqueue(repeatedItem.id, selection);

		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(service.cancelForItem(repeatedItem.id)).toBe(true);
		await expect(repeated).rejects.toMatchObject({ name: 'AbortError' });
		expect(pending[0]!.options.signal?.aborted).toBe(false);

		pending[0]!.resolve([{ text: 'First only', startSeconds: 0, endSeconds: 1 }]);
		await expect(first).resolves.toMatchObject({ sourceItemId: firstItem.id });
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(1);
	});

	it('cancels queued and active jobs without blocking the next request', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const second = service.enqueue(secondItem.id, selection);

		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(service.cancelForItem(secondItem.id)).toBe(true);
		await expect(second).rejects.toMatchObject({ name: 'AbortError' });
		expect(service.jobForItem(secondItem.id)).toBeUndefined();

		expect(service.cancelForItem(firstItem.id)).toBe(true);
		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		expect(service.jobs).toHaveLength(0);
		expect(mediaTasks.list).toHaveLength(0);
	});

	it('discards a completed result when the source window changed during transcription', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const result = service.enqueue(firstItem.id, selection);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		timelineStore._updateItems([{ id: firstItem.id, patch: { speed: 2 } }]);
		pending[0]!.resolve([{ text: 'Stale', startSeconds: 0, endSeconds: 1 }]);

		await expect(result).rejects.toThrow('changed while transcription was running');
		expect(timelineStore.items.some((item) => item.type === 'subtitle')).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('publishes progress and runtime details only on the owning job', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const result = service.enqueue(firstItem.id, selection);
		await vi.waitFor(() => expect(pending).toHaveLength(1));

		pending[0]!.options.onProgress?.({ stage: 'decoding', progress: 0.4 });
		pending[0]!.options.onRuntimeInfo?.({ backend: 'webgpu' });
		pending[0]!.options.onFallback?.({
			engine: 'whisper',
			model: 'whisper-small',
			fallbackReason: 'no-webgpu'
		});
		expect(service.jobForItem(firstItem.id)).toMatchObject({
			progress: { stage: 'decoding', progress: 0.4 },
			backend: 'webgpu',
			fallback: { model: 'whisper-small' }
		});

		pending[0]!.resolve([{ text: 'Done', startSeconds: 0, endSeconds: 1 }]);
		await result;
	});

	it('retries Whisper Large with Whisper Small after a browser memory failure', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const result = service.enqueue(firstItem.id, { ...selection, model: 'whisper-large' });
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		pending[0]!.reject(new RangeError('Array buffer allocation failed'));

		await vi.waitFor(() => expect(pending).toHaveLength(2));
		expect(pending[1]?.options.model).toBe('whisper-small');
		expect(service.jobForItem(firstItem.id)).toMatchObject({
			status: 'running',
			fallback: { model: 'whisper-small', fallbackReason: 'out-of-memory' },
			progress: { stage: 'preparing', progress: 0, restarted: true }
		});

		pending[1]!.resolve([{ text: 'Recovered', startSeconds: 0, endSeconds: 1 }]);
		await expect(result).resolves.toMatchObject({ sourceItemId: firstItem.id });
	});

	it('persists a full-source transcript and reuses it for later clip captions', async () => {
		const controlled = controlledDependencies();
		const sourceService = new TranscriptionService(controlled.dependencies);
		const sourceResult = sourceService.enqueueMedia(media.id, selection);
		await vi.waitFor(() => expect(controlled.pending).toHaveLength(1));
		expect(controlled.pending[0]?.options).toMatchObject({
			sourceStartSeconds: 0,
			sourceEndSeconds: media.duration
		});
		controlled.pending[0]!.resolve([
			{ text: 'First', startSeconds: 0.25, endSeconds: 0.75 },
			{ text: 'Later', startSeconds: 3.25, endSeconds: 3.75 }
		]);
		await expect(sourceResult).resolves.toMatchObject({
			mediaId: media.id,
			model: selection.model
		});

		sourceService.reset();
		const restoredService = new TranscriptionService(controlled.dependencies);
		const clipResult = restoredService.enqueue(firstItem.id, selection);
		await expect(clipResult).resolves.toMatchObject({ sourceItemId: firstItem.id });
		expect(controlled.dependencies.transcribe).toHaveBeenCalledOnce();
		const caption = timelineStore.items.find(
			(item) =>
				item.captionSource?.type === 'transcript' && item.captionSource.clipId === firstItem.id
		);
		expect(caption?.cues?.[0]).toMatchObject({ startFrame: 8, endFrame: 23, text: 'First' });
	});

	it('refreshes and deletes the reusable source transcript without removing placed captions', async () => {
		const controlled = controlledDependencies();
		const service = new TranscriptionService(controlled.dependencies);
		const generated = service.enqueueMedia(media.id, selection);
		await vi.waitFor(() => expect(controlled.pending).toHaveLength(1));
		controlled.pending[0]!.resolve([{ text: 'First', startSeconds: 0, endSeconds: 1 }]);
		await generated;
		await service.enqueue(firstItem.id, selection);

		const refreshed = service.enqueueMedia(media.id, selection);
		await vi.waitFor(() => expect(controlled.pending).toHaveLength(2));
		controlled.pending[1]!.resolve([{ text: 'Better', startSeconds: 0, endSeconds: 1 }]);
		await expect(refreshed).resolves.toMatchObject({ words: [{ text: 'Better' }] });
		expect(controlled.dependencies.saveSourceTranscript).toHaveBeenCalledTimes(2);

		await service.deleteMediaTranscript(media.id);
		expect(controlled.storedTranscript).toBeNull();
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(1);
		expect(service.sourceTranscriptStatus(media.id)).toBe('idle');
	});

	it('cancels a source transcription through the shared media task', async () => {
		const controlled = controlledDependencies();
		const service = new TranscriptionService(controlled.dependencies);
		const result = service.enqueueMedia(media.id, selection);
		await vi.waitFor(() => expect(controlled.pending).toHaveLength(1));
		expect(service.cancelForMedia(media.id)).toBe(true);
		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(mediaTasks.list).toHaveLength(0);
		expect(controlled.dependencies.saveSourceTranscript).not.toHaveBeenCalled();
	});

	it('does not start a clip job after the editor resets during transcript cache lookup', async () => {
		const controlled = controlledDependencies();
		let finishLookup!: (transcript: SourceTranscript | null) => void;
		controlled.dependencies.getSourceTranscript = vi.fn(
			() =>
				new Promise<SourceTranscript | null>((resolve) => {
					finishLookup = resolve;
				})
		);
		const service = new TranscriptionService(controlled.dependencies);
		const result = service.enqueue(firstItem.id, selection);
		service.reset();
		finishLookup(null);

		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(controlled.dependencies.transcribe).not.toHaveBeenCalled();
		expect(mediaTasks.list).toHaveLength(0);
	});
});
