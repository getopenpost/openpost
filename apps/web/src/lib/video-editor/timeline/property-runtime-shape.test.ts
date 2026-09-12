import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { isDirectLinkableProperty } from './property-expression';
import { evaluateItemPropertyExpression, resolveItemPropertyRuntime } from './property-runtime';

function shapeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	// SAFETY: tests only read the shape/expression paths under test; the remaining
	// TimelineItem fields are optional for property-runtime resolution.
	return {
		id: 'shape-1',
		trackId: 'track-1',
		from: 0,
		durationInFrames: 60,
		label: 'Shape',
		type: 'shape',
		...overrides
	} as TimelineItem;
}

const contextFor = (items: readonly TimelineItem[]) => ({
	absoluteFrame: 10,
	fps: 30,
	items,
	resolvePreExpressionItem: (item: TimelineItem) => item
});

describe('shape linkable properties', () => {
	it('accepts trim and taper props in the linkable domain', () => {
		for (const property of [
			'trimPathStart',
			'trimPathEnd',
			'trimPathOffset',
			'taperStartWidth',
			'taperEndWidth',
			'taperStartLength',
			'taperEndLength'
		]) {
			expect(isDirectLinkableProperty(property), property).toBe(true);
		}
	});

	it('applies a trimPathStart expression to the item field, not the transform', () => {
		const item = shapeItem({
			expressions: [
				{ type: 'expression', targetProperty: 'trimPathStart', source: 'value + 10', enabled: true }
			]
		});
		const resolved = resolveItemPropertyRuntime(item, item, contextFor([item]));
		expect(resolved.trimPathStart).toBe(10);
		expect('trimPathStart' in (resolved.transform ?? {})).toBe(false);
	});

	it('resolves prop() references to trim props instead of throwing unknown property', () => {
		const source = shapeItem({ id: 'shape-source', trimPathEnd: 70 });
		const item = shapeItem({
			expressions: [
				{
					type: 'expression',
					targetProperty: 'trimPathStart',
					source: 'prop("shape-source", "trimPathEnd")',
					enabled: true
				}
			]
		});
		const result = evaluateItemPropertyExpression(
			item,
			'trimPathStart',
			contextFor([source, item])
		);
		expect(result.error).toBeUndefined();
		expect(result.value).toBe(70);
	});

	it('falls back to render defaults for unset trim props', () => {
		const item = shapeItem({
			expressions: [
				{ type: 'expression', targetProperty: 'trimPathStart', source: 'value', enabled: true }
			]
		});
		const result = evaluateItemPropertyExpression(item, 'trimPathStart', contextFor([item]));
		expect(result.error).toBeUndefined();
		expect(result.value).toBe(0);
		const end = evaluateItemPropertyExpression(
			shapeItem({
				expressions: [
					{ type: 'expression', targetProperty: 'trimPathEnd', source: 'value', enabled: true }
				]
			}),
			'trimPathEnd',
			contextFor([item])
		);
		expect(end.value).toBe(100);
	});
});
