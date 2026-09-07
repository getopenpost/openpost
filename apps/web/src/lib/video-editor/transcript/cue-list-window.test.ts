import { describe, expect, it } from 'vitest';
import {
	buildCueListLayout,
	queryCueListWindow,
	TRANSCRIPT_CUE_OVERSCAN_ROWS,
	TRANSCRIPT_CUE_ROW_ESTIMATE_PX
} from './cue-list-window';

function cueKeys(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `subtitle-${index}:cue-${index}`);
}

describe('transcript cue-list window', () => {
	it('uses the shared row-height estimate as its layout seed', () => {
		expect(TRANSCRIPT_CUE_ROW_ESTIMATE_PX).toBe(116);
		const layout = buildCueListLayout(cueKeys(3));
		expect(layout.totalSize).toBe(3 * TRANSCRIPT_CUE_ROW_ESTIMATE_PX);
	});

	it('windows a 600-cue episode down to the visible rows plus overscan', () => {
		const layout = buildCueListLayout(cueKeys(600));
		const viewportHeight = 400;
		const window = queryCueListWindow(layout, 0, viewportHeight);
		const rendered = window.endIndex - window.startIndex;
		// Visible rows plus overscan stay far below the full cue count.
		expect(rendered).toBeLessThan(600);
		expect(rendered).toBeLessThanOrEqual(
			Math.ceil(viewportHeight / TRANSCRIPT_CUE_ROW_ESTIMATE_PX) +
				TRANSCRIPT_CUE_OVERSCAN_ROWS * 2 +
				2
		);
		expect(window.beforeSize).toBe(0);
		expect(window.afterSize).toBeGreaterThan(0);
		expect(window.beforeSize + window.afterSize).toBeLessThanOrEqual(layout.totalSize);
	});

	it('advances the window while keeping spacers consistent mid-list', () => {
		const layout = buildCueListLayout(cueKeys(600));
		const window = queryCueListWindow(layout, 10_000, 400);
		expect(window.startIndex).toBeGreaterThan(0);
		expect(window.endIndex).toBeGreaterThan(window.startIndex);
		expect(window.endIndex - window.startIndex).toBeLessThan(600);
		expect(window.beforeSize).toBe(layout.offsets[window.startIndex]);
		expect(window.beforeSize + window.afterSize).toBeLessThanOrEqual(layout.totalSize);
	});

	it('renders an empty cue list as an empty window', () => {
		const layout = buildCueListLayout([]);
		expect(queryCueListWindow(layout, 0, 400)).toMatchObject({
			startIndex: 0,
			endIndex: 0,
			beforeSize: 0,
			afterSize: 0
		});
	});
});
