import { describe, expect, it } from 'vitest';
import { BLEND_MODE_INDEX, BLEND_MODE_GROUPS, ALL_BLEND_MODES } from './blend-modes';
import { GPU_EFFECT_CATALOG, getGpuEffect, getGpuEffectDefaultParams } from './registry';
import { clampGpuParam, defaultGpuParams, normalizeGpuParam } from './types';
import { asciiDataTexture } from './shaders/ascii';

/** FreeCut's 25 blend modes with their exact WGSL dispatch indices (MIT). */
const FREECUT_BLEND_MODE_INDEX = {
	normal: 0,
	dissolve: 1,
	darken: 2,
	multiply: 3,
	'color-burn': 4,
	'linear-burn': 5,
	lighten: 6,
	screen: 7,
	'color-dodge': 8,
	'linear-dodge': 9,
	overlay: 10,
	'soft-light': 11,
	'hard-light': 12,
	'vivid-light': 13,
	'linear-light': 14,
	'pin-light': 15,
	'hard-mix': 16,
	difference: 17,
	exclusion: 18,
	subtract: 19,
	divide: 20,
	hue: 21,
	saturation: 22,
	color: 23,
	luminosity: 24
};

describe('gpu registry integrity', () => {
	it('has unique ids for every catalog entry', () => {
		const ids = GPU_EFFECT_CATALOG.map((definition) => definition.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('declares the entry point function in every fragment source', () => {
		for (const definition of GPU_EFFECT_CATALOG) {
			expect(
				definition.fragmentSource.includes(`vec4 ${definition.entryPoint}(vec2 vUv)`),
				`${definition.id} must define vec4 ${definition.entryPoint}(vec2 vUv)`
			).toBe(true);
		}
	});

	it('declares a complete vertex entry point for every scatter effect', () => {
		for (const definition of GPU_EFFECT_CATALOG) {
			if (!definition.scatterVertexSource) continue;
			expect(
				definition.scatterEntryPoint,
				`${definition.id} must name its scatter entry`
			).toBeTruthy();
			expect(
				definition.scatterVertexSource.includes(
					`vec4 ${definition.scatterEntryPoint}(int vertexId, out ivec2 destination)`
				),
				`${definition.id} must declare its point-scatter entry function`
			).toBe(true);
		}
	});

	it('declares every resolved uniform in the fragment source', () => {
		for (const definition of GPU_EFFECT_CATALOG) {
			const defaults = defaultGpuParams(definition.schema);
			const values = definition.uniformValues(defaults, 1920, 1080, 0);
			for (const [name] of Object.entries(values)) {
				expect(
					definition.fragmentSource.includes(`uniform float ${name};`),
					`${definition.id} must declare uniform float ${name};`
				).toBe(true);
			}
		}
	});

	it('keeps schema defaults inside their own min/max range', () => {
		for (const definition of GPU_EFFECT_CATALOG) {
			for (const param of definition.schema) {
				if (param.type && param.type !== 'number') continue;
				expect(
					param.default >= param.min && param.default <= param.max,
					`${definition.id}.${param.name} default out of range`
				).toBe(true);
				expect(param.step).toBeGreaterThan(0);
			}
		}
	});

	it('returns registry defaults for every effect id', () => {
		for (const definition of GPU_EFFECT_CATALOG) {
			const defaults = getGpuEffectDefaultParams(definition.id);
			expect(Object.keys(defaults).length).toBe(definition.schema.length);
		}
		expect(getGpuEffectDefaultParams('gpu-nonexistent')).toEqual({});
		expect(getGpuEffect('gpu-nonexistent')).toBeUndefined();
	});
});

describe('gpu param clamping', () => {
	const param = { name: 'amount', label: 'Amount', min: -1, max: 1, step: 0.01, default: 0 };

	it('passes in-range values through unchanged', () => {
		expect(clampGpuParam(param, 0.5)).toBe(0.5);
		expect(clampGpuParam(param, -1)).toBe(-1);
		expect(clampGpuParam(param, 1)).toBe(1);
	});

	it('clamps out-of-range values to the bounds', () => {
		expect(clampGpuParam(param, 5)).toBe(1);
		expect(clampGpuParam(param, -42)).toBe(-1);
	});

	it('maps non-finite values to the schema default', () => {
		expect(clampGpuParam(param, Number.NaN)).toBe(0);
		expect(clampGpuParam(param, Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe('typed GPU params', () => {
	it('validates selects, colors, booleans, and bounded text', () => {
		expect(
			normalizeGpuParam(
				{
					name: 'font',
					label: 'Font',
					type: 'select',
					default: 'mono',
					options: [{ value: 'mono', label: 'Mono' }]
				},
				'unknown'
			)
		).toBe('mono');
		expect(
			normalizeGpuParam(
				{ name: 'color', label: 'Color', type: 'color', default: '#ffffff' },
				'#123456'
			)
		).toBe('#123456');
		expect(
			normalizeGpuParam({ name: 'enabled', label: 'Enabled', type: 'boolean', default: true }, 1)
		).toBe(false);
		expect(
			normalizeGpuParam(
				{ name: 'text', label: 'Text', type: 'text', default: '', maxLength: 3 },
				'ABCDE'
			)
		).toBe('ABC');
	});

	it('keys the ASCII atlas by glyph ramp and font', () => {
		expect(asciiDataTexture.key({ charSet: 'custom', customChars: '01', font: 'courier' })).toBe(
			'01|courier'
		);
		const payload = asciiDataTexture.build({ charSet: 'binary', font: 'monospace' });
		expect(payload.width).toBe(48);
		expect(payload.height).toBe(24);
		expect(payload.data).toHaveLength(48 * 24 * 4);
	});
});

describe('blend modes vs FreeCut catalog', () => {
	it('covers exactly FreeCut\u2019s 25 modes with identical indices', () => {
		expect(Object.keys(BLEND_MODE_INDEX).sort()).toEqual(
			Object.keys(FREECUT_BLEND_MODE_INDEX).sort()
		);
		for (const [mode, index] of Object.entries(FREECUT_BLEND_MODE_INDEX)) {
			const typed = ALL_BLEND_MODES.find((entry) => entry === mode);
			if (!typed) throw new Error(`unknown blend mode: ${mode}`);
			expect(BLEND_MODE_INDEX[typed]).toBe(index);
		}
	});

	it('assigns contiguous indices 0..24', () => {
		expect([...Object.values(BLEND_MODE_INDEX)].sort((a, b) => a - b)).toEqual(
			Array.from({ length: 25 }, (_, i) => i)
		);
	});

	it('groups cover every mode exactly once', () => {
		const grouped = BLEND_MODE_GROUPS.flatMap((group) => group.modes);
		expect(grouped.sort()).toEqual([...ALL_BLEND_MODES].sort());
		expect(new Set(grouped).size).toBe(grouped.length);
	});
});

describe('gradient map data texture', () => {
	it('builds an opaque 256x1 LUT', () => {
		const definition = getGpuEffect('gpu-gradient-map');
		if (!definition?.dataTexture) throw new Error('gradient map data texture missing');
		const payload = definition.dataTexture.build({});
		expect(payload.width).toBe(256);
		expect(payload.height).toBe(1);
		expect(payload.data.length).toBe(256 * 4);
		for (let i = 0; i < 256; i++) {
			expect(payload.data[i * 4 + 3]).toBe(255);
		}
	});
});
