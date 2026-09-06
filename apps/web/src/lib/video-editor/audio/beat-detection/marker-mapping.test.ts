import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import type { Beat } from './types';
import { beatsToMarkers, dedupeAgainstExisting } from './marker-mapping';
import { addBeatMarkersAtomic } from './beat-actions';

function beat(time: number, index: number): Beat {
	return { time, strength: 1, index };
}

describe('beat marker mapping', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('maps beats to deterministic frames, labels, and colors at project fps', () => {
		const beats = [beat(0, 0), beat(0.5, 1), beat(1, 2), beat(1.5, 3), beat(2, 4)];
		const downbeats = [0];
		const markers = beatsToMarkers(beats, downbeats, { fps: 30 });
		expect(markers.map((marker) => marker.frame)).toEqual([0, 15, 30, 45, 60]);
		expect(markers[0]?.label).toBe('Downbeat 1');
		expect(markers[0]?.color).toBe('#f59e0b');
		expect(markers[1]?.label).toBe('Beat 2');
		expect(markers[1]?.color).toBe('#38bdf8');
	});

	it('dedupes beats that land on the same frame within tolerance', () => {
		const beats = [beat(0.01, 0), beat(0.02, 1)];
		const markers = beatsToMarkers(beats, [], { fps: 30 });
		expect(markers).toHaveLength(1);
	});

	it('filters correctly for reversed clips', () => {
		const item = {
			id: 'clip',
			trackId: 'track',
			from: 10,
			durationInFrames: 60,
			label: 'Clip',
			type: 'audio' as const,
			mediaId: 'media',
			sourceStart: 30,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1,
			isReversed: true
		};
		const beats = [beat(0.5, 0), beat(1.5, 1), beat(3.5, 2)];
		const markers = beatsToMarkers(beats, [], { fps: 30, item });
		expect(markers).toHaveLength(1);
		expect(markers[0]?.frame).toBeGreaterThanOrEqual(10);
	});

	it('inserts beat markers atomically and undoes in one step', () => {
		const beats = [beat(0, 0), beat(0.5, 1), beat(1, 2)];
		const markers = beatsToMarkers(beats, [0], { fps: 30 });
		const inserted = addBeatMarkersAtomic(markers);
		expect(inserted).toBe(3);
		expect(timelineStore.markers).toHaveLength(3);
		expect(commandHistory.canUndo).toBe(true);
		expect(commandHistory.getLastCommandType()).toBe('ADD_BEAT_MARKERS');
		commandHistory.undo();
		expect(timelineStore.markers).toHaveLength(0);
		commandHistory.redo();
		expect(timelineStore.markers).toHaveLength(3);
	});
});
