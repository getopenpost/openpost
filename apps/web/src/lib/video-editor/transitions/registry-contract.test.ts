import { describe, expect, it } from 'vitest';
import { transitionRegistry } from './index';

const FREECUT_TRANSITION_IDS = [
	'fade',
	'barnDoor',
	'split',
	'wipe',
	'bandWipe',
	'centerWipe',
	'edgeWipe',
	'radialWipe',
	'spiralWipe',
	'venetianBlindWipe',
	'xWipe',
	'clockWipe',
	'slide',
	'flip',
	'iris',
	'arrowIris',
	'crossIris',
	'diamondIris',
	'eyeIris',
	'hexagonIris',
	'ovalIris',
	'pentagonIris',
	'squareIris',
	'triangleIris',
	'boxShape',
	'heartShape',
	'starShape',
	'triangleLeftShape',
	'triangleRightShape',
	'dissolve',
	'additiveDissolve',
	'blurDissolve',
	'dipToColorDissolve',
	'nonAdditiveDissolve',
	'smoothCut',
	'sparkles',
	'glitch',
	'pixelate',
	'chromatic',
	'radialBlur',
	'liquidDistort',
	'lensWarpZoom',
	'lightLeakBurn',
	'filmGateSlip'
] as const;

describe('FreeCut transition registry contract', () => {
	it('keeps all 44 presentations wired to usable renderers', () => {
		expect(transitionRegistry.getIds().sort()).toEqual([...FREECUT_TRANSITION_IDS].sort());

		for (const id of FREECUT_TRANSITION_IDS) {
			const definition = transitionRegistry.getDefinition(id);
			const renderer = transitionRegistry.getRenderer(id);
			expect(definition, `${id} definition`).toBeDefined();
			expect(renderer, `${id} renderer`).toBeDefined();
			expect(definition?.id).toBe(id);
			expect(definition?.label.trim()).not.toBe('');
			expect(definition?.supportedTimings.length).toBeGreaterThan(0);
			expect(renderer?.renderCanvas || renderer?.gpuTransitionId, `${id} render path`).toBeTruthy();
		}
	});
});
