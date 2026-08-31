import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import {
	audioSkimTimeSeconds,
	createLatestOnlyFrameRunner,
	createResilientAudioSkimEngine,
	selectAudioSkimSource,
	type AudioSkimEngine
} from './audio-skim';

const FPS = 30;

function track(
	id: string,
	kind: 'video' | 'audio',
	order: number,
	overrides: Partial<TimelineTrack> = {}
): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		volume: 1,
		...overrides
	};
}

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		mediaId: 'video-media',
		sourceStart: 30,
		sourceEnd: 150,
		sourceDuration: 180,
		sourceFps: 60,
		speed: 2,
		...overrides
	};
}

function engine(scrub = vi.fn()): AudioSkimEngine {
	return { scrub, stop: vi.fn(), dispose: vi.fn() };
}

describe('timeline audio skim scheduling', () => {
	it('runs the active frame and only the newest queued frame', async () => {
		const releases: Array<() => void> = [];
		const started: number[] = [];
		const runner = createLatestOnlyFrameRunner(async (frame) => {
			started.push(frame);
			await new Promise<void>((resolve) => releases.push(resolve));
		});

		runner.schedule(10);
		runner.schedule(11);
		runner.schedule(12);
		expect(started).toEqual([10]);
		releases.shift()?.();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual([10, 12]);
		releases.shift()?.();
	});

	it('maps speed, source frame rate, and reverse playback exactly', () => {
		const forward = clip();
		expect(audioSkimTimeSeconds(forward, 15, FPS, 3)).toBeCloseTo(1.5, 8);
		expect(audioSkimTimeSeconds({ ...forward, isReversed: true }, 15, FPS, 3)).toBeCloseTo(
			1.48333333,
			7
		);
	});

	it('uses the audible audio companion instead of double-playing linked video audio', () => {
		const tracks = [track('video', 'video', 0), track('audio', 'audio', 1)];
		const items = [
			clip({ id: 'video', linkedGroupId: 'linked' }),
			clip({
				id: 'audio',
				type: 'audio',
				trackId: 'audio',
				mediaId: 'audio-media',
				linkedGroupId: 'linked',
				volume: 0.5
			})
		];
		const source = selectAudioSkimSource(15, items, tracks, [], FPS, () => 3);
		expect(source?.item.id).toBe('audio');
		expect(source?.gain).toBeCloseTo(0.5, 8);
	});

	it('honors mute and solo before descending into nested compositions', () => {
		const outer = clip({
			id: 'nested',
			type: 'composition',
			mediaId: undefined,
			compositionId: 'sequence',
			sourceStart: 10,
			sourceEnd: 70,
			sourceFps: FPS,
			speed: 1
		});
		const innerAudio = clip({
			id: 'inner-audio',
			type: 'audio',
			trackId: 'inner-audio',
			mediaId: 'nested-media',
			sourceStart: 0,
			sourceEnd: 120,
			speed: 1
		});
		const resolveComposition = () => ({
			items: [innerAudio],
			tracks: [track('inner-audio', 'audio', 0, { solo: true })],
			transitions: [],
			fps: FPS
		});
		const source = selectAudioSkimSource(
			15,
			[outer],
			[track('video', 'video', 0)],
			[],
			FPS,
			() => 4,
			resolveComposition
		);
		expect(source?.item.id).toBe('inner-audio');
		expect(source?.timeSeconds).toBeCloseTo(25 / FPS, 8);

		const muted = selectAudioSkimSource(
			15,
			[outer],
			[track('video', 'video', 0, { muted: true })],
			[],
			FPS,
			() => 4,
			resolveComposition
		);
		expect(muted).toBeNull();
	});
});

describe('resilient audio skim engine', () => {
	it('recovers from an element playback failure', async () => {
		const primary = engine(vi.fn().mockRejectedValue(new Error('autoplay rejected')));
		const fallback = engine(vi.fn().mockResolvedValue(undefined));
		const resilient = createResilientAudioSkimEngine(primary, fallback);
		const request = { url: 'blob:media', kind: 'audio' as const, timeSeconds: 1, gain: 0.8 };

		await expect(resilient.scrub(request)).resolves.toBeUndefined();
	});
});
