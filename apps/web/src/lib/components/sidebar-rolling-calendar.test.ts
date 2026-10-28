import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@internationalized/date';
import { buildRollingCalendarWeeks } from './sidebar-rolling-calendar';

describe('sidebar rolling calendar', () => {
	const today = new CalendarDate(2026, 7, 28);

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
		// Sunday-first build starts on the Sunday of the current week...
		expect(weeks[0][0].key).toBe('2026-07-26');
		// ...and only rolls forward from there.
		expect(weeks[4][0].key).toBe('2026-08-23');
		expect(weeks.flat().filter((day) => day.today)).toHaveLength(1);
	});
});
