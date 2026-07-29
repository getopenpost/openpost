import { CalendarDate } from '@internationalized/date';

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RollingCalendarDay {
	date: CalendarDate;
	key: string;
	today: boolean;
	past: boolean;
}

function dayOfWeek(date: CalendarDate): number {
	return date.toDate('UTC').getUTCDay();
}

export function startOfCalendarWeek(date: CalendarDate, weekStartsOn: WeekStart): CalendarDate {
	const daysSinceWeekStart = (dayOfWeek(date) - weekStartsOn + 7) % 7;
	return date.subtract({ days: daysSinceWeekStart });
}

export function buildRollingCalendarWeeks(
	today: CalendarDate,
	weekStartsOn: WeekStart,
	weekCount: number
): RollingCalendarDay[][] {
	const firstDay = startOfCalendarWeek(today, weekStartsOn);
	return Array.from({ length: Math.max(0, weekCount) }, (_, weekIndex) =>
		Array.from({ length: 7 }, (_, dayIndex) => {
			const date = firstDay.add({ days: weekIndex * 7 + dayIndex });
			return {
				date,
				key: date.toString(),
				today: date.compare(today) === 0,
				past: date.compare(today) < 0
			};
		})
	);
}
