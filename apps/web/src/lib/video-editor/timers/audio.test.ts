import { expect, it } from 'vitest';
import { planMixdown, sliceMixEntries } from '../media/render-plan';
import { mixAudioWindows } from '../audio/bounded-audio-mixer';
import { createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
const tracks = createDefaultTracks();
const timer: TimelineItem = {
	id: 'timer',
	label: 'Timer',
	type: 'text',
	from: 60,
	durationInFrames: 300,
	trackId: tracks[0]!.id,
	timer: {
		direction: 'down',
		format: 'clock',
		style: 'ring',
		warningSound: true
	}
};
it('keeps warning sounds attached to the timer when it moves or changes length', () => {
	expect(planMixdown([timer], tracks, 30).map((entry) => entry.whenSeconds)).toEqual([9, 10, 11]);
	expect(
		planMixdown([{ ...timer, from: 0, durationInFrames: 150 }], tracks, 30).map(
			(entry) => entry.whenSeconds
		)
	).toEqual([2, 3, 4]);
	expect(
		planMixdown(
			[timer],
			tracks.map((track) => ({ ...track, muted: true })),
			30
		)
	).toEqual([]);
});
it('renders audible bounded samples for a range starting inside a warning tone', async () => {
	const entries = sliceMixEntries(planMixdown([timer], tracks, 30), 9.03, 9.1);
	const result = [];
	for await (const window of mixAudioWindows(entries, 0.07)) result.push(window);
	expect(result).toHaveLength(1);
	const samples = result[0]!.samples[0]!;
	expect(samples.length).toBe(3360);
	expect(Math.max(...samples)).toBeGreaterThan(0.1);
	expect(samples.every(Number.isFinite)).toBe(true);
});
