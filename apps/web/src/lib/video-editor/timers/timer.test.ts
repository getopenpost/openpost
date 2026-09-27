import { expect, it } from 'vitest';
import { timerValue, type TimerSettings } from './timer';
const down: TimerSettings = {
	style: 'ring',
	direction: 'down',
	format: 'clock'
};
it('counts actual seconds when a timer is resized and shows its finish on the final frame', () => {
	expect(timerValue(down, 0, 1350, 30).text).toBe('00:45');
	expect(timerValue(down, 30, 1350, 30).text).toBe('00:44');
	expect(timerValue(down, 30, 1800, 30).text).toBe('00:59');
	expect(timerValue({ ...down, finishText: 'GO' }, 1799, 1800, 30).text).toBe('GO');
});
it('supports count-up and percentage without wall-clock state', () => {
	expect(timerValue({ ...down, direction: 'up' }, 1500, 3000, 25).text).toBe('01:00');
	expect(timerValue({ ...down, direction: 'up', format: 'percent' }, 50, 101, 30).text).toBe('50%');
	expect(timerValue({ ...down, format: 'percent' }, 100, 101, 30).text).toBe('0%');
	expect(timerValue({ ...down, direction: 'up' }, 2999, 3000, 25).text).toBe('02:00');
});
it('holds completion without speeding up seconds', () => {
	const settings = { ...down, finishHoldSeconds: 0.5, finishText: 'GO' };
	expect(timerValue(settings, 0, 1365, 30).text).toBe('00:45');
	expect(timerValue(settings, 30, 1365, 30).text).toBe('00:44');
	expect(timerValue(settings, 1349, 1365, 30).text).toBe('00:01');
	for (const frame of [1350, 1357, 1364])
		expect(timerValue(settings, frame, 1365, 30).text).toBe('GO');
});
it('keeps a trimmed clip shorter than its saved finish hold nonnegative', () => {
	const settings = {
		...down,
		format: 'seconds' as const,
		finishHoldSeconds: 5
	};
	expect(timerValue(settings, 0, 30, 30).text).toBe('1');
	expect(timerValue(settings, 29, 30, 30).text).toBe('0');
});
