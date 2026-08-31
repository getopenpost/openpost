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

	it('translates every anchor by the same world delta', () => {
		const input = new Map([
			['a', transform({ x: -100, y: 30 })],
			['b', transform({ x: 200, y: -40, anchorX: 0 })]
		]);
		const state = initializeGroupTransform(input, CANVAS.width, CANVAS.height);
		const result = translateGroup(state, 17, -23);
		expect(result.get('a')).toMatchObject({ x: -83, y: 7 });
		expect(result.get('b')).toMatchObject({ x: 217, y: -63 });
	});

	it('uniformly scales full custom-anchor geometry around the visual group center', () => {
		const input = new Map([
			['a', transform({ x: -100, width: 80, height: 40, anchorX: 0, anchorY: 10, rotation: 25 })],
			[
				'b',
				transform({
					x: 140,
					y: 60,
					width: 120,
					height: 90,
					anchorX: 100,
					anchorY: 0,
					rotation: -15
				})
			]
		]);
		const state = initializeGroupTransform(input, CANVAS.width, CANVAS.height);
		const before = calculateGroupBounds(input, CANVAS.width, CANVAS.height);
		const result = scaleGroup(state, 1.5, CANVAS.width, CANVAS.height);
		const after = calculateGroupBounds(result, CANVAS.width, CANVAS.height);
		expectClose(after.width, before.width * 1.5);
		expectClose(after.height, before.height * 1.5);
		expectClose((after.left + after.right) / 2, state.center.x);
		expectClose((after.top + after.bottom) / 2, state.center.y);
		expect(result.get('a')).toMatchObject({ width: 120, height: 60, anchorX: 0, anchorY: 15 });
		expect(result.get('b')).toMatchObject({ width: 180, height: 135, anchorX: 150, anchorY: 0 });
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

	it('rotates item anchors and item rotations around the visual group center', () => {
		const input = new Map([
			['left', transform({ x: -100, rotation: 170 })],
			['right', transform({ x: 100, rotation: -170 })]
		]);
		const state = initializeGroupTransform(input, CANVAS.width, CANVAS.height);
		const result = rotateGroup(state, 90, CANVAS.width, CANVAS.height);
		expectClose(result.get('left')!.x, 0);
		expectClose(result.get('left')!.y, -100);
		expectClose(result.get('right')!.x, 0);
		expectClose(result.get('right')!.y, 100);
		expect(result.get('left')?.rotation).toBe(-100);
		expect(result.get('right')?.rotation).toBe(-80);
	});

	it('derives stable scale and wrapped rotation deltas from pointer positions', () => {
		const state = initializeGroupTransform(
			new Map([['a', transform()]]),
			CANVAS.width,
			CANVAS.height
		);
		expect(groupScaleFactor(state, { x: 550, y: 400 }, { x: 600, y: 400 })).toBe(2);
		expect(groupRotationDelta(state, { x: 400, y: 399 }, { x: 400, y: 401 })).toBeCloseTo(
			-1.145877,
			5
		);
	});

	it('snaps group translation and scale without changing internal layout', () => {
		const input = new Map([
			['left', transform({ x: -154, width: 100 })],
			['right', transform({ x: 146, width: 100 })]
		]);
		const moved = snapGroupTranslation({
			transforms: input,
			deltaX: 5,
			deltaY: 0,
			canvasWidth: CANVAS.width,
			canvasHeight: CANVAS.height
		});
		expect(moved.deltaX).toBe(4);
		expect(moved.snapLines).toContainEqual({
			type: 'vertical',
			position: CANVAS.width / 2,
			label: '50%'
		});

		const state = initializeGroupTransform(
			new Map([['item', transform({ width: 490, height: 245 })]]),
			CANVAS.width,
			CANVAS.height
		);
		const scaled = snapGroupScale({
			state,
			scale: 1,
			canvasWidth: CANVAS.width,
			canvasHeight: CANVAS.height
		});
		expect(scaled.scale).toBeCloseTo(500 / 490, 8);
		expect(scaled.snapLines).not.toHaveLength(0);
	});

	it('hit-tests rotated custom-anchor items in local coordinates', () => {
		const item = transform({ width: 120, height: 40, anchorX: 0, anchorY: 0, rotation: 90 });
		expect(groupItemContainsPoint(item, { x: 480, y: 460 }, CANVAS.width, CANVAS.height)).toBe(
			true
		);
		expect(groupItemContainsPoint(item, { x: 520, y: 460 }, CANVAS.width, CANVAS.height)).toBe(
			false
		);
	});

	it('includes animated scale when measuring and hit-testing an item', () => {
		const transform = {
			x: 0,
			y: 0,
			width: 100,
			height: 40,
			rotation: 0,
			scaleX: 2,
			scaleY: 0.5
		};
		expect(groupItemBounds(transform, 800, 400)).toMatchObject({
			left: 300,
			right: 500,
			top: 190,
			bottom: 210
		});
		expect(groupItemContainsPoint(transform, { x: 495, y: 200 }, 800, 400)).toBe(true);
		expect(groupItemContainsPoint(transform, { x: 400, y: 215 }, 800, 400)).toBe(false);
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

	it('distributes unequal rotated bounds by equal edge gaps without moving endpoints', () => {
		const input = new Map([
			['first', transform({ x: -300, width: 80, rotation: 20 })],
			['middle', transform({ x: -40, width: 180, anchorX: 0, rotation: -30 })],
			['last', transform({ x: 320, width: 120, rotation: 10 })]
		]);
		const result = alignGroupItems(input, 'distribute-horizontal', CANVAS.width, CANVAS.height);
		expect(result.get('first')).toEqual(input.get('first'));
		expect(result.get('last')).toEqual(input.get('last'));
		const bounds = [...result.values()]
			.map((entry) => groupItemBounds(entry, CANVAS.width, CANVAS.height))
			.sort((left, right) => left.left - right.left);
		expectClose(bounds[1]!.left - bounds[0]!.right, bounds[2]!.left - bounds[1]!.right);
	});
});
