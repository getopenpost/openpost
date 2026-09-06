/** Canvas text measurement seam ported from FreeCut (MIT). */

export interface FontMetrics {
	ascent: number;
	descent: number;
}

export interface TextMeasurer {
	measure(text: string, cssFont: string, letterSpacing: number): number;
	fontMetrics(cssFont: string): FontMetrics;
}

type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function parseFontSizePx(cssFont: string): number {
	const match = /(\d+(?:\.\d+)?)px/.exec(cssFont);
	return match ? Number.parseFloat(match[1]!) : 16;
}

export function applyCanvasLetterSpacing(context: CanvasContext, letterSpacing: number): void {
	if ('letterSpacing' in context) context.letterSpacing = `${letterSpacing}px`;
}

export function createCanvasTextMeasurer(context: CanvasContext): TextMeasurer {
	if ('fontKerning' in context) context.fontKerning = 'normal';
	return {
		measure(text, cssFont, letterSpacing) {
			if (context.font !== cssFont) context.font = cssFont;
			applyCanvasLetterSpacing(context, letterSpacing);
			return context.measureText(text).width;
		},
		fontMetrics(cssFont) {
			if (context.font !== cssFont) context.font = cssFont;
			const fontSize = parseFontSizePx(cssFont);
			const metrics = context.measureText('Hg');
			return {
				ascent: metrics.fontBoundingBoxAscent || fontSize * 0.8,
				descent: metrics.fontBoundingBoxDescent || fontSize * 0.2
			};
		}
	};
}
