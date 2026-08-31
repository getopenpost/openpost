import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import {
	resolveTransitionDropTarget,
	resolveTransitionTargetFromSelection
} from './transition-drop';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 72,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function clip(id: string, from: number, type: TimelineItem['type'] = 'video'): TimelineItem {
	return {
		id,
		trackId: track.id,
		from,
		durationInFrames: 60,
		label: id,
		type,
		mediaId: `media-${id}`,
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30
	};
}

describe('transition drop targets', () => {
	it('resolves the exact contiguous edge and prefers the right cut for click apply', () => {
		const items = [clip('left', 0), clip('middle', 60), clip('right', 120)];
		expect(
			resolveTransitionDropTarget({
				itemId: 'middle',
				edge: 'left',
				items,
				tracks: [track],
				transitions: [],
				fps: 30,
				presentation: 'dissolve'
			})
		).toMatchObject({ fromItemId: 'left', toItemId: 'middle', edge: 'left' });
		expect(
			resolveTransitionTargetFromSelection({
				selectedItemId: 'middle',
				items,
				tracks: [track],
				transitions: [],
				fps: 30,
				presentation: 'dissolve'
			})
		).toMatchObject({ fromItemId: 'middle', toItemId: 'right', edge: 'right' });
	});

	it('resolves an existing bridge for replacement', () => {
		const items = [clip('left', 0), clip('right', 60)];
		const transitions: TimelineTransition[] = [
			{
				id: 'transition',
				type: 'crossfade',
				presentation: 'fade',
				durationInFrames: 15,
				fromItemId: 'left',
				toItemId: 'right'
			}
		];
		expect(
			resolveTransitionDropTarget({
				itemId: 'left',
				edge: 'right',
				items,
				tracks: [track],
				transitions,
				fps: 30,
				presentation: 'glitch'
			})
		).toMatchObject({ existingTransitionId: 'transition' });

		const shortHandles = [
			{ ...items[0]!, sourceEnd: 116 },
			{ ...items[1]!, sourceStart: 4 }
		];
		expect(
			resolveTransitionDropTarget({
				itemId: 'left',
				edge: 'right',
				items: shortHandles,
				tracks: [track],
				transitions: [{ ...transitions[0]!, durationInFrames: 5 }],
				fps: 30,
				presentation: 'flip'
			})
		).toBeNull();
	});

	it('rejects gaps, locked tracks, audio, and clips without source handles', () => {
		const left = clip('left', 0);
		const gapped = clip('right', 90);
		const params = {
			itemId: left.id,
			edge: 'right' as const,
			items: [left, gapped],
			tracks: [track],
			transitions: [],
			fps: 30,
			presentation: 'fade'
		};
		expect(resolveTransitionDropTarget(params)).toBeNull();
		expect(
			resolveTransitionDropTarget({
				...params,
				items: [left, clip('right', 60)],
				tracks: [{ ...track, locked: true }]
			})
		).toBeNull();
		expect(
			resolveTransitionDropTarget({
				...params,
				items: [clip('audio-left', 0, 'audio'), clip('right', 60)]
			})
		).toBeNull();
		expect(
			resolveTransitionDropTarget({
				...params,
				items: [left, { ...clip('right', 60), sourceStart: 0 }]
			})
		).toBeNull();
	});
});
