export { isFutureSchedule } from './schedule-timezone';

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FocusedSchedulingSettings {
	timezone: string;
	weekStartsOn: WeekStart;
	slotStartHour: number;
	slotEndHour: number;
	slotIntervalMinutes: number;
}

interface WorkspaceSchedulingSettings {
	timezone: string;
	week_start: number;
	slot_start_hour: number;
	slot_end_hour: number;
	slot_interval_minutes: number;
}

export function defaultFocusedSchedulingSettings(): FocusedSchedulingSettings {
	return {
		timezone: 'UTC',
		weekStartsOn: 1,
		slotStartHour: 5,
		slotEndHour: 23,
		slotIntervalMinutes: 15
	};
}

export function snapshotFocusedSchedulingSettings(
	settings: WorkspaceSchedulingSettings
): FocusedSchedulingSettings {
	const defaults = defaultFocusedSchedulingSettings();
	return {
		timezone: settings.timezone || defaults.timezone,
		weekStartsOn: isWeekStart(settings.week_start) ? settings.week_start : defaults.weekStartsOn,
		slotStartHour: boundedInteger(settings.slot_start_hour, 0, 23, defaults.slotStartHour),
		slotEndHour: boundedInteger(settings.slot_end_hour, 0, 23, defaults.slotEndHour),
		slotIntervalMinutes: boundedInteger(
			settings.slot_interval_minutes,
			1,
			60,
			defaults.slotIntervalMinutes
		)
	};
}

export function isFocusedProviderReadinessReady(
	selectedWorkspaceID: string,
	loadedWorkspaceID: string,
	loading: boolean,
	error: string,
	selectedProviders: string[],
	loadedProviders: string[]
): boolean {
	const providerCoverage = new Set(loadedProviders);
	return (
		Boolean(selectedWorkspaceID) &&
		selectedWorkspaceID === loadedWorkspaceID &&
		!loading &&
		!error &&
		selectedProviders.length > 0 &&
		selectedProviders.every((provider) => providerCoverage.has(provider))
	);
}

function isWeekStart(value: number): value is WeekStart {
	return Number.isInteger(value) && value >= 0 && value <= 6;
}

function boundedInteger(value: number, min: number, max: number, fallback: number): number {
	return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
