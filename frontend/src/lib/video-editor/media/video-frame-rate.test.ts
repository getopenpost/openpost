import { describe, expect, it, vi } from 'vitest';
import type { VideoFrameRateMetrics } from './types';
import {
	FRAME_RATE_PROBE_PACKET_COUNT,
	probeVideoFrameRate,
	probeVideoFrameRateMetrics,
	type VideoFrameRateTrack
} from './video-frame-rate';

const CFR_METRICS: VideoFrameRateMetrics = {
	underlyingFrameRate: 30,
	bestGuessFrameRate: 29.97,
	minFrameRate: 29.97,
	maxFrameRate: 29.97,
	averageFrameRate: 29.97,
	medianFrameRate: 29.97,
	frameRateIsConstant: true,
	probedPacketCount: 256
};

describe('source video frame-rate probing', () => {
	it('uses MediaBunny timestamp metrics and preserves the complete CFR result', async () => {
		const computeFrameRateMetrics = vi.fn(async () => CFR_METRICS);
		const result = await probeVideoFrameRateMetrics({ computeFrameRateMetrics });

		expect(computeFrameRateMetrics).toHaveBeenCalledWith({
			targetPacketCount: FRAME_RATE_PROBE_PACKET_COUNT
		});
		expect(result).toEqual({ fps: 29.97, metrics: CFR_METRICS });
	});

	it('keeps variable-frame-rate truth instead of reducing it to one average', async () => {
		const vfr: VideoFrameRateMetrics = {
			...CFR_METRICS,
			underlyingFrameRate: null,
			bestGuessFrameRate: 60,
			minFrameRate: 23.976,
			maxFrameRate: 60,
			averageFrameRate: 41.2,
			medianFrameRate: 30,
			frameRateIsConstant: false
		};

		const result = await probeVideoFrameRateMetrics({
			computeFrameRateMetrics: async () => vfr
		});

		expect(result.fps).toBe(60);
		expect(result.metrics).toEqual(vfr);
	});

	it.each([
		['bestGuessFrameRate', 0],
		['underlyingFrameRate', Number.NaN],
		['probedPacketCount', -1]
	] as const)('rejects an invalid %s metric', async (key, value) => {
		// SAFETY: each table row replaces one declared VideoFrameRateMetrics field with its test value.
		const invalid = { ...CFR_METRICS, [key]: value } as VideoFrameRateMetrics;
		const track: VideoFrameRateTrack = { computeFrameRateMetrics: async () => invalid };

		await expect(probeVideoFrameRateMetrics(track)).rejects.toThrow(/invalid/i);
	});

	it('falls back to 30 fps without persisting guessed metrics when probing fails', async () => {
		const result = await probeVideoFrameRate({
			computeFrameRateMetrics: async () => {
				throw new Error('Unreadable timestamps');
			}
		});

		expect(result).toEqual({ fps: 30 });
	});
});
