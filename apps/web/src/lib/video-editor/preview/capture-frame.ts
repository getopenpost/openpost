/**
 * Capture-frame resolution, ported from FreeCut (MIT)
 * `features/preview/utils/preview-capture-frame.ts`.
 *
 * Decides which timeline frame a capture (scope sample, save-frame) should
 * read: while playing, the live playback frame wins when it is within drift
 * of the committed playhead; while paused, an explicit preview/scrub frame
 * wins over the committed playhead.
 */
export interface ResolveCaptureFrameParams {
	currentFrame: number;
	previewFrame: number | null;
	isPlaying: boolean;
	livePlaybackFrame?: number | null;
}

export const MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES = 2;

function normalizeFrame(frame: number): number {
	if (!Number.isFinite(frame)) return 0;
	return Math.max(0, Math.round(frame));
}

export function resolvePreviewCaptureFrame({
	currentFrame,
	previewFrame,
	isPlaying,
	livePlaybackFrame
}: ResolveCaptureFrameParams): number {
	if (
		isPlaying &&
		livePlaybackFrame !== null &&
		livePlaybackFrame !== undefined &&
		Number.isFinite(livePlaybackFrame)
	) {
		const normalizedCurrentFrame = normalizeFrame(currentFrame);
		const normalizedLiveFrame = normalizeFrame(livePlaybackFrame);
		if (
			Math.abs(normalizedLiveFrame - normalizedCurrentFrame) <=
			MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES
		) {
			return normalizedLiveFrame;
		}
		return normalizedCurrentFrame;
	}

	if (isPlaying) {
		return normalizeFrame(currentFrame);
	}

	if (previewFrame !== null && previewFrame !== undefined) {
		return normalizeFrame(previewFrame);
	}

	return normalizeFrame(currentFrame);
}
