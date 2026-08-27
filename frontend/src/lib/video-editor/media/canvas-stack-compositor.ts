/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- Canvas stack bridges browser canvas and WebGL resources with checked 2d contexts */
/** Shared preview/export compositor for transformed layers and real backdrops. */

import type { TimelineItem, TimelineTransition } from '../project/types';
import { effectsToCssFilter } from '../effects/filter';
import type { GpuRenderEffect } from '../effects/gpu/compositor';
import { getGpuEffectDefaultParams } from '../effects/gpu/registry';
import { isNonNormalBlend } from '../effects/gpu/blend-modes';
import { blendImageData } from '../effects/gpu/cpu-blend';
import { mediaDrawGeometry } from './render-geometry';
import { transitionRegistry } from '../transitions';
import { TransitionPipeline } from '../transitions/gpu/pipeline';
import { ShapeMaskRasterizer } from '../shapes/masks';
import { drawCornerPinImage, hasCornerPin, resolveCornerPinForSize } from '../preview/corner-pin';
import { canvasPool } from '../effects/gpu/gpu-resource-pool';
import {
	acquireSharedGpuCompositor,
	releaseSharedGpuCompositor
} from '../effects/gpu/shared-gpu-compositor';

type StackCanvas = HTMLCanvasElement | OffscreenCanvas;
type StackContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface RoundedPathContext {
	roundRect?: (x: number, y: number, width: number, height: number, radius: number) => void;
	rect: (x: number, y: number, width: number, height: number) => void;
}

export interface StackLayerSource {
	source: CanvasImageSource & TexImageSource;
	width: number;
	height: number;
}

export interface StackTransitionParticipant {
	source: StackLayerSource;
	item: TimelineItem;
	alpha: number;
	masks?: TimelineItem[];
}

export interface CanvasStackDiagnostics {
	webgl2Ready: boolean;
	webgpuTransitionsReady: boolean;
}

function createRawCanvas(width: number, height: number): StackCanvas {
	if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
	const c = document.createElement('canvas');
	c.width = width;
	c.height = height;
	return c;
}

function acquireCanvas(width: number, height: number): StackCanvas {
	const pooled = canvasPool.acquire(width, height);
	if (pooled) return pooled.canvas as StackCanvas;
	return createRawCanvas(width, height);
}

function releaseCanvas(canvas: StackCanvas | null): void {
	if (!canvas) return;
	canvasPool.release(canvas);
}

function ensureCanvasSize(
	canvas: StackCanvas,
	context: StackContext,
	targetWidth: number,
	targetHeight: number
): { canvas: StackCanvas; context: StackContext } {
	if (canvas.width === targetWidth && canvas.height === targetHeight) return { canvas, context };
	const pooled = canvasPool.acquire(targetWidth, targetHeight);
	if (pooled) {
		releaseCanvas(canvas);
		const nextCanvas = pooled.canvas as StackCanvas;
		const nextContext = nextCanvas.getContext('2d');
		if (!nextContext) throw new Error('Failed to acquire pooled canvas context.');
		nextContext.imageSmoothingEnabled = true;
		nextContext.imageSmoothingQuality = 'high';
		return { canvas: nextCanvas, context: nextContext as StackContext };
	}
	canvas.width = targetWidth;
	canvas.height = targetHeight;
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	return { canvas, context };
}

export function itemOpacity(item: TimelineItem): number {
	return Math.min(1, Math.max(0, item.transform?.opacity ?? 1));
}

export function drawTransformedLayer(
	context: StackContext,
	image: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number,
	alpha: number
): void {
	const transform = item.transform ?? {};
	const geometry = mediaDrawGeometry(item, sourceWidth, sourceHeight, canvasWidth, canvasHeight);
	context.save();
	context.globalAlpha = Math.min(1, Math.max(0, alpha));
	context.filter = effectsToCssFilter(item.effects) || 'none';
	context.translate(geometry.centerX, geometry.centerY);
	context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
	context.scale(
		transform.flipHorizontal === true ? -1 : 1,
		transform.flipVertical === true ? -1 : 1
	);
	const cornerRadius = Math.min(
		Math.max(0, transform.cornerRadius ?? 0),
		geometry.drawWidth / 2,
		geometry.drawHeight / 2
	);
	if (cornerRadius > 0) {
		context.beginPath();
		const pathContext: RoundedPathContext = context;
		if (pathContext.roundRect) {
			pathContext.roundRect(
				-geometry.anchorX,
				-geometry.anchorY,
				geometry.drawWidth,
				geometry.drawHeight,
				cornerRadius
			);
		} else {
			pathContext.rect(
				-geometry.anchorX,
				-geometry.anchorY,
				geometry.drawWidth,
				geometry.drawHeight
			);
		}
		context.clip();
	}
	context.drawImage(
		image,
		geometry.sourceX,
		geometry.sourceY,
		geometry.sourceWidth,
		geometry.sourceHeight,
		-geometry.anchorX,
		-geometry.anchorY,
		geometry.drawWidth,
		geometry.drawHeight
	);
	context.restore();
}

/** One persistent canvas stack sharing a single WebGL2 compositor across preview and export. */
export class CanvasStackCompositor {
	private readonly context: StackContext;
	private layerCanvas: StackCanvas;
	private layerContext: StackContext;
	private sharedGpu: {
		compositor: import('../effects/gpu/compositor').GpuCompositor;
		canvas: StackCanvas;
	} | null;
	private readonly maskRasterizer = new ShapeMaskRasterizer();
	private cornerPinCanvas: StackCanvas;
	private cornerPinContext: StackContext;
	private transitionLeftCanvas: StackCanvas | null;
	private transitionRightCanvas: StackCanvas | null;
	private transitionOutputCanvas: StackCanvas | null;
	private transitionOutputContext: StackContext | null;
	private readonly transitionLeftStack: CanvasStackCompositor | null;
	private readonly transitionRightStack: CanvasStackCompositor | null;
	private transitionPipeline: TransitionPipeline | null = null;
	private transitionDevice: GPUDevice | null = null;
	private disposed = false;
	private width = 1;
	private height = 1;
	private lastFailure: string | null = null;
	private exactRenderFailure: string | null = null;

	constructor(
		private readonly canvas: StackCanvas,
		withTransitionBranches = true
	) {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Failed to create the composition canvas context.');
		this.context = context;
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.layerCanvas = acquireCanvas(1, 1);
		const layerContext = this.layerCanvas.getContext('2d');
		if (!layerContext) throw new Error('Failed to create the layer canvas context.');
		this.layerContext = layerContext as StackContext;
		this.layerContext.imageSmoothingEnabled = true;
		this.layerContext.imageSmoothingQuality = 'high';
		this.cornerPinCanvas = acquireCanvas(1, 1);
		const cornerPinContext = this.cornerPinCanvas.getContext('2d');
		if (!cornerPinContext) throw new Error('Failed to create the corner pin canvas context.');
		this.cornerPinContext = cornerPinContext as StackContext;
		this.cornerPinContext.imageSmoothingEnabled = true;
		this.cornerPinContext.imageSmoothingQuality = 'high';
		this.sharedGpu = acquireSharedGpuCompositor();
		if (withTransitionBranches) {
			this.transitionLeftCanvas = acquireCanvas(1, 1);
			this.transitionRightCanvas = acquireCanvas(1, 1);
			this.transitionOutputCanvas = acquireCanvas(1, 1);
			this.transitionOutputContext = this.transitionOutputCanvas.getContext(
				'2d'
			) as StackContext | null;
			this.transitionLeftStack = new CanvasStackCompositor(this.transitionLeftCanvas, false);
			this.transitionRightStack = new CanvasStackCompositor(this.transitionRightCanvas, false);
			void this.initializeTransitionPipeline();
		} else {
			this.transitionLeftCanvas = null;
			this.transitionRightCanvas = null;
			this.transitionOutputCanvas = null;
			this.transitionOutputContext = null;
			this.transitionLeftStack = null;
			this.transitionRightStack = null;
		}
	}

	private async initializeTransitionPipeline(): Promise<void> {
		const gpu = globalThis.navigator?.gpu;
		if (!gpu) return;
		try {
			const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
			if (!adapter || this.disposed) return;
			const device = await adapter.requestDevice();
			if (this.disposed) {
				device.destroy();
				return;
			}
			this.transitionDevice = device;
			this.transitionPipeline = TransitionPipeline.create(device);
		} catch {
			// Canvas2D remains the exact fallback when WebGPU is unavailable or blocked.
		}
	}

	private resize(width: number, height: number): void {
		this.width = Math.max(1, Math.round(width));
		this.height = Math.max(1, Math.round(height));
		if (this.canvas.width !== this.width) this.canvas.width = this.width;
		if (this.canvas.height !== this.height) this.canvas.height = this.height;
		const nextLayer = ensureCanvasSize(
			this.layerCanvas,
			this.layerContext,
			this.width,
			this.height
		);
		this.layerCanvas = nextLayer.canvas;
		this.layerContext = nextLayer.context;
		if (this.transitionOutputCanvas && this.transitionOutputContext) {
			const nextOut = ensureCanvasSize(
				this.transitionOutputCanvas,
				this.transitionOutputContext,
				this.width,
				this.height
			);
			this.transitionOutputCanvas = nextOut.canvas;
			this.transitionOutputContext = nextOut.context;
		}
		// Do not replace transitionLeftCanvas/rightCanvas here: each branch stack owns its canvas and resizes itself on beginFromBackdrop. Replacing only the parent field would detach the branch renderer from the canvas passed to the transition.
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.context.globalAlpha = 1;
		this.context.globalCompositeOperation = 'source-over';
		this.context.filter = 'none';
	}

	beginFrame(width: number, height: number, backgroundColor: string): void {
		this.resize(width, height);
		this.context.fillStyle = backgroundColor;
		this.context.fillRect(0, 0, this.width, this.height);
		this.lastFailure = null;
		this.exactRenderFailure = null;
	}

	private beginFromBackdrop(backdrop: StackCanvas, width: number, height: number): void {
		this.resize(width, height);
		this.context.globalCompositeOperation = 'copy';
		this.context.drawImage(backdrop, 0, 0, this.width, this.height);
		this.context.globalCompositeOperation = 'source-over';
		this.lastFailure = null;
		this.exactRenderFailure = null;
	}

	private recordExactRenderFailure(reason: string): void {
		this.exactRenderFailure ??= reason;
		this.lastFailure ??= reason;
	}

	private gpuEffects(item: TimelineItem): GpuRenderEffect[] {
		return (item.effects ?? []).flatMap((effect) =>
			effect.type === 'gpu' && effect.enabled
				? [
						{
							effectId: effect.effectId,
							params: {
								...getGpuEffectDefaultParams(effect.effectId),
								...effect.params
							}
						}
					]
				: []
		);
	}

	private renderGpuEffects(
		source: StackLayerSource,
		item: TimelineItem,
		time: number
	): CanvasImageSource {
		const effects = this.gpuEffects(item);
		if (effects.length === 0) return source.source;
		if (!this.sharedGpu) {
			this.recordExactRenderFailure('WebGL2 is unavailable for enabled GPU effects');
			return source.source;
		}
		const rendered = this.sharedGpu.compositor.render(
			source.source,
			source.width,
			source.height,
			effects,
			{ time }
		);
		if (!rendered) {
			this.recordExactRenderFailure(
				this.sharedGpu.compositor.failureReason() ?? 'An enabled GPU effect could not render'
			);
			return source.source;
		}
		return this.sharedGpu.canvas;
	}

	private drawLayer(
		context: StackContext,
		image: CanvasImageSource,
		source: StackLayerSource,
		item: TimelineItem,
		alpha: number
	): void {
		const geometry = mediaDrawGeometry(item, source.width, source.height, this.width, this.height);
		const pinWidth = Math.max(1, Math.round(geometry.drawWidth));
		const pinHeight = Math.max(1, Math.round(geometry.drawHeight));
		const pin = resolveCornerPinForSize(item.cornerPin, pinWidth, pinHeight);
		if (!pin || !hasCornerPin(pin)) {
			drawTransformedLayer(
				context,
				image,
				source.width,
				source.height,
				item,
				this.width,
				this.height,
				alpha
			);
			return;
		}

		const nextPin = ensureCanvasSize(
			this.cornerPinCanvas,
			this.cornerPinContext,
			pinWidth,
			pinHeight
		);
		this.cornerPinCanvas = nextPin.canvas;
		this.cornerPinContext = nextPin.context;
		this.cornerPinContext.globalAlpha = 1;
		this.cornerPinContext.globalCompositeOperation = 'source-over';
		this.cornerPinContext.filter = 'none';
		this.cornerPinContext.clearRect(0, 0, pinWidth, pinHeight);
		this.cornerPinContext.drawImage(
			image,
			geometry.sourceX,
			geometry.sourceY,
			geometry.sourceWidth,
			geometry.sourceHeight,
			0,
			0,
			pinWidth,
			pinHeight
		);

		const transform = item.transform ?? {};
		context.save();
		context.globalAlpha = Math.min(1, Math.max(0, alpha));
		context.filter = effectsToCssFilter(item.effects) || 'none';
		context.translate(geometry.centerX, geometry.centerY);
		context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
		context.scale(
			transform.flipHorizontal === true ? -1 : 1,
			transform.flipVertical === true ? -1 : 1
		);
		drawCornerPinImage(
			context,
			this.cornerPinCanvas,
			pinWidth,
			pinHeight,
			-geometry.anchorX,
			-geometry.anchorY,
			pin
		);
		context.restore();
	}

	compositeLayer(
		source: StackLayerSource,
		item: TimelineItem,
		alpha: number,
		time: number,
		masks: readonly TimelineItem[] = []
	): void {
		const processed = this.renderGpuEffects(source, item, time);
		const blendMode = item.blendMode ?? 'normal';
		const needsLayerCanvas =
			masks.length > 0 || isNonNormalBlend(blendMode) || hasCornerPin(item.cornerPin);
		if (!needsLayerCanvas) {
			drawTransformedLayer(
				this.context,
				processed,
				source.width,
				source.height,
				item,
				this.width,
				this.height,
				alpha
			);
			return;
		}

		this.layerContext.globalAlpha = 1;
		this.layerContext.globalCompositeOperation = 'source-over';
		this.layerContext.filter = 'none';
		this.layerContext.clearRect(0, 0, this.width, this.height);
		this.drawLayer(this.layerContext, processed, source, item, alpha);
		this.maskRasterizer.apply(this.layerContext, masks, this.width, this.height);

		if (!isNonNormalBlend(blendMode)) {
			this.context.globalAlpha = 1;
			this.context.globalCompositeOperation = 'source-over';
			this.context.filter = 'none';
			this.context.drawImage(this.layerCanvas, 0, 0, this.width, this.height);
			return;
		}

		if (
			this.sharedGpu?.compositor.render(this.layerCanvas, this.width, this.height, [], {
				time,
				blendMode,
				backdrop: this.canvas,
				dissolveAlpha: alpha
			})
		) {
			this.context.globalAlpha = 1;
			this.context.globalCompositeOperation = 'copy';
			this.context.filter = 'none';
			this.context.drawImage(this.sharedGpu.canvas, 0, 0);
			this.context.globalCompositeOperation = 'source-over';
			return;
		}

		this.lastFailure = this.sharedGpu?.compositor.failureReason() ?? 'WebGL2 unavailable';
		const basePixels = this.context.getImageData(0, 0, this.width, this.height);
		const layerPixels = this.layerContext.getImageData(0, 0, this.width, this.height);
		this.context.putImageData(blendImageData(basePixels, layerPixels, blendMode, alpha), 0, 0);
	}

	/** Transition two complete scene branches, then keep painting higher tracks. */
	compositeTransition(
		outgoing: StackTransitionParticipant,
		incoming: StackTransitionParticipant,
		transition: TimelineTransition,
		progress: number,
		time: number
	): boolean {
		const leftStack = this.transitionLeftStack;
		const rightStack = this.transitionRightStack;
		const leftCanvas = this.transitionLeftCanvas;
		const rightCanvas = this.transitionRightCanvas;
		const outputCanvas = this.transitionOutputCanvas;
		const outputContext = this.transitionOutputContext;
		if (
			!leftStack ||
			!rightStack ||
			!leftCanvas ||
			!rightCanvas ||
			!outputCanvas ||
			!outputContext
		) {
			this.recordExactRenderFailure('Transition branches unavailable');
			return false;
		}
		const presentation =
			transition.presentation ?? (transition.type === 'fade-black' ? 'dipToColorDissolve' : 'fade');
		const rendererEntry = transitionRegistry.getRenderer(presentation);
		const renderer = rendererEntry?.renderCanvas;
		if (!renderer) {
			this.recordExactRenderFailure(`Transition renderer unavailable: ${presentation}`);
			return false;
		}

		leftStack.beginFromBackdrop(this.canvas, this.width, this.height);
		rightStack.beginFromBackdrop(this.canvas, this.width, this.height);
		leftStack.compositeLayer(outgoing.source, outgoing.item, outgoing.alpha, time, outgoing.masks);
		rightStack.compositeLayer(incoming.source, incoming.item, incoming.alpha, time, incoming.masks);
		const nextOut = ensureCanvasSize(outputCanvas, outputContext, this.width, this.height);
		this.transitionOutputCanvas = nextOut.canvas;
		this.transitionOutputContext = nextOut.context;
		const outCtx = this.transitionOutputContext;
		const outCanvas = this.transitionOutputCanvas;
		outCtx.globalAlpha = 1;
		outCtx.globalCompositeOperation = 'source-over';
		outCtx.filter = 'none';
		outCtx.clearRect(0, 0, this.width, this.height);
		const gpuOutput =
			rendererEntry.gpuTransitionId &&
			typeof OffscreenCanvas === 'function' &&
			leftCanvas instanceof OffscreenCanvas &&
			rightCanvas instanceof OffscreenCanvas
				? this.transitionPipeline?.render(
						rendererEntry.gpuTransitionId,
						leftCanvas,
						rightCanvas,
						progress,
						this.width,
						this.height,
						transition.direction,
						transition.properties
					)
				: null;
		if (gpuOutput) {
			outCtx.drawImage(gpuOutput, 0, 0, this.width, this.height);
		} else {
			renderer(
				outCtx as OffscreenCanvasRenderingContext2D,
				leftCanvas as OffscreenCanvas,
				rightCanvas as OffscreenCanvas,
				progress,
				transition.direction,
				{ width: this.width, height: this.height },
				transition.properties
			);
		}
		this.context.globalAlpha = 1;
		this.context.globalCompositeOperation = 'copy';
		this.context.filter = 'none';
		this.context.drawImage(outCanvas, 0, 0, this.width, this.height);
		this.context.globalCompositeOperation = 'source-over';
		const branchExactFailure =
			leftStack.exactRenderFailureReason() ?? rightStack.exactRenderFailureReason();
		if (branchExactFailure) this.recordExactRenderFailure(branchExactFailure);
		this.lastFailure ??= leftStack.failureReason() ?? rightStack.failureReason();
		return true;
	}

	failureReason(): string | null {
		return this.lastFailure;
	}

	exactRenderFailureReason(): string | null {
		return this.exactRenderFailure;
	}

	assertExactRender(): void {
		if (!this.exactRenderFailure) return;
		throw new Error(`Video frame could not render exactly: ${this.exactRenderFailure}`);
	}

	diagnostics(): CanvasStackDiagnostics {
		return {
			webgl2Ready: this.sharedGpu !== null,
			webgpuTransitionsReady: this.transitionPipeline !== null
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.sharedGpu) {
			releaseSharedGpuCompositor();
			this.sharedGpu = null;
		}
		this.transitionLeftStack?.dispose();
		this.transitionRightStack?.dispose();
		this.transitionPipeline?.destroy();
		this.transitionDevice?.destroy();
		this.transitionPipeline = null;
		this.transitionDevice = null;
		releaseCanvas(this.layerCanvas);
		releaseCanvas(this.cornerPinCanvas);
		if (this.transitionLeftCanvas) releaseCanvas(this.transitionLeftCanvas);
		if (this.transitionRightCanvas) releaseCanvas(this.transitionRightCanvas);
		if (this.transitionOutputCanvas) releaseCanvas(this.transitionOutputCanvas);
	}
}
