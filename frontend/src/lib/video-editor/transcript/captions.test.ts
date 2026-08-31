import { beforeEach, describe, expect, it } from 'vitest';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
import { addSubtitleItemFromSrt, srtToCues } from './captions';

const SRT = '1\n00:00:00,500 --> 00:00:02,000\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\nWorld';

describe('srtToCues', () => {
	it('converts seconds to frames and guarantees nonzero span', () => {
		const cues = srtToCues([{ startSeconds: 0.5, endSeconds: 0.5, text: 'x' }], 30);
		expect(cues[0]!.startFrame).toBe(15);
		expect(cues[0]!.endFrame).toBe(16);
	});
});

describe('addSubtitleItemFromSrt', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('creates an undoable subtitle item holding every cue', () => {
		const id = addSubtitleItemFromSrt(SRT);
		const item = timelineStore.itemById.get(id)!;
		expect(item.type).toBe('subtitle');
		expect(item.cues?.length).toBe(2);
		expect(item.durationInFrames).toBe(120); // last cue ends at 4s @30fps
		expect(commandHistory.undoStack.length).toBe(1);
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});

	it('creates a caption track when the imported caption range would overlap visual items', () => {
		const occupied = (id: string, trackId: string): TimelineItem => ({
			id,
			trackId,
			from: 0,
			durationInFrames: 120,
			label: id,
			type: 'video'
		});
		timelineStore._setItems([
			occupied('overlay', 'track-video-overlay'),
			occupied('main', 'track-video-main')
		]);

		const id = addSubtitleItemFromSrt(SRT);
		const subtitle = timelineStore.itemById.get(id);

		expect(subtitle?.trackId).not.toBe('track-video-overlay');
		expect(subtitle?.trackId).not.toBe('track-video-main');
		expect(timelineStore.tracks).toHaveLength(4);
	});

	it('rejects caption files without cues', () => {
		expect(() => addSubtitleItemFromSrt('nonsense')).toThrow();
	});
});
