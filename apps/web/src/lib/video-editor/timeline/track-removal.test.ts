import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { emptyTrackIdsForRemoval } from './track-removal';

function track(id: string, order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind: id.startsWith('a') ? 'audio' : 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(trackId: string): TimelineItem {
	return {
		id: `item-${trackId}`,
		trackId,
		from: 0,
		durationInFrames: 30,
		label: trackId,
		type: 'video'
	};
}

describe('empty track removal planning', () => {
	it('returns every empty media track when at least one occupied track remains', () => {
		const tracks = [track('v1', 0), track('a1', 1), track('a2', 2)];
		expect(emptyTrackIdsForRemoval(tracks, [item('a1')], 'v1')).toEqual(['v1', 'a2']);
	});

	it('preserves the context track when every media track is empty', () => {
		const tracks = [track('v1', 0), track('a1', 1)];
		expect(emptyTrackIdsForRemoval(tracks, [], 'a1')).toEqual(['v1']);
	});

	it('ignores group rows and preserves one media track for an invalid context id', () => {
		const tracks = [
			{
				...track('group', 0),
				kind: undefined,
				isGroup: true
			},
			track('v1', 1),
			track('a1', 2)
		];
		expect(emptyTrackIdsForRemoval(tracks, [], 'group')).toEqual(['a1']);
	});
});
