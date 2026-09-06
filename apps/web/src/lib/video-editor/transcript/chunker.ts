/**
 * Ported from FreeCut (MIT) — media-library/transcription/lib/chunker.ts,
 * reshaped from a streaming sample buffer into a pure planner over a known
 * duration so callers can pre-compute Whisper windows before decoding.
 */

export interface ChunkPlan {
	index: number;
	/** Window bounds in seconds from media start. */
	startSeconds: number;
	endSeconds: number;
}

const DEFAULT_WINDOW_SECONDS = 30;
const DEFAULT_OVERLAP_SECONDS = 2;
const MIN_WINDOW_SECONDS = 0.001;

/** Mono PCM rate every consumer of a ChunkPlan expects. */
export const WHISPER_SAMPLE_RATE = 16_000;

export function planChunks(
	durationSeconds: number,
	windowSeconds: number = DEFAULT_WINDOW_SECONDS,
	overlapSeconds: number = DEFAULT_OVERLAP_SECONDS
): ChunkPlan[] {
	if (!(durationSeconds > 0)) return [];

	const window = Math.max(windowSeconds, MIN_WINDOW_SECONDS);
	const overlap = Math.min(Math.max(overlapSeconds, 0), window / 2);
	const advance = window - overlap;

	const plans: ChunkPlan[] = [];
	let start = 0;
	while (start < durationSeconds) {
		const end = Math.min(start + window, durationSeconds);
		plans.push({ index: plans.length, startSeconds: start, endSeconds: end });
		if (end >= durationSeconds) break;
		start += advance;
	}

	while (plans.length >= 2) {
		const last = plans[plans.length - 1]!;
		const isSliver = last.endSeconds - last.startSeconds < overlap;
		if (!isSliver) break;
		plans.pop();
		const newLast = plans[plans.length - 1]!;
		newLast.endSeconds = durationSeconds;
	}

	return plans.map((plan, index) => ({
		index,
		startSeconds: plan.startSeconds,
		endSeconds: plan.endSeconds
	}));
}
