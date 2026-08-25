import { describe, expect, it } from 'vitest';

// Shared derivation logic extracted for deterministic testing.
// Mirrors the timestamp-gap fallback used in both probe.worker and extraction.worker.

const DEFAULT_DELAY_MS = 100;

function deriveDurationsMs(ownDurationsMs: number[], timestampsUs: number[]): number[] {
	return ownDurationsMs.map((own, index) => {
		if (own > 0) return own;
		const current = timestampsUs[index];
		const next = timestampsUs[index + 1];
		if (current !== undefined && next !== undefined && current >= 0 && next > current) {
			return (next - current) / 1000;
		}
		return DEFAULT_DELAY_MS;
	});
}

describe('animated durations derivation via timestamp gap then 100ms', () => {
	it('prefers own duration when positive', () => {
		expect(deriveDurationsMs([100, 200], [0, 100000])).toEqual([100, 200]);
	});

	it('falls back to timestamp gap when own duration is zero', () => {
		// timestamps in microseconds: 0, 50000 -> gap 50ms
		expect(deriveDurationsMs([0, 0], [0, 50000, 120000])).toEqual([50, 70]);
	});

	it('uses timestamp gap only when both timestamps valid and increasing', () => {
		expect(deriveDurationsMs([0], [-1, 50000])).toEqual([DEFAULT_DELAY_MS]);
		expect(deriveDurationsMs([0], [10000, 5000])).toEqual([DEFAULT_DELAY_MS]);
		expect(deriveDurationsMs([0], [0, undefined as unknown as number])).toEqual([DEFAULT_DELAY_MS]);
	});

	it('defaults to 100ms when no gap available', () => {
		expect(deriveDurationsMs([0, 0], [0])).toEqual([DEFAULT_DELAY_MS, DEFAULT_DELAY_MS]);
	});
});

describe('probe and worker frame limit', () => {
	const MAX_FRAMES = 2_000;
	function checkLimit(frameCount: number): void {
		if (frameCount > MAX_FRAMES)
			throw new Error(`Animation exceeds the ${MAX_FRAMES} frame limit.`);
	}
	it('rejects over 2000 frames', () => {
		expect(() => checkLimit(2001)).toThrow(/2000 frame limit/);
		expect(() => checkLimit(5000)).toThrow();
	});
	it('allows exactly 2000 frames', () => {
		expect(() => checkLimit(2000)).not.toThrow();
	});
	it('allows small animations', () => {
		expect(() => checkLimit(3)).not.toThrow();
	});
});
