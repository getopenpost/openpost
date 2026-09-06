import { applyColorEffectsToPixels, renderColorEffectsWithCanvas2D } from './cpu-renderer';
import type { EditorColorGradeAdjustments } from './model';
import type {
	EditorColorCompositor,
	EditorColorCompositorFactory,
	EditorColorRenderEffect
} from './rendering';

export { IMAGE_COLOR_GRADE_VERSION } from './model';
export type { EditorColorGradeAdjustments } from './model';

function rounded(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}

/** Translate still-image controls into the canonical video color pipeline. */
export function editorColorGradeAdjustmentsToEffects(
	adjustments: EditorColorGradeAdjustments
): EditorColorRenderEffect[] {
	const effects: EditorColorRenderEffect[] = [];
	if (adjustments.brightness) {
		effects.push({
			effectId: 'gpu-brightness',
			params: { amount: adjustments.brightness }
		});
	}
	if (adjustments.exposure) {
		effects.push({
			effectId: 'gpu-exposure',
			params: {
				exposure: rounded(adjustments.exposure * 3),
				offset: 0,
				gamma: 1
			}
		});
	}
	if (adjustments.contrast) {
		effects.push({
			effectId: 'gpu-contrast',
			params: { amount: 1 + adjustments.contrast }
		});
	}
	if (adjustments.saturation) {
		effects.push({
			effectId: 'gpu-saturation',
			params: { amount: 1 + adjustments.saturation }
		});
	}
	if (adjustments.vibrance) {
		effects.push({
			effectId: 'gpu-vibrance',
			params: { amount: adjustments.vibrance }
		});
	}
	if (adjustments.hue) {
		effects.push({
			effectId: 'gpu-hue-shift',
			params: { shift: ((adjustments.hue % 1) + 1) % 1, span: 1, flow: 0 }
		});
	}
	if (adjustments.temperature || adjustments.tint) {
		effects.push({
			effectId: 'gpu-temperature',
			params: { temperature: adjustments.temperature, tint: adjustments.tint }
		});
	}
	if (adjustments.highlights || adjustments.shadows) {
		effects.push({
			effectId: 'gpu-color-wheels',
			params: {
				lift: 0,
				gain: 1,
				gamma: 1,
				offset: 0,
				shadows: rounded(adjustments.shadows * 100),
				highlights: rounded(adjustments.highlights * 100)
			}
		});
	}
	return effects;
}

export const imageAdjustmentsToGradeEffects = editorColorGradeAdjustmentsToEffects;

export type ImageGradeBackend = 'gpu' | 'cpu';

export interface ImageGradeRenderResult {
	canvas: HTMLCanvasElement;
	backend: ImageGradeBackend;
}

/** Reusable renderer for exact still previews and exports. */
export class ImageGradeRenderer {
	private readonly gpuCanvas: HTMLCanvasElement;
	private readonly cpuCanvas: HTMLCanvasElement;
	private compositor: EditorColorCompositor | null;

	constructor(createCompositor?: EditorColorCompositorFactory) {
		if (!globalThis.document) throw new Error('Image grading requires a document.');
		this.gpuCanvas = document.createElement('canvas');
		this.cpuCanvas = document.createElement('canvas');
		this.compositor = createCompositor?.(this.gpuCanvas) ?? null;
	}

	render(
		source: TexImageSource,
		width: number,
		height: number,
		adjustments: EditorColorGradeAdjustments
	): ImageGradeRenderResult | null {
		const effects = editorColorGradeAdjustmentsToEffects(adjustments);
		if (this.compositor) {
			try {
				if (this.compositor.render(source, width, height, effects)) {
					return { canvas: this.gpuCanvas, backend: 'gpu' };
				}
			} catch {
				// The Canvas2D adapter below is the deterministic fallback.
			}
			this.compositor.dispose();
			this.compositor = null;
		}
		return renderColorEffectsWithCanvas2D(this.cpuCanvas, source, width, height, effects)
			? { canvas: this.cpuCanvas, backend: 'cpu' }
			: null;
	}

	dispose(): void {
		this.compositor?.dispose();
		this.compositor = null;
	}
}

/** Compatibility helper for one-shot callers and tests. */
export function renderVersionedImageGrade(
	source: TexImageSource,
	width: number,
	height: number,
	adjustments: EditorColorGradeAdjustments,
	createCompositor?: EditorColorCompositorFactory
): HTMLCanvasElement | null {
	const renderer = new ImageGradeRenderer(createCompositor);
	const result = renderer.render(source, width, height, adjustments);
	renderer.dispose();
	return result?.canvas ?? null;
}

export function applyImageGradePixels(
	pixels: Uint8ClampedArray,
	adjustments: EditorColorGradeAdjustments
): void {
	applyColorEffectsToPixels(pixels, editorColorGradeAdjustmentsToEffects(adjustments));
}
