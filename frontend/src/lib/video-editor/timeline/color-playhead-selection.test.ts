import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { colorGradeTargetAtFrame, colorSelectionSpansFrame } from './color-playhead-selection';

function track(id: string, order: number, visible = true): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 40,
		locked: false,
		visible,
		muted: false,
		solo: false,
		order
	};
}

function item(
	id: string,
	trackId: string,
	from: number,
	durationInFrames: number,
	type: TimelineItem['type'] = 'video'
): TimelineItem {
	return { id, trackId, from, durationInFrames, type, label: id };
}

describe('Color playhead selection', () => {
	it('follows the playhead across adjacent clips and leaves gaps untargeted', () => {
		const clips = [item('first', 'v1', 0, 90), item('second', 'v1', 90, 90)];
		const tracks = [track('v1', 0)];

		expect(colorGradeTargetAtFrame(clips, tracks, 30)?.id).toBe('first');
		expect(colorGradeTargetAtFrame(clips, tracks, 120)?.id).toBe('second');
		expect(colorGradeTargetAtFrame(clips, tracks, 240)).toBeNull();
	});

	it('prefers visible source footage before overlays, then the top track', () => {
		const tracks = [track('top', 0), track('lower', 1), track('hidden', -1, false)];
		const clips = [
			item('hidden-video', 'hidden', 0, 90),
			item('title', 'top', 0, 90, 'text'),
			item('lower-video', 'lower', 0, 90),
			item('top-video', 'top', 0, 90)
		];

		expect(colorGradeTargetAtFrame(clips, tracks, 30)?.id).toBe('top-video');
	});

	it('preserves a manual visual selection only while it spans the playhead', () => {
		const first = item('first', 'v1', 0, 90);
		const second = item('second', 'v1', 90, 90);
		const itemById = new Map([
			[first.id, first],
			[second.id, second]
		]);

		expect(colorSelectionSpansFrame(['first'], itemById, 30)).toBe(true);
		expect(colorSelectionSpansFrame(['first'], itemById, 120)).toBe(false);
	});
});
