import type { TimelineItem } from '../project/types';
import { mediaDrawGeometry } from '../media/render-geometry';
import { buildShapePath } from './render';
import { drawCornerPinImage, hasCornerPin, resolveCornerPinForSize } from '../preview/corner-pin';

type MaskCanvas = HTMLCanvasElement | OffscreenCanvas;
type MaskContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createMaskCanvas(): MaskCanvas {
	return typeof OffscreenCanvas === 'function'
		? new OffscreenCanvas(1, 1)
		: document.createElement('canvas');
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function resize(canvas: MaskCanvas, width: number, height: number): void {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
}

/** A mask on a higher timeline track affects an item on every lower track. */
export function doesShapeMaskAffectTrack(maskTrackOrder: number, itemTrackOrder: number): boolean {
	return maskTrackOrder < itemTrackOrder;
}

/** Keep only shape masks whose timeline track sits above the target item. */
export function shapeMasksForTrack(
	masks: TimelineItem[],
	itemTrackOrder: number,
	trackOrderById: ReadonlyMap<string, number>
): TimelineItem[] {
	return masks.filter((mask) =>
		doesShapeMaskAffectTrack(trackOrderById.get(mask.trackId) ?? 0, itemTrackOrder)
	);
}

/**
 * Persistent browser-canvas mask pipeline shared by preview, nested timelines,
 * still capture, and export. Each mask intersects the previous result.
 */
export class ShapeMaskRasterizer {
	private readonly localCanvas = createMaskCanvas();
	private readonly matteCanvas = createMaskCanvas();
	private readonly featherCanvas = createMaskCanvas();
	private readonly localContext: MaskContext;
	private readonly matteContext: MaskContext;
	private readonly featherContext: MaskContext;

	constructor() {
		const localContext = this.localCanvas.getContext('2d');
		const matteContext = this.matteCanvas.getContext('2d');
		const featherContext = this.featherCanvas.getContext('2d');
		if (!localContext || !matteContext || !featherContext) {
			throw new Error('Failed to create the shape mask canvas contexts.');
		}
		this.localContext = localContext;
		this.matteContext = matteContext;
		this.featherContext = featherContext;
	}

	private paintLocalSilhouette(mask: TimelineItem, width: number, height: number): void {
		resize(this.localCanvas, width, height);
		this.localContext.globalAlpha = 1;
		this.localContext.globalCompositeOperation = 'source-over';
		this.localContext.filter = 'none';
		this.localContext.clearRect(0, 0, width, height);
		buildShapePath(
			this.localContext,
			{ ...mask, pathClosed: true, strokeEnabled: false },
			width,
			height
		);
		this.localContext.fillStyle = '#ffffff';
		this.localContext.fill();
	}

	private paintTransformedSilhouette(mask: TimelineItem, width: number, height: number): void {
		const localWidth = Math.max(1, Math.round(mask.transform?.width ?? width));
		const localHeight = Math.max(1, Math.round(mask.transform?.height ?? height));
		this.paintLocalSilhouette(mask, localWidth, localHeight);

		const geometry = mediaDrawGeometry(mask, localWidth, localHeight, width, height);
		const transform = mask.transform ?? {};
		this.matteContext.save();
		this.matteContext.translate(geometry.centerX, geometry.centerY);
		this.matteContext.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
		this.matteContext.scale(
			(transform.flipHorizontal === true ? -1 : 1) * (transform.scaleX ?? 1),
			(transform.flipVertical === true ? -1 : 1) * (transform.scaleY ?? 1)
		);
		const pin = resolveCornerPinForSize(mask.cornerPin, localWidth, localHeight);
		if (pin && hasCornerPin(pin)) {
			drawCornerPinImage(
				this.matteContext,
				this.localCanvas,
				localWidth,
				localHeight,
				-geometry.anchorX,
				-geometry.anchorY,
				pin
			);
		} else {
			this.matteContext.drawImage(
				this.localCanvas,
				0,
				0,
				localWidth,
				localHeight,
				-geometry.anchorX,
				-geometry.anchorY,
				geometry.drawWidth,
				geometry.drawHeight
			);
		}
		this.matteContext.restore();
	}

	private renderMatte(mask: TimelineItem, width: number, height: number): MaskCanvas {
		resize(this.matteCanvas, width, height);
		resize(this.featherCanvas, width, height);
		this.matteContext.globalAlpha = 1;
		this.matteContext.globalCompositeOperation = 'source-over';
		this.matteContext.filter = 'none';
		this.matteContext.clearRect(0, 0, width, height);

		if (mask.maskInvert) {
			this.matteContext.fillStyle = '#ffffff';
			this.matteContext.fillRect(0, 0, width, height);
			this.matteContext.globalCompositeOperation = 'destination-out';
		}
		this.paintTransformedSilhouette(mask, width, height);
		this.matteContext.globalCompositeOperation = 'source-over';

		const feather = mask.maskType === 'alpha' ? Math.max(0, Math.round(mask.maskFeather ?? 0)) : 0;
		if (feather === 0) return this.matteCanvas;

		this.featherContext.globalAlpha = 1;
		this.featherContext.globalCompositeOperation = 'source-over';
		this.featherContext.clearRect(0, 0, width, height);
		this.featherContext.filter = `blur(${feather}px)`;
		this.featherContext.drawImage(this.matteCanvas, 0, 0);
		this.featherContext.filter = 'none';
		return this.featherCanvas;
	}

	apply(
		layerContext: MaskContext,
		masks: readonly TimelineItem[],
		width: number,
		height: number
	): void {
		for (const mask of masks) {
			if (mask.type !== 'shape' || mask.isMask !== true) continue;
			const matte = this.renderMatte(mask, width, height);
			const opacity =
				clamp((mask.maskOpacity ?? 100) / 100, 0, 1) * clamp(mask.transform?.opacity ?? 1, 0, 1);
			layerContext.globalCompositeOperation = 'destination-in';
			layerContext.globalAlpha = opacity;
			layerContext.filter = 'none';
			layerContext.drawImage(matte, 0, 0, width, height);
			layerContext.globalAlpha = 1;
			layerContext.globalCompositeOperation = 'source-over';
		}
	}
}
