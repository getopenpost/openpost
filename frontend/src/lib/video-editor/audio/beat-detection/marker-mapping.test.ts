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
		expect(markers.map((m) => m.frame)).toEqual([0, 15, 30, 45, 60]);
		expect(markers[0]?.label).toBe('Downbeat 1');
		expect(markers[0]?.color).toBe('#f59e0b');
		expect(markers[1]?.label).toBe('Beat 2');
		expect(markers[1]?.color).toBe('#38bdf8');
	});

	it('dedupes beats that land on the same frame within tolerance', () => {
		const beats = [beat(0.01, 0), beat(0.02, 1)];
		const markers = beatsToMarkers(beats, [], { fps: 30 });
		// Both would map to frame 0 or 1, dedup tolerance 1 collapses to one
		expect(markers).toHaveLength(1);
	});

	it('maps through clip source window with speed (timeline frames shift)', () => {
		const item = {
			id: 'clip',
			trackId: 'track',
			from: 30,
			durationInFrames: 60,
			label: 'Clip',
			type: 'audio' as const,
			mediaId: 'media',
			sourceStart: 0,
			sourceEnd: 60,
			sourceFps: 30,
			speed: 2
		};
		// At 2x, source second 1.0 maps to fewer timeline frames
		const beats = [beat(0, 0), beat(1, 1)];
		const markers = beatsToMarkers(beats, [], { fps: 30, item });
		// 0 sec at from 30, 1 sec at from+15 (because 30fps source * /2)
		expect(markers[0]?.frame).toBe(30);
		expect(markers[1]?.frame).toBe(45);
	});

	it('dedupeAgainstExisting filters collisions with tolerance 1', () => {
		const existing = [
			{ id: 'a', frame: 15, color: '#fff' },
			{ id: 'b', frame: 30, color: '#fff' }
		];
		const candidates = [
			{ id: 'c1', frame: 15, color: '#38bdf8', label: 'Beat 1' },
			{ id: 'c2', frame: 16, color: '#38bdf8', label: 'Beat 2' },
			{ id: 'c3', frame: 45, color: '#38bdf8', label: 'Beat 3' }
		];
		expect(dedupeAgainstExisting(candidates, existing, 1)).toEqual([
			expect.objectContaining({ id: 'c3', frame: 45 })
		]);
	});
});

describe('atomic marker insertion / dedupe / undo', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
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

	it('second insertion dedupes without creating a new undo entry', () => {
		const beats = [beat(0, 0), beat(0.5, 1)];
		const first = beatsToMarkers(beats, [], { fps: 30 });
		addBeatMarkersAtomic(first);
		const beforeUndoDepth = commandHistory.undoStack.length;
		const second = beatsToMarkers(beats, [], { fps: 30 });
		const secondInserted = addBeatMarkersAtomic(second);
		expect(secondInserted).toBe(0);
		expect(timelineStore.markers).toHaveLength(2);
		// No new history entry when nothing changed
		expect(commandHistory.undoStack.length).toBe(beforeUndoDepth);
	});

	it('preserves existing marker behavior - manual marker plus beats coexist', () => {
		timelineStore._addMarker({ id: 'manual', frame: 90, color: '#d97746', label: 'Manual' });
		commandHistory.clearHistory();
		const beats = [beat(3, 0)]; // frame 90 again at 30fps
		const markers = beatsToMarkers(beats, [], { fps: 30 });
		const inserted = addBeatMarkersAtomic(markers);
		expect(inserted).toBe(0);
		expect(timelineStore.markers.map((m) => m.id)).toContain('manual');
		expect(timelineStore.markers).toHaveLength(1);
		// Non-colliding beat does insert
		const beats2 = [beat(4, 1)];
		const markers2 = beatsToMarkers(beats2, [], { fps: 30 });
		expect(addBeatMarkersAtomic(markers2)).toBe(1);
		expect(timelineStore.markers).toHaveLength(2);
	});
});
