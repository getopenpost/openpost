import { expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import {
	protectRecordingRanges,
	recordingReviewFingerprint,
	recordingAnalysisItemIds
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

it('omits lexical cuts across audible sources and protects locked linked participants', () => {
	const items = [clip('screen'), clip('camera')];
	for (const kind of ['filler', 'retake'] as const) {
		expect(
			protectRecordingRanges(items, tracks, ['screen', 'camera'], 10, [
				{ sourceItemId: 'screen', start: 1, end: 2, kind }
			])
		).toEqual([]);
	}
	const lockedTracks = tracks.map((track) => ({
		...track,
		locked: track.id === 'camera-track'
	}));
	expect(
		protectRecordingRanges(items, lockedTracks, ['screen'], 10, [
			pause('screen', 1, 2),
			pause('camera', 1, 2)
		])
	).toEqual([]);
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
