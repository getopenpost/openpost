import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { planMediaDeletion } from './media-deletion';
import { removePlannedMediaReferences } from './media-deletion-action';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: true,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function item(id: string, mediaId?: string): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 30,
		label: id,
		type: 'video',
		mediaId
	};
}

beforeEach(() => {
	sequenceStore.reset();
	commandHistory.clearHistory();
});

describe('project media deletion', () => {
	it('plans direct and generated-caption references across root and nested sequences', () => {
		const source = item('source', 'camera');
		const caption: TimelineItem = {
			...item('caption'),
			type: 'subtitle',
			captionSource: { type: 'transcript', clipId: source.id, mediaId: 'camera' }
		};
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [item('nested-source', 'camera')],
			tracks: [track],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const plan = planMediaDeletion(
			{
				...createEmptyTimeline(),
				tracks: [track],
				items: [source, caption],
				compositions: [nested]
			},
			['camera', 'camera']
		);

		expect(plan).toMatchObject({
			mediaIds: ['camera'],
			rootReferenceCount: 2,
			nestedReferenceCount: 1,
			totalReferenceCount: 3
		});
		expect(plan.sequences).toEqual([
			{ sequenceId: null, itemIds: ['source', 'caption'] },
			{ sequenceId: 'nested', itemIds: ['nested-source'] }
		]);
	});

	it('removes locked references, transitions, and parent links while preserving the active sequence', () => {
		const source = item('source', 'camera');
		const child: TimelineItem = {
			...item('child', 'other'),
			transformParent: {
				parentItemId: source.id,
				parentReference: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
				childLocalReference: { x: 10, y: 0, width: 100, height: 100, rotation: 0 },
				childWorldReference: { x: 10, y: 0, width: 100, height: 100, rotation: 0 }
			}
		};
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [item('nested-source', 'camera'), item('nested-other', 'other')],
			tracks: [track],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				tracks: [track],
				items: [source, child],
				transitions: [
					{
						id: 'transition',
						type: 'crossfade',
						durationInFrames: 5,
						fromItemId: source.id,
						toItemId: child.id
					}
				],
				compositions: [nested]
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		sequenceStore.switchTo(nested.id);
		const plan = planMediaDeletion(sequenceStore.projectTimeline(), ['camera']);

		expect(removePlannedMediaReferences(plan)).toBe(2);
		expect(sequenceStore.activeSequenceId).toBe(nested.id);
		expect(commandHistory.undoStack).toHaveLength(0);
		const result = sequenceStore.projectTimeline();
		expect(result.items.map((candidate) => candidate.id)).toEqual(['child']);
		expect(result.items[0]?.transformParent?.parentItemId).toBeUndefined();
		expect(result.transitions).toEqual([]);
		expect(result.compositions?.[0]?.items.map((candidate) => candidate.id)).toEqual([
			'nested-other'
		]);
	});
});
