import { describe, expect, it } from 'vitest';
import { paddedMetricDomain } from './analytics-chart';

describe('paddedMetricDomain', () => {
	it('keeps follower changes legible instead of forcing the chart to zero', () => {
		expect(paddedMetricDomain([6680, 6712, 6704])).toEqual([6676, 6716]);
	});

	it('adds a useful range when every measurement is the same', () => {
		expect(paddedMetricDomain([5000, 5000])).toEqual([4950, 5050]);
	});

	it('never creates a negative follower axis', () => {
		expect(paddedMetricDomain([0, 2])).toEqual([0, 3]);
	});
});
