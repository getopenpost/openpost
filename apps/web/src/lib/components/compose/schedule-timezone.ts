import {
	CalendarDate,
	Time,
	fromDate,
	toCalendarDateTime,
	type DateValue
} from '@internationalized/date';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface WorkspaceClock {
	date: CalendarDate;
	minutes: number;
}

/** Converts a workspace-local wall time into the absolute instant sent to the API. */
export function workspaceScheduleToISO(
	date: DateValue,
	time: string,
	timeZone: string
): string | undefined {
	if (!TIME_PATTERN.test(time)) return undefined;

	try {
		const [hours, minutes] = time.split(':').map(Number);
		const dateTime = toCalendarDateTime(date, new Time(hours, minutes));
		const instant = dateTime.toDate(timeZone, 'earlier');
		const resolved = fromDate(instant, timeZone);
		if (
			resolved.year !== date.year ||
			resolved.month !== date.month ||
			resolved.day !== date.day ||
			resolved.hour !== hours ||
			resolved.minute !== minutes
		) {
			return undefined;
		}
		return instant.toISOString();
	} catch {
		return undefined;
	}
}

export function workspaceScheduleFromISO(
	value: string,
	timeZone: string
): { date: CalendarDate; time: string } | undefined {
	const instant = new Date(value);
	if (!Number.isFinite(instant.getTime())) return undefined;

	try {
		const zoned = fromDate(instant, timeZone);
		return {
			date: new CalendarDate(zoned.year, zoned.month, zoned.day),
			time: `${zoned.hour.toString().padStart(2, '0')}:${zoned.minute.toString().padStart(2, '0')}`
		};
	} catch {
		return undefined;
	}
}

export function workspaceClock(timeZone: string, instant = new Date()): WorkspaceClock {
	let zoned: ReturnType<typeof fromDate>;
	try {
		zoned = fromDate(instant, timeZone);
	} catch {
		zoned = fromDate(instant, 'UTC');
	}
	return {
		date: new CalendarDate(zoned.year, zoned.month, zoned.day),
		minutes: zoned.hour * 60 + zoned.minute
	};
}

/** Returns the workspace-local calendar date for an absolute API instant. */
export function workspaceDateKeyFromISO(value: string, timeZone: string): string | undefined {
	return workspaceScheduleFromISO(value, timeZone)?.date.toString();
}

/** Returns true only when an API schedule instant is strictly after now. */
export function isFutureSchedule(scheduledAt: string, now = Date.now()): boolean {
	const timestamp = Date.parse(scheduledAt);
	return Number.isFinite(timestamp) && timestamp > now;
}

/** Moves an API instant to another workspace-local date while preserving its wall time. */
export function workspaceScheduleMoveToDate(
	value: string,
	date: DateValue,
	timeZone: string
): string | undefined {
	const source = workspaceScheduleFromISO(value, timeZone);
	if (!source) return undefined;

	const moved = workspaceScheduleToISO(date, source.time, timeZone);
	if (!moved) return undefined;

	const sourceInstant = new Date(value);
	const movedInstant = new Date(moved);
	movedInstant.setUTCSeconds(sourceInstant.getUTCSeconds(), sourceInstant.getUTCMilliseconds());
	return movedInstant.toISOString();
}
