import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import { mediaPool } from '../media/pool.svelte';
import { mediaTasks } from '../media/media-tasks.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { SceneAnalysis } from '../media/scene-search/types';
import { AiCaptionService, type AiCaptionServiceDependencies } from './ai-caption-service.svelte';

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

const item: TimelineItem = {
	id: 'clip',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Clip',
	type: 'video',
	mediaId: 'media',
	sourceStart: 0,
	sourceEnd: 90,
	sourceFps: 30
};

const media: MediaMetadata = {
	id: 'media',
	storageType: 'workspace',
	fileName: 'clip.mp4',
	fileSize: 100,
	mimeType: 'video/mp4',
	duration: 3,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'avc',
	bitrate: 1000,
	tags: ['video']
};

function sceneAnalysis(scenes: SceneAnalysis['scenes'] = []): SceneAnalysis {
	return {
		schemaVersion: 1,
		detectorVersion: 2,
		mediaId: media.id,
		sourceFileSize: media.fileSize,
		method: 'adaptive',
		sampleIntervalSec: 0,
		analyzedAt: Date.now(),
		scenes
	};
}

interface PendingAiCaption {
	media: MediaMetadata;
	resolve: (analysis: SceneAnalysis) => void;
	reject: (error: Error) => void;
	signal?: AbortSignal;
}

function controlledDependencies() {
	const pending: PendingAiCaption[] = [];
	const dependencies: AiCaptionServiceDependencies = {
		isAnalyzable: () => true,
		analyzeScenes: vi.fn((m: MediaMetadata, opts) => {
			return new Promise<SceneAnalysis>((resolve, reject) => {
				pending.push({ media: m, resolve, reject, signal: opts.signal });
				opts.signal?.addEventListener(
					'abort',
					() => reject(new DOMException('AI caption cancelled', 'AbortError')),
					{
						once: true
					}
				);
			});
		}),
		analyzeContent: vi.fn(async (analysis: SceneAnalysis) => analysis),
		getCanvas: () => ({ width: 1920, height: 1080 })
	};
	return { pending, dependencies };
}

beforeEach(() => {
	commandHistory.clearHistory();
	mediaTasks.reset();
	mediaPool.clear();
	mediaPool.upsert(media, 'ready');
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
});

describe('AiCaptionService rapid guard and worker contention', () => {
	it('coalesces rapid duplicate triggers for the same clip and serializes distinct clips', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new AiCaptionService(dependencies);
		const first = service.enqueue(item.id);
		const duplicate = service.enqueue(item.id);
		expect(duplicate).toBe(first);
		expect(pending).toHaveLength(1);
		expect(service.jobForItem(item.id)?.status).toBe('running');

		// Different clip would be queued, but we test same clip duplicate is coalesced
		// Resolve first job with scenes that overlap the clip window
		const analysis = sceneAnalysis([
			{
				id: `${media.id}:0`,
				mediaId: media.id,
				index: 0,
				startSec: 0,
				endSec: 1,
				timeSec: 0,
				text: 'A test scene'
			}
		]);
		pending[0]!.resolve(analysis);
		await expect(first).resolves.toMatchObject({ sourceItemId: item.id });
		await expect(duplicate).resolves.toMatchObject({ sourceItemId: item.id });
		expect(
			timelineStore.items.filter((entry) => entry.captionSource?.type === 'ai-captions')
		).toHaveLength(1);
		expect(service.jobs).toHaveLength(0);
	});

	it('does not start a duplicate job while one is running; second distinct trigger stays queued', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new AiCaptionService(dependencies);
		const secondTrack: TimelineTrack = { ...track, id: 'video2', order: 1 };
		const secondItem: TimelineItem = { ...item, id: 'clip2', trackId: secondTrack.id };
		timelineStore.setAll({ tracks: [track, secondTrack], items: [item, secondItem], fps: 30 });
		mediaPool.upsert({ ...media, id: 'media2', fileName: 'clip2.mp4' }, 'ready');
		// Need second media for second item
		const media2: MediaMetadata = { ...media, id: 'media2', fileName: 'clip2.mp4' };
		mediaPool.upsert(media2, 'ready');
		secondItem.mediaId = 'media2';

		const first = service.enqueue(item.id);
		const second = service.enqueue(secondItem.id);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(service.jobForItem(item.id)?.status).toBe('running');
		expect(service.jobForItem(secondItem.id)?.status).toBe('queued');
		expect(service.queuePosition(service.jobForItem(secondItem.id)!.id)).toBe(1);

		pending[0]!.resolve(
			sceneAnalysis([
				{
					id: `${media.id}:0`,
					mediaId: media.id,
					index: 0,
					startSec: 0,
					endSec: 1,
					timeSec: 0,
					text: 'Scene'
				}
			])
		);
		await expect(first).resolves.toBeDefined();
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		pending[1]!.resolve(
			sceneAnalysis([
				{
					id: `${media2.id}:0`,
					mediaId: media2.id,
					index: 0,
					startSec: 0,
					endSec: 1,
					timeSec: 0,
					text: 'Scene 2'
				}
			])
		);
		await expect(second).resolves.toBeDefined();
		expect(service.jobs).toHaveLength(0);
	});

	it('cancels cleanly and allows a fresh retry after abort', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new AiCaptionService(dependencies);
		const first = service.enqueue(item.id);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(service.cancelForItem(item.id)).toBe(true);
		expect(service.jobForItem(item.id)?.status).toBe('cancelling');
		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		expect(service.jobs).toHaveLength(0);
		expect(mediaTasks.list).toHaveLength(0);

		// Fresh retry should succeed
		const retry = service.enqueue(item.id);
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		pending[1]!.resolve(
			sceneAnalysis([
				{
					id: `${media.id}:0`,
					mediaId: media.id,
					index: 0,
					startSec: 0,
					endSec: 1,
					timeSec: 0,
					text: 'Retry scene'
				}
			])
		);
		await expect(retry).resolves.toMatchObject({ sourceItemId: item.id });
		expect(
			timelineStore.items.filter((entry) => entry.captionSource?.type === 'ai-captions')
		).toHaveLength(1);
	});
});
