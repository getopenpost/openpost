/**
 * Windowed cue-list layout for the transcript panel.
 *
 * A long episode can carry hundreds of subtitle cues; mounting a full editor
 * row per cue blows out the component tree. The panel renders only the
 * visible window (plus overscan) inside a scroll container, reusing the
 * shared virtual-row helpers. Rows self-report through the row-height
 * estimate below, mirroring FreeCut's CUE_ROW_ESTIMATE_PX seed.
 */
import {
	buildVirtualRowLayout,
	queryVirtualRowLayout,
	type VirtualRowLayout,
	type VirtualRowWindow
} from '../timeline/virtual-row-window';

/** Estimated rendered height of one cue row in pixels (seed, not a clamp).
 * Ported from FreeCut (MIT) subtitle-section.tsx CUE_ROW_ESTIMATE_PX; the windowing
 * math itself reuses this repo's shared virtual-row helpers. */
export const TRANSCRIPT_CUE_ROW_ESTIMATE_PX = 116;

/** Rows kept mounted above and below the viewport, in row units.
 * Ported from FreeCut (MIT) subtitle-section.tsx VirtualCueList overscan. */
export const TRANSCRIPT_CUE_OVERSCAN_ROWS = 4;

export function buildCueListLayout(
	keys: readonly string[],
	measuredSizes: ReadonlyMap<string, number> = new Map()
): VirtualRowLayout {
	return buildVirtualRowLayout([...keys], measuredSizes, TRANSCRIPT_CUE_ROW_ESTIMATE_PX);
}

export function queryCueListWindow(
	layout: VirtualRowLayout,
	scrollTop: number,
	viewportHeight: number
): VirtualRowWindow {
	return queryVirtualRowLayout(
		layout,
		scrollTop,
		viewportHeight,
		TRANSCRIPT_CUE_OVERSCAN_ROWS * TRANSCRIPT_CUE_ROW_ESTIMATE_PX
	);
}
