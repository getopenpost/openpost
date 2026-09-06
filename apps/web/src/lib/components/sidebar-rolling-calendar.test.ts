import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@internationalized/date';
import { buildRollingCalendarWeeks, startOfCalendarWeek } from './sidebar-rolling-calendar';

describe('sidebar rolling calendar', () => {
	const today = new CalendarDate(2026, 7, 28);

	it('starts with the week containing today', () => {
		expect(startOfCalendarWeek(today, 0).toString()).toBe('2026-07-26');
		expect(startOfCalendarWeek(today, 1).toString()).toBe('2026-07-27');
	});

	it('keeps earlier days in the current week visible but disabled', () => {
		const weeks = buildRollingCalendarWeeks(today, 1, 5);
		expect(weeks).toHaveLength(5);
		expect(weeks[0].map((day) => day.key)).toEqual([
			'2026-07-27',
			'2026-07-28',
			'2026-07-29',
			'2026-07-30',
			'2026-07-31',
			'2026-08-01',
			'2026-08-02'
		]);
		expect(weeks[0][0]).toMatchObject({ past: true, today: false });
		expect(weeks[0][1]).toMatchObject({ past: false, today: true });
		expect(weeks[0][2]).toMatchObject({ past: false, today: false });
	});

	it('only generates forward weeks after the current week', () => {
		const weeks = buildRollingCalendarWeeks(today, 0, 5);
		expect(weeks[4][0].key).toBe('2026-08-23');
		expect(weeks.flat().filter((day) => day.today)).toHaveLength(1);
	});
});
