import { expect, it } from 'vitest';
import { evaluateExactMediaPlacement } from './media-drop-placement';
import type { TimelineTrack } from '../project/types';

const videoTrack: TimelineTrack = {
	id: 'video-1',
	name: 'Video',
	kind: 'video',
	height: 96,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

it('accepts a media drop over a non-exclusive adjustment layer', () => {
	const result = evaluateExactMediaPlacement({
		trackId: videoTrack.id,
		from: 60,
		durationInFrames: 90,
		kind: 'video',
		tracks: [videoTrack],
		items: [
			{
				trackId: videoTrack.id,
				from: 0,
				durationInFrames: 300,
				type: 'adjustment'
			}
		]
	});

	expect(result).toMatchObject({ valid: true, placement: { trackId: videoTrack.id } });
});
