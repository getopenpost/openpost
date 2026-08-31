import { describe, expect, it } from 'vitest';
import {
	buildPriorityIndices,
	buildTargetIndices,
	computeFilmstripTiles,
	fitFilmstripFrameSize,
	getBackgroundStride,
	getTargetFrameBudget,
	prioritizeFilmstripTargetIndices,
	visibleFilmstripTargetIndices
} from './filmstrip-plan';

describe('fitFilmstripFrameSize', () => {
	it('preserves aspect ratio inside the budget', () => {
		const size = fitFilmstripFrameSize(1920, 1080, 178, 100);
		expect(size.height).toBe(100);
		expect(size.width).toBeCloseTo(178, 0);
	});

	it('falls back to the budget for unusable sources', () => {
		expect(fitFilmstripFrameSize(0, 0, 178, 100)).toEqual({
			width: 178,
			height: 100
		});
	});
});

describe('getTargetFrameBudget', () => {
	it('extracts every frame for short clips', () => {
		expect(getTargetFrameBudget(30)).toBe(30);
	});

	it('caps long clips at the sqrt-scaled budget', () => {
		const budget = getTargetFrameBudget(3600);
		expect(budget).toBeGreaterThanOrEqual(40);
		expect(budget).toBeLessThanOrEqual(72);
	});

	it('honors an explicit smaller target', () => {
		expect(getTargetFrameBudget(3600, 10)).toBe(10);
	});
});

describe('getBackgroundStride', () => {
	it('samples short clips densely and long clips sparsely', () => {
		// Thresholds are inclusive (<=), matching FreeCut.
		expect(getBackgroundStride(300)).toBe(1);
		expect(getBackgroundStride(301)).toBe(2);
		expect(getBackgroundStride(1201)).toBe(3);
		expect(getBackgroundStride(2401)).toBe(4);
	});
});

describe('buildTargetIndices', () => {
	it('always includes both endpoints', () => {
		const targets = buildTargetIndices(600, null);
		expect(targets[0]).toBe(0);
		expect(targets[targets.length - 1]).toBe(599);
	});

	it('stays within the budget for hour-long clips', () => {
		const targets = buildTargetIndices(3600, null);
		expect(targets.length).toBeLessThanOrEqual(getTargetFrameBudget(3600));
	});

	it('prioritizes the visible window densely', () => {
		const targets = buildTargetIndices(600, { startIndex: 10, endIndex: 20 });
		for (let i = 10; i < 20; i++) expect(targets).toContain(i);
	});

	it('always includes exact viewport targets even when the background budget is full', () => {
		const exactTargets = [101, 203, 307, 409];
		const targets = buildTargetIndices(3600, null, 2, exactTargets);
		for (const index of exactTargets) expect(targets).toContain(index);
	});

	it('returns everything for tiny clips regardless of range', () => {
		expect(buildTargetIndices(5, null)).toEqual([0, 1, 2, 3, 4]);
	});
});

describe('prioritizeFilmstripTargetIndices', () => {
	it('decodes exact viewport frames before the background sample', () => {
		expect(prioritizeFilmstripTargetIndices([0, 100, 200, 300], [200, 100])).toEqual([
			200, 100, 0, 300
		]);
	});
});

describe('computeFilmstripTiles', () => {
	it('positions whole tiles at one-second pitch', () => {
		const frames = [
			{ index: 0, url: 'u0' },
			{ index: 1, url: 'u1' },
			{ index: 2, url: 'u2' }
		];
		const tiles = computeFilmstripTiles(frames, 0, 3, 300);
		expect(tiles.map((tile) => tile.x)).toEqual([0, 100, 200]);
		expect(tiles.every((tile) => tile.width === 100)).toBe(true);
	});

	it('clips tiles to the trimmed window', () => {
		const frames = [
			{ index: 0, url: null },
			{ index: 1, url: null }
		];
		const tiles = computeFilmstripTiles(frames, 0.5, 1.5, 150);
		expect(tiles).toHaveLength(2);
		expect(tiles[0]?.x).toBe(0);
		expect(tiles[0]?.width).toBe(50);
		expect(tiles[1]?.x).toBe(50);
		expect(tiles[1]?.width).toBe(100);
	});

	it('mirrors tile positions and order for reversed playback', () => {
		const frames = [0, 1, 2].map((index) => ({ index, url: `frame-${index}` }));
		const tiles = computeFilmstripTiles(frames, 0, 3, 300, true);
		expect(tiles.map((tile) => ({ index: tile.index, x: tile.x }))).toEqual([
			{ index: 2, x: 0 },
			{ index: 1, x: 100 },
			{ index: 0, x: 200 }
		]);
	});

	it('drops tiles outside the window and rejects unusable input', () => {
		const frames = [{ index: 5, url: null }];
		expect(computeFilmstripTiles(frames, 0, 2, 200)).toEqual([]);
		expect(computeFilmstripTiles(frames, 0, 0, 200)).toEqual([]);
		expect(computeFilmstripTiles(frames, 0, 2, 0)).toEqual([]);
	});

	it('fills a sparse long clip with viewport-sized nearest-frame tiles', () => {
		const frames = [0, 120, 240, 359].map((index) => ({ index, url: `frame-${index}` }));
		const tiles = computeFilmstripTiles(frames, 0, 360, 720, false, {
			tileWidthPx: 120,
			visibleStartPx: 240,
			visibleEndPx: 600
		});

		expect(tiles.map((tile) => ({ slot: tile.slot, index: tile.index, x: tile.x }))).toEqual([
			{ slot: 2, index: 120, x: 240 },
			{ slot: 3, index: 240, x: 360 },
			{ slot: 4, index: 240, x: 480 }
		]);
		expect(tiles.every((tile) => tile.width === 120)).toBe(true);
	});

	it('maps viewport tiles through an exact variable-speed source curve', () => {
		const frames = [0, 1, 2, 3, 4].map((index) => ({ index, url: `frame-${index}` }));
		const sourceSecondAtTimelineRatio = (ratio: number): number => {
			if (ratio <= 1 / 3) return ratio * 3.6;
			if (ratio <= 2 / 3) return 1.2 + (ratio - 1 / 3) * 5.4;
			return 3 + (ratio - 2 / 3) * 3.6;
		};

		const tiles = computeFilmstripTiles(frames, 0, 4.2, 300, false, {
			tileWidthPx: 100,
			visibleStartPx: 0,
			visibleEndPx: 300,
			sourceSecondAtTimelineRatio
		});

		expect(tiles.map((tile) => tile.index)).toEqual([1, 2, 4]);
		expect(
			visibleFilmstripTargetIndices({
				sourceStartSeconds: 0,
				clipSpanSeconds: 4.2,
				clipWidthPx: 300,
				visibleStartPx: 0,
				visibleEndPx: 300,
				tileWidthPx: 100,
				totalSourceFrames: 5,
				sourceSecondAtTimelineRatio
			})
		).toEqual([0, 2, 3]);
	});

	it('returns exact source-second targets for the visible tile window', () => {
		expect(
			visibleFilmstripTargetIndices({
				sourceStartSeconds: 30,
				clipSpanSeconds: 300,
				clipWidthPx: 600,
				visibleStartPx: 120,
				visibleEndPx: 360,
				tileWidthPx: 120,
				totalSourceFrames: 400
			})
		).toEqual([120, 180]);
	});

	it('mirrors visible target seconds for reversed playback', () => {
		expect(
			visibleFilmstripTargetIndices({
				sourceStartSeconds: 30,
				clipSpanSeconds: 300,
				clipWidthPx: 600,
				visibleStartPx: 120,
				visibleEndPx: 360,
				tileWidthPx: 120,
				totalSourceFrames: 400,
				reversed: true
			})
		).toEqual([180, 240]);
	});
});

describe('buildPriorityIndices', () => {
	it('is empty without a range', () => {
		expect(buildPriorityIndices(100, null)).toEqual([]);
	});

	it('clamps out-of-bounds ranges', () => {
		const indices = buildPriorityIndices(50, {
			startIndex: -10,
			endIndex: 500
		});
		expect(indices[0]).toBe(0);
		expect(indices[indices.length - 1]).toBe(49);
	});

	it('subsamples very wide ranges to the dense cap', () => {
		const indices = buildPriorityIndices(2000, { startIndex: 0, endIndex: 2000 }, 100);
		expect(indices.length).toBeLessThanOrEqual(101);
		expect(indices).toContain(0);
		expect(indices).toContain(1999);
	});
});
