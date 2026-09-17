import { describe, expect, it } from 'vitest';
import {
	estimateLabelWidthPx,
	longestLabel,
	measureLabelWidthPx,
	widestMenuWidthPx
} from './menu-measure';

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

describe('measureLabelWidthPx', () => {
	it('falls back to the estimator without a document', () => {
		expect(measureLabelWidthPx('Original')).toBe(estimateLabelWidthPx('Original'));
	});
});

describe('widestMenuWidthPx', () => {
	it('fits the longest option plus trigger chrome', () => {
		const labels = ['MP4', 'PNG SEQUENCE', 'Audio only: voiceover'];
		const width = widestMenuWidthPx(labels);
		expect(width).toBe(estimateLabelWidthPx('Audio only: voiceover') + 22);
		expect(width).toBeGreaterThan(widestMenuWidthPx(['MP4']));
	});

	it('never shifts when the selected value changes', () => {
		const labels = ['VP9', 'H.264'];
		expect(widestMenuWidthPx(labels)).toBe(widestMenuWidthPx([...labels].reverse()));
	});
});
