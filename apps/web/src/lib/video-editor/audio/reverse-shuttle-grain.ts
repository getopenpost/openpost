export const REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS = 0.08;
export const REVERSE_SHUTTLE_LOOKAHEAD_SECONDS = 0.16;
export const REVERSE_SHUTTLE_GRAIN_FADE_SECONDS = 0.008;

export interface ReverseShuttleGrainPlan {
	sourceStartSeconds: number;
	sourceDurationSeconds: number;
	playbackRate: number;
	reverseSamples: boolean;
	nextSourceCursorSeconds: number;
}

export function resolveReverseShuttleGrainPlan(params: {
	sourceCursorSeconds: number;
	playbackRate: number;
	reverseSamples: boolean;
	bufferStartSeconds: number;
	bufferDurationSeconds: number;
	outputDurationSeconds?: number;
}): ReverseShuttleGrainPlan | null {
	const outputDuration = params.outputDurationSeconds ?? REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS;
	const playbackRate = Math.max(0.0625, Math.min(16, params.playbackRate));
	const cursor = params.sourceCursorSeconds;
	const bufferEnd = params.bufferStartSeconds + params.bufferDurationSeconds;
	if (!Number.isFinite(cursor) || cursor < params.bufferStartSeconds || cursor > bufferEnd) {
		return null;
	}
	const sourceDirection = params.reverseSamples ? -1 : 1;
	const sourceStart =
		sourceDirection < 0
			? Math.max(params.bufferStartSeconds, cursor - outputDuration * playbackRate)
			: cursor;
	const sourceEnd =
		sourceDirection < 0 ? cursor : Math.min(bufferEnd, cursor + outputDuration * playbackRate);
	const sourceDuration = sourceEnd - sourceStart;
	if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return null;

	return {
		sourceStartSeconds: sourceStart,
		sourceDurationSeconds: sourceDuration,
		playbackRate,
		reverseSamples: sourceDirection < 0,
		nextSourceCursorSeconds: sourceDirection < 0 ? sourceStart : sourceEnd
	};
}

export function copyShuttleGrainSamples(
	source: Float32Array,
	target: Float32Array,
	sourceStartSample: number,
	reverseSamples: boolean
): void {
	const maxSourceIndex = source.length - 1;
	for (let index = 0; index < target.length; index += 1) {
		const sourceIndex = reverseSamples
			? sourceStartSample + target.length - 1 - index
			: sourceStartSample + index;
		target[index] = source[Math.max(0, Math.min(maxSourceIndex, sourceIndex))] ?? 0;
	}
}
