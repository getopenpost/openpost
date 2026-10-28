/**
 * Scrub-proxy fallback scheduler, ported from FreeCut (MIT)
 * `features/preview/utils/scrub-proxy-fallback.ts`.
 *
 * The pure nearest/clone helpers in `./scrub-proxy-fallback` answer one lookup.
 * This scheduler adds the runtime behavior FreeCut wraps around them:
 * - a filmstrip prewarm hook so scrub targets are already cached,
 * - a per-media generation counter so a superseded scrub cannot present pixels,
 * - an inflight map so concurrent seeks for the same frame share one decode.
 */
import {
	cloneFilmstripFallback,
	MAX_FILMSTRIP_FALLBACK_DRIFT_SECONDS,
	nearestFilmstripFallback
} from './scrub-proxy-fallback';
import { filmstripCache } from '../media/filmstrip-client';

const fallbackGenerationByMedia = new Map<string, number>();
const fallbackInflight = new Map<string, Promise<ImageBitmap | null>>();

/**
 * Start decoding filmstrip tiles before the first scrub seek needs them.
 * Safe to call repeatedly; the filmstrip service prewarms once.
 */
export function warmScrubProxyFallback(): void {
	try {
		filmstripCache.prewarm();
	} catch {
		// Prewarming is optional; the regular seek path remains authoritative.
	}
}

/**
 * Invalidate pending fallback work for one media (or every media when omitted),
 * e.g. when a new scrub target starts. In-flight clones resolve to null.
 */
export function invalidateScrubFallbacks(mediaId?: string): void {
	if (mediaId === undefined) {
		for (const key of fallbackGenerationByMedia.keys()) {
			fallbackGenerationByMedia.set(key, (fallbackGenerationByMedia.get(key) ?? 0) + 1);
		}
		return;
	}
	fallbackGenerationByMedia.set(mediaId, (fallbackGenerationByMedia.get(mediaId) ?? 0) + 1);
}

function quantizeTimestamp(timestampSeconds: number): string {
	return timestampSeconds.toFixed(6);
}

/**
 * Shared nearest-filmstrip decode for a scrub seek. Concurrent callers for the
 * same media + timestamp share one clone; superseded or out-of-drift requests
 * resolve to null instead of presenting stale pixels.
 */
export function requestScrubFallback(
	mediaId: string,
	timestampSeconds: number,
	maxDriftSeconds = MAX_FILMSTRIP_FALLBACK_DRIFT_SECONDS
): Promise<ImageBitmap | null> {
	if (!mediaId || !Number.isFinite(timestampSeconds)) return Promise.resolve(null);
	const key = `${mediaId}:${quantizeTimestamp(timestampSeconds)}`;
	const pending = fallbackInflight.get(key);
	if (pending) return pending;
	const generation = fallbackGenerationByMedia.get(mediaId) ?? 0;

	const request = (async (): Promise<ImageBitmap | null> => {
		const filmstrip = filmstripCache.cachedFilmstrip(mediaId);
		const frame = filmstrip
			? nearestFilmstripFallback(filmstrip.frames, timestampSeconds, maxDriftSeconds)
			: null;
		if (!frame) return null;
		const bitmap = await cloneFilmstripFallback(frame);
		if ((fallbackGenerationByMedia.get(mediaId) ?? 0) !== generation) {
			bitmap.close();
			return null;
		}
		return bitmap;
	})()
		.catch(() => null)
		.finally(() => {
			fallbackInflight.delete(key);
		});
	fallbackInflight.set(key, request);
	return request;
}
