import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../../routes/layout.css';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { beatDetectionService } from './beat-detection-service.svelte';
import BeatDetectionPanel from './beat-detection-panel.svelte';

const media: MediaMetadata = {
	id: 'media-audio',
	storageType: 'workspace',
	fileName: 'beat.wav',
	fileSize: 1000,
	mimeType: 'audio/wav',
	duration: 4,
	width: 0,
	height: 0,
	fps: 0,
	codec: 'pcm',
	audioCodec: 'pcm',
	audioCodecSupported: true,
	tags: ['audio']
};

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip-1',
		trackId: 'track-audio',
		from: 0,
		durationInFrames: 120,
		label: 'Beat clip',
		type: 'audio',
		mediaId: media.id,
		sourceStart: 0,
		sourceEnd: 120,
		sourceFps: 30,
		...overrides
	};
}

describe('beat detection panel - browser UI cancellation / error / success', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		mediaPool.clear();
		beatDetectionService.reset();
		beatDetectionService.clearResolveMediaBlobForTesting();
		beatDetectionService.setAnalyzeBlobForTesting(null);
		beatDetectionService.setResolveMediaBlobForTesting(async () => new Blob([new Uint8Array(100)]));
		mediaPool.upsert(media, 'ready');
		timelineStore.setAll({
			tracks: [
				{
					id: 'track-audio',
					name: 'Audio',
					kind: 'audio',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [clip()],
			fps: 30,
			markers: []
		});
	});

	it('surfaces no-selection error when no audio or video clip exists', async () => {
		timelineStore._setItems([]);
		render(BeatDetectionPanel, { props: { selectedItemId: null } });
		await expect.element(page.getByRole('button', { name: /Detect beats/ })).toBeDisabled();
		await expect(beatDetectionService.analyzeSelectedClip(null)).rejects.toThrow(/Select an audio/);
		await expect.element(page.getByText(/Select an audio or video clip/)).toBeInTheDocument();
		expect(beatDetectionService.status).toBe('error');
		expect(timelineStore.markers).toHaveLength(0);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('cancels an in-flight analysis and leaves markers and history intact', async () => {
		beatDetectionService.setAnalyzeBlobForTesting(
			(_blob: Blob, signal?: AbortSignal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener('abort', () =>
						reject(new DOMException('Cancelled', 'AbortError'))
					);
				})
		);

		render(BeatDetectionPanel, { props: { selectedItemId: 'clip-1' } });
		const promise = beatDetectionService.analyzeSelectedClip('clip-1');
		await expect.element(page.getByText(/Analyzing audio/)).toBeInTheDocument();
		beatDetectionService.cancel();
		const result = await promise;
		expect(result.status).toBe('cancelled');
		expect(beatDetectionService.status).toBe('cancelled');
		expect(timelineStore.markers).toHaveLength(0);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('adds beat markers on success and announces count and BPM', async () => {
		beatDetectionService.setAnalyzeBlobForTesting(async () => ({
			bpm: 120,
			confidence: 0.9,
			beats: [
				{ time: 0, strength: 1, index: 0 },
				{ time: 0.5, strength: 1, index: 1 },
				{ time: 1, strength: 1, index: 2 }
			],
			duration: 2,
			downbeats: [0]
		}));

		render(BeatDetectionPanel, { props: { selectedItemId: 'clip-1' } });
		await page.getByRole('button', { name: /Detect beats/ }).click();
		await expect.element(page.getByText(/Added 3 beat markers/)).toBeInTheDocument();
		await expect.element(page.getByText(/120 BPM/)).toBeInTheDocument();
		expect(timelineStore.markers).toHaveLength(3);
		expect(timelineStore.markers[0]?.label).toBe('Downbeat 1');
		expect(commandHistory.canUndo).toBe(true);
		expect(commandHistory.getLastCommandType()).toBe('ADD_BEAT_MARKERS');
	});

	it('surfaces decode failure as an error alert without markers', async () => {
		beatDetectionService.setResolveMediaBlobForTesting(async () => {
			throw new Error('Source bytes missing for beat.wav');
		});

		render(BeatDetectionPanel, { props: { selectedItemId: 'clip-1' } });
		await page.getByRole('button', { name: /Detect beats/ }).click();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		await expect.element(page.getByText(/Source bytes missing/)).toBeInTheDocument();
		expect(timelineStore.markers).toHaveLength(0);
	});

	it('uses shared controls: panel is labelled and button has accessible name', async () => {
		render(BeatDetectionPanel, { props: { selectedItemId: 'clip-1' } });
		await expect.element(page.getByRole('button', { name: /Detect beats/ })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: /Beat markers/ })).toBeInTheDocument();
	});
});
