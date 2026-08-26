import { describe, expect, it } from 'vitest';
import { getMaxOffsetFrames, getTextMotionTimelineBands } from './text-motion-timeline';
import type { TimelineItem } from '../project/types';

function textItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	// SAFETY: factory merges required TimelineItem fields (id, trackId, from, durationInFrames, label, type, text) with overrides for isolated timeline band tests.
	return {
		id: 'text-1',
		trackId: 'visual',
		from: 10,
		durationInFrames: 100,
		label: 'Title',
		type: 'text',
		text: 'Hello world test',
		...overrides
	} as TimelineItem;
}

describe('getTextMotionTimelineBands', () => {
	it('places In at clip start and Out at clip end with no offset', () => {
		const item = textItem({
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 12,
					staggerFrames: 2,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				out: {
					presetId: 'fade-down',
					durationFrames: 8,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		const bands = getTextMotionTimelineBands(item);
		const inBand = bands.find((b) => b.slot === 'in')!;
		const outBand = bands.find((b) => b.slot === 'out')!;
		expect(inBand.fromFrame).toBe(10);
		expect(inBand.clipFromFrame).toBe(10);
		expect(outBand.toFrame).toBe(110);
		expect(outBand.clipToFrame).toBe(110);
		expect(inBand.durationFrames).toBe(12);
		expect(outBand.durationFrames).toBe(8);
		expect(inBand.offsetFrames).toBe(0);
		expect(outBand.offsetFrames).toBe(0);
	});

	it('respects In and Out offsets and clamps to clip bounds', () => {
		const item = textItem({
			durationInFrames: 50,
			textMotion: {
				in: {
					presetId: 'rise',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0,
					offsetFrames: 5
				},
				out: {
					presetId: 'sink',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0,
					offsetFrames: 5
				}
			}
		});
		const bands = getTextMotionTimelineBands(item);
		const inBand = bands.find((b) => b.slot === 'in')!;
		const outBand = bands.find((b) => b.slot === 'out')!;
		expect(inBand.fromFrame).toBe(15);
		expect(outBand.toFrame).toBe(55);
		expect(inBand.offsetFrames).toBe(5);
		expect(outBand.offsetFrames).toBe(5);
	});

	it('places Loop between In and Out and has no offset', () => {
		const item = textItem({
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				loop: {
					presetId: 'pulse',
					durationFrames: 12,
					staggerFrames: 0,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				out: {
					presetId: 'fade-down',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		const bands = getTextMotionTimelineBands(item);
		const loop = bands.find((b) => b.slot === 'loop')!;
		const inBand = bands.find((b) => b.slot === 'in')!;
		const outBand = bands.find((b) => b.slot === 'out')!;
		expect(loop.fromFrame).toBe(inBand.toFrame);
		expect(loop.toFrame).toBe(outBand.fromFrame);
		expect(loop.offsetFrames).toBe(0);
		expect(loop.durationFrames).toBe(12);
	});

	it('clamps window length to half clip duration', () => {
		const item = textItem({
			durationInFrames: 20,
			text: 'a '.repeat(50),
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 50,
					staggerFrames: 5,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		const bands = getTextMotionTimelineBands(item);
		const inBand = bands[0]!;
		expect(inBand.toFrame - inBand.fromFrame).toBeLessThanOrEqual(10);
	});

	it('computes max offset without overlapping opposite band', () => {
		const item = textItem({
			durationInFrames: 60,
			textMotion: {
				in: {
					presetId: 'typewriter',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				},
				out: {
					presetId: 'fade-down',
					durationFrames: 10,
					staggerFrames: 1,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		const bands = getTextMotionTimelineBands(item);
		const inBand = bands.find((b) => b.slot === 'in')!;
		const outBand = bands.find((b) => b.slot === 'out')!;
		expect(getMaxOffsetFrames(inBand, bands)).toBeGreaterThan(0);
		expect(getMaxOffsetFrames(outBand, bands)).toBeGreaterThan(0);
		// loop has no offset
		const loopItem = textItem({
			textMotion: {
				loop: {
					presetId: 'pulse',
					durationFrames: 10,
					staggerFrames: 0,
					intensity: 1,
					order: 'forward',
					easing: 'linear',
					seed: 0
				}
			}
		});
		const loopBands = getTextMotionTimelineBands(loopItem);
		expect(getMaxOffsetFrames(loopBands[0]!, loopBands)).toBe(0);
	});
});
