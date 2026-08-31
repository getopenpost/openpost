import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import {
	planBeatSync,
	splitItemOnBeatMarkersAtomic,
	syncTracksToBeatMarkersAtomic
} from './beat-sync';

function track(id: string, locked = false): TimelineTrack {
	return {
		id,
		name: id,
		kind: id.includes('audio') ? 'audio' : 'video',
		height: 96,
		locked,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: 0
	};
}

function clip(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 40,
		label: id,
		type: 'video',
		mediaId: `media-${id}`,
		sourceStart: 0,
		sourceEnd: 40,
		sourceDuration: 300,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

describe('beat sync planning', () => {
	it('fits clips to an independently defined beat grid in every mode', () => {
		const clips = [
			clip('first', { from: 12, durationInFrames: 62 }),
			clip('second', { from: 100, durationInFrames: 28 })
		];
		const beats = [0, 30, 60, 90, 120, 150];

		expect(planBeatSync(clips, beats, { mode: 'smart', cadence: 1, offsetFrames: 0 })).toEqual([
			expect.objectContaining({ id: 'first', from: 0, durationInFrames: 60 }),
			expect.objectContaining({ id: 'second', from: 60, durationInFrames: 30 })
		]);
		expect(
			planBeatSync(clips, beats, { mode: 'one-per-beat', cadence: 1, offsetFrames: 0 })
		).toEqual([
			expect.objectContaining({ id: 'first', from: 0, durationInFrames: 30 }),
			expect.objectContaining({ id: 'second', from: 30, durationInFrames: 30 })
		]);
		expect(
			planBeatSync(clips, beats, { mode: 'preserve-duration', cadence: 2, offsetFrames: 5 })
		).toEqual([
			expect.objectContaining({ id: 'first', from: 5, durationInFrames: 62 }),
			expect.objectContaining({ id: 'second', from: 65, durationInFrames: 28 })
		]);
	});
});

describe('beat sync timeline actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('retimes each chosen track independently and keeps linked audio synchronized in one undo', () => {
		timelineStore._setTracks([track('visual'), track('overlay'), track('audio')]);
		timelineStore._setItems([
			clip('visual-a', { from: 10, durationInFrames: 40, linkedGroupId: 'pair' }),
			clip('audio-a', {
				trackId: 'audio',
				type: 'audio',
				from: 10,
				durationInFrames: 40,
				linkedGroupId: 'pair'
			}),
			clip('visual-b', { from: 80, durationInFrames: 40 }),
			clip('overlay-a', { trackId: 'overlay', from: 40, durationInFrames: 40 })
		]);

		const result = syncTracksToBeatMarkersAtomic({
			trackIds: ['visual', 'overlay', 'audio'],
			beatFrames: [0, 30, 60, 90],
			config: { mode: 'one-per-beat', cadence: 1, offsetFrames: 0 }
		});

		expect(result).toEqual({ changed: 4, skippedLocked: 0, skippedUnavailable: 0 });
		expect(timelineStore.itemById.get('visual-a')).toMatchObject({ from: 0, durationInFrames: 30 });
		expect(timelineStore.itemById.get('audio-a')).toMatchObject({ from: 0, durationInFrames: 30 });
		expect(timelineStore.itemById.get('visual-b')).toMatchObject({
			from: 30,
			durationInFrames: 30
		});
		expect(timelineStore.itemById.get('overlay-a')).toMatchObject({
			from: 0,
			durationInFrames: 30
		});
		expect(commandHistory.getLastCommandType()).toBe('SYNC_CLIPS_TO_BEATS');
		commandHistory.undo();
		expect(timelineStore.itemById.get('visual-a')).toMatchObject({
			from: 10,
			durationInFrames: 40
		});
		expect(timelineStore.itemById.get('audio-a')).toMatchObject({ from: 10, durationInFrames: 40 });
	});

	it('does not extend a retimed media clip beyond its available source', () => {
		timelineStore._setTracks([track('visual')]);
		timelineStore._setItems([
			clip('short-source', {
				durationInFrames: 10,
				sourceEnd: 10,
				sourceDuration: 20
			})
		]);

		syncTracksToBeatMarkersAtomic({
			trackIds: ['visual'],
			beatFrames: [0, 30],
			config: { mode: 'one-per-beat', cadence: 1, offsetFrames: 0 }
		});

		expect(timelineStore.itemById.get('short-source')).toMatchObject({
			durationInFrames: 20,
			sourceEnd: 20
		});
	});

	it('does not partly retime a linked pair when either track is locked', () => {
		timelineStore._setTracks([track('visual'), track('audio', true)]);
		timelineStore._setItems([
			clip('visual-a', { from: 10, linkedGroupId: 'pair' }),
			clip('audio-a', { trackId: 'audio', type: 'audio', from: 10, linkedGroupId: 'pair' })
		]);

		expect(
			syncTracksToBeatMarkersAtomic({
				trackIds: ['visual'],
				beatFrames: [0, 30],
				config: { mode: 'preserve-duration', cadence: 1, offsetFrames: 0 }
			})
		).toEqual({ changed: 0, skippedLocked: 2, skippedUnavailable: 0 });
		expect(timelineStore.itemById.get('visual-a')?.from).toBe(10);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('rejects a beat sync that would overlap visible items on one track', () => {
		timelineStore._setTracks([track('visual')]);
		timelineStore._setItems([
			clip('first', { from: 0, durationInFrames: 40 }),
			clip('second', { from: 80, durationInFrames: 40 })
		]);

		expect(
			syncTracksToBeatMarkersAtomic({
				trackIds: ['visual'],
				beatFrames: [0, 30],
				config: { mode: 'preserve-duration', cadence: 1, offsetFrames: 0 }
			})
		).toEqual({ changed: 0, skippedLocked: 0, skippedUnavailable: 1 });
		expect(timelineStore.items.map((item) => item.from)).toEqual([0, 80]);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('allows beat-synced audio items to overlap for mixing', () => {
		timelineStore._setTracks([track('audio')]);
		timelineStore._setItems([
			clip('first', { trackId: 'audio', type: 'audio', from: 0, durationInFrames: 40 }),
			clip('second', { trackId: 'audio', type: 'audio', from: 80, durationInFrames: 40 })
		]);

		expect(
			syncTracksToBeatMarkersAtomic({
				trackIds: ['audio'],
				beatFrames: [0, 30],
				config: { mode: 'preserve-duration', cadence: 1, offsetFrames: 0 }
			})
		).toEqual({ changed: 1, skippedLocked: 0, skippedUnavailable: 0 });
		expect(timelineStore.items.map((item) => item.from)).toEqual([0, 30]);
	});

	it('splits on the requested beat cadence and undoes the whole cut set', () => {
		timelineStore._setTracks([track('visual'), track('audio')]);
		timelineStore._setItems([
			clip('montage', { durationInFrames: 130, sourceEnd: 130, linkedGroupId: 'pair' }),
			clip('montage-audio', {
				trackId: 'audio',
				type: 'audio',
				durationInFrames: 130,
				sourceEnd: 130,
				linkedGroupId: 'pair'
			})
		]);

		expect(splitItemOnBeatMarkersAtomic('montage', [0, 30, 60, 90, 120], 2)).toBe(2);
		expect(
			timelineStore.items.map((item) => item.durationInFrames).toSorted((a, b) => a - b)
		).toEqual([10, 10, 60, 60, 60, 60]);
		expect(commandHistory.getLastCommandType()).toBe('SPLIT_CLIP_ON_BEATS');
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.items[0]?.durationInFrames).toBe(130);
		expect(timelineStore.items[1]?.durationInFrames).toBe(130);
	});
});
