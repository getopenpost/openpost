// oxlint-disable
/**
 * Ported from FreeCut (MIT) - registry/gpu/pipeline tests
 * Verifies 44-entry registry, defaults, timing/property helpers, and graceful GPU fallback.
 */

import { describe, expect, it } from 'vitest';
import { transitionRegistry } from './registry';
import './index';
import {
	clamp01,
	smoothStep,
	getNumericProperty,
	seededRandom,
	fadeOpacity,
	crossDissolveT
} from './renderers/gpu';
import { GPU_TRANSITION_REGISTRY, getGpuTransition, getGpuTransitionIds } from './gpu/registry';
import { TransitionPipeline } from './gpu/pipeline';

const EXPECTED_IDS = [
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

describe('transition registry - 44 entry contract', () => {
	it('registers exactly 44 transitions', () => {
		expect(transitionRegistry.size).toBe(44);
		expect(transitionRegistry.getIds().sort()).toEqual([...EXPECTED_IDS].sort());
	});

	it.each(EXPECTED_IDS)('has definition and renderer for "%s"', (id) => {
		const def = transitionRegistry.getDefinition(id);
		const renderer = transitionRegistry.getRenderer(id);
		expect(def, `${id} definition`).toBeDefined();
		expect(renderer, `${id} renderer`).toBeDefined();
		expect(def!.id).toBe(id);
		expect(def!.label.trim().length).toBeGreaterThan(0);
		expect(def!.description.trim().length).toBeGreaterThan(0);
		expect(def!.category.trim().length).toBeGreaterThan(0);
		expect(def!.supportedTimings.length).toBeGreaterThan(0);
		expect(def!.supportedTimings).not.toContain('spring');
		expect(def!.defaultDuration).toBeGreaterThanOrEqual(def!.minDuration);
		expect(def!.defaultDuration).toBeLessThanOrEqual(def!.maxDuration);
	});

	it('exposes correct categories and directions', () => {
		expect(transitionRegistry.getDefinition('fade')!.category).toBe('basic');
		expect(transitionRegistry.getDefinition('fade')!.hasDirection).toBe(false);
		expect(transitionRegistry.getDefinition('wipe')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('wipe')!.directions).toEqual(
			expect.arrayContaining(['from-left', 'from-right', 'from-top', 'from-bottom'])
		);
		expect(transitionRegistry.getDefinition('slide')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('flip')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('edgeWipe')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('bandWipe')!.hasDirection).toBe(false);
		expect(transitionRegistry.getDefinition('lightLeakBurn')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('chromatic')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('liquidDistort')!.hasDirection).toBe(true);
		expect(transitionRegistry.getDefinition('iris')!.hasDirection).toBe(false);
	});

	it('preserves exact defaults from FreeCut', () => {
		expect(transitionRegistry.getDefinition('fade')!.defaultDuration).toBe(30);
		expect(transitionRegistry.getDefinition('flip')!.defaultDuration).toBe(30);
		expect(transitionRegistry.getDefinition('flip')!.minDuration).toBe(10);
		expect(transitionRegistry.getDefinition('iris')!.defaultDuration).toBe(30);
		expect(transitionRegistry.getDefinition('sparkles')!.defaultDuration).toBe(24);
		expect(transitionRegistry.getDefinition('glitch')!.defaultDuration).toBe(20);
		expect(transitionRegistry.getDefinition('smoothCut')!.defaultDuration).toBe(18);
		expect(transitionRegistry.getDefinition('dissolve')!.defaultDuration).toBe(30);
		expect(transitionRegistry.getDefinition('blurDissolve')!.defaultDuration).toBe(30);
		expect(transitionRegistry.getDefinition('dipToColorDissolve')!.parameters?.[0].key).toBe(
			'color'
		);
		expect(transitionRegistry.getDefinition('lensWarpZoom')!.parameters?.length).toBeGreaterThan(0);
		expect(transitionRegistry.getDefinition('filmGateSlip')!.parameters?.length).toBe(7);
	});

	it('maps gpuTransitionId for GPU-accelerated canvas fallbacks', () => {
		expect(transitionRegistry.getRenderer('fade')!.gpuTransitionId).toBe('fade');
		expect(transitionRegistry.getRenderer('wipe')!.gpuTransitionId).toBe('wipe');
		expect(transitionRegistry.getRenderer('slide')!.gpuTransitionId).toBe('slide');
		expect(transitionRegistry.getRenderer('flip')!.gpuTransitionId).toBe('flip');
		expect(transitionRegistry.getRenderer('dissolve')!.gpuTransitionId).toBe('dissolve');
		expect(transitionRegistry.getRenderer('glitch')!.gpuTransitionId).toBe('glitch');
		// barnDoor has no GPU id (canvas only)
		expect(transitionRegistry.getRenderer('barnDoor')!.gpuTransitionId).toBeUndefined();
		expect(transitionRegistry.getRenderer('split')!.gpuTransitionId).toBeUndefined();
	});
});

describe('timing and property helpers', () => {
	it('clamp01 passes through and clamps', () => {
		expect(clamp01(0)).toBe(0);
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(1)).toBe(1);
		expect(clamp01(-1)).toBe(0);
		expect(clamp01(2)).toBe(1);
	});

	it('smoothStep produces S-curve', () => {
		expect(smoothStep(0, 1, 0)).toBe(0);
		expect(smoothStep(0, 1, 1)).toBe(1);
		expect(smoothStep(0, 1, 0.5)).toBeCloseTo(0.5, 5);
		expect(smoothStep(0, 1, 0.25)).toBeLessThan(0.25);
		expect(smoothStep(0, 1, 0.75)).toBeGreaterThan(0.75);
		expect(Number.isFinite(smoothStep(0.5, 0.5, 0.6))).toBe(true);
	});

	it('getNumericProperty returns finite numbers and falls back', () => {
		expect(getNumericProperty({ a: 5 }, 'a', 0)).toBe(5);
		expect(getNumericProperty({}, 'a', 7)).toBe(7);
		expect(getNumericProperty(undefined, 'a', 7)).toBe(7);
		expect(getNumericProperty({ a: '5' as unknown as number }, 'a', 9)).toBe(9);
		expect(getNumericProperty({ a: NaN }, 'a', 1)).toBe(1);
		expect(getNumericProperty({ a: Infinity }, 'a', 1)).toBe(1);
	});

	it('seededRandom is deterministic in [0,1)', () => {
		expect(seededRandom(1)).toBe(seededRandom(1));
		expect(seededRandom(42)).toBeGreaterThanOrEqual(0);
		expect(seededRandom(42)).toBeLessThan(1);
		expect(seededRandom(0)).not.toBe(seededRandom(1));
	});

	it('fadeOpacity uses cos/sin power curve', () => {
		expect(fadeOpacity(0, true)).toBeCloseTo(1, 5);
		expect(fadeOpacity(1, true)).toBeCloseTo(0, 5);
		expect(fadeOpacity(0, false)).toBeCloseTo(0, 5);
		expect(fadeOpacity(1, false)).toBeCloseTo(1, 5);
		expect(fadeOpacity(0.5, true)).toBeCloseTo(Math.SQRT1_2, 5);
	});

	it('crossDissolveT is cosine eased and clamped', () => {
		expect(crossDissolveT(0)).toBeCloseTo(0, 5);
		expect(crossDissolveT(1)).toBeCloseTo(1, 5);
		expect(crossDissolveT(0.5)).toBeCloseTo(0.5, 5);
		expect(crossDissolveT(-1)).toBe(crossDissolveT(0));
		expect(crossDissolveT(2)).toBe(crossDissolveT(1));
	});
});

describe('GPU transition registry', () => {
	it('exposes 21 shader definitions', () => {
		expect(GPU_TRANSITION_REGISTRY.size).toBe(21);
		expect(getGpuTransitionIds().length).toBe(21);
	});

	it('every shader has valid metadata and 16-byte aligned uniform size', () => {
		for (const [id, def] of GPU_TRANSITION_REGISTRY) {
			expect(def.id).toBe(id);
			expect(def.shader.trim().length).toBeGreaterThan(0);
			expect(def.entryPoint.trim().length).toBeGreaterThan(0);
			expect(def.uniformSize % 16).toBe(0);
			expect(def.uniformSize).toBeGreaterThan(0);
			const uniforms = def.packUniforms(0.5, 1920, 1080, 0, {});
			expect(uniforms).toBeInstanceOf(Float32Array);
			expect(uniforms.byteLength).toBeLessThanOrEqual(def.uniformSize);
			expect(Array.from(uniforms).every(Number.isFinite)).toBe(true);
		}
	});

	it('progress is always first float', () => {
		for (const [id, def] of GPU_TRANSITION_REGISTRY) {
			const u = def.packUniforms(0.42, 1280, 720, 0, {});
			expect(u[0], id).toBeCloseTo(0.42);
		}
	});

	it('packs dissolve family within buffer', () => {
		const cases: Array<[string, Record<string, unknown>]> = [
			['dissolve', {}],
			['blurDissolve', { strength: 8 }],
			['dipToColorDissolve', { color: [1, 0.9, 0.7] }],
			['smoothCut', { strength: 1.2 }]
		];
		for (const [id, props] of cases) {
			const def = getGpuTransition(id)!;
			const u = def.packUniforms(0.4, 1920, 1080, 0, props);
			expect(u.byteLength).toBeLessThanOrEqual(def.uniformSize);
		}
	});

	it('returns undefined for unknown ids', () => {
		expect(getGpuTransition('nope')).toBeUndefined();
	});
});

describe('graceful GPU unavailability', () => {
	it('TransitionPipeline.create returns null without device', () => {
		expect(TransitionPipeline.create(undefined)).toBeNull();
		expect(TransitionPipeline.create(null as unknown as any)).toBeNull();
	});

	it('TransitionPipeline handles unsupported device gracefully', () => {
		// A bogus device that throws on sampler creation should not crash create()
		const badDevice = {
			createSampler: () => {
				throw new Error('no gpu');
			}
		} as unknown as any;
		expect(TransitionPipeline.create(badDevice)).toBeNull();
	});

	it('pipeline instance reports missing ids and validates dimensions', () => {
		// Use a minimal mock device that succeeds init but has no real GPU
		const mockDevice = {
			createSampler: () => ({}),
			createShaderModule: () => ({
				getCompilationInfo: () => Promise.resolve({ messages: [] })
			}),
			createBindGroupLayout: () => ({}),
			createPipelineLayout: () => ({}),
			createRenderPipeline: () => ({}),
			createTexture: () => ({ createView: () => ({}), destroy: () => {} }),
			createBuffer: () => ({ size: 64, destroy: () => {} }),
			queue: { writeBuffer: () => {}, copyExternalImageToTexture: () => {}, submit: () => {} },
			createCommandEncoder: () => ({
				beginRenderPass: () => ({
					setPipeline: () => {},
					setBindGroup: () => {},
					draw: () => {},
					end: () => {}
				}),
				finish: () => ({})
			})
		} as unknown as any;

		const pipeline = TransitionPipeline.create(mockDevice);
		// If pipeline was created, it should handle invalid transitions gracefully
		if (pipeline) {
			expect(pipeline.has('nope')).toBe(false);
			const fakeLeft = { width: 2, height: 2 } as unknown as OffscreenCanvas;
			const fakeRight = { width: 2, height: 2 } as unknown as OffscreenCanvas;
			const fakeTex = { width: 2, height: 2, createView: () => ({}) } as unknown as any;
			expect(pipeline.render('nope', fakeLeft, fakeRight, 0.5, 2, 2)).toBeNull();
			expect(pipeline.render('fade', fakeLeft, fakeRight, 0.5, 1, 1)).toBeNull(); // too small
			expect(pipeline.renderToTexture('fade', fakeLeft, fakeRight, fakeTex, 0.5, 2, 2)).toBe(false);
			pipeline.destroy();
		}
	});
});
