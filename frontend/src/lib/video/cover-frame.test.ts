import { describe, expect, it } from 'vitest';
import { clampCoverFrameTimestamp, formatCoverFrameTimestamp } from './cover-frame';

describe('cover-frame helpers', () => {
	it('clamps timestamps inside the available video range', () => {
		expect(clampCoverFrameTimestamp(-50, 10_000)).toBe(0);
		expect(clampCoverFrameTimestamp(5_432.4, 10_000)).toBe(5_432);
		expect(clampCoverFrameTimestamp(12_000, 10_000)).toBe(9_999);
	});

	it('formats short and long timestamps', () => {
		expect(formatCoverFrameTimestamp(65_900)).toBe('1:05');
		expect(formatCoverFrameTimestamp(3_665_000)).toBe('1:01:05');
	});
});
