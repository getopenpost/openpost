/**
 * Single owner for h:mm:ss media duration display.
 *
 * Consolidates the duplicated formatters in the project browser and the
 * scene browser. Fractions of a second round to the nearest second,
 * matching `formatVideoDuration` in `media-presentation.ts` (which takes
 * milliseconds; this owner takes seconds). Negative input clamps to zero.
 * Hours are omitted when zero; minutes and seconds pad to two digits only
 * when hours are shown.
 */
export function formatMediaDuration(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
		: `${minutes}:${String(secs).padStart(2, '0')}`;
}
