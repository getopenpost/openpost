import { describe, expect, it } from 'vitest';

import { resolveCropSnapAxes } from './crop-session.svelte.ts';

describe('resolveCropSnapAxes', () => {
	it('snaps both axes for moves and corner handles', () => {
		for (const rotatedSide of [false, true]) {
			expect(resolveCropSnapAxes('move', rotatedSide)).toBe('both');
			for (const handle of ['ne', 'nw', 'se', 'sw'] as const) {
				expect(resolveCropSnapAxes(handle, rotatedSide)).toBe('both');
			}
		}
	});

	it('snaps edges along their own axis, swapped past a quarter turn', () => {
		expect(resolveCropSnapAxes('e', false)).toBe('x');
		expect(resolveCropSnapAxes('w', false)).toBe('x');
		expect(resolveCropSnapAxes('n', false)).toBe('y');
		expect(resolveCropSnapAxes('s', false)).toBe('y');
		expect(resolveCropSnapAxes('e', true)).toBe('y');
		expect(resolveCropSnapAxes('w', true)).toBe('y');
		expect(resolveCropSnapAxes('n', true)).toBe('x');
		expect(resolveCropSnapAxes('s', true)).toBe('x');
	});
});
