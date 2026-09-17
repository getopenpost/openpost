/**
 * Widest-label menu measurement for editor-density menus.
 *
 * Contract (ProUI `pro-menu` behavior): a menu trigger sizes itself to its
 * longest option so switching values never shifts the toolbar. Measurement
 * prefers a canvas 2d context when one exists (browser) and falls back to a
 * deterministic character-width estimate (SSR, tests) so the trigger width is
 * stable before fonts load.
 */

export interface LabelWidthOptions {
	/** Font size in px of the trigger label. */
	fontSizePx?: number;
	/** Average glyph width as a fraction of font size (fallback estimator). */
	avgCharRatio?: number;
	/** Extra px for trigger chrome (padding, chevron, gaps). */
	chromePx?: number;
}

const DEFAULT_FONT_SIZE_PX = 11;
const DEFAULT_CHAR_RATIO = 0.58;
const DEFAULT_CHROME_PX = 22;

/** Longest label by character count; ties keep the first label. */
export function longestLabel(labels: string[]): string {
	let longest = '';
	for (const label of labels) {
		if (label.length > longest.length) longest = label;
	}
	return longest;
}

/** Deterministic fallback width; monotonic in label length. */
export function estimateLabelWidthPx(label: string, options: LabelWidthOptions = {}): number {
	const fontSizePx = options.fontSizePx ?? DEFAULT_FONT_SIZE_PX;
	const ratio = options.avgCharRatio ?? DEFAULT_CHAR_RATIO;
	return Math.ceil(label.length * fontSizePx * ratio);
}

/**
 * Measure one label in px. Uses canvas when available, otherwise the estimator.
 * `font` must be a CSS font shorthand when measuring, e.g. "11px sans-serif".
 */
export function measureLabelWidthPx(label: string, font?: string): number {
	if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
		try {
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			if (context) {
				if (font) context.font = font;
				const measured = context.measureText(label).width;
				if (Number.isFinite(measured) && measured > 0) return Math.ceil(measured);
			}
		} catch {
			// Fall through to the estimator below.
		}
	}
	return estimateLabelWidthPx(label);
}

/** Trigger width that fits every option label plus trigger chrome. */
export function widestMenuWidthPx(labels: string[], options: LabelWidthOptions = {}): number {
	const chromePx = options.chromePx ?? DEFAULT_CHROME_PX;
	let widest = 0;
	for (const label of labels) {
		const width = estimateLabelWidthPx(label, options);
		if (width > widest) widest = width;
	}
	return widest + chromePx;
}
