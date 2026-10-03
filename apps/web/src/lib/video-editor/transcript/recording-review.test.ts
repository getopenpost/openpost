import { expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import {
	protectRecordingRanges,
	recordingReviewFingerprint,
	recordingAnalysisItemIds,
	selectedRecordingDuration
} from './recording-review';

const tracks: TimelineTrack[] = ['screen-track', 'camera-track'].map((id, order) => ({
	id,
	name: id,
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	syncLock: false,
	order
}));
function clip(id: string, patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		type: 'video',
		mediaId: id,
		trackId: `${id}-track`,
		from: 0,
		durationInFrames: 100,
		sourceStart: 0,
		sourceEnd: 100,
		sourceFps: 10,
		linkedGroupId: 'recording',
		label: id,
		...patch
	};
}
function pause(sourceItemId: string, start: number, end: number) {
	return { sourceItemId, start, end, kind: 'pause' as const };
}

it('preserves camera speech when the linked screen is silent or the camera analysis failed', () => {
	const items = [clip('screen'), clip('camera')];
	const range = pause('screen', 1, 8);
	expect(protectRecordingRanges(items, tracks, ['screen', 'camera'], 10, [range])).toEqual([]);
	const reviewed = protectRecordingRanges(items, tracks, ['screen', 'camera'], 10, [
		range,
		pause('camera', 3, 4),
		pause('camera', 6, 7)
	]);
	expect(
		protectRecordingRanges(items, tracks, ['screen'], 10, [range, pause('camera', 3, 4)])
	).toEqual([pause('screen', 3, 4)]);
	expect(reviewed.filter((entry) => entry.sourceItemId === 'screen')).toEqual([
		pause('screen', 3, 4),
		pause('screen', 6, 7)
	]);
});

it('analyzes distinct linked sources once and shares aligned detached companion evidence', () => {
	const items = [
		clip('screen', { audioDetached: true }),
		clip('camera', { type: 'audio', mediaId: 'screen' })
	];
	expect(recordingAnalysisItemIds(items, ['screen'])).toEqual(['screen']);
	expect(protectRecordingRanges(items, tracks, ['screen'], 10, [pause('screen', 1, 2)])).toEqual([
		pause('screen', 1, 2)
	]);
	items[1]!.mediaId = 'camera';
	expect(recordingAnalysisItemIds(items, ['screen'])).toEqual(['screen', 'camera']);
	items[1]!.linkedGroupId = undefined;
	expect(recordingAnalysisItemIds(items, ['screen'])).toEqual(['screen']);
});

it('reports playback seconds without double-counting linked or overlapping cuts', () => {
	const items = [
		clip('screen', { speed: 2, durationInFrames: 50 }),
		clip('camera', {
			speed: 2,
			durationInFrames: 50,
			isReversed: true
		})
	];
	expect(
		selectedRecordingDuration(items, ['screen', 'camera'], 10, [
			pause('screen', 2, 6),
			pause('screen', 4, 8),
			pause('camera', 2, 8)
		])
	).toBe(3);
});

it('intersects source ranges after mapping shifted, retimed and reversed clips to the timeline', () => {
	const items = [
		clip('screen'),
		clip('camera', {
			from: 20,
			durationInFrames: 40,
			sourceStart: 100,
			sourceEnd: 180,
			speed: 2,
			isReversed: true
		})
	];
	const result = protectRecordingRanges(items, tracks, ['screen', 'camera'], 10, [
		pause('screen', 2, 6),
		pause('camera', 12, 14)
	]);
	expect(result).toEqual([pause('screen', 4, 5), pause('camera', 12, 14)]);
});

it('keeps independent repeated media instances separate', () => {
	const items = [
		clip('screen', { linkedGroupId: undefined }),
		clip('camera', {
			linkedGroupId: undefined,
			mediaId: 'screen',
			from: 200
		})
	];
	expect(
		protectRecordingRanges(items, tracks, ['screen'], 10, [
			pause('screen', 1, 2),
			pause('camera', 1, 3)
		])
	).toEqual([pause('screen', 1, 2)]);
});

it('rounds inward when different source frame rates cannot represent the same cut boundary', () => {
	const items = [
		clip('screen', { sourceFps: 24, sourceEnd: 240, durationInFrames: 600 }),
		clip('camera', { sourceFps: 60, sourceEnd: 600, durationInFrames: 600 })
	];
	expect(
		protectRecordingRanges(items, tracks, ['screen'], 60, [
			pause('screen', 0, 3),
			pause('camera', 1, 119 / 60)
		])
	).toEqual([pause('screen', 1, 47 / 24)]);
});

it('omits lexical cuts across audible sources and protects locked linked participants', () => {
	const items = [clip('screen'), clip('camera')];
	for (const kind of ['filler', 'retake'] as const) {
		expect(
			protectRecordingRanges(items, tracks, ['screen', 'camera'], 10, [
				{ sourceItemId: 'screen', start: 1, end: 2, kind }
			])
		).toEqual([]);
	}
	const lockedTracks = tracks.map((track) => ({ ...track, locked: track.id === 'camera-track' }));
	expect(
		protectRecordingRanges(items, lockedTracks, ['screen'], 10, [
			pause('screen', 1, 2),
			pause('camera', 1, 2)
		])
	).toEqual([]);
});

it('does not require detached or muted sources to approve audible companion silence', () => {
	const items = [clip('screen', { audioDetached: true }), clip('camera')];
	expect(protectRecordingRanges(items, tracks, ['camera'], 10, [pause('camera', 1, 2)])).toEqual([
		pause('camera', 1, 2)
	]);
	const muted = tracks.map((track) => ({ ...track, muted: track.id === 'screen-track' }));
	expect(
		protectRecordingRanges([clip('screen'), clip('camera')], muted, ['camera'], 10, [
			pause('camera', 1, 2)
		])
	).toEqual([pause('camera', 1, 2)]);
});

it('invalidates review for in-place edits, locks, selection and frame rate changes', () => {
	const items = [clip('screen')];
	const localTracks = structuredClone(tracks);
	const first = recordingReviewFingerprint(items, localTracks, ['screen'], 10);
	expect(recordingReviewFingerprint(structuredClone(items), localTracks, ['screen'], 10)).toBe(
		first
	);
	items[0]!.sourceStart = 10;
	expect(recordingReviewFingerprint(items, localTracks, ['screen'], 10)).not.toBe(first);
	const trimmed = recordingReviewFingerprint(items, localTracks, ['screen'], 10);
	localTracks[0]!.locked = true;
	expect(recordingReviewFingerprint(items, localTracks, ['screen'], 10)).not.toBe(trimmed);
	const locked = recordingReviewFingerprint(items, localTracks, ['screen'], 10);
	expect(recordingReviewFingerprint(items, localTracks, [], 10)).not.toBe(locked);
	expect(recordingReviewFingerprint(items, localTracks, ['screen'], 30)).not.toBe(locked);
});
