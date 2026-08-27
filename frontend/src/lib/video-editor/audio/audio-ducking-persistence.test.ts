import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { updateItemProperties } from '../timeline/actions/items';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';

function track(id: string): TimelineTrack {
	return {
		id,
		name: id,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
}

function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item-1',
		trackId: 'track-a',
		from: 0,
		durationInFrames: 90,
		label: '',
		type: 'audio',
		mediaId: 'media-a',
		...extra
	};
}

describe('audio ducking persistence and undo', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore.setAll({
			fps: 30,
			tracks: [track('track-a'), track('track-b')],
			items: [item({ id: 'voice', trackId: 'track-a' }), item({ id: 'music', trackId: 'track-b' })]
		});
	});

	it('persists ducking settings through item updates and survives store snapshot', () => {
		updateItemProperties('music', { audioDucking: { duckOthersDb: -12, attackSec: 0.1, releaseSec: 0.25, targetTrackIds: ['track-a'] } } as Partial<TimelineItem>, 'UPDATE_CLIP_AUDIO_DUCKING');
		expect(timelineStore.itemById.get('music')?.audioDucking).toEqual({
			duckOthersDb: -12,
			attackSec: 0.1,
			releaseSec: 0.25,
			targetTrackIds: ['track-a']
		});
	});

	it('undo and redo restore ducking settings', () => {
		updateItemProperties('voice', { audioDucking: { duckOthersDb: -9 } } as Partial<TimelineItem>, 'UPDATE_CLIP_AUDIO_DUCKING');
		expect(timelineStore.itemById.get('voice')?.audioDucking).toBeDefined();
		expect(commandHistory.canUndo).toBe(true);
		commandHistory.undo();
		expect(timelineStore.itemById.get('voice')?.audioDucking).toBeUndefined();
		expect(commandHistory.canRedo).toBe(true);
		commandHistory.redo();
		expect(timelineStore.itemById.get('voice')?.audioDucking).toEqual({ duckOthersDb: -9 });
	});

	it('survives speed, trim and track mute/solo changes without clearing ducking', () => {
		updateItemProperties('voice', { audioDucking: { duckOthersDb: -6 } } as Partial<TimelineItem>, 'UPDATE_CLIP_AUDIO_DUCKING');
		// Speed change preserves ducking
		updateItemProperties('voice', { speed: 1.5 } as Partial<TimelineItem>, 'UPDATE_CLIP_SPEED');
		expect(timelineStore.itemById.get('voice')?.audioDucking?.duckOthersDb).toBe(-6);
		// Trim does not clear ducking
		updateItemProperties('voice', { from: 10 } as Partial<TimelineItem>, 'TRIM_ITEM');
		expect(timelineStore.itemById.get('voice')?.audioDucking).toBeDefined();
		// Muting track does not delete setting (just suppresses it at runtime)
		timelineStore._setTracks([
			{ ...track('track-a'), muted: true },
			track('track-b')
		]);
		expect(timelineStore.itemById.get('voice')?.audioDucking).toBeDefined();
	});
});
