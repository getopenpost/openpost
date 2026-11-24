import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import { removeSilenceFromItems, removeTranscriptItemRanges } from './range-removal';
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
		expect(result.removedRangeCount).toBe(1);
		expect(result.removedItemCount).toBe(2);
		const audioPieces = timelineStore.items.filter((i) => i.type === 'audio');
		expect(audioPieces.length).toBe(2);
	});

	it('counts only applied source ranges when selected sources are locked or outside their window', () => {
		const unlocked = mediaClip({
			id: 'unlocked',
			durationInFrames: 90,
			sourceEnd: 90
		});
		const locked = mediaClip({
			id: 'locked',
			trackId: 'locked-track',
			mediaId: 'locked-media'
		});
		timelineStore._setTracks([
			{
				id: 'locked-track',
				name: 'Locked',
				kind: 'video',
				order: 1,
				height: 80,
				locked: true,
				visible: true,
				muted: false,
				solo: false
			}
		]);
		timelineStore._setItems([unlocked, locked]);
		const result = removeSilenceFromItems(['unlocked', 'locked'], {
			'media-1': [
				{ start: 1, end: 2 },
				{ start: 5, end: 6 }
			],
			'locked-media': [{ start: 1, end: 2 }]
		});
		expect(result.removedRangeCount).toBe(1);
		expect(timelineStore.itemById.get('locked')).toEqual(locked);
		expect(
			timelineStore.items
				.filter((item) => item.mediaId === 'media-1')
				.reduce((sum, item) => sum + item.durationInFrames, 0)
		).toBe(60);
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
});

it('preserves locked linked audio when most of its shared source is cut', () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const video = mediaClip({
		id: 'video',
		originId: 'pair',
		linkedGroupId: 'pair'
	});
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
	it('cuts linked title along with video even when title track sync-lock is disabled', () => {
		timelineStore._setTracks([track('a'), { ...track('b'), syncLock: false }]);
		timelineStore._setItems([
			clip('v', 'a', { linkedGroupId: 'pair' }),
			clip('title', 'b', {
				type: 'text',
				text: 'Title',
				linkedGroupId: 'pair',
				mediaId: undefined
			})
		]);
		removeTranscriptItemRanges({ v: [{ start: 1, end: 2 }] });
		expect(
			timelineStore.items
				.filter((i) => i.type === 'text')
				.reduce((n, i) => n + i.durationInFrames, 0)
		).toBe(270);
	});
	it('preserves captions of a locked source sharing a track with a linked adjustment', () => {
		timelineStore._setTracks([track('a'), track('b'), { ...track('c'), locked: true }]);
		timelineStore._setItems([
			clip('voice', 'a', { linkedGroupId: 'linked' }),
			clip('grade', 'b', {
				type: 'adjustment',
				linkedGroupId: 'linked',
				mediaId: undefined
			}),
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
