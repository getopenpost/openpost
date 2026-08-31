/** Shared preview/export compositor for transformed layers and real backdrops. */

import type { TimelineItem, TimelineTransition } from '../project/types';
import { effectsToCssFilter } from '../effects/filter';
import type { GpuRenderEffect } from '../effects/gpu/compositor';
import { getGpuEffectDefaultParams } from '../effects/gpu/registry';
import { isNonNormalBlend } from '../effects/gpu/blend-modes';
import { blendImageData } from '../effects/gpu/cpu-blend';
import { mediaDrawGeometry, type MediaDrawGeometry } from './render-geometry';
import { applyCropFeatherMask, hasCropFeather } from './crop-layout';
import { transitionRegistry } from '../transitions';
import { TransitionPipeline } from '../transitions/gpu/pipeline';
import { ShapeMaskRasterizer } from '../shapes/masks';
import { drawCornerPinImage, hasCornerPin, resolveCornerPinForSize } from '../preview/corner-pin';
import { clampBackground } from '../backgrounds/types';
import {
	createBackgroundGpuRenderer,
	GPU_BACKGROUND_PIXEL_THRESHOLD,
	renderBackgroundCpu,
	type BackgroundGpuAdapter
} from '../backgrounds/render';
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
	source: StackLayerSource | null;
	item: TimelineItem;
	alpha: number;
	masks?: TimelineItem[];
}

export interface CanvasStackDiagnostics {
	webgl2Ready: boolean;
	webgpuTransitionsReady: boolean;
}

export interface BackgroundDiagnostics {
	gpuCalls: number;
	cpuFallbacks: number;
	lastKey: string | null;
}

export interface CanvasStackCompositorOptions {
	backgroundAdapter?: BackgroundGpuAdapter | null;
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
	if (pooled) return pooled.canvas;
	return createRawCanvas(width, height);
}

function releaseCanvas(canvas: StackCanvas | null): void {
	if (!canvas) return;
	canvasPool.release(canvas);
}

interface CanvasSizeResult {
	canvas: StackCanvas;
	context: StackContext;
}

function ensureCanvasSize(
	canvas: StackCanvas,
	context: StackContext,
	targetWidth: number,
	targetHeight: number
): CanvasSizeResult {
	if (canvas.width === targetWidth && canvas.height === targetHeight) return { canvas, context };
	const pooled = canvasPool.acquire(targetWidth, targetHeight);
	if (pooled) {
		releaseCanvas(canvas);
		const nextCanvas = pooled.canvas;
		const nextContext = nextCanvas.getContext('2d');
		if (!nextContext) throw new Error('Failed to acquire pooled canvas context.');
		nextContext.imageSmoothingEnabled = true;
		nextContext.imageSmoothingQuality = 'high';
		return { canvas: nextCanvas, context: nextContext };
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
	if (hasCropFeather(geometry.featherPixels)) {
		const width = Math.max(1, Math.ceil(geometry.drawWidth));
		const height = Math.max(1, Math.ceil(geometry.drawHeight));
		const localCanvas = acquireCanvas(width, height);
		const localContext = localCanvas.getContext('2d');
		if (localContext) {
			localContext.globalAlpha = 1;
			localContext.globalCompositeOperation = 'source-over';
			localContext.filter = 'none';
			localContext.clearRect(0, 0, width, height);
			drawMediaIntoLocalCanvas(localContext, image, geometry, transform.cornerRadius ?? 0, true);
			context.save();
			applyLayerTransform(context, transform, item.effects, geometry, alpha);
			context.drawImage(localCanvas, -geometry.anchorX, -geometry.anchorY);
			context.restore();
		}
		releaseCanvas(localCanvas);
		return;
	}
	context.save();
	applyLayerTransform(context, transform, item.effects, geometry, alpha);
	clipRoundedRect(
		context,
		-geometry.anchorX,
		-geometry.anchorY,
		geometry.drawWidth,
		geometry.drawHeight,
		transform.cornerRadius ?? 0
	);
	clipRect(context, geometry.viewportRect, -geometry.anchorX, -geometry.anchorY);
	context.drawImage(
		image,
		geometry.sourceX,
		geometry.sourceY,
		geometry.sourceWidth,
		geometry.sourceHeight,
		-geometry.anchorX + geometry.mediaRect.x,
		-geometry.anchorY + geometry.mediaRect.y,
		geometry.mediaRect.width,
		geometry.mediaRect.height
	);
	context.restore();
}

function applyLayerTransform(
	context: StackContext,
	transform: NonNullable<TimelineItem['transform']>,
	effects: TimelineItem['effects'],
	geometry: MediaDrawGeometry,
	alpha: number
): void {
	context.globalAlpha = Math.min(1, Math.max(0, alpha));
	context.filter = effectsToCssFilter(effects) || 'none';
	context.translate(geometry.centerX, geometry.centerY);
	context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
	context.scale(
		(transform.flipHorizontal === true ? -1 : 1) * (transform.scaleX ?? 1),
		(transform.flipVertical === true ? -1 : 1) * (transform.scaleY ?? 1)
	);
}

function drawMediaIntoLocalCanvas(
	context: StackContext,
	image: CanvasImageSource,
	geometry: MediaDrawGeometry,
	cornerRadius: number,
	applyFeather: boolean
): void {
	context.save();
	clipRoundedRect(context, 0, 0, geometry.drawWidth, geometry.drawHeight, cornerRadius);
	clipRect(context, geometry.viewportRect);
	context.drawImage(
		image,
		geometry.sourceX,
		geometry.sourceY,
		geometry.sourceWidth,
		geometry.sourceHeight,
		geometry.mediaRect.x,
		geometry.mediaRect.y,
		geometry.mediaRect.width,
		geometry.mediaRect.height
	);
	context.restore();
	if (applyFeather) applyCropFeatherMask(context, geometry.viewportRect, geometry.featherPixels);
}

function clipRoundedRect(
	context: StackContext,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number
): void {
	const cornerRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
	if (cornerRadius <= 0) return;
	context.beginPath();
	const pathContext: RoundedPathContext = context;
	if (pathContext.roundRect) pathContext.roundRect(x, y, width, height, cornerRadius);
	else pathContext.rect(x, y, width, height);
	context.clip();
}

function clipRect(
	context: StackContext,
	rect: { x: number; y: number; width: number; height: number },
	offsetX = 0,
	offsetY = 0
): void {
	context.beginPath();
	context.rect(offsetX + rect.x, offsetY + rect.y, rect.width, rect.height);
	context.clip();
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
	private backgroundCanvas: StackCanvas;
	private backgroundContext: StackContext;
	private backgroundGpu: BackgroundGpuAdapter | null = null;
	private readonly createBackgroundGpuOnDemand: boolean;
	private lastBackgroundKey: string | null = null;
	private gpuCallCount = 0;
	private cpuFallbackCount = 0;
	private lastBackgroundW = 0;
	private lastBackgroundH = 0;
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
		withTransitionBranches = true,
		options?: CanvasStackCompositorOptions
	) {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Failed to create the composition canvas context.');
		this.context = context;
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.layerCanvas = acquireCanvas(1, 1);
		const layerContext = this.layerCanvas.getContext('2d');
		if (!layerContext) throw new Error('Failed to create the layer canvas context.');
		this.layerContext = layerContext;
		this.layerContext.imageSmoothingEnabled = true;
		this.layerContext.imageSmoothingQuality = 'high';
		this.cornerPinCanvas = acquireCanvas(1, 1);
		const cornerPinContext = this.cornerPinCanvas.getContext('2d');
		if (!cornerPinContext) throw new Error('Failed to create the corner pin canvas context.');
		this.cornerPinContext = cornerPinContext;
		this.cornerPinContext.imageSmoothingEnabled = true;
		this.cornerPinContext.imageSmoothingQuality = 'high';
		this.backgroundCanvas = acquireCanvas(1, 1);
		const backgroundContext = this.backgroundCanvas.getContext('2d');
		if (!backgroundContext) throw new Error('Failed to create the background canvas context.');
		this.backgroundContext = backgroundContext;
		this.backgroundContext.imageSmoothingEnabled = true;
		this.backgroundContext.imageSmoothingQuality = 'high';
		if (options && 'backgroundAdapter' in options) {
			this.backgroundGpu = options.backgroundAdapter ?? null;
			this.createBackgroundGpuOnDemand = false;
		} else {
			this.createBackgroundGpuOnDemand = true;
		}
		this.sharedGpu = acquireSharedGpuCompositor();
		if (withTransitionBranches) {
			this.transitionLeftCanvas = acquireCanvas(1, 1);
			this.transitionRightCanvas = acquireCanvas(1, 1);
			this.transitionOutputCanvas = acquireCanvas(1, 1);
			this.transitionOutputContext = this.transitionOutputCanvas.getContext('2d');
			const leftStackOptions: CanvasStackCompositorOptions | undefined =
				options && 'backgroundAdapter' in options
					? { backgroundAdapter: options.backgroundAdapter }
					: undefined;
			this.transitionLeftStack = new CanvasStackCompositor(
				this.transitionLeftCanvas,
				false,
				leftStackOptions
			);
			this.transitionRightStack = new CanvasStackCompositor(
				this.transitionRightCanvas,
				false,
				leftStackOptions
			);
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
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.context.globalAlpha = 1;
		this.context.globalCompositeOperation = 'source-over';
		this.context.filter = 'none';
	}

	beginFrame(width: number, height: number, backgroundColor: string | null): void {
		this.resize(width, height);
		if (backgroundColor === null) {
			this.context.clearRect(0, 0, this.width, this.height);
		} else {
			this.context.fillStyle = backgroundColor;
			this.context.fillRect(0, 0, this.width, this.height);
		}
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

	private backgroundStackSource(item: TimelineItem): StackLayerSource | null {
		if (item.type !== 'background' || !item.background) return null;
		const bg = clampBackground(item.background);
		const transform = item.transform ?? {};
		const width = Math.max(1, Math.round(transform.width ?? this.width));
		const height = Math.max(1, Math.round(transform.height ?? this.height));
		const key = `${JSON.stringify(bg)}_${width}x${height}`;
		if (
			this.lastBackgroundKey === key &&
			this.lastBackgroundW === width &&
			this.lastBackgroundH === height
		) {
			return { source: this.backgroundCanvas, width, height };
		}
		const next = ensureCanvasSize(this.backgroundCanvas, this.backgroundContext, width, height);
		this.backgroundCanvas = next.canvas;
		this.backgroundContext = next.context;
		this.backgroundContext.clearRect(0, 0, width, height);
		if (
			!this.backgroundGpu &&
			this.createBackgroundGpuOnDemand &&
			width * height >= GPU_BACKGROUND_PIXEL_THRESHOLD
		) {
			this.backgroundGpu = createBackgroundGpuRenderer();
		}
		if (this.backgroundGpu && width * height >= GPU_BACKGROUND_PIXEL_THRESHOLD) {
			const ok = this.backgroundGpu.render(bg, width, height);
			if (ok) {
				this.gpuCallCount++;
				this.backgroundContext.drawImage(this.backgroundGpu.canvas, 0, 0);
			} else {
				this.cpuFallbackCount++;
				renderBackgroundCpu(this.backgroundContext, bg, width, height);
				return { source: this.backgroundCanvas, width, height };
			}
		} else {
			this.cpuFallbackCount++;
			renderBackgroundCpu(this.backgroundContext, bg, width, height);
		}
		this.lastBackgroundKey = key;
		this.lastBackgroundW = width;
		this.lastBackgroundH = height;
		return { source: this.backgroundCanvas, width, height };
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
		drawMediaIntoLocalCanvas(
			this.cornerPinContext,
			image,
			geometry,
			item.transform?.cornerRadius ?? 0,
			hasCropFeather(geometry.featherPixels)
		);

		const transform = item.transform ?? {};
		context.save();
		context.globalAlpha = Math.min(1, Math.max(0, alpha));
		context.filter = effectsToCssFilter(item.effects) || 'none';
		context.translate(geometry.centerX, geometry.centerY);
		context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
		context.scale(
			(transform.flipHorizontal === true ? -1 : 1) * (transform.scaleX ?? 1),
			(transform.flipVertical === true ? -1 : 1) * (transform.scaleY ?? 1)
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
		source: StackLayerSource | null,
		item: TimelineItem,
		alpha: number,
		time: number,
		masks: readonly TimelineItem[] = []
	): void {
		const bgSource = this.backgroundStackSource(item);
		const effectiveSource = bgSource ?? source;
		if (!effectiveSource) return;
		const processed = this.renderGpuEffects(effectiveSource, item, time);
		const blendMode = item.blendMode ?? 'normal';
		const needsLayerCanvas =
			masks.length > 0 || isNonNormalBlend(blendMode) || hasCornerPin(item.cornerPin);
		if (!needsLayerCanvas) {
			drawTransformedLayer(
				this.context,
				processed,
				effectiveSource.width,
				effectiveSource.height,
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
		this.drawLayer(this.layerContext, processed, effectiveSource, item, alpha);
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
		} else if (
			outCtx instanceof OffscreenCanvasRenderingContext2D &&
			leftCanvas instanceof OffscreenCanvas &&
			rightCanvas instanceof OffscreenCanvas
		) {
			renderer(
				outCtx,
				leftCanvas,
				rightCanvas,
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

	getBackgroundDiagnostics(): BackgroundDiagnostics {
		return {
			gpuCalls: this.gpuCallCount,
			cpuFallbacks: this.cpuFallbackCount,
			lastKey: this.lastBackgroundKey
		};
	}

	setBackgroundAdapter(adapter: BackgroundGpuAdapter | null): void {
		if (this.backgroundGpu) this.backgroundGpu.dispose();
		this.backgroundGpu = adapter;
		this.lastBackgroundKey = null;
	}

	getBackgroundCanvasForTest(): StackCanvas {
		return this.backgroundCanvas;
	}

	getCanvasForTest(): StackCanvas {
		return this.canvas;
	}

	getBackgroundAdapterForTest(): BackgroundGpuAdapter | null {
		return this.backgroundGpu;
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
		releaseCanvas(this.backgroundCanvas);
		if (this.backgroundGpu) {
			this.backgroundGpu.dispose();
			this.backgroundGpu = null;
		}
		if (this.transitionLeftCanvas) releaseCanvas(this.transitionLeftCanvas);
		if (this.transitionRightCanvas) releaseCanvas(this.transitionRightCanvas);
		if (this.transitionOutputCanvas) releaseCanvas(this.transitionOutputCanvas);
	}
}
