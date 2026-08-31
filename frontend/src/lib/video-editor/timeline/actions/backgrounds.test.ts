import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTracks } from '../../project/defaults';
import type { TimelineItem } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { addBackgroundItem } from './backgrounds';

function visual(id: string, trackId: string): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'image'
	};
}

describe('background item placement', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('creates another visual track when every current visual track is occupied', () => {
		timelineStore._setItems([
			visual('overlay', 'track-video-overlay'),
			visual('main', 'track-video-main')
		]);

		const id = addBackgroundItem();
		const background = timelineStore.itemById.get(id);

		expect(background?.trackId).not.toBe('track-video-overlay');
		expect(background?.trackId).not.toBe('track-video-main');
		expect(timelineStore.tracks).toHaveLength(4);
	});
});
