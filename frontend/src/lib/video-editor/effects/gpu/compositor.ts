/**
 * WebGL2 GPU compositor.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/effects-pipeline.ts
 * and infrastructure/gpu-media/media-blend-pipeline.ts — adapted from WebGPU
 * to WebGL2: fullscreen-quad fragment passes plus exact point-scatter passes,
 * ping-pong framebuffers chaining multiple effects, per-effect uniform binding
 * from param values, and the verbatim 25-mode blend pass as the final composite
 * against an optional second source texture.
 *
 * The engine is intentionally standalone (no Svelte imports) so the export
 * canvas compositor can adopt the same shaders later.
 */

import { BLEND_MODE_INDEX, type BlendMode } from './blend-modes';
import { BLEND_MODES_GLSL, EFFECT_COMMON_GLSL, FULLSCREEN_VERTEX_GLSL } from './shader-source';
import { getGpuEffect } from './registry';
import type { GpuParamValues, GpuShaderDefinition } from './types';
import { gpuResourcePool } from './gpu-resource-pool';
import { COLOR_BATCH_FRAGMENT_SOURCE, packColorBatch, planEffectPasses } from './color-batch';

/** One resolved effect instance handed to `render`. */
export interface GpuRenderEffect {
	effectId: string;
	params: GpuParamValues;
}

export interface GpuRenderOptions {
	/** Seconds on the session clock; drives time-based effects (grain, glitch…). */
	time?: number;
	/** Final composite mode against the backdrop (default 'normal'). */
	blendMode?: BlendMode;
	/** Second source texture for the blend pass; opaque black when absent. */
	backdrop?: TexImageSource | null;
	/** Layer opacity used as dissolve coverage; ignored by other modes. */
	dissolveAlpha?: number;
}

interface ProgramBundle {
	program: WebGLProgram;
	uniformLocations: Map<string, WebGLUniformLocation | null>;
	samplerUnits: Map<string, number>;
}

const VERTEX_SHADER = FULLSCREEN_VERTEX_GLSL;

function fragmentShaderSource(definition: GpuShaderDefinition): string {
	return `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;
uniform sampler2D uInputTex;
in vec2 vUv;
out vec4 fragColor;
${EFFECT_COMMON_GLSL}
${definition.fragmentSource}
void main() {
  fragColor = ${definition.entryPoint}(vUv);
}
`;
}

function scatterVertexShaderSource(definition: GpuShaderDefinition): string {
	if (!definition.scatterVertexSource || !definition.scatterEntryPoint) {
		throw new Error(`GPU compositor: ${definition.id} has an incomplete scatter definition`);
	}
	return `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uInputTex;
out vec4 vScatterColor;
${definition.scatterVertexSource}
void main() {
  ivec2 destination;
  vScatterColor = ${definition.scatterEntryPoint}(gl_VertexID, destination);
  ivec2 size = textureSize(uInputTex, 0);
  vec2 center = (vec2(destination) + vec2(0.5)) / vec2(size);
  gl_Position = vec4(center * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;
}

const SCATTER_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec4 vScatterColor;
out vec4 fragColor;
void main() {
  fragColor = vScatterColor;
}
`;

const BLEND_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uLayerTex;
uniform sampler2D uBaseTex;
uniform float uOpacity;
uniform float uDissolveAlpha;
uniform int uMode;
in vec2 vUv;
out vec4 fragColor;
${BLEND_MODES_GLSL}
void main() {
  vec4 layer = texture(uLayerTex, vUv);
  vec4 base = texture(uBaseTex, vUv);
  fragColor = compositeBlendSourceOver(
    base,
    layer,
    layer.a * uOpacity,
    1.0,
    uMode,
    vUv * 1024.0,
    uDissolveAlpha
  );
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('GPU compositor: shader allocation failed');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? '';
		gl.deleteShader(shader);
		throw new Error(`GPU compositor: shader compile failed: ${log}`);
	}
	return shader;
}

function linkProgram(
	gl: WebGL2RenderingContext,
	vertex: WebGLShader,
	fragment: WebGLShader
): WebGLProgram {
	const program = gl.createProgram();
	if (!program) throw new Error('GPU compositor: program allocation failed');
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? '';
		gl.deleteProgram(program);
		throw new Error(`GPU compositor: program link failed: ${log}`);
	}
	return program;
}

export class GpuCompositor {
	private readonly gl: WebGL2RenderingContext;
	private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
	private readonly vertexShader: WebGLShader;
	private readonly programs = new Map<string, ProgramBundle>();
	private blendProgram: ProgramBundle | null = null;
	private colorBatchProgram: ProgramBundle | null = null;
	private colorBatchUnavailable = false;
	private sourceTexture: WebGLTexture | null = null;
	private backdropTexture: WebGLTexture | null = null;
	private pingTextures: [WebGLTexture | null, WebGLTexture | null] = [null, null];
	private framebuffers: [WebGLFramebuffer | null, WebGLFramebuffer | null] = [null, null];
	private pingSize: [number, number] = [0, 0];
	private dataTextureCache = new Map<
		string,
		{ texture: WebGLTexture; key: string; dimension: '2d' | '3d'; target: number }
	>();
	private disposed = false;
	private lastFailure: string | null = null;

	private contextLostListener: ((event: Event) => void) | null = null;

	private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, gl: WebGL2RenderingContext) {
		this.canvas = canvas;
		this.gl = gl;
		this.vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		this.sourceTexture = this.createTexture();
		this.backdropTexture = this.createTexture();
		const listener = (event: Event) => {
			event.preventDefault();
			gpuResourcePool.clearForContext(gl);
			this.pingTextures = [null, null];
			this.framebuffers = [null, null];
			this.pingSize = [0, 0];
		};
		this.contextLostListener = listener;
		canvas.addEventListener('webglcontextlost', listener);
	}

	/** Create a compositor for a canvas; null when WebGL2 is unavailable. */
	static create(canvas: HTMLCanvasElement | OffscreenCanvas): GpuCompositor | null {
		const gl = canvas.getContext('webgl2', {
			alpha: true,
			premultipliedAlpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			powerPreference: 'low-power'
		});
		if (!gl) return null;
		try {
			return new GpuCompositor(canvas, gl);
		} catch {
			gl.getExtension('WEBGL_lose_context')?.loseContext();
			return null;
		}
	}

	private createTexture(): WebGLTexture {
		const gl = this.gl;
		const texture = gl.createTexture();
		if (!texture) throw new Error('GPU compositor: texture allocation failed');
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	}

	private getProgram(definition: GpuShaderDefinition): ProgramBundle {
		const cached = this.programs.get(definition.id);
		if (cached) return cached;
		const gl = this.gl;
		const scatter = definition.scatterVertexSource !== undefined;
		const vertex = scatter
			? compileShader(gl, gl.VERTEX_SHADER, scatterVertexShaderSource(definition))
			: this.vertexShader;
		const fragment = compileShader(
			gl,
			gl.FRAGMENT_SHADER,
			scatter ? SCATTER_FRAGMENT_SOURCE : fragmentShaderSource(definition)
		);
		const program = linkProgram(gl, vertex, fragment);
		gl.deleteShader(fragment);
		if (scatter) gl.deleteShader(vertex);

		const bundle: ProgramBundle = { program, uniformLocations: new Map(), samplerUnits: new Map() };
		// SAFETY: getProgramParameter is typed any; ACTIVE_UNIFORMS returns the
		// GLint uniform count for this linked program.
		const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
		let nextSamplerUnit = 1;
		const sampler2DType = gl.SAMPLER_2D;
		const sampler3DType = gl.SAMPLER_3D;
		for (let i = 0; i < uniformCount; i++) {
			const info = gl.getActiveUniform(program, i);
			if (!info) continue;
			const name = info.name.replace(/\[0\]$/, '');
			if (info.type === sampler2DType || info.type === sampler3DType) {
				bundle.samplerUnits.set(name, name === 'uInputTex' ? 0 : nextSamplerUnit++);
			}
		}
		this.programs.set(definition.id, bundle);
		return bundle;
	}

	private getBlendProgram(): ProgramBundle {
		if (this.blendProgram) return this.blendProgram;
		const gl = this.gl;
		const fragment = compileShader(gl, gl.FRAGMENT_SHADER, BLEND_FRAGMENT_SOURCE);
		const program = linkProgram(gl, this.vertexShader, fragment);
		gl.deleteShader(fragment);
		this.blendProgram = { program, uniformLocations: new Map(), samplerUnits: new Map() };
		return this.blendProgram;
	}

	private getColorBatchProgram(): ProgramBundle | null {
		if (this.colorBatchProgram) return this.colorBatchProgram;
		if (this.colorBatchUnavailable) return null;
		const gl = this.gl;
		try {
			const definition: GpuShaderDefinition = {
				id: 'inline-color-batch',
				label: 'Inline color batch',
				category: 'color',
				entryPoint: 'colorBatchFragment',
				fragmentSource: COLOR_BATCH_FRAGMENT_SOURCE,
				schema: [],
				uniformValues: () => ({})
			};
			const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource(definition));
			const program = linkProgram(gl, this.vertexShader, fragment);
			gl.deleteShader(fragment);
			this.colorBatchProgram = {
				program,
				uniformLocations: new Map(),
				samplerUnits: new Map()
			};
			return this.colorBatchProgram;
		} catch {
			this.colorBatchUnavailable = true;
			return null;
		}
	}

	private location(bundle: ProgramBundle, name: string): WebGLUniformLocation | null {
		if (!bundle.uniformLocations.has(name)) {
			bundle.uniformLocations.set(name, this.gl.getUniformLocation(bundle.program, name));
		}
		return bundle.uniformLocations.get(name) ?? null;
	}

	private ensurePingTargets(width: number, height: number): void {
		const gl = this.gl;
		if (gl.isContextLost?.()) {
			this.pingTextures = [null, null];
			this.framebuffers = [null, null];
			this.pingSize = [0, 0];
			return;
		}
		if (this.pingSize[0] === width && this.pingSize[1] === height) return;
		const previousWidth = this.pingSize[0];
		const previousHeight = this.pingSize[1];
		for (let i = 0; i < 2; i++) {
			const oldTexture = this.pingTextures[i];
			const oldFramebuffer = this.framebuffers[i];
			if (oldTexture && oldFramebuffer && previousWidth > 0 && previousHeight > 0) {
				const entry = {
					texture: oldTexture,
					framebuffer: oldFramebuffer,
					width: previousWidth,
					height: previousHeight,
					bytes: previousWidth * previousHeight * 4
				};
				const released = gpuResourcePool.release(gl, entry);
				if (!released) {
					// pool deleted the entry when capped; nothing more to do
				}
			} else {
				if (oldTexture) gl.deleteTexture(oldTexture);
				if (oldFramebuffer) gl.deleteFramebuffer(oldFramebuffer);
			}
			this.pingTextures[i] = null;
			this.framebuffers[i] = null;
		}
		for (let i = 0; i < 2; i++) {
			const pooled = gpuResourcePool.acquire(gl, width, height);
			if (pooled) {
				this.pingTextures[i] = pooled.texture;
				this.framebuffers[i] = pooled.framebuffer;
				continue;
			}
			const texture = this.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			const framebuffer = gl.createFramebuffer();
			if (!framebuffer) throw new Error('GPU compositor: framebuffer allocation failed');
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
			const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
			if (status !== gl.FRAMEBUFFER_COMPLETE) {
				gl.deleteTexture(texture);
				gl.deleteFramebuffer(framebuffer);
				throw new Error('GPU compositor: framebuffer incomplete');
			}
			this.pingTextures[i] = texture;
			this.framebuffers[i] = framebuffer;
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.pingSize = [width, height];
	}

	private uploadTexture(texture: WebGLTexture | null, source: TexImageSource): void {
		const gl = this.gl;
		if (!texture) return;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	}

	private ensureDataTexture(definition: GpuShaderDefinition, params: GpuParamValues): void {
		const spec = definition.dataTexture;
		const gl = this.gl;
		if (!spec) return;
		const dimension = spec.dimension ?? '2d';
		const target = dimension === '3d' ? gl.TEXTURE_3D : gl.TEXTURE_2D;
		// Keep the input bound on unit 0. Texture creation uses the active unit,
		// so selecting unit 1 first prevents a cache miss from replacing the
		// source with the auxiliary LUT or glyph atlas for the current pass.
		gl.activeTexture(gl.TEXTURE1);
		const key = spec.key(params);
		const cached = this.dataTextureCache.get(definition.id);
		if (
			cached &&
			cached.key === key &&
			cached.dimension === dimension &&
			cached.target === target
		) {
			gl.bindTexture(target, cached.texture);
			return;
		}
		if (cached) gl.deleteTexture(cached.texture);
		const payload = spec.build(params);
		const depth = payload.depth ?? 1;
		const is3d = dimension === '3d';
		if (is3d) {
			const max3d = Number(gl.getParameter(gl.MAX_3D_TEXTURE_SIZE));
			if (!Number.isFinite(max3d)) {
				throw new Error('GPU compositor: could not read MAX_3D_TEXTURE_SIZE');
			}
			if (payload.width > max3d || payload.height > max3d || depth > max3d) {
				throw new Error(
					`GPU compositor: 3D LUT ${definition.id} ${payload.width}x${payload.height}x${depth} exceeds MAX_3D_TEXTURE_SIZE ${max3d} - device cannot support this LUT`
				);
			}
		} else {
			const max2d = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
			if (!Number.isFinite(max2d)) {
				throw new Error('GPU compositor: could not read MAX_TEXTURE_SIZE');
			}
			if (payload.width > max2d || payload.height > max2d) {
				throw new Error(
					`GPU compositor: 2D data texture ${definition.id} ${payload.width}x${payload.height} exceeds MAX_TEXTURE_SIZE ${max2d}`
				);
			}
		}
		let texture: WebGLTexture | null = null;
		try {
			if (is3d) {
				texture = gl.createTexture();
				if (!texture) throw new Error('GPU compositor: 3D texture allocation failed');
				gl.bindTexture(target, texture);
				gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
				gl.texImage3D(
					target,
					0,
					gl.RGBA8,
					payload.width,
					payload.height,
					depth,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					payload.data
				);
				const err = gl.getError();
				if (err !== gl.NO_ERROR) {
					throw new Error(
						`GPU compositor: texImage3D failed for ${definition.id} ${payload.width}x${payload.height}x${depth} (gl.getError 0x${err.toString(16)})`
					);
				}
			} else {
				texture = this.createTexture();
				gl.bindTexture(target, texture);
				gl.texImage2D(
					target,
					0,
					gl.RGBA8,
					payload.width,
					payload.height,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					payload.data
				);
				const err = gl.getError();
				if (err !== gl.NO_ERROR) {
					throw new Error(
						`GPU compositor: texImage2D failed for ${definition.id} ${payload.width}x${payload.height} (gl.getError 0x${err.toString(16)})`
					);
				}
			}
			this.dataTextureCache.set(definition.id, { texture, key, dimension, target });
			gl.bindTexture(target, texture);
		} catch (error) {
			if (texture) gl.deleteTexture(texture);
			// Never cache an incomplete texture. Preview reports the failure and export stops
			// before it can present a frame with the wrong colors.
			throw error;
		}
	}

	/**
	 * Render `source` through the ordered effect chain onto the canvas.
	 * Returns false when the GPU work could not complete (caller should fall
	 * back to the DOM/CSS-filter path).
	 */
	render(
		source: TexImageSource,
		width: number,
		height: number,
		effects: readonly GpuRenderEffect[],
		options: GpuRenderOptions = {}
	): boolean {
		if (this.disposed || width <= 0 || height <= 0) return false;
		this.lastFailure = null;
		const gl = this.gl;
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		try {
			this.uploadTexture(this.sourceTexture, source);
			if (options.backdrop) {
				this.uploadTexture(this.backdropTexture, options.backdrop);
			}
			this.ensurePingTargets(width, height);

			let currentTexture = this.sourceTexture;
			let passIndex = 0;
			let passes = planEffectPasses(effects, true);
			const needsColorBatch = passes.some((pass) => pass.kind === 'color-batch');
			const colorBatchProgram = needsColorBatch ? this.getColorBatchProgram() : null;
			if (needsColorBatch && !colorBatchProgram) passes = planEffectPasses(effects, false);

			for (const pass of passes) {
				const target = this.framebuffers[passIndex % 2];
				const targetTexture = this.pingTextures[passIndex % 2];
				if (!target || !targetTexture) return false;
				gl.bindFramebuffer(gl.FRAMEBUFFER, target);
				gl.viewport(0, 0, width, height);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, currentTexture);

				if (pass.kind === 'color-batch') {
					if (!colorBatchProgram) return false;
					const packed = packColorBatch(pass.effects, width, height, options.time ?? 0);
					gl.useProgram(colorBatchProgram.program);
					gl.uniform1i(this.location(colorBatchProgram, 'uInputTex'), 0);
					gl.uniform1i(this.location(colorBatchProgram, 'uOpCount'), packed.count);
					gl.uniform1iv(this.location(colorBatchProgram, 'uKinds[0]'), packed.kinds);
					gl.uniform4fv(this.location(colorBatchProgram, 'uValues0[0]'), packed.values0);
					gl.uniform4fv(this.location(colorBatchProgram, 'uValues1[0]'), packed.values1);
					gl.drawArrays(gl.TRIANGLES, 0, 6);
					currentTexture = targetTexture;
					passIndex++;
					continue;
				}

				const entry = pass.effect;
				const definition = getGpuEffect(entry.effectId);
				if (!definition) {
					throw new Error(`GPU effect renderer unavailable: ${entry.effectId}`);
				}
				const bundle = this.getProgram(definition);
				gl.useProgram(bundle.program);

				for (const [name, unit] of bundle.samplerUnits) {
					if (name === 'uInputTex') continue;
					gl.uniform1i(this.location(bundle, name), unit);
				}
				this.ensureDataTexture(definition, entry.params);

				const values = definition.uniformValues(entry.params, width, height, options.time ?? 0);
				for (const [name, value] of Object.entries(values)) {
					const loc = this.location(bundle, name);
					if (loc) gl.uniform1f(loc, value);
				}

				if (definition.scatterVertexSource) {
					gl.clearColor(0, 0, 0, 0);
					gl.clear(gl.COLOR_BUFFER_BIT);
					gl.drawArrays(gl.POINTS, 0, width * height);
				} else {
					gl.drawArrays(gl.TRIANGLES, 0, 6);
				}
				currentTexture = targetTexture;
				passIndex++;
			}

			// Final blend pass to the canvas: processed clip over the backdrop
			// (opaque black when none) with the clip's blend mode.
			const blend = this.getBlendProgram();
			const mode = BLEND_MODE_INDEX[options.blendMode ?? 'normal'] ?? 0;
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, width, height);
			gl.useProgram(blend.program);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, currentTexture);
			gl.activeTexture(gl.TEXTURE1);
			if (options.backdrop && this.backdropTexture) {
				gl.bindTexture(gl.TEXTURE_2D, this.backdropTexture);
			} else {
				// No backdrop: a transparent-black base keeps 'normal' a straight
				// blit and lets non-normal modes operate against empty alpha.
				if (!this.neutralBase) this.neutralBase = this.createNeutralBase();
				gl.bindTexture(gl.TEXTURE_2D, this.neutralBase);
			}
			gl.uniform1i(this.location(blend, 'uLayerTex'), 0);
			gl.uniform1i(this.location(blend, 'uBaseTex'), 1);
			gl.uniform1f(this.location(blend, 'uOpacity'), 1);
			gl.uniform1f(this.location(blend, 'uDissolveAlpha'), options.dissolveAlpha ?? 1);
			gl.uniform1i(this.location(blend, 'uMode'), mode);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
			return true;
		} catch (error) {
			this.lastFailure = error instanceof Error ? error.message : String(error);
			return false;
		}
	}

	/** Last compile/render failure, exposed for diagnostics and browser tests. */
	failureReason(): string | null {
		return this.lastFailure;
	}

	private neutralBase: WebGLTexture | null = null;

	private createNeutralBase(): WebGLTexture {
		const gl = this.gl;
		const texture = this.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			new Uint8Array([0, 0, 0, 0])
		);
		return texture;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const gl = this.gl;
		if (this.contextLostListener) {
			this.canvas.removeEventListener('webglcontextlost', this.contextLostListener);
			this.contextLostListener = null;
		}
		const lost = gl.isContextLost?.() === true;
		if (!lost) {
			for (const bundle of this.programs.values()) gl.deleteProgram(bundle.program);
			if (this.blendProgram) gl.deleteProgram(this.blendProgram.program);
			if (this.colorBatchProgram) gl.deleteProgram(this.colorBatchProgram.program);
			gpuResourcePool.clearForContext(gl);
			for (const texture of this.pingTextures) if (texture) gl.deleteTexture(texture);
			for (const framebuffer of this.framebuffers)
				if (framebuffer) gl.deleteFramebuffer(framebuffer);
			if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
			if (this.backdropTexture) gl.deleteTexture(this.backdropTexture);
			if (this.neutralBase) gl.deleteTexture(this.neutralBase);
			for (const cached of this.dataTextureCache.values()) gl.deleteTexture(cached.texture);
			gl.deleteShader(this.vertexShader);
		} else {
			gpuResourcePool.clearForContext(gl);
		}
		this.dataTextureCache.clear();
		this.pingTextures = [null, null];
		this.framebuffers = [null, null];
		this.programs.clear();
	}
}

/** Create a compositor for a canvas; null when WebGL2 is unavailable. */
export function createGpuCompositor(
	canvas: HTMLCanvasElement | OffscreenCanvas
): GpuCompositor | null {
	return GpuCompositor.create(canvas);
}
