import { describe, expect, it } from 'vitest';
import {
	calendarDragRotation,
	calendarDragVisualPosition,
	calendarEdgeScrollVelocity,
	resolveWeekCalendarTarget
} from './calendar-drag';

const weekGeometry = {
	grid: { left: 100, top: 200, width: 1_120, height: 1_920 },
	gutterWidth: 72,
	hourHeight: 80,
	targetHeight: 36
};

describe('week calendar drag geometry', () => {
	it('maps pointer position to a deterministic 15-minute slot', () => {
		const target = resolveWeekCalendarTarget({ x: 396, y: 905 }, weekGeometry);

		expect(target).toMatchObject({ dayIndex: 1, minutes: 525 });
		expect(target?.time).toBe('08:45');
		expect(target?.left).toBeCloseTo(325.71, 1);
		expect(target?.top).toBe(902);
	});

	it('clamps targets to the first and last available slots', () => {
		expect(resolveWeekCalendarTarget({ x: -200, y: -100 }, weekGeometry)).toMatchObject({
			dayIndex: 0,
			minutes: 0
		});
		expect(resolveWeekCalendarTarget({ x: 2_000, y: 4_000 }, weekGeometry)).toMatchObject({
			dayIndex: 6,
			minutes: 1_425
		});
	});
});

describe('week calendar drag motion', () => {
	it('uses velocity for restrained presentation without changing the target', () => {
		expect(calendarDragRotation(1_500)).toBe(8);
		expect(calendarDragRotation(-1_500)).toBe(-8);
		expect(calendarDragRotation(0)).toBe(0);
		expect(
			calendarDragVisualPosition({ x: 500, y: 400 }, { x: 25, y: 12 }, { x: 1_500, y: -1_500 })
		).toEqual({ x: 465, y: 394 });
	});

	it('accelerates autoscroll only inside the top and bottom edge zones', () => {
		const scrollBounds = { top: 100, bottom: 700 };

		expect(calendarEdgeScrollVelocity(400, scrollBounds)).toBe(0);
		expect(calendarEdgeScrollVelocity(100, scrollBounds)).toBe(-720);
		expect(calendarEdgeScrollVelocity(700, scrollBounds)).toBe(720);
		expect(calendarEdgeScrollVelocity(130, scrollBounds)).toBeLessThan(0);
	});
});
