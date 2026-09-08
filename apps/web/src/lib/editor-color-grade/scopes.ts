export type ScopeCanvasSource = HTMLCanvasElement | OffscreenCanvas;

export const SEQUENCE_SCOPE_SAMPLE_ID = 'sequence-output';

export interface ScopeSample {
	itemId: string;
	source: ScopeCanvasSource | null;
	image: ImageData | null;
}

/**
 * Scope capture cadence, ported from FreeCut (MIT)
 * `color-scopes-view.tsx`: GPU scopes sample at ~15fps while CPU fallback
 * renders at most every 220ms. Paused frames capture larger (384x216) since
 * they stay on screen; playing frames stay small (256x144) to hold the
 * playback budget.
 */
export const SCOPE_CAPTURE_INTERVAL_PLAYING_MS = 66;
export const SCOPE_CAPTURE_INTERVAL_PAUSED_MS = 220;
export const SCOPE_SAMPLE_SIZE_PLAYING = { width: 256, height: 144 } as const;
export const SCOPE_SAMPLE_SIZE_PAUSED = { width: 384, height: 216 } as const;
/**
 * Watchdog: if WebGPU scope setup stays pending past this, assume the device
 * request wedged (e.g. cold-start contention) and fall back to CPU scopes
 * instead of leaving the dock blank forever. Mirrors FreeCut's
 * `GPU_RENDER_STUCK_TIMEOUT_MS` recovery rule.
 */
export const SCOPE_SETUP_TIMEOUT_MS = 1000;

export function resolveScopeSampleSize(isPlaying: boolean): {
	width: number;
	height: number;
} {
	return isPlaying ? SCOPE_SAMPLE_SIZE_PLAYING : SCOPE_SAMPLE_SIZE_PAUSED;
}

export function scopeCaptureDue(lastCaptureAt: number, now: number, isPlaying: boolean): boolean {
	const interval = isPlaying ? SCOPE_CAPTURE_INTERVAL_PLAYING_MS : SCOPE_CAPTURE_INTERVAL_PAUSED_MS;
	return now - lastCaptureAt >= interval;
}

export function readScopeImage(target: ScopeSample): ImageData | null {
	if (target.image) return target.image;
	const source = target.source;
	if (!source) return null;
	try {
		// SAFETY: Both allowed source types expose a 2D context with getImageData.
		const context = source.getContext('2d', { willReadFrequently: true }) as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!context) return null;
		target.image = context.getImageData(0, 0, source.width, source.height);
		return target.image;
	} catch {
		return null;
	}
}
