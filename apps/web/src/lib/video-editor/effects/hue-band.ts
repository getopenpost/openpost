/**
 * Hue-band strip geometry for the secondary-qualifier bespoke panel.
 * Ported from FreeCut (MIT) `HueBandControl` in
 * features/effects/components/panels/gpu-secondary-qualifier-panel.tsx:
 * the strip maps 0..360 degrees to 0..100 percent, the core band spans
 * hueWidth around the center, and the feather band extends hueSoftness
 * beyond the core on each side. Bands clamp to the strip edges.
 */
export interface HueBandGeometry {
	centerPct: number;
	coreLeftPct: number;
	coreRightPct: number;
	softLeftPct: number;
	softRightPct: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function hueBandGeometry(center: number, width: number, softness: number): HueBandGeometry {
	const centerPct = (clamp(center, 0, 360) / 360) * 100;
	const coreRadiusPct = (clamp(width, 0, 180) / 360) * 100;
	const featherPct = (clamp(softness, 0, 120) / 360) * 100;
	const softRadiusPct = coreRadiusPct + featherPct;
	return {
		centerPct,
		coreLeftPct: clamp(centerPct - coreRadiusPct, 0, 100),
		coreRightPct: clamp(100 - centerPct - coreRadiusPct, 0, 100),
		softLeftPct: clamp(centerPct - softRadiusPct, 0, 100),
		softRightPct: clamp(100 - centerPct - softRadiusPct, 0, 100)
	};
}

/** Map a client X coordinate on the strip to a 0..360 hue value. */
export function hueFromStripPosition(clientX: number, left: number, widthPx: number): number {
	if (widthPx <= 0) return 0;
	return clamp(((clientX - left) / widthPx) * 360, 0, 360);
}
