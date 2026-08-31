import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { itemClipboardStore } from '../stores/item-clipboard-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { pasteTimelineItemClipboard } from './item-clipboard';

const track: TimelineTrack = {
	id: 'V1',
	name: 'Video 1',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const clip: TimelineItem = {
	id: 'source',
	trackId: track.id,
	from: 0,
	durationInFrames: 30,
	label: 'Clip',
	type: 'video'
};

beforeEach(() => {
	commandHistory.clearHistory();
	itemClipboardStore.__resetForTesting();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [clip], currentFrame: 30, fps: 30 });
});

describe('timeline item clipboard action', () => {
	it('pastes every clipboard item in one undo step and consumes a cut clipboard', () => {
		itemClipboardStore.copy([clip], 'cut');
		const pastedIds = pasteTimelineItemClipboard(track.id);

		expect(pastedIds).toHaveLength(1);
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.itemById.get(pastedIds[0]!)).toMatchObject({
			trackId: track.id,
			from: 30,
			originId: pastedIds[0]
		});
		expect(itemClipboardStore.hasItems).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items).toEqual([clip]);
	});
});
