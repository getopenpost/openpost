import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '$lib/video-editor/project/types';
import { planOpenTrackForRange } from './track-occupancy';

const tracks: TimelineTrack[] = [
	{
		id: 'visual-top',
		name: 'Visual 2',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: 0
	},
	{
		id: 'visual-bottom',
		name: 'Visual 1',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: 1
	}
];

describe('background track placement', () => {
	it('uses the lowest open visual layer', () => {
		const plan = planOpenTrackForRange({
			tracks,
			items: [],
			kind: 'video',
			itemType: 'background',
			from: 0,
			durationInFrames: 90,
			label: 'Sunset mesh',
			stacking: 'bottom',
			createId: () => 'created'
		});

		expect(plan).toMatchObject({ created: false, track: { id: 'visual-bottom' } });
	});

	it('creates a new bottom layer when every visual track is occupied', () => {
		const plan = planOpenTrackForRange({
			tracks,
			items: tracks.map((track) => ({
				id: `item-${track.id}`,
				trackId: track.id,
				from: 0,
				durationInFrames: 90,
				type: 'text' as const
			})),
			kind: 'video',
			itemType: 'background',
			from: 0,
			durationInFrames: 90,
			label: 'Sunset mesh',
			stacking: 'bottom',
			createId: () => 'created'
		});

		expect(plan).toMatchObject({ created: true, track: { id: 'created', order: 2 } });
	});
});
