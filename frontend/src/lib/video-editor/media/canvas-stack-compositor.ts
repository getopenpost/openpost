/** Shared preview/export compositor for transformed layers and real backdrops. */

import type { TimelineItem, TimelineTransition } from '../project/types';
import { effectsToCssFilter } from '../effects/filter';
import {
	createGpuCompositor,
	type GpuCompositor,
	type GpuRenderEffect
} from '../effects/gpu/compositor';
import { getGpuEffectDefaultParams } from '../effects/gpu/registry';
import { isNonNormalBlend } from '../effects/gpu/blend-modes';
import { blendImageData } from '../effects/gpu/cpu-blend';
import { mediaDrawGeometry } from './render-geometry';
import { transitionRegistry } from '../transitions';
import { TransitionPipeline } from '../transitions/gpu/pipeline';
import {
	getSharedTransitionDevice,
	getSharedTransitionDeviceSync
} from '../transitions/gpu/shared-device';
import { ShapeMaskRasterizer } from '../shapes/masks';
import { drawCornerPinImage, hasCornerPin, resolveCornerPinForSize } from '../preview/corner-pin';

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
	transitionMode: 'gpu' | 'cpu' | 'undecided';
}

let transitionPipelineCreateCount = 0;
let transitionTextureUploadCount = 0;

export interface TransitionPipelineStats {
	pipelineCreates: number;
	textureUploads: number;
}

export function getTransitionPipelineStats(): TransitionPipelineStats {
	return {
		pipelineCreates: transitionPipelineCreateCount,
		textureUploads: transitionTextureUploadCount
	};
}

export function resetTransitionPipelineStatsForTests(): void {
	transitionPipelineCreateCount = 0;
	transitionTextureUploadCount = 0;
}

function createStackCanvas(): StackCanvas {
	return typeof OffscreenCanvas === 'function'
		? new OffscreenCanvas(1, 1)
		: document.createElement('canvas');
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

/** One persistent canvas stack with a single reusable WebGL2 compositor. */
export class CanvasStackCompositor {
	private readonly context: StackContext;
	private readonly layerCanvas: StackCanvas;
	private readonly layerContext: StackContext;
	private readonly gpuCanvas: StackCanvas;
	private readonly gpuCompositor: GpuCompositor | null;
	private readonly maskRasterizer = new ShapeMaskRasterizer();
	private readonly cornerPinCanvas = createStackCanvas();
	private readonly cornerPinContext: StackContext;
	private readonly transitionLeftCanvas: StackCanvas | null;
	private readonly transitionRightCanvas: StackCanvas | null;
	private readonly transitionOutputCanvas: StackCanvas | null;
	private readonly transitionOutputContext: StackContext | null;
	private readonly transitionLeftStack: CanvasStackCompositor | null;
	private readonly transitionRightStack: CanvasStackCompositor | null;
	private transitionPipeline: TransitionPipeline | null = null;
	private transitionDevice: GPUDevice | null = null;
	private transitionReadyPromise: Promise<'gpu' | 'cpu'> | null = null;
	private transitionMode: 'gpu' | 'cpu' | null = null;
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
		this.layerCanvas = createStackCanvas();
		const layerContext = this.layerCanvas.getContext('2d');
		if (!layerContext) throw new Error('Failed to create the layer canvas context.');
		this.layerContext = layerContext;
		this.layerContext.imageSmoothingEnabled = true;
		this.layerContext.imageSmoothingQuality = 'high';
		const cornerPinContext = this.cornerPinCanvas.getContext('2d');
		if (!cornerPinContext) throw new Error('Failed to create the corner pin canvas context.');
		this.cornerPinContext = cornerPinContext;
		this.cornerPinContext.imageSmoothingEnabled = true;
		this.cornerPinContext.imageSmoothingQuality = 'high';
		this.gpuCanvas = createStackCanvas();
		this.gpuCompositor = createGpuCompositor(this.gpuCanvas);
		if (withTransitionBranches) {
			this.transitionLeftCanvas = createStackCanvas();
			this.transitionRightCanvas = createStackCanvas();
			this.transitionOutputCanvas = createStackCanvas();
			this.transitionOutputContext = this.transitionOutputCanvas.getContext('2d');
			this.transitionLeftStack = new CanvasStackCompositor(this.transitionLeftCanvas, false);
			this.transitionRightStack = new CanvasStackCompositor(this.transitionRightCanvas, false);
		} else {
			this.transitionLeftCanvas = null;
			this.transitionRightCanvas = null;
			this.transitionOutputCanvas = null;
			this.transitionOutputContext = null;
			this.transitionLeftStack = null;
			this.transitionRightStack = null;
		}
	}

	/** Explicit readiness: must be awaited before frame zero. Locks gpu vs cpu for the whole export. */
	async ensureTransitionPipelineReady(): Promise<'gpu' | 'cpu'> {
		if (this.transitionMode) return this.transitionMode;
		if (this.transitionReadyPromise) return this.transitionReadyPromise;
		if (!this.transitionLeftCanvas) {
			this.transitionMode = 'cpu';
			return 'cpu';
		}
		this.transitionReadyPromise = (async (): Promise<'gpu' | 'cpu'> => {
			if (typeof OffscreenCanvas !== 'function') {
				this.transitionMode = 'cpu';
				return 'cpu';
			}
			try {
				const device = await getSharedTransitionDevice();
				if (!device || this.disposed) {
					this.transitionMode = 'cpu';
					return 'cpu';
				}
				// Device loss after preselection must fail the export, not silently switch to cpu.
				if (device.lost) {
					device.lost.then((info) => {
						if (this.transitionDevice === device) {
							this.recordExactRenderFailure(
								`WebGPU device lost: ${info?.reason ?? 'unknown'}: ${info?.message ?? ''}`
							);
							this.transitionDevice = null;
							// Keep transitionMode as 'gpu' so mid-export cannot silently fall back to cpu.
							// The pipeline will be destroyed and subsequent renders will throw.
							this.transitionPipeline?.destroy();
							this.transitionPipeline = null;
						}
					});
				}
				this.transitionDevice = device;
				const pipeline = TransitionPipeline.create(device);
				if (!pipeline) {
					this.transitionMode = 'cpu';
					return 'cpu';
				}
				transitionPipelineCreateCount++;
				this.transitionPipeline = pipeline;
				this.transitionMode = 'gpu';
				return 'gpu';
			} catch {
				this.transitionMode = 'cpu';
				return 'cpu';
			}
		})();
		const mode = await this.transitionReadyPromise;
		this.transitionMode = mode;
		return mode;
	}

	getTransitionMode(): 'gpu' | 'cpu' | null {
		return this.transitionMode;
	}

	/** Precompile/validate every GPU transition ID used by the project before frame 0. */
	async ensureTransitionsPreflight(gpuTransitionIds: string[]): Promise<void> {
		if (gpuTransitionIds.length === 0) return;
		if (this.transitionMode !== 'gpu' || !this.transitionPipeline) {
			// Mode already decided before frame 0; cpu path needs no GPU validation.
			return;
		}
		try {
			await this.transitionPipeline.ensureTransitionsReady(gpuTransitionIds);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.recordExactRenderFailure(reason);
			throw new Error(`Video frame could not render exactly: ${reason}`);
		}
	}

	/** For tests: force cpu fallback before first frame. */
	forceCpuTransitionModeForTests(): void {
		this.transitionMode = 'cpu';
		this.transitionReadyPromise = Promise.resolve('cpu');
		this.transitionPipeline = null;
		this.transitionDevice = null;
	}

	private async initializeTransitionPipeline(): Promise<void> {
		await this.ensureTransitionPipelineReady();
	}

	private resize(width: number, height: number): void {
		this.width = Math.max(1, Math.round(width));
		this.height = Math.max(1, Math.round(height));
		if (this.canvas.width !== this.width) this.canvas.width = this.width;
		if (this.canvas.height !== this.height) this.canvas.height = this.height;
		if (this.layerCanvas.width !== this.width) this.layerCanvas.width = this.width;
		if (this.layerCanvas.height !== this.height) this.layerCanvas.height = this.height;
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.layerContext.imageSmoothingEnabled = true;
		this.layerContext.imageSmoothingQuality = 'high';
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
		if (!this.gpuCompositor) {
			this.recordExactRenderFailure('WebGL2 is unavailable for enabled GPU effects');
			return source.source;
		}
		const rendered = this.gpuCompositor.render(
			source.source,
			source.width,
			source.height,
			effects,
			{ time }
		);
		if (!rendered) {
			this.recordExactRenderFailure(
				this.gpuCompositor.failureReason() ?? 'An enabled GPU effect could not render'
			);
			return source.source;
		}
		return this.gpuCanvas;
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

		if (this.cornerPinCanvas.width !== pinWidth) this.cornerPinCanvas.width = pinWidth;
		if (this.cornerPinCanvas.height !== pinHeight) this.cornerPinCanvas.height = pinHeight;
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
			this.gpuCompositor?.render(this.layerCanvas, this.width, this.height, [], {
				time,
				blendMode,
				backdrop: this.canvas,
				dissolveAlpha: alpha
			})
		) {
			this.context.globalAlpha = 1;
			this.context.globalCompositeOperation = 'copy';
			this.context.filter = 'none';
			this.context.drawImage(this.gpuCanvas, 0, 0);
			this.context.globalCompositeOperation = 'source-over';
			return;
		}

		this.lastFailure = this.gpuCompositor?.failureReason() ?? 'WebGL2 unavailable';
		const basePixels = this.context.getImageData(0, 0, this.width, this.height);
		const layerPixels = this.layerContext.getImageData(0, 0, this.width, this.height);
		this.context.putImageData(blendImageData(basePixels, layerPixels, blendMode, alpha), 0, 0);
	}

	/** Transition two complete scene branches, then keep painting higher tracks.
	 * Caller must await ensureTransitionPipelineReady() before frame zero so the gpu/cpu
	 * choice is locked for the entire export. Mid-export switches are prohibited. */
	compositeTransition(
		outgoing: StackTransitionParticipant,
		incoming: StackTransitionParticipant,
		transition: TimelineTransition,
		progress: number,
		time: number
	): boolean {
		if (this.transitionMode === null && this.transitionLeftCanvas) {
			const reason = 'Transition pipeline readiness not awaited before frame zero';
			this.recordExactRenderFailure(reason);
			throw new Error(`Video frame could not render exactly: ${reason}`);
		}
		if (this.exactRenderFailure) {
			throw new Error(`Video frame could not render exactly: ${this.exactRenderFailure}`);
		}
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
		if (outputCanvas.width !== this.width) outputCanvas.width = this.width;
		if (outputCanvas.height !== this.height) outputCanvas.height = this.height;
		outputContext.globalAlpha = 1;
		outputContext.globalCompositeOperation = 'source-over';
		outputContext.filter = 'none';
		outputContext.clearRect(0, 0, this.width, this.height);
		const canUseGpu =
			this.transitionMode === 'gpu' &&
			rendererEntry.gpuTransitionId !== undefined &&
			typeof OffscreenCanvas === 'function' &&
			leftCanvas instanceof OffscreenCanvas &&
			rightCanvas instanceof OffscreenCanvas &&
			this.transitionPipeline !== null;
		if (canUseGpu) {
			let gpuOutput: OffscreenCanvas | null = null;
			try {
				gpuOutput = this.transitionPipeline!.render(
					rendererEntry.gpuTransitionId!,
					leftCanvas,
					rightCanvas,
					progress,
					this.width,
					this.height,
					transition.direction,
					transition.properties
				);
			} catch (error) {
				this.recordExactRenderFailure(
					`GPU transition render failed: ${error instanceof Error ? error.message : String(error)}`
				);
				throw error;
			}
			if (gpuOutput) {
				// Two copyExternalImageToTexture uploads (left + right) per GPU transition frame.
				transitionTextureUploadCount += 2;
				outputContext.drawImage(gpuOutput, 0, 0, this.width, this.height);
			} else {
				this.recordExactRenderFailure(`GPU transition render returned null: ${presentation}`);
				throw new Error(`GPU transition render returned null: ${presentation}`);
			}
		} else if (this.transitionMode === 'gpu' && rendererEntry.gpuTransitionId) {
			this.recordExactRenderFailure(
				`GPU mode selected but pipeline unavailable for ${presentation}`
			);
			throw new Error(`GPU transition unavailable: ${presentation}`);
		} else {
			// CPU fallback: locked before frame zero or non-GPU presentation. Never switches mid-export.
			// SAFETY: Branches are OffscreenCanvas in the worker realm and HTMLCanvas fallback otherwise; renderer requires OffscreenCanvas inputs.
			renderer(
				outputContext as OffscreenCanvasRenderingContext2D,
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
		this.context.drawImage(outputCanvas, 0, 0, this.width, this.height);
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
			webgl2Ready: this.gpuCompositor !== null,
			webgpuTransitionsReady: this.transitionPipeline !== null,
			transitionMode: this.transitionMode ?? 'undecided'
		};
	}

	dispose(): void {
		this.disposed = true;
		this.gpuCompositor?.dispose();
		this.transitionLeftStack?.dispose();
		this.transitionRightStack?.dispose();
		// Pipeline is per-compositor; device is shared per-realm and must not be destroyed here
		// or sibling/nested compositors lose their device mid-export.
		this.transitionPipeline?.destroy();
		this.transitionPipeline = null;
		this.transitionDevice = null;
		this.transitionReadyPromise = null;
		// transitionMode retained for diagnostics after dispose
	}
}
