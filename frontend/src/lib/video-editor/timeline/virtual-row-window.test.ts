import { describe, expect, it } from 'vitest';
import { buildVirtualRowLayout, queryVirtualRowLayout } from './virtual-row-window';

describe('virtual row window', () => {
	it('uses measured variable heights and keeps exact before and after space', () => {
		const layout = buildVirtualRowLayout(
			['a', 'b', 'c', 'd'],
			new Map([
				['b', 80],
				['d', 20]
			]),
			40
		);
		expect(layout).toEqual({
			offsets: [0, 40, 120, 160],
			sizes: [40, 80, 40, 20],
			totalSize: 180
		});
		expect(queryVirtualRowLayout(layout, 125, 25, 0)).toEqual({
			startIndex: 2,
			endIndex: 3,
			beforeSize: 120,
			afterSize: 20
		});
	});

	it('adds bounded overscan without mounting the full list', () => {
		const keys = Array.from({ length: 250 }, (_, index) => `row-${index}`);
		const layout = buildVirtualRowLayout(keys, new Map(), 34);
		const window = queryVirtualRowLayout(layout, 3_400, 400, 272);
		expect(window.startIndex).toBe(92);
		expect(window.endIndex).toBe(120);
		expect(window.endIndex - window.startIndex).toBeLessThan(32);
		expect(window.beforeSize + window.afterSize).toBeGreaterThan(7_000);
	});

	it('returns an empty window for an empty layout', () => {
		const layout = buildVirtualRowLayout([], new Map(), 34);
		expect(queryVirtualRowLayout(layout, 0, 400, 200)).toEqual({
			startIndex: 0,
			endIndex: 0,
			beforeSize: 0,
			afterSize: 0
		});
	});
});
