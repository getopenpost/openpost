import { describe, expect, it } from 'vitest';
import { getBrowserMediaPlaybackRate, getNextShuttleRate } from './shuttle';

describe('shuttle', () => {
	it('advances forward rates 1 -> 2 -> 4 and clamps', () => {
		expect(getNextShuttleRate(1, 1)).toBe(2);
		expect(getNextShuttleRate(2, 1)).toBe(4);
		expect(getNextShuttleRate(4, 1)).toBe(4);
	});

	it('advances reverse rates -1 -> -2 -> -4 and clamps', () => {
		expect(getNextShuttleRate(-1, -1)).toBe(-2);
		expect(getNextShuttleRate(-2, -1)).toBe(-4);
		expect(getNextShuttleRate(-4, -1)).toBe(-4);
	});

	it('resets to direction when switching direction', () => {
		expect(getNextShuttleRate(2, -1)).toBe(-1);
		expect(getNextShuttleRate(-2, 1)).toBe(1);
		expect(getNextShuttleRate(0, 1)).toBe(1);
	});

	it('clamps browser playback rate to positive authored * transport', () => {
		expect(getBrowserMediaPlaybackRate(1, -1)).toBe(1);
		expect(getBrowserMediaPlaybackRate(2, 2)).toBe(4);
		expect(getBrowserMediaPlaybackRate(0.5, 4)).toBe(2);
		expect(getBrowserMediaPlaybackRate(10, 10)).toBe(16);
		expect(getBrowserMediaPlaybackRate(0.01, 0.01)).toBe(0.0625);
	});
});
