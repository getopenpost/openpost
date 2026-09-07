/**
 * Reverse decode-window planner for fast reverse shuttle.
 *
 * Ported verbatim from FreeCut (MIT)
 * `preview/utils/reverse-playback-window.ts`: 20-sample window, stride =
 * rate*fps/60, refill after ~60% of the prepared interval is consumed. The
 * signed transport clock stays authoritative; at faster shuttle rates only
 * frames that can plausibly reach the display are requested, letting the
 * clock skip intermediate authored frames instead of making decoding slow
 * transport.
 */

export interface ReversePlaybackWindowPlan {
	highFrame: number;
	lowFrame: number;
	refillFrame: number;
	strideFrames: number;
	targetFrames: number[];
}

const DEFAULT_REVERSE_WINDOW_SAMPLES = 20;
const DEFAULT_PRESENTATION_FPS = 60;

export function resolveReversePlaybackWindowPlan(input: {
	targetFrame: number;
	fps: number;
	playbackRate: number;
	maxSamples?: number;
	presentationFps?: number;
}): ReversePlaybackWindowPlan {
	const targetFrame = Math.max(0, Math.round(input.targetFrame));
	const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
	const rate =
		Number.isFinite(input.playbackRate) && input.playbackRate !== 0
			? Math.abs(input.playbackRate)
			: 1;
	const presentationFps =
		Number.isFinite(input.presentationFps) && Number(input.presentationFps) > 0
			? Number(input.presentationFps)
			: DEFAULT_PRESENTATION_FPS;
	const maxSamples = Math.max(2, Math.round(input.maxSamples ?? DEFAULT_REVERSE_WINDOW_SAMPLES));
	const strideFrames = Math.max(1, Math.round((rate * fps) / presentationFps));
	const targetFrames: number[] = [];

	for (let index = 0; index < maxSamples; index += 1) {
		const frame = targetFrame - index * strideFrames;
		if (frame < 0) break;
		targetFrames.push(frame);
	}

	const lowFrame = targetFrames.at(-1) ?? targetFrame;
	const spanFrames = Math.max(0, targetFrame - lowFrame);
	return {
		highFrame: targetFrame,
		lowFrame,
		// Refill after roughly 60% of the prepared interval has been consumed,
		// preserving the remaining frames while the next forward decode settles.
		refillFrame: Math.max(lowFrame, targetFrame - Math.round(spanFrames * 0.6)),
		strideFrames,
		targetFrames
	};
}

export function shouldQueueReversePlaybackWindow(input: {
	targetFrame: number;
	preparedLowFrame: number | null;
	preparedHighFrame: number | null;
	refillFrame: number | null;
	requestInFlight: boolean;
}): boolean {
	if (input.requestInFlight) return false;
	if (
		input.preparedLowFrame === null ||
		input.preparedHighFrame === null ||
		input.refillFrame === null
	) {
		return true;
	}
	if (input.targetFrame > input.preparedHighFrame || input.targetFrame < input.preparedLowFrame) {
		return true;
	}
	return input.targetFrame <= input.refillFrame;
}
