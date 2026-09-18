/**
 * Click-to-land track math for the editor-density slider row.
 *
 * Contract (ProUI `pro-slider` behavior, ported to Svelte): the thumb lands
 * where the pointer presses. The track's usable width is the track width
 * minus the thumb width, so the far left is exactly `min`, the far right is
 * exactly `max`, and the thumb center rides under the cursor.
 */

export interface TrackPointerGeometry {
	/** Pointer x in client coordinates. */
	clientX: number;
	/** Track left edge in client coordinates. */
	trackLeft: number;
	/** Full track width in px. */
	trackWidth: number;
	/** Visual thumb width in px (not the transparent hit area). */
	thumbWidthPx: number;
}

export interface TrackValueBounds {
	min: number;
	max: number;
	step: number;
}

/**
 * Value for a pointer press on the track. Quantizes to `step` and clamps to
 * `[min, max]`; presses outside the track pin to the nearest end.
 */
export function sliderValueFromPointer(
	geometry: TrackPointerGeometry,
	bounds: TrackValueBounds
): number {
	const { clientX, trackLeft, trackWidth, thumbWidthPx } = geometry;
	const { min, max, step } = bounds;
	const usable = Math.max(1, trackWidth - thumbWidthPx);
	const ratio = Math.min(1, Math.max(0, (clientX - trackLeft - thumbWidthPx / 2) / usable));
	// Pinned ends bypass quantization: a step grid that does not divide the
	// range must still land the far ends exactly on min and max.
	if (ratio <= 0) return min;
	if (ratio >= 1) return max;
	const raw = min + ratio * (max - min);
	const quantized = min + Math.round((raw - min) / step) * step;
	return Math.min(max, Math.max(min, quantized));
}
