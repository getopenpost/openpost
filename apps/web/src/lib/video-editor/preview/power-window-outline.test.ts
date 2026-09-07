import { describe, expect, it } from 'vitest';
import { powerWindowBoundaryPoints } from './power-window-outline';

const DEFAULTS = {
	centerX: 0.5,
	centerY: 0.5,
	sizeX: 0.5,
	sizeY: 0.5,
	rotation: 0,
	feather: 0.3,
	shape: 'ellipse'
};

describe('powerWindowBoundaryPoints', () => {
	it('places the unrotated ellipse boundary at half size around the center', () => {
		const { outer } = powerWindowBoundaryPoints(DEFAULTS, 1);
		expect(outer).toHaveLength(48);
		// First sample is angle 0: (centerX + sizeX/2, centerY).
		expect(outer[0]!.x).toBeCloseTo(0.75, 6);
		expect(outer[0]!.y).toBeCloseTo(0.5, 6);
		// Quarter turn: (centerX, centerY + sizeY/2).
		expect(outer[12]!.x).toBeCloseTo(0.5, 6);
		expect(outer[12]!.y).toBeCloseTo(0.75, 6);
	});

	it('compensates the shader aspect scaling on X', () => {
		const { outer } = powerWindowBoundaryPoints(DEFAULTS, 2);
		expect(outer[0]!.x).toBeCloseTo(0.75, 6);
		expect(outer[0]!.y).toBeCloseTo(0.5, 6);
	});

	it('rotates the boundary with the window rotation', () => {
		const { outer } = powerWindowBoundaryPoints({ ...DEFAULTS, rotation: 90 }, 1);
		expect(outer[0]!.x).toBeCloseTo(0.5, 6);
		expect(outer[0]!.y).toBeCloseTo(0.75, 6);
	});

	it('samples rectangle corners', () => {
		const { outer } = powerWindowBoundaryPoints({ ...DEFAULTS, shape: 'rectangle' }, 1);
		expect(outer).toHaveLength(48);
		expect(outer[0]!.x).toBeCloseTo(0.25, 6);
		expect(outer[0]!.y).toBeCloseTo(0.25, 6);
	});

	it('scales the feather edge and skips it at zero feather', () => {
		const feathered = powerWindowBoundaryPoints(DEFAULTS, 1);
		expect(feathered.inner).not.toBeNull();
		expect(feathered.inner![0]!.x).toBeCloseTo(0.5 + 0.25 * 0.7, 6);
		const sharp = powerWindowBoundaryPoints({ ...DEFAULTS, feather: 0 }, 1);
		expect(sharp.inner).toBeNull();
	});

	it('falls back to safe defaults for invalid input', () => {
		const { outer } = powerWindowBoundaryPoints({}, 0);
		expect(outer).toHaveLength(48);
		expect(outer[0]!.x).toBeCloseTo(0.75, 6);
	});
});
