import { CalendarDate, fromDate } from '@internationalized/date';

export interface ParsedScheduleInput {
	date: CalendarDate;
	time: string;
}

const WEEKDAY_INDEXES = new Map<string, number>([
	['sunday', 0],
	['sun', 0],
	['monday', 1],
	['mon', 1],
	['tuesday', 2],
	['tue', 2],
	['tues', 2],
	['wednesday', 3],
	['wed', 3],
	['thursday', 4],
	['thu', 4],
	['thurs', 4],
	['friday', 5],
	['fri', 5],
	['saturday', 6],
	['sat', 6]
]);

const MONTH_INDEXES = new Map<string, number>([
	['january', 0],
	['jan', 0],
	['february', 1],
	['feb', 1],
	['march', 2],
	['mar', 2],
	['april', 3],
	['apr', 3],
	['may', 4],
	['june', 5],
	['jun', 5],
	['july', 6],
	['jul', 6],
	['august', 7],
	['aug', 7],
	['september', 8],
	['sep', 8],
	['sept', 8],
	['october', 9],
	['oct', 9],
	['november', 10],
	['nov', 10],
	['december', 11],
	['dec', 11]
]);

function toCalendarDate(date: Date, useUTC = false): CalendarDate {
	return new CalendarDate(
		useUTC ? date.getUTCFullYear() : date.getFullYear(),
		(useUTC ? date.getUTCMonth() : date.getMonth()) + 1,
		useUTC ? date.getUTCDate() : date.getDate()
	);
}

function toTime(date: Date, useUTC = false): string {
	const hours = useUTC ? date.getUTCHours() : date.getHours();
	const minutes = useUTC ? date.getUTCMinutes() : date.getMinutes();
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function parsed(date: Date, useUTC = false): ParsedScheduleInput {
	return {
		date: toCalendarDate(date, useUTC),
		time: toTime(date, useUTC)
	};
}

function workspaceWallClock(instant: Date, timeZone: string): Date {
	let zoned: ReturnType<typeof fromDate>;
	try {
		zoned = fromDate(instant, timeZone);
	} catch {
		zoned = fromDate(instant, 'UTC');
	}
	return new Date(
		Date.UTC(
			zoned.year,
			zoned.month - 1,
			zoned.day,
			zoned.hour,
			zoned.minute,
			zoned.second,
			zoned.millisecond
		)
	);
}

function parsedInstant(instant: Date, timeZone: string): ParsedScheduleInput {
	const zoned = fromDate(instant, timeZone);
	return {
		date: new CalendarDate(zoned.year, zoned.month, zoned.day),
		time: `${zoned.hour.toString().padStart(2, '0')}:${zoned.minute.toString().padStart(2, '0')}`
	};
}

function parseTime(input: string): { hour: number; minute: number } | null {
	if (/\bnoon\b/.test(input)) return { hour: 12, minute: 0 };
	if (/\bmidnight\b/.test(input)) return { hour: 0, minute: 0 };

	const matches = Array.from(input.matchAll(/\b(at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g));
	const explicitMatches = matches.filter((match) => !!match[1] || !!match[3] || !!match[4]);
	const match =
		explicitMatches.length > 0
			? explicitMatches[explicitMatches.length - 1]
			: matches[matches.length - 1];
	if (!match) return null;

	let hour = Number.parseInt(match[2], 10);
	const minute = match[3] ? Number.parseInt(match[3], 10) : 0;
	const meridiem = match[4];

	if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
		return null;
	}
	if (meridiem === 'am') {
		if (hour === 12) hour = 0;
	} else if (meridiem === 'pm') {
		if (hour < 12) hour += 12;
	}
	if (hour < 0 || hour > 23) return null;
	return { hour, minute };
}

function applyTime(
	date: Date,
	time: { hour: number; minute: number } | null,
	fallbackHour = 9,
	useUTC = false
) {
	const next = new Date(date);
	if (useUTC) next.setUTCHours(time?.hour ?? fallbackHour, time?.minute ?? 0, 0, 0);
	else next.setHours(time?.hour ?? fallbackHour, time?.minute ?? 0, 0, 0);
	return next;
}

function nextWeekday(
	base: Date,
	targetDay: number,
	forceNext: boolean,
	timeInput: string,
	useUTC = false
): Date {
	const time = parseTime(timeInput);
	let daysUntil = (targetDay - (useUTC ? base.getUTCDay() : base.getDay()) + 7) % 7;
	if (forceNext || daysUntil === 0) {
		const candidate = applyTime(base, time, 9, useUTC);
		if (forceNext || candidate.getTime() <= base.getTime())
			daysUntil = daysUntil === 0 ? 7 : daysUntil;
	}
	const next = new Date(base);
	if (useUTC) next.setUTCDate(base.getUTCDate() + daysUntil);
	else next.setDate(base.getDate() + daysUntil);
	return applyTime(next, time, 9, useUTC);
}

function yearOf(date: Date, useUTC: boolean) {
	return useUTC ? date.getUTCFullYear() : date.getFullYear();
}

function createDate(year: number, month: number, day: number, useUTC: boolean) {
	return useUTC ? new Date(Date.UTC(year, month, day)) : new Date(year, month, day);
}

function isExactDate(date: Date, year: number, month: number, day: number, useUTC: boolean) {
	return (
		yearOf(date, useUTC) === year &&
		(useUTC ? date.getUTCMonth() : date.getMonth()) === month &&
		(useUTC ? date.getUTCDate() : date.getDate()) === day
	);
}

function addCalendarDays(date: Date, days: number, useUTC: boolean) {
	if (useUTC) date.setUTCDate(date.getUTCDate() + days);
	else date.setDate(date.getDate() + days);
}

function addCalendarYears(date: Date, years: number, useUTC: boolean) {
	if (useUTC) date.setUTCFullYear(date.getUTCFullYear() + years);
	else date.setFullYear(date.getFullYear() + years);
}

export function parseNaturalScheduleInput(
	input: string,
	now = new Date(),
	timeZone?: string
): ParsedScheduleInput | null {
	const normalized = input.trim().toLowerCase().replace(/[,]+/g, ' ').replace(/\s+/g, ' ');
	if (!normalized) return null;
	const useUTC = Boolean(timeZone);
	const referenceNow = timeZone ? workspaceWallClock(now, timeZone) : now;

	const relativeMatch = normalized.match(
		/^in\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)$/
	);
	if (relativeMatch) {
		const amount = Number.parseInt(relativeMatch[1], 10);
		const unit = relativeMatch[2];
		if (timeZone && (unit.startsWith('m') || unit.startsWith('h'))) {
			const milliseconds = amount * (unit.startsWith('m') ? 60_000 : 3_600_000);
			return parsedInstant(new Date(now.getTime() + milliseconds), timeZone);
		}
		const next = new Date(referenceNow);
		if (unit.startsWith('m')) next.setMinutes(next.getMinutes() + amount);
		else if (unit.startsWith('h')) next.setHours(next.getHours() + amount);
		else if (unit.startsWith('d')) addCalendarDays(next, amount, useUTC);
		else addCalendarDays(next, amount * 7, useUTC);
		if (useUTC) next.setUTCSeconds(0, 0);
		else next.setSeconds(0, 0);
		return parsed(next, useUTC);
	}

	const tomorrowMatch = /\btomorrow\b/.test(normalized);
	const todayMatch = /\btoday\b/.test(normalized);
	const tonightMatch = /\btonight\b/.test(normalized);
	if (tomorrowMatch || todayMatch || tonightMatch) {
		const next = new Date(referenceNow);
		if (tomorrowMatch) addCalendarDays(next, 1, useUTC);
		const time = parseTime(normalized);
		const fallbackHour = tonightMatch ? 20 : 9;
		const candidate = applyTime(next, time, fallbackHour, useUTC);
		if (!tomorrowMatch && candidate.getTime() <= referenceNow.getTime()) {
			addCalendarDays(candidate, 1, useUTC);
		}
		return parsed(candidate, useUTC);
	}

	const weekdayMatch = normalized.match(
		/\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/
	);
	if (weekdayMatch) {
		const weekday = WEEKDAY_INDEXES.get(weekdayMatch[2]);
		if (weekday !== undefined) {
			return parsed(
				nextWeekday(
					referenceNow,
					weekday,
					!!weekdayMatch[1],
					normalized.replace(weekdayMatch[0], ''),
					useUTC
				),
				useUTC
			);
		}
	}

	const isoDateTimeMatch = normalized.match(
		/\b(\d{4})-(\d{2})-(\d{2})(?:t|\s+)(\d{1,2}):(\d{2})\b/
	);
	if (isoDateTimeMatch) {
		const year = Number.parseInt(isoDateTimeMatch[1], 10);
		const month = Number.parseInt(isoDateTimeMatch[2], 10) - 1;
		const day = Number.parseInt(isoDateTimeMatch[3], 10);
		const hour = Number.parseInt(isoDateTimeMatch[4], 10);
		const minute = Number.parseInt(isoDateTimeMatch[5], 10);
		if (
			month < 0 ||
			month > 11 ||
			day < 1 ||
			day > 31 ||
			hour < 0 ||
			hour > 23 ||
			minute < 0 ||
			minute > 59
		) {
			return null;
		}
		const candidateDate = createDate(year, month, day, useUTC);
		if (!isExactDate(candidateDate, year, month, day, useUTC)) return null;
		return parsed(applyTime(candidateDate, { hour, minute }, 9, useUTC), useUTC);
	}

	const monthMatch = normalized.match(
		/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+(\d{4}))?\b/
	);
	if (monthMatch) {
		const month = MONTH_INDEXES.get(monthMatch[1]);
		const day = Number.parseInt(monthMatch[2], 10);
		const explicitYear = monthMatch[3] ? Number.parseInt(monthMatch[3], 10) : null;
		if (month !== undefined && day >= 1 && day <= 31) {
			const year = explicitYear ?? yearOf(referenceNow, useUTC);
			const candidate = createDate(year, month, day, useUTC);
			if (!isExactDate(candidate, year, month, day, useUTC)) return null;
			const withTime = applyTime(
				candidate,
				parseTime(normalized.replace(monthMatch[0], '')),
				9,
				useUTC
			);
			if (!explicitYear && withTime.getTime() <= referenceNow.getTime()) {
				addCalendarYears(withTime, 1, useUTC);
				if (!isExactDate(withTime, year + 1, month, day, useUTC)) return null;
			}
			return parsed(withTime, useUTC);
		}
	}

	const slashDateMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
	if (slashDateMatch) {
		const month = Number.parseInt(slashDateMatch[1], 10) - 1;
		const day = Number.parseInt(slashDateMatch[2], 10);
		let year = slashDateMatch[3]
			? Number.parseInt(slashDateMatch[3], 10)
			: yearOf(referenceNow, useUTC);
		if (year < 100) year += 2000;
		if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
			const candidateDate = createDate(year, month, day, useUTC);
			if (!isExactDate(candidateDate, year, month, day, useUTC)) return null;
			const candidate = applyTime(
				candidateDate,
				parseTime(normalized.replace(slashDateMatch[0], '')),
				9,
				useUTC
			);
			if (!slashDateMatch[3] && candidate.getTime() <= referenceNow.getTime()) {
				addCalendarYears(candidate, 1, useUTC);
				if (!isExactDate(candidate, year + 1, month, day, useUTC)) return null;
			}
			return parsed(candidate, useUTC);
		}
	}

	const time = parseTime(normalized);
	if (time) {
		const candidate = applyTime(referenceNow, time, 9, useUTC);
		if (candidate.getTime() <= referenceNow.getTime()) {
			addCalendarDays(candidate, 1, useUTC);
		}
		return parsed(candidate, useUTC);
	}

	return null;
}
