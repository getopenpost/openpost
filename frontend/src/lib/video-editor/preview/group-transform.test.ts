import { describe, expect, it } from 'vitest';
import {
	alignGroupItems,
	calculateGroupBounds,
	changedGroupTransformValues,
	groupItemBounds,
	groupItemContainsPoint,
	groupRotationDelta,
	groupScaleFactor,
	initializeGroupTransform,
	rotateGroup,
	scaleGroup,
	snapGroupScale,
	snapGroupTranslation,
	translateGroup,
	type GroupTransform
} from './group-transform';

const CANVAS = { width: 1000, height: 800 };

function transform(overrides: Partial<GroupTransform> = {}): GroupTransform {
	return { x: 0, y: 0, width: 100, height: 60, rotation: 0, ...overrides };
}

function expectClose(actual: number, expected: number): void {
	expect(actual).toBeCloseTo(expected, 8);
}

describe('group transform geometry', () => {
	it('plans only properties changed by the group operation', () => {
		const current = transform({ anchorX: undefined, anchorY: undefined });
		expect(changedGroupTransformValues(current, { ...current, x: 10, y: -5 })).toEqual({
			x: 10,
			y: -5
		});
		expect(
			changedGroupTransformValues(current, {
				...current,
				width: 200,
				height: 120,
				anchorX: 100,
				anchorY: 60
			})
		).toEqual({ width: 200, height: 120, anchorX: 100, anchorY: 60 });
	});

	it('calculates the exact rotated AABB around a custom anchor', () => {
		const bounds = groupItemBounds(
			transform({ x: 20, y: -30, width: 120, height: 40, anchorX: 0, anchorY: 0, rotation: 90 }),
			CANVAS.width,
			CANVAS.height
		);
		expectClose(bounds.left, 480);
		expectClose(bounds.right, 520);
		expectClose(bounds.top, 370);
		expectClose(bounds.bottom, 490);
	});

	it('enforces the minimum size for every item, including the smallest dimension', () => {
		const input = new Map([
			['wide', transform({ width: 200, height: 40 })],
			['tiny', transform({ width: 30, height: 25 })]
		]);
		const result = scaleGroup(
			initializeGroupTransform(input, CANVAS.width, CANVAS.height),
			0.01,
			CANVAS.width,
			CANVAS.height
		);
		expect(result.get('wide')?.height).toBe(32);
		expect(result.get('tiny')?.width).toBe(24);
		expect(result.get('tiny')?.height).toBe(20);
	});

	it('aligns rotated custom-anchor visual bounds to every canvas edge and center', () => {
		const item = transform({ x: 30, y: 50, anchorX: 0, anchorY: 0, rotation: 30 });
		const cases = [
			['left', 'left', 0],
			['center-horizontal', 'left', CANVAS.width / 2],
			['right', 'right', CANVAS.width],
			['top', 'top', 0],
			['center-vertical', 'top', CANVAS.height / 2],
			['bottom', 'bottom', CANVAS.height]
		] as const;
		for (const [alignment, edge, expected] of cases) {
			const aligned = alignGroupItems(
				new Map([['item', item]]),
				alignment,
				CANVAS.width,
				CANVAS.height
			).get('item')!;
			const bounds = groupItemBounds(aligned, CANVAS.width, CANVAS.height);
			const actual =
				alignment === 'center-horizontal'
					? (bounds.left + bounds.right) / 2
					: alignment === 'center-vertical'
						? (bounds.top + bounds.bottom) / 2
						: bounds[edge];
			expectClose(actual, expected);
		}
	});
});
