import { describe, expect, it } from 'vitest';
import { fitTimelineItemDuration, layoutTimelineIntervals } from './timeline-layout';

describe('video editor timeline interval layout', () => {
	it('stacks simultaneous items into separate hit-test lanes', () => {
		const layout = layoutTimelineIntervals(
			[
				{ id: 'title', start_us: 0, duration_us: 5_000_000 },
				{ id: 'annotation', start_us: 0, duration_us: 3_000_000 },
				{ id: 'image', start_us: 0, duration_us: 5_000_000 }
			],
			5_000_000,
			500,
			48
		);

		expect(layout.lane_count).toBe(3);
		expect(new Set([...layout.placements.values()].map((item) => item.lane)).size).toBe(3);
	});

	it('accounts for minimum-width controls when short items are adjacent', () => {
		const layout = layoutTimelineIntervals(
			[
				{ id: 'a', start_us: 0, duration_us: 10_000 },
				{ id: 'b', start_us: 20_000, duration_us: 10_000 },
				{ id: 'c', start_us: 600_000, duration_us: 100_000 }
			],
			1_000_000,
			100,
			48
		);

		expect(layout.placements.get('a')?.lane).not.toBe(layout.placements.get('b')?.lane);
		expect(layout.placements.get('c')?.lane).toBe(0);
	});

	it('trims a long audio bed to the remaining visual project duration', () => {
		expect(fitTimelineItemDuration(9_600_000, 5_000_000, 0)).toEqual({
			duration_us: 5_000_000,
			trimmed: true
		});
		expect(fitTimelineItemDuration(2_000_000, 5_000_000, 1_000_000)).toEqual({
			duration_us: 2_000_000,
			trimmed: false
		});
	});
});
