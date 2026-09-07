import { describe, expect, it } from 'vitest';
import {
	EXPRESSION_GUIDE_ITEMS,
	EXPRESSION_GUIDE_SECTIONS,
	getExpressionPresets,
	type ExpressionPreset
} from './expression-catalog';
import { evaluatePropertyExpression } from './property-expression';
import type { DirectLinkableProperty } from '../project/types';

const ALL_LINKABLE: readonly DirectLinkableProperty[] = [
	'x',
	'y',
	'width',
	'height',
	'anchorX',
	'anchorY',
	'rotation',
	'opacity',
	'cornerRadius',
	'trimPathStart',
	'trimPathEnd',
	'trimPathOffset',
	'taperStartWidth',
	'taperEndWidth',
	'taperStartLength',
	'taperEndLength',
	'position',
	'scale',
	'anchor'
];

function evaluateScalar(source: string, preValue = 0): number {
	const result = evaluatePropertyExpression(source, {
		preValue,
		globalFrame: 30,
		fps: 30,
		resolveProperty: () => null
	});
	if (result.error) throw new Error(`preset failed to evaluate: ${result.error}`);
	// Number.isFinite takes unknown, so no narrowing is needed: a vector result fails here.
	if (!Number.isFinite(result.value)) throw new Error('preset must evaluate to a scalar');
	// SAFETY: the finiteness check above rejects every Vector2 result.
	return result.value as number;
}

function evaluateVector(source: string): { x: number; y: number } {
	const result = evaluatePropertyExpression(source, {
		preValue: { x: 10, y: 20 },
		globalFrame: 30,
		fps: 30,
		resolveProperty: () => null
	});
	if (result.error) throw new Error(`preset failed to evaluate: ${result.error}`);
	// SAFETY: vector presets evaluate against a vector preValue through vector-safe
	// operators only; a scalar result fails the finiteness check below.
	const vector = result.value as { x: number; y: number };
	if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y))
		throw new Error('preset must evaluate to a vector');
	return vector;
}

describe('expression-catalog', () => {
	it('covers every linkable property with presets (FreeCut group parity)', () => {
		// FreeCut gives every property Adjust + Motion; only trimPathOffset (offset
		// presets) lacks a Timing group. This asserts exact group parity, not more.
		const expectedGroups = new Map<DirectLinkableProperty, readonly string[]>(
			ALL_LINKABLE.map((property): [DirectLinkableProperty, readonly string[]] => [
				property,
				property === 'trimPathOffset' ? ['Adjust', 'Motion'] : ['Adjust', 'Motion', 'Timing']
			])
		);
		for (const property of ALL_LINKABLE) {
			const presets = getExpressionPresets(property);
			expect(presets.length, property).toBeGreaterThan(0);
			for (const group of expectedGroups.get(property) ?? []) {
				expect(
					presets.some((preset) => preset.group === group),
					`${property} misses ${group}`
				).toBe(true);
			}
		}
	});

	it('keeps labels, sources, and descriptions non-empty', () => {
		const seen = new Set<string>();
		for (const property of ALL_LINKABLE) {
			for (const preset of getExpressionPresets(property)) {
				expect(preset.label.trim().length, property).toBeGreaterThan(0);
				expect(preset.source.trim().length, property).toBeGreaterThan(0);
				expect(preset.description.trim().length, property).toBeGreaterThan(0);
				seen.add(`${preset.label}::${preset.source}`);
			}
		}
		expect(seen.size).toBeGreaterThan(40);
	});

	it('evaluates every scalar preset without errors', () => {
		const scalarProperties: DirectLinkableProperty[] = [
			'x',
			'rotation',
			'opacity',
			'trimPathStart',
			'trimPathOffset',
			'taperStartWidth'
		];
		for (const property of scalarProperties) {
			const presets: readonly ExpressionPreset[] = getExpressionPresets(property);
			for (const preset of presets) {
				const value = evaluateScalar(preset.source, 50);
				expect(Number.isFinite(value), `${property}/${preset.label}`).toBe(true);
			}
		}
	});

	it('evaluates every position/scale/anchor preset to a finite vector', () => {
		for (const property of ['position', 'scale', 'anchor'] as const) {
			for (const preset of getExpressionPresets(property)) {
				const value = evaluateVector(preset.source);
				expect(Number.isFinite(value.x), `${property}/${preset.label}`).toBe(true);
				expect(Number.isFinite(value.y), `${property}/${preset.label}`).toBe(true);
			}
		}
	});

	it('keeps the guide sections and items intact', () => {
		expect(EXPRESSION_GUIDE_SECTIONS.map((section) => section.id)).toEqual([
			'basics',
			'functions',
			'references',
			'errors'
		]);
		for (const section of EXPRESSION_GUIDE_SECTIONS) {
			const items = EXPRESSION_GUIDE_ITEMS[section.id];
			expect(items.length, section.id).toBeGreaterThan(0);
			for (const item of items) {
				expect(item.title.trim().length).toBeGreaterThan(0);
				expect(item.syntax.trim().length).toBeGreaterThan(0);
				expect(item.description.trim().length).toBeGreaterThan(0);
			}
		}
	});
});
