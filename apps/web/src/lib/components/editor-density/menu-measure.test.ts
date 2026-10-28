import { describe, expect, it } from 'vitest';
import { estimateLabelWidthPx, longestLabel, widestMenuWidthPx } from './menu-measure';

describe('longestLabel', () => {
	it('returns the longest label and keeps the first on ties', () => {
		expect(longestLabel(['Fit', 'Original', '16:9'])).toBe('Original');
		expect(longestLabel(['ab', 'cd'])).toBe('ab');
		expect(longestLabel([])).toBe('');
	});
});

describe('estimateLabelWidthPx', () => {
	it('grows monotonically with label length', () => {
		const short = estimateLabelWidthPx('Fit');
		const long = estimateLabelWidthPx('Audio only: voiceover');
		expect(long).toBeGreaterThan(short);
		expect(estimateLabelWidthPx('')).toBe(0);
	});
});

describe('widestMenuWidthPx', () => {
	it('fits the longest option plus trigger chrome', () => {
		const labels = ['MP4', 'PNG SEQUENCE', 'Audio only: voiceover'];
		const width = widestMenuWidthPx(labels);
		// Independent expectation: ceil(21 chars * 11px * 0.58) = 134, plus the
		// 22px trigger chrome. Comparing against the estimator would let a broken
		// estimator satisfy both sides.
		expect(width).toBe(156);
		expect(width).toBeGreaterThan(widestMenuWidthPx(['MP4']));
	});

	it('never shifts when the selected value changes', () => {
		const labels = ['VP9', 'H.264'];
		expect(widestMenuWidthPx(labels)).toBe(widestMenuWidthPx([...labels].reverse()));
	});
});
