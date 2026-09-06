import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import {
	removeSilenceFromItems,
	SILENCE_COVERAGE_REMOVAL_THRESHOLD,
	type SourceRange
} from './range-removal';
import type { TimelineItem } from '$lib/video-editor/project/types';

function mediaClip(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: crypto.randomUUID(),
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 300,
		label: 'clip',
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 0,
		sourceDuration: 900,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

function silenceRanges(ranges: Array<[number, number]>) {
	return { 'media-1': ranges.map(([start, end]) => ({ start, end })) } as const;
}

describe('removeSilenceFromItems', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('splits at range boundaries and removes covered segments with ripple', () => {
		const clip = mediaClip();
		timelineStore._setTracks([
			{
				id: 'track-video-main',
				name: 'Video',
				kind: 'video',
				height: 96,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			}
		]);
		timelineStore._setItems([clip]);

		// Silence from source second 1 to 2 (frames 30..60).
		const result = removeSilenceFromItems([clip.id], silenceRanges([[1, 2]]));

		expect(result.splitCount).toBe(2);
		expect(result.removedItemCount).toBe(1);
		expect(timelineStore.items.length).toBe(2);
		const [first, second] = timelineStore.items;
		expect(first?.durationInFrames).toBe(30);
		// Second piece rippled left into the removed gap.
		expect(second?.from).toBe(30);
		expect(second?.sourceStart).toBe(60);
		// One undo step restores the original clip.
		commandHistory.undo();
		expect(timelineStore.items.length).toBe(1);
		expect(timelineStore.items[0]?.durationInFrames).toBe(300);
	});

	it('removes only the covered middle segment after splitting', () => {
		const clip = mediaClip({ durationInFrames: 90 });
		timelineStore._setItems([clip]);

		// Range covers source seconds 1.5..1.9 of a 3s clip: split at frames
		// 45/57, drop the covered middle piece, ripple the tail left.
		const result = removeSilenceFromItems([clip.id], silenceRanges([[1.5, 1.9]]));
		expect(result.removedItemCount).toBe(1);
		expect(timelineStore.items.length).toBe(2);
		const [head, tail] = timelineStore.items;
		expect(head?.durationInFrames).toBe(45);
		expect(tail?.from).toBe(45);
		expect(tail?.sourceStart).toBe(57);
	});

	it('ignores items without matching media ranges', () => {
		const clip = mediaClip({ mediaId: 'other-media' });
		timelineStore._setItems([clip]);
		const result = removeSilenceFromItems([clip.id], silenceRanges([[0, 5]]));
		expect(result.analyzedItemCount).toBe(0);
		expect(timelineStore.items.length).toBe(1);
	});

	it('removes linked audio twins together with the video segment', () => {
		const groupId = crypto.randomUUID();
		const lineage = crypto.randomUUID();
		const video = mediaClip({ linkedGroupId: groupId, originId: lineage });
		const audio = mediaClip({
			id: crypto.randomUUID(),
			type: 'audio',
			trackId: 'track-audio',
			linkedGroupId: groupId,
			originId: lineage
		});
		timelineStore._setItems([video, audio]);

		const result = removeSilenceFromItems([video.id], silenceRanges([[1, 2]]));
		// Video splits in two and loses one segment; the linked audio twin is
		// split too and its covered segment removed with the video's.
		expect(result.splitCount).toBeGreaterThanOrEqual(2);
		const audioPieces = timelineStore.items.filter((i) => i.type === 'audio');
		expect(audioPieces.length).toBe(2);
	});

	it('threshold constant matches FreeCut semantics', () => {
		expect(SILENCE_COVERAGE_REMOVAL_THRESHOLD).toBe(0.75);
	});

	it('cuts the same interval from sync-locked tracks in the same undo step', () => {
		timelineStore._setTracks([
			{
				id: 'track-video-main',
				name: 'Video',
				kind: 'video',
				height: 96,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				syncLock: true,
				order: 0
			},
			{
				id: 'music',
				name: 'Music',
				kind: 'audio',
				height: 64,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				syncLock: true,
				order: 1
			}
		]);
		const clip = mediaClip();
		const music = mediaClip({
			id: 'music-clip',
			trackId: 'music',
			type: 'audio',
			mediaId: 'music-media'
		});
		timelineStore._setItems([clip, music]);

		removeSilenceFromItems([clip.id], silenceRanges([[1, 2]]));

		expect(
			timelineStore.items
				.filter((item) => item.trackId === 'music')
				.toSorted((left, right) => left.from - right.from)
				.map(({ from, durationInFrames, sourceStart, sourceEnd }) => ({
					from,
					durationInFrames,
					sourceStart,
					sourceEnd
				}))
		).toEqual([
			{ from: 0, durationInFrames: 30, sourceStart: 0, sourceEnd: 30 },
			{ from: 30, durationInFrames: 240, sourceStart: 60, sourceEnd: 300 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('music-clip')?.durationInFrames).toBe(300);
	});

	it('leaves selected clips on locked tracks untouched', () => {
		const clip = mediaClip();
		timelineStore._setTracks([
			{
				id: 'track-video-main',
				name: 'Video',
				kind: 'video',
				height: 96,
				locked: true,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			}
		]);
		timelineStore._setItems([clip]);

		expect(removeSilenceFromItems([clip.id], silenceRanges([[1, 2]]))).toMatchObject({
			analyzedItemCount: 0,
			removedItemCount: 0
		});
		expect(timelineStore.items).toHaveLength(1);
		expect(commandHistory.canUndo).toBe(false);
	});
});
