import { afterEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { timelineStore } from './timeline-store.svelte';

function track(id: string): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: id === 'one' ? 0 : 1
	};
}

function item(id: string, trackId: string, from: number): TimelineItem {
	return {
		id,
		trackId,
		from,
		durationInFrames: 10,
		label: id,
		type: 'video'
	};
}

afterEach(() => timelineStore.clear());

describe('timeline gesture preview indexing', () => {
	it('keeps lookup maps live during a gesture and rebuilds exact bounds once on commit', () => {
		timelineStore.setAll({
			tracks: [track('one'), track('two')],
			items: [item('moving', 'one', 0), item('fixed', 'one', 50)]
		});
		const itemById = timelineStore.itemById;
		const itemsByTrackId = timelineStore.itemsByTrackId;

		timelineStore._previewMoveItems([{ id: 'moving', from: 300, trackId: 'two' }]);
		expect(timelineStore.itemById).toBe(itemById);
		expect(timelineStore.itemsByTrackId).toBe(itemsByTrackId);
		expect(timelineStore.itemById.get('moving')).toMatchObject({ from: 300, trackId: 'two' });
		expect(timelineStore.itemsByTrackId.get('one')?.map(({ id }) => id)).toEqual(['fixed']);
		expect(timelineStore.itemsByTrackId.get('two')?.map(({ id }) => id)).toEqual(['moving']);
		expect(timelineStore.maxItemEndFrame).toBe(310);

		timelineStore._previewUpdateItems([
			{ id: 'moving', patch: { from: 5, trackId: 'one', durationInFrames: 20 } }
		]);
		// Preview bounds may stay conservatively wide so auto-scroll never collapses mid-gesture.
		expect(timelineStore.maxItemEndFrame).toBe(310);
		timelineStore._commitPreviewItems();

		expect(timelineStore.itemById).not.toBe(itemById);
		expect(timelineStore.itemsByTrackId).not.toBe(itemsByTrackId);
		expect(timelineStore.maxItemEndFrame).toBe(60);
		expect(timelineStore.itemsByTrackId.get('one')?.map(({ id }) => id)).toEqual([
			'moving',
			'fixed'
		]);
	});
});
