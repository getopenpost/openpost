import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import {
	colorGradeTargetAtFrame,
	colorItemSpansFrame,
	colorSelectionSpansFrame
} from './color-playhead-selection';

function item(
	overrides: Partial<TimelineItem> & { id: string; type: TimelineItem['type'] }
): TimelineItem {
	// SAFETY: tests only read id/trackId/from/durationInFrames/label/type; remaining fields are never accessed.
	return {
		trackId: 'track-1',
		from: 0,
		durationInFrames: 100,
		label: overrides.id,
		...overrides
	} as TimelineItem;
}

function track(overrides: Partial<TimelineTrack> & { id: string }): TimelineTrack {
	// SAFETY: tests only read id/order/visible/isGroup; remaining fields are never accessed.
	return {
		name: overrides.id,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...overrides
	} as TimelineTrack;
}

describe('colorItemSpansFrame', () => {
	it('includes the start frame and excludes the end frame', () => {
		const clip = item({
			id: 'a',
			type: 'video',
			from: 10,
			durationInFrames: 20
		});
		expect(colorItemSpansFrame(clip, 10)).toBe(true);
		expect(colorItemSpansFrame(clip, 29)).toBe(true);
		expect(colorItemSpansFrame(clip, 9)).toBe(false);
		expect(colorItemSpansFrame(clip, 30)).toBe(false);
	});
});

describe('colorSelectionSpansFrame', () => {
	it('keeps the selection while a visual clip covers the frame', () => {
		const clip = item({
			id: 'a',
			type: 'video',
			from: 0,
			durationInFrames: 100
		});
		const byId = new Map([[clip.id, clip]]);
		expect(colorSelectionSpansFrame([clip.id], byId, 50)).toBe(true);
		expect(colorSelectionSpansFrame([clip.id], byId, 150)).toBe(false);
		expect(colorSelectionSpansFrame([], byId, 50)).toBe(false);
	});

	it('ignores audio, subtitle, and controller selections', () => {
		const audio = item({
			id: 's',
			type: 'audio',
			from: 0,
			durationInFrames: 100
		});
		const byId = new Map([[audio.id, audio]]);
		expect(colorSelectionSpansFrame([audio.id], byId, 50)).toBe(false);
	});
});

describe('colorGradeTargetAtFrame', () => {
	const tracks = [track({ id: 'track-1', order: 0 }), track({ id: 'track-2', order: 1 })];

	it('prefers source footage over overlay types on the same frame', () => {
		const text = item({ id: 'text', type: 'text', trackId: 'track-1' });
		const video = item({ id: 'video', type: 'video', trackId: 'track-2' });
		expect(colorGradeTargetAtFrame([text, video], tracks, 10)?.id).toBe('video');
	});

	it('breaks priority ties by track order', () => {
		const first = item({ id: 'first', type: 'image', trackId: 'track-2' });
		const second = item({ id: 'second', type: 'image', trackId: 'track-1' });
		expect(colorGradeTargetAtFrame([first, second], tracks, 10)?.id).toBe('second');
	});

	it('skips hidden tracks, groups, and audio, and returns null in gaps', () => {
		const hidden = item({
			id: 'hidden',
			type: 'video',
			trackId: 'hidden-track'
		});
		const allTracks = [...tracks, track({ id: 'hidden-track', order: -1, visible: false })];
		expect(colorGradeTargetAtFrame([hidden], allTracks, 10)).toBeNull();
		const audio = item({ id: 'audio', type: 'audio', trackId: 'track-1' });
		expect(colorGradeTargetAtFrame([audio], tracks, 10)).toBeNull();
		const video = item({ id: 'video', type: 'video', trackId: 'track-1' });
		expect(colorGradeTargetAtFrame([video], tracks, 500)).toBeNull();
	});
});
