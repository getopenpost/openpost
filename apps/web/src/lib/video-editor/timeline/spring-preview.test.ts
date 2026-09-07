import { describe, expect, it } from 'vitest';
import { springPreviewDuration, springPreviewPosition } from './easing-presets';

describe('spring preview timing', () => {
	it('derives duration from mass and friction like easing.dev', () => {
		// FreeCut reference values: mass 0.3 / friction 18 → 153ms.
		expect(springPreviewDuration({ mass: 0.3, friction: 18 })).toBeCloseTo(0.1535, 3);
		// mass 4 / friction 80 → 460ms.
		expect(springPreviewDuration({ mass: 4, friction: 80 })).toBeCloseTo(0.46, 2);
	});

	it('clamps the duration to the FreeCut 0.15–4s window', () => {
		expect(springPreviewDuration({ mass: 0.1, friction: 100 })).toBe(0.15);
		expect(springPreviewDuration({ mass: 10, friction: 1 })).toBe(4);
	});

	it('falls back to the 1s bezier duration when decay is not positive', () => {
		expect(springPreviewDuration({ mass: 1, friction: 0 })).toBe(1);
	});

	it('mirrors ping-pong: ease out then ease back flipped in time and value', () => {
		const ease = (progress: number) => progress * progress;
		const duration = 1;
		expect(springPreviewPosition(0.25, duration, ease)).toBeCloseTo(0.0625, 6);
		// Return leg mirrors: 1 - ease(0.25) at phase 1.25.
		expect(springPreviewPosition(1.25, duration, ease)).toBeCloseTo(1 - 0.0625, 6);
		// Loop wraps every two durations.
		expect(springPreviewPosition(2.25, duration, ease)).toBeCloseTo(
			springPreviewPosition(0.25, duration, ease),
			6
		);
	});
});
