import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import {
	removeSilenceFromItems,
	removeTranscriptItemRanges,
	SILENCE_COVERAGE_REMOVAL_THRESHOLD,
	type SourceRange
} from './range-removal';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';

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

	it('removes shared sync-lock intervals even where selected tracks have gaps', () => {
		const tracks: TimelineTrack[] = ['A', 'B', 'C'].map((id, order) => ({
			id,
			name: id,
			kind: 'audio',
			order,
			syncLock: true,
			height: 80,
			locked: false,
			visible: true,
			muted: false,
			solo: false
		}));
		timelineStore._setTracks(tracks);
		timelineStore._setItems([
			mediaClip({ id: 'a', trackId: 'A', type: 'audio', durationInFrames: 90 }),
			mediaClip({ id: 'b', trackId: 'B', type: 'audio', from: 120, durationInFrames: 90 }),
			mediaClip({ id: 'later-a', trackId: 'A', type: 'audio', from: 300, durationInFrames: 30 }),
			mediaClip({ id: 'reference', trackId: 'C', type: 'audio', from: 300, durationInFrames: 30 })
		]);
		removeTranscriptItemRanges({ a: [{ start: 1, end: 2 }], b: [{ start: 1, end: 2 }] });
		expect(timelineStore.itemById.get('b')?.from).toBe(90);
		expect(timelineStore.itemById.get('later-a')?.from).toBe(240);
		expect(timelineStore.itemById.get('reference')?.from).toBe(240);
		commandHistory.undo();
		expect(timelineStore.itemById.get('later-a')?.from).toBe(300);
	});

	it('ripples imported subtitles on a directly edited track', () => {
		timelineStore._setTracks([
			{
				id: 'A',
				name: 'Video',
				kind: 'video',
				order: 0,
				syncLock: true,
				height: 80,
				locked: false,
				visible: true,
				muted: false,
				solo: false
			}
		]);
		timelineStore._setItems([
			mediaClip({ id: 'a', trackId: 'A', durationInFrames: 90 }),
			{
				id: 'srt',
				label: 'Imported captions',
				type: 'subtitle',
				trackId: 'A',
				from: 75,
				durationInFrames: 15,
				captionSource: {
					type: 'subtitle-import',
					clipId: 'a',
					mediaId: 'media-1',
					fileName: 'captions.srt'
				},
				cues: [{ id: 'cue', text: 'Later', startFrame: 0, endFrame: 15 }]
			}
		]);
		removeTranscriptItemRanges({ a: [{ start: 1, end: 2 }] });
		expect(timelineStore.itemById.get('srt')?.from).toBe(45);
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

it('preserves locked linked audio when most of its shared source is cut', () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const video = mediaClip({ id: 'video', originId: 'pair', linkedGroupId: 'pair' });
	const audio = mediaClip({
		id: 'audio',
		type: 'audio',
		trackId: 'audio-track',
		originId: 'pair',
		linkedGroupId: 'pair'
	});
	timelineStore._setTracks([
		{
			id: 'audio-track',
			name: 'Audio',
			kind: 'audio',
			height: 72,
			locked: true,
			visible: true,
			muted: false,
			solo: false,
			order: 1
		}
	]);
	timelineStore._setItems([video, audio]);
	removeSilenceFromItems(['video'], silenceRanges([[0, 9]]));
	expect(timelineStore.itemById.get('audio')).toEqual(audio);
	expect(timelineStore.items.filter((item) => item.type === 'video')).toHaveLength(1);
	expect(timelineStore.items.find((item) => item.type === 'video')?.durationInFrames).toBe(30);
});

it('does not remove an unselected duplicate which shares the selected source lineage', () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const selected = mediaClip({ id: 'selected', originId: 'shared' });
	const duplicate = mediaClip({ id: 'duplicate', originId: 'shared', from: 400 });
	timelineStore._setItems([selected, duplicate]);
	removeSilenceFromItems(['selected'], silenceRanges([[0, 9]]));
	expect(timelineStore.itemById.get('duplicate')).toMatchObject({
		durationInFrames: 300,
		sourceStart: 0,
		from: 130
	});
});

it('cuts linked audio from a separate source lineage even with sync-lock disabled', () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const video = mediaClip({ id: 'video', linkedGroupId: 'pair' });
	const audio = mediaClip({
		id: 'audio',
		type: 'audio',
		trackId: 'audio-track',
		linkedGroupId: 'pair'
	});
	timelineStore._setTracks([
		{
			id: 'audio-track',
			name: 'Audio',
			kind: 'audio',
			height: 72,
			locked: false,
			syncLock: false,
			visible: true,
			muted: false,
			solo: false,
			order: 1
		}
	]);
	timelineStore._setItems([video, audio]);
	removeSilenceFromItems(['video'], silenceRanges([[1, 2]]));
	expect(
		timelineStore.items
			.filter((item) => item.type === 'audio')
			.reduce((sum, item) => sum + item.durationInFrames, 0)
	).toBe(270);
	expect(
		timelineStore.items
			.filter((item) => item.type === 'audio')
			.map((item) => item.sourceStart)
			.sort((a, b) => (a ?? 0) - (b ?? 0))
	).toEqual([0, 60]);
});

it('cuts distinct staged ranges from multiple retained fragments of the same linked group', () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setItems([
		mediaClip({ id: 'head', linkedGroupId: 'recording', durationInFrames: 30, sourceEnd: 30 }),
		mediaClip({
			id: 'tail',
			linkedGroupId: 'recording',
			from: 60,
			durationInFrames: 30,
			sourceStart: 60,
			sourceEnd: 90
		})
	]);
	removeTranscriptItemRanges({ head: [{ start: 0, end: 0.2 }], tail: [{ start: 2, end: 2.2 }] });
	expect(timelineStore.items.reduce((sum, item) => sum + item.durationInFrames, 0)).toBe(48);
	expect(
		timelineStore.items.toSorted((a, b) => a.from - b.from).map((item) => item.sourceStart)
	).toEqual([6, 66]);
});

describe('linked and multi-track source cuts', () => {
	const clip = (id: string, trackId: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({
		id,
		type: 'video',
		trackId,
		mediaId: id,
		label: id,
		from: 0,
		durationInFrames: 300,
		sourceStart: 0,
		sourceEnd: 300,
		sourceFps: 30,
		...extra
	});
	const track = (id: string): TimelineTrack => ({
		id,
		name: id,
		kind: 'video',
		height: 72,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		syncLock: true,
		order: 0
	});
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setTracks([track('a'), track('b')]);
	});
	it('does not cut linked audio outside selected video source window', () => {
		const video = clip('v', 'a', { durationInFrames: 150, sourceEnd: 150, linkedGroupId: 'pair' });
		const audio = clip('au', 'b', { type: 'audio', linkedGroupId: 'pair' });
		timelineStore._setItems([video, audio]);
		removeSilenceFromItems(['v'], { v: [{ start: 6, end: 7 }] });
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.itemById.get('au')?.durationInFrames).toBe(300);
	});
	it('ripple removes both intervals from selected sync-locked tracks', () => {
		timelineStore._setItems([clip('a', 'a'), clip('b', 'b')]);
		removeTranscriptItemRanges({ a: [{ start: 1, end: 2 }], b: [{ start: 3, end: 4 }] });
		expect(
			timelineStore.items
				.filter((i) => i.trackId === 'a')
				.reduce((n, i) => n + i.durationInFrames, 0)
		).toBe(240);
		expect(
			timelineStore.items
				.filter((i) => i.trackId === 'b')
				.reduce((n, i) => n + i.durationInFrames, 0)
		).toBe(240);
	});
	it('keeps a linked video and audio pair linked across propagated cuts', () => {
		timelineStore._setTracks([track('a'), track('b'), { ...track('c'), kind: 'audio' }]);
		timelineStore._setItems([
			clip('a', 'a'),
			clip('v', 'b', { linkedGroupId: 'pair' }),
			clip('au', 'c', { type: 'audio', linkedGroupId: 'pair' })
		]);
		removeTranscriptItemRanges({ a: [{ start: 1, end: 2 }] });
		const pieces = timelineStore.items.filter((i) => i.id !== 'a' && i.mediaId !== 'a');
		expect(pieces.every((i) => !!i.linkedGroupId)).toBe(true);
	});
	it('cuts linked title along with video even when title track sync-lock is disabled', () => {
		timelineStore._setTracks([track('a'), { ...track('b'), syncLock: false }]);
		timelineStore._setItems([
			clip('v', 'a', { linkedGroupId: 'pair' }),
			clip('title', 'b', { type: 'text', text: 'Title', linkedGroupId: 'pair', mediaId: undefined })
		]);
		removeTranscriptItemRanges({ v: [{ start: 1, end: 2 }] });
		expect(
			timelineStore.items
				.filter((i) => i.type === 'text')
				.reduce((n, i) => n + i.durationInFrames, 0)
		).toBe(270);
	});

	it('ripples overlapping mixed audio by the removed interval once', () => {
		timelineStore._setTracks([{ ...track('a'), kind: 'audio' }]);
		timelineStore._setItems([
			clip('voice', 'a', { type: 'audio' }),
			clip('music', 'a', { type: 'audio' }),
			clip('later', 'a', { type: 'audio', from: 360, durationInFrames: 30, sourceEnd: 30 })
		]);
		removeTranscriptItemRanges({ voice: [{ start: 1, end: 2 }] });
		expect(timelineStore.itemById.get('later')?.from).toBe(330);
		const tails = timelineStore.items.filter((i) => i.sourceStart === 60);
		expect(tails.map((i) => i.from)).toEqual([30, 30]);
		expect(timelineStore.items.filter((i) => i.sourceStart === 0 && i.id !== 'later')).toHaveLength(
			2
		);
	});
	it('preserves captions of a locked source sharing a track with a linked adjustment', () => {
		timelineStore._setTracks([track('a'), track('b'), { ...track('c'), locked: true }]);
		timelineStore._setItems([
			clip('voice', 'a', { linkedGroupId: 'linked' }),
			clip('grade', 'b', { type: 'adjustment', linkedGroupId: 'linked', mediaId: undefined }),
			clip('locked-source', 'c'),
			{
				id: 'caption',
				type: 'subtitle',
				trackId: 'b',
				label: 'Caption',
				from: 30,
				durationInFrames: 30,
				captionSource: {
					type: 'transcript',
					clipId: 'locked-source',
					mediaId: 'locked-source',
					sourceStartSeconds: 1,
					sourceEndSeconds: 2
				},
				cues: [{ id: 'cue', text: 'Retain me', startFrame: 0, endFrame: 30 }]
			}
		]);
		removeTranscriptItemRanges({ voice: [{ start: 1, end: 2 }] });
		expect(timelineStore.itemById.get('caption')?.from).toBe(30);
		expect(timelineStore.itemById.get('caption')?.durationInFrames).toBe(30);
	});
});
