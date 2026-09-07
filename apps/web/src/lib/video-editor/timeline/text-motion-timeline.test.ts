import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { createTextMotionEffect } from './text-motion-presets';
import { getMaxOffsetFrames, getTextMotionTimelineBands } from './text-motion-timeline';

function textItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'text',
		trackId: 'visual',
		from: 100,
		durationInFrames: 90,
		label: 'Text',
		text: 'CINEMA',
		type: 'text',
		color: '#ffffff',
		...overrides
	};
}

describe('text-motion timeline bands', () => {
	it('renders In/Out bands at the clip edges without offsets', () => {
		const bands = getTextMotionTimelineBands(
			textItem({
				textMotion: {
					in: createTextMotionEffect('typewriter'),
					out: createTextMotionEffect('fade-down')
				}
			})
		);
		const inBand = bands.find((band) => band.slot === 'in')!;
		const outBand = bands.find((band) => band.slot === 'out')!;
		expect(inBand.fromFrame).toBe(100);
		expect(outBand.toFrame).toBe(190);
		expect(inBand.offsetFrames).toBe(0);
		expect(outBand.offsetFrames).toBe(0);
		expect(inBand.toFrame).toBeLessThanOrEqual(outBand.fromFrame);
	});

	it('moves In/Out bands away from the clip edge with offsets', () => {
		const bands = getTextMotionTimelineBands(
			textItem({
				textMotion: {
					in: { ...createTextMotionEffect('typewriter'), offsetFrames: 10 },
					out: { ...createTextMotionEffect('fade-down'), offsetFrames: 5 }
				}
			})
		);
		const inBand = bands.find((band) => band.slot === 'in')!;
		const outBand = bands.find((band) => band.slot === 'out')!;
		expect(inBand.fromFrame).toBe(110);
		expect(inBand.offsetFrames).toBe(10);
		expect(outBand.toFrame).toBe(185);
		expect(outBand.offsetFrames).toBe(5);
	});

	it('clamps offsets to the clip bounds (drag-time max keeps bands apart)', () => {
		const bands = getTextMotionTimelineBands(
			textItem({
				textMotion: {
					in: { ...createTextMotionEffect('typewriter'), offsetFrames: 80 },
					out: { ...createTextMotionEffect('fade-down'), offsetFrames: 80 }
				}
			})
		);
		const inBand = bands.find((band) => band.slot === 'in')!;
		const outBand = bands.find((band) => band.slot === 'out')!;
		// 80 frames exceed the available room, so both clamp into the clip.
		expect(inBand.offsetFrames).toBeLessThan(80);
		expect(outBand.offsetFrames).toBeLessThan(80);
		expect(inBand.fromFrame).toBeGreaterThanOrEqual(100);
		expect(outBand.toFrame).toBeLessThanOrEqual(190);
		// Offset drags cap at getMaxOffsetFrames, which accounts for the opposite band.
		expect(getMaxOffsetFrames(inBand, bands)).toBeGreaterThanOrEqual(0);
		expect(getMaxOffsetFrames(outBand, bands)).toBeGreaterThanOrEqual(0);
	});

	it('grows the In band when its duration grows (band-edge drag model)', () => {
		const shortItem = textItem({
			textMotion: { in: { ...createTextMotionEffect('typewriter'), durationFrames: 6 } }
		});
		const longItem = textItem({
			textMotion: { in: { ...createTextMotionEffect('typewriter'), durationFrames: 12 } }
		});
		const shortBand = getTextMotionTimelineBands(shortItem).find((band) => band.slot === 'in')!;
		const longBand = getTextMotionTimelineBands(longItem).find((band) => band.slot === 'in')!;
		expect(longBand.toFrame - longBand.fromFrame).toBeGreaterThan(
			shortBand.toFrame - shortBand.fromFrame
		);
		expect(shortBand.fromFrame).toBe(longBand.fromFrame);
	});
});
