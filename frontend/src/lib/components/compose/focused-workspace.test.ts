import { describe, expect, it } from 'vitest';
import {
	defaultFocusedSchedulingSettings,
	isFocusedProviderReadinessReady,
	isFutureSchedule,
	snapshotFocusedSchedulingSettings
} from './focused-workspace';

describe('focused composer workspace scheduling state', () => {
	it('keeps an immutable scheduling snapshot when the global workspace settings change', () => {
		const workspaceSettings = {
			timezone: 'Europe/Lisbon',
			week_start: 1,
			slot_start_hour: 8,
			slot_end_hour: 18,
			slot_interval_minutes: 30
		};
		const snapshot = snapshotFocusedSchedulingSettings(workspaceSettings);

		workspaceSettings.timezone = 'America/New_York';
		workspaceSettings.slot_start_hour = 5;

		expect(snapshot).toEqual({
			timezone: 'Europe/Lisbon',
			weekStartsOn: 1,
			slotStartHour: 8,
			slotEndHour: 18,
			slotIntervalMinutes: 30
		});
	});

	it('falls back to safe slot settings when persisted values are invalid', () => {
		expect(
			snapshotFocusedSchedulingSettings({
				timezone: '',
				week_start: 9,
				slot_start_hour: -1,
				slot_end_hour: 25,
				slot_interval_minutes: 0
			})
		).toEqual(defaultFocusedSchedulingSettings());
	});

	it('accepts only a valid instant strictly after now', () => {
		const now = Date.parse('2026-07-20T12:00:00.000Z');

		expect(isFutureSchedule('2026-07-20T12:00:00.001Z', now)).toBe(true);
		expect(isFutureSchedule('2026-07-20T12:00:00.000Z', now)).toBe(false);
		expect(isFutureSchedule('2026-07-20T11:59:59.999Z', now)).toBe(false);
		expect(isFutureSchedule('not-a-date', now)).toBe(false);
	});

	it('fails provider readiness closed until the selected workspace succeeds', () => {
		expect(isFocusedProviderReadinessReady('workspace-a', '', false, '', ['x'], ['x'])).toBe(false);
		expect(
			isFocusedProviderReadinessReady('workspace-a', 'workspace-a', true, '', ['x'], ['x'])
		).toBe(false);
		expect(
			isFocusedProviderReadinessReady(
				'workspace-a',
				'workspace-a',
				false,
				'Request failed',
				['x'],
				['x']
			)
		).toBe(false);
		expect(
			isFocusedProviderReadinessReady('workspace-b', 'workspace-a', false, '', ['x'], ['x'])
		).toBe(false);
		expect(
			isFocusedProviderReadinessReady('workspace-a', 'workspace-a', false, '', [], ['x'])
		).toBe(false);
		expect(
			isFocusedProviderReadinessReady(
				'workspace-a',
				'workspace-a',
				false,
				'',
				['x', 'linkedin'],
				['x']
			)
		).toBe(false);
		expect(
			isFocusedProviderReadinessReady(
				'workspace-a',
				'workspace-a',
				false,
				'',
				['x', 'linkedin'],
				['linkedin', 'x']
			)
		).toBe(true);
	});
});
