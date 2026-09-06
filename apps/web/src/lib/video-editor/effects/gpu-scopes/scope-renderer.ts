/** Ported from FreeCut (MIT), adapted to OpenPost's Svelte scope surface. */
/**
 * GPU scope renderer facade.
 * Manages WebGPU device, source texture upload, and delegates to individual scope classes.
 */

import { HistogramScope } from './histogram-scope';
import { WaveformScope } from './waveform-scope';
import { VectorscopeScope } from './vectorscope-scope';

export type ScopeRendererLostHandler = (message: string) => void;

interface ConfiguredScopeCanvas {
	context: GPUCanvasContext;
	width: number;
	height: number;
}

export class ScopeRenderer {
	private device: GPUDevice;
	private format: GPUTextureFormat;
	private histogram: HistogramScope;
	private waveform: WaveformScope;
	private vectorscope: VectorscopeScope;
	private srcTexture: GPUTexture | null = null;
	private srcW = 0;
	private srcH = 0;
	private kr = 0.2126;
	private kb = 0.0722;
	private rangeMin = 0;
	private rangeMax = 1;
	private destroyed = false;
	private lost = false;
	private canvasContexts = new Map<HTMLCanvasElement, ConfiguredScopeCanvas>();

	private constructor(device: GPUDevice, onLost?: ScopeRendererLostHandler) {
		this.device = device;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		this.histogram = new HistogramScope(device, this.format);
		this.waveform = new WaveformScope(device, this.format);
		this.vectorscope = new VectorscopeScope(device, this.format);
		void device.lost.then((info) => {
			if (this.destroyed) return;
			this.lost = true;
			this.srcTexture = null;
			this.srcW = 0;
			this.srcH = 0;
			this.canvasContexts.clear();
			onLost?.(info.message || `WebGPU device lost: ${info.reason}`);
		});
	}

	static async create(onLost?: ScopeRendererLostHandler): Promise<ScopeRenderer | null> {
		if (!globalThis.navigator?.gpu) return null;
		try {
			const adapter = await navigator.gpu.requestAdapter();
			if (!adapter) return null;
			const device = await adapter.requestDevice();
			return new ScopeRenderer(device, onLost);
		} catch {
			return null;
		}
	}

	get available(): boolean {
		return !this.destroyed && !this.lost;
	}

	private assertAvailable(): void {
		if (!this.available) throw new Error('WebGPU scope renderer is unavailable');
	}

	configureCanvas(canvas: HTMLCanvasElement): GPUCanvasContext | null {
		if (!this.available) return null;
		try {
			const cached = this.canvasContexts.get(canvas);
			if (cached?.width === canvas.width && cached.height === canvas.height) {
				return cached.context;
			}
			// SAFETY: The WebGPU context ID returns GPUCanvasContext when the browser supports it.
			const ctx = cached?.context ?? (canvas.getContext('webgpu') as GPUCanvasContext | null);
			if (!ctx) return null;
			cached?.context.unconfigure();
			ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
			this.canvasContexts.set(canvas, {
				context: ctx,
				width: canvas.width,
				height: canvas.height
			});
			return ctx;
		} catch {
			return null;
		}
	}

	setMatrix(kr: number, kb: number) {
		this.kr = kr;
		this.kb = kb;
	}

	setRange(min: number, max: number) {
		this.rangeMin = min;
		this.rangeMax = max;
	}

	private ensureTexture(w: number, h: number) {
		this.assertAvailable();
		if (this.srcTexture && this.srcW === w && this.srcH === h) return;
		this.srcTexture?.destroy();
		this.srcTexture = this.device.createTexture({
			size: { width: w, height: h },
			format: 'rgba8unorm',
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT
		});
		this.srcW = w;
		this.srcH = h;
	}

	/** Near-zero-copy: GPU-accelerated transfer from canvas (avoids getImageData CPU readback) */
	uploadFromCanvas(source: OffscreenCanvas | HTMLCanvasElement) {
		const w = source.width;
		const h = source.height;
		if (w < 2 || h < 2) return;
		this.ensureTexture(w, h);
		this.device.queue.copyExternalImageToTexture(
			{ source, flipY: false },
			{ texture: this.srcTexture!, mipLevel: 0 },
			{ width: w, height: h }
		);
	}

	/** Fallback: upload from ImageData (CPU → GPU transfer) */
	uploadFrame(imageData: ImageData) {
		const w = imageData.width;
		const h = imageData.height;
		if (w < 2 || h < 2) return;
		this.ensureTexture(w, h);
		this.device.queue.writeTexture(
			{ texture: this.srcTexture! },
			imageData.data,
			{ bytesPerRow: w * 4 },
			{ width: w, height: h }
		);
	}

	renderWaveforms(requests: Array<{ ctx: GPUCanvasContext; mode: number }>) {
		this.assertAvailable();
		if (!this.srcTexture || requests.length === 0) return;
		this.waveform.renderBatch(
			this.srcTexture,
			requests,
			this.kr,
			this.kb,
			this.rangeMin,
			this.rangeMax
		);
	}

	renderHistogram(ctx: GPUCanvasContext, mode: number) {
		this.assertAvailable();
		if (!this.srcTexture) return;
		this.histogram.render(
			this.srcTexture,
			ctx,
			mode,
			this.kr,
			this.kb,
			this.rangeMin,
			this.rangeMax
		);
	}

	renderVectorscope(ctx: GPUCanvasContext) {
		this.assertAvailable();
		if (!this.srcTexture) return;
		this.vectorscope.render(this.srcTexture, ctx, this.kr, this.kb);
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.srcTexture?.destroy();
		this.srcTexture = null;
		for (const { context } of this.canvasContexts.values()) context.unconfigure();
		this.canvasContexts.clear();
		this.waveform.destroy();
		this.histogram.destroy();
		this.vectorscope.destroy();
		this.device.destroy();
	}
}
