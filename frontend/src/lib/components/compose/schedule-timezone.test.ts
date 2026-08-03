import { CalendarDate } from '@internationalized/date';
import { describe, expect, it } from 'vitest';
import {
	isFutureSchedule,
	workspaceClock,
	workspaceDateKeyFromISO,
	workspaceScheduleFromISO,
	workspaceScheduleMoveToDate,
	workspaceScheduleToISO
} from './schedule-timezone';

describe('workspaceScheduleToISO', () => {
	it('uses the workspace timezone instead of the device timezone', () => {
		expect(workspaceScheduleToISO(new CalendarDate(2026, 7, 20), '09:00', 'Europe/Lisbon')).toBe(
			'2026-07-20T08:00:00.000Z'
		);
		expect(workspaceScheduleToISO(new CalendarDate(2026, 1, 15), '09:00', 'America/New_York')).toBe(
			'2026-01-15T14:00:00.000Z'
		);
	});

	it('handles daylight-saving gaps and repeated times consistently', () => {
		expect(
			workspaceScheduleToISO(new CalendarDate(2026, 3, 8), '02:30', 'America/New_York')
		).toBeUndefined();
		expect(workspaceScheduleToISO(new CalendarDate(2026, 11, 1), '01:30', 'America/New_York')).toBe(
			'2026-11-01T05:30:00.000Z'
		);
	});

	it('rejects malformed times', () => {
		expect(workspaceScheduleToISO(new CalendarDate(2026, 7, 20), '24:00', 'UTC')).toBeUndefined();
		expect(workspaceScheduleToISO(new CalendarDate(2026, 7, 20), '9:00', 'UTC')).toBeUndefined();
	});

	it('fails safely when persisted workspace timezone data is invalid', () => {
		expect(
			workspaceScheduleToISO(new CalendarDate(2026, 7, 20), '09:00', 'Bad/Zone')
		).toBeUndefined();
		expect(workspaceScheduleFromISO('2026-07-20T08:00:00.000Z', 'Bad/Zone')).toBeUndefined();
		expect(workspaceClock('Bad/Zone', new Date('2026-07-20T08:00:00.000Z'))).toEqual({
			date: new CalendarDate(2026, 7, 20),
			minutes: 8 * 60
		});
	});

	it('restores an API instant as workspace-local editor fields', () => {
		expect(workspaceScheduleFromISO('2026-07-20T08:00:00.000Z', 'Europe/Lisbon')).toEqual({
			date: new CalendarDate(2026, 7, 20),
			time: '09:00'
		});
		expect(workspaceScheduleFromISO('2026-07-20T08:00:00.000Z', 'America/New_York')).toEqual({
			date: new CalendarDate(2026, 7, 20),
			time: '04:00'
		});
	});

	it('derives today and current minutes from the workspace clock', () => {
		const instant = new Date('2026-07-20T23:30:00.000Z');

		expect(workspaceClock('Europe/Lisbon', instant)).toMatchObject({
			date: new CalendarDate(2026, 7, 21),
			minutes: 30
		});
		expect(workspaceClock('America/New_York', instant)).toMatchObject({
			date: new CalendarDate(2026, 7, 20),
			minutes: 19 * 60 + 30
		});
	});

	it('groups API instants by the workspace-local date', () => {
		expect(workspaceDateKeyFromISO('2026-07-20T23:30:00.000Z', 'Europe/Lisbon')).toBe('2026-07-21');
		expect(workspaceDateKeyFromISO('2026-07-20T23:30:00.000Z', 'America/New_York')).toBe(
			'2026-07-20'
		);
	});

	it('moves an instant by workspace-local date and preserves its wall time', () => {
		expect(
			workspaceScheduleMoveToDate(
				'2026-07-20T22:15:27.400Z',
				new CalendarDate(2026, 7, 22),
				'Europe/Lisbon'
			)
		).toBe('2026-07-22T22:15:27.400Z');
	});

	it('rejects a moved wall time that is no longer in the future', () => {
		const moved = workspaceScheduleMoveToDate(
			'2026-07-21T08:00:00.000Z',
			new CalendarDate(2026, 7, 20),
			'UTC'
		);

		expect(moved).toBe('2026-07-20T08:00:00.000Z');
		expect(isFutureSchedule(moved!, Date.parse('2026-07-20T12:00:00.000Z'))).toBe(false);
	});
});
