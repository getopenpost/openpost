import type { FilmstripFrame } from '../media/filmstrip-client';
import { FILMSTRIP_FRAME_RATE } from '../media/filmstrip-plan';

export const PROXY_SEEK_STALL_MS = 60;
export const MAX_FILMSTRIP_FALLBACK_DRIFT_SECONDS = 0.75;

export function nearestFilmstripFallback(
	frames: readonly FilmstripFrame[],
	timestampSeconds: number,
	maxDriftSeconds = MAX_FILMSTRIP_FALLBACK_DRIFT_SECONDS
): FilmstripFrame | null {
	if (!Number.isFinite(timestampSeconds) || frames.length === 0) return null;
	let nearest: FilmstripFrame | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const frame of frames) {
		if (!frame.bitmap && !frame.url) continue;
		const timestamp = frame.index / FILMSTRIP_FRAME_RATE;
		const distance = Math.abs(timestamp - timestampSeconds);
		if (distance < nearestDistance) {
			nearest = frame;
			nearestDistance = distance;
		}
	}
	return nearestDistance <= maxDriftSeconds ? nearest : null;
}

/** Clone cache-owned pixels so cache eviction cannot invalidate an in-flight presentation. */
export async function cloneFilmstripFallback(frame: FilmstripFrame): Promise<ImageBitmap> {
	if (frame.bitmap) return createImageBitmap(frame.bitmap);
	if (!frame.url) throw new Error('Filmstrip fallback has no pixels.');
	const response = await fetch(frame.url);
	if (!response.ok) throw new Error(`Filmstrip fallback unavailable (${response.status}).`);
	return createImageBitmap(await response.blob());
}
