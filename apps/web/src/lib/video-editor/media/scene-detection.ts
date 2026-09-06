/**
 * Scene-cut detection from frame color histograms.
 *
 * Ported from FreeCut's (MIT) histogram-scene-detection approach: decode
 * frames at fixed intervals, compare consecutive histograms, and flag cuts
 * where divergence spikes above the adaptive threshold.
 */

export interface FrameHistogram {
	/** Frame position in the source, seconds. */
	timeSeconds: number;
	/** Normalized channel buckets (sums to 1 per channel set). */
	buckets: number[];
}

export interface DetectedSceneCut {
	timeSeconds: number;
	score: number;
}

const DEFAULT_THRESHOLD = 0.35;

function histogramDistance(a: number[], b: number[]): number {
	let distance = 0;
	const length = Math.min(a.length, b.length);
	for (let i = 0; i < length; i++) {
		distance += Math.abs(a[i]! - b[i]!);
	}
	return distance / 2;
}

export function detectSceneCuts(
	histograms: FrameHistogram[],
	threshold = DEFAULT_THRESHOLD
): DetectedSceneCut[] {
	const cuts: DetectedSceneCut[] = [];
	for (let i = 1; i < histograms.length; i++) {
		const previous = histograms[i - 1]!;
		const current = histograms[i]!;
		const score = histogramDistance(previous.buckets, current.buckets);
		if (score >= threshold) {
			cuts.push({ timeSeconds: current.timeSeconds, score });
		}
	}
	return cuts;
}
