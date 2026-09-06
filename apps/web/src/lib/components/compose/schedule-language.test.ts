import { describe, expect, it } from 'vitest';
import { parseNaturalScheduleInput } from './schedule-language';

const base = new Date(2026, 6, 6, 10, 15, 0, 0);

describe('parseNaturalScheduleInput', () => {
	it('parses tomorrow with a meridiem time', () => {
		const parsed = parseNaturalScheduleInput('tomorrow at 9am', base);

		expect(parsed?.date.toString()).toBe('2026-07-07');
		expect(parsed?.time).toBe('09:00');
	});

	it('uses elapsed time for relative hours across workspace DST changes', () => {
		const springForward = parseNaturalScheduleInput(
			'in 3 hours',
			new Date('2026-03-08T06:30:00.000Z'),
			'America/New_York'
		);
		const fallBack = parseNaturalScheduleInput(
			'in 3 hours',
			new Date('2026-11-01T04:30:00.000Z'),
			'America/New_York'
		);

		expect(springForward?.date.toString()).toBe('2026-03-08');
		expect(springForward?.time).toBe('05:30');
		expect(fallBack?.date.toString()).toBe('2026-11-01');
		expect(fallBack?.time).toBe('02:30');
	});

	it('rolls a plain past time to tomorrow', () => {
		const parsed = parseNaturalScheduleInput('9:30', base);

		expect(parsed?.date.toString()).toBe('2026-07-07');
		expect(parsed?.time).toBe('09:30');
	});

	it('keeps workspace calendar-day arithmetic independent of device DST', () => {
		const parsed = parseNaturalScheduleInput(
			'in 1 day',
			new Date('2026-03-28T05:30:00.000Z'),
			'America/New_York'
		);

		expect(parsed?.date.toString()).toBe('2026-03-29');
		expect(parsed?.time).toBe('01:30');
	});

	it('rejects calendar dates that normalize into another month', () => {
		expect(parseNaturalScheduleInput('February 31 2026 at 9am', base)).toBeNull();
		expect(parseNaturalScheduleInput('02/31/2026 9am', base)).toBeNull();
	});
});
