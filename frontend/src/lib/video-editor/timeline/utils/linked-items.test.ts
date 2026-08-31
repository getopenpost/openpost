import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import {
	getLinkedSyncOffsetFrames,
	getSynchronizedLinkedCounterpartPair,
	getSynchronizedLinkedItems
} from './linked-items';

function mediaItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		mediaId: 'media',
		linkedGroupId: 'group',
		sourceStart: 0,
		sourceEnd: 60,
		speed: 1,
		...overrides
	};
}

describe('synchronized linked items', () => {
	it('keeps a frame-aligned audio companion in the edit group', () => {
		const video = mediaItem();
		const audio = mediaItem({ id: 'audio', trackId: 'audio-track', type: 'audio' });
		expect(getSynchronizedLinkedItems([video, audio], video.id).map((item) => item.id)).toEqual([
			'video',
			'audio'
		]);
	});

	it('drops a linked companion after its media window diverges', () => {
		const video = mediaItem();
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio-track',
			type: 'audio',
			sourceStart: 12,
			sourceEnd: 72
		});
		expect(getSynchronizedLinkedItems([video, audio], video.id)).toEqual([video]);
	});

	it('matches both sides of a cut on the companion track', () => {
		const leftVideo = mediaItem({ id: 'left-video', linkedGroupId: 'left' });
		const leftAudio = mediaItem({
			id: 'left-audio',
			trackId: 'audio-track',
			type: 'audio',
			linkedGroupId: 'left'
		});
		const rightVideo = mediaItem({
			id: 'right-video',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120,
			linkedGroupId: 'right'
		});
		const rightAudio = mediaItem({
			id: 'right-audio',
			trackId: 'audio-track',
			type: 'audio',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120,
			linkedGroupId: 'right'
		});

		expect(
			getSynchronizedLinkedCounterpartPair(
				[leftVideo, leftAudio, rightVideo, rightAudio],
				leftVideo.id,
				rightVideo.id
			)
		).toEqual({ leftCounterpart: leftAudio, rightCounterpart: rightAudio });
	});
});

describe('linked A/V sync offset', () => {
	it('reports opposing offsets after either linked clip moves alone', () => {
		const video = mediaItem({ from: 12 });
		const audio = mediaItem({ id: 'audio', trackId: 'audio-track', type: 'audio' });
		expect(getLinkedSyncOffsetFrames([video, audio], video.id, 30)).toBe(12);
		expect(getLinkedSyncOffsetFrames([video, audio], audio.id, 30)).toBe(-12);
	});

	it('accounts for source frame rate and playback speed', () => {
		const video = mediaItem({ sourceStart: 60, sourceEnd: 180, sourceFps: 60, speed: 2 });
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio-track',
			type: 'audio',
			sourceStart: 30,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1
		});
		expect(getLinkedSyncOffsetFrames([video, audio], video.id, 30)).toBe(15);
	});

	it('treats sub-frame rounding overlap as synchronized', () => {
		const video = mediaItem({ sourceStart: 1, sourceFps: 60 });
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio-track',
			type: 'audio',
			sourceStart: 0,
			sourceFps: 30
		});
		expect(getLinkedSyncOffsetFrames([video, audio], video.id, 30)).toBeNull();
	});

	it('chooses the closest valid companion in a larger linked group', () => {
		const video = mediaItem({ from: 20 });
		const closeAudio = mediaItem({
			id: 'audio-close',
			trackId: 'audio-track',
			type: 'audio',
			from: 16
		});
		const farAudio = mediaItem({
			id: 'audio-far',
			trackId: 'audio-track-2',
			type: 'audio',
			from: 0
		});
		expect(getLinkedSyncOffsetFrames([video, farAudio, closeAudio], video.id, 30)).toBe(4);
	});

	it('ignores same-kind and unlinked clips', () => {
		const video = mediaItem();
		const otherVideo = mediaItem({ id: 'video-2', from: 20 });
		const unlinkedAudio = mediaItem({
			id: 'audio',
			trackId: 'audio-track',
			type: 'audio',
			from: 20,
			linkedGroupId: 'other-group'
		});
		expect(getLinkedSyncOffsetFrames([video, otherVideo, unlinkedAudio], video.id, 30)).toBeNull();
	});
});
