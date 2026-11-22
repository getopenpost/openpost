import { afterEach, expect, it, vi } from 'vitest';
import { analyzeRecordingCleanup } from './analyze-recording';
import { analyzeSilenceSignal } from '../media/silence';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';

// Audio decoding is an I/O boundary. The detector's own tests prove PCM classification;
// these cases prove that missing transcript words never replace its evidence.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('../media/silence', () => ({ analyzeSilenceSignal: vi.fn() }));

afterEach(() => {
	timelineStore.__resetForTesting();
	vi.clearAllMocks();
});

it.each([
	{
		name: 'audible content missing from the transcript',
		signalRanges: [],
		failed: false,
		expected: []
	},
	{
		name: 'a confirmed silent part of a transcript gap',
		signalRanges: [{ start: 2, end: 3 }],
		failed: false,
		expected: [{ start: 2, end: 3 }]
	},
	{
		name: 'audio that could not be decoded',
		signalRanges: [],
		failed: true,
		expected: []
	}
])('requires audio evidence for $name', async ({ signalRanges, failed, expected }) => {
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'clip',
			type: 'audio',
			trackId: 'track-audio',
			mediaId: 'recording',
			label: 'Recording',
			from: 0,
			durationInFrames: 180,
			sourceStart: 0,
			sourceEnd: 180,
			sourceFps: 30
		},
		{
			id: 'captions',
			type: 'subtitle',
			trackId: 'track-video-overlay',
			label: 'Partial captions',
			from: 0,
			durationInFrames: 180,
			captionSource: {
				type: 'transcript',
				clipId: 'clip',
				mediaId: 'recording',
				sourceStartSeconds: 0,
				sourceEndSeconds: 6
			},
			cues: [
				{
					id: 'cue',
					startFrame: 0,
					endFrame: 180,
					text: 'Hello everyone',
					words: [
						{ id: 'one', text: 'Hello', startFrame: 0, endFrame: 15 },
						{ id: 'two', text: 'everyone', startFrame: 120, endFrame: 180 }
					]
				}
			]
		}
	]);
	vi.mocked(analyzeSilenceSignal).mockResolvedValue({
		rangesByMediaId: { recording: signalRanges },
		analyzedMediaIds: failed ? [] : ['recording'],
		failedMediaIds: failed ? ['recording'] : []
	});
	const result = await analyzeRecordingCleanup(['clip'], {
		signal: new AbortController().signal,
		onProgress: () => {}
	});
	expect(result.ranges.map(({ start, end }) => ({ start, end }))).toEqual(expected);
	expect(result.failedCount).toBe(failed ? 1 : 0);
	expect(timelineStore.itemById.get('clip')?.durationInFrames).toBe(180);
});
