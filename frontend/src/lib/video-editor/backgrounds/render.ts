import type { ProceduralBackground } from './types';
import { clampBackground } from './types';

export interface BackgroundGpuAdapter {
	readonly canvas: OffscreenCanvas | HTMLCanvasElement;
	failureReason(): string | null;
	render(background: ProceduralBackground, width: number, height: number): boolean;
	dispose(): void;
}

export type BackgroundGpuRenderer = BackgroundGpuAdapter;

export const GPU_BACKGROUND_PIXEL_THRESHOLD = 256 * 256;

// -- Color helpers (deterministic, no external deps) --
function hexToRgb(hex: string): [number, number, number] {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpColor(a: string, b: string, t: number): string {
	const [ar, ag, ab] = hexToRgb(a);
	const [br, bg, bb] = hexToRgb(b);
	return rgbToHex(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t));
}

function bilinearMeshColor(
	colors: [string, string, string, string],
	u: number,
	v: number,
	smoothness: number
): string {
	const smooth = (t: number): number => {
		if (smoothness <= 0) return t;
		if (smoothness >= 1) return t * t * (3 - 2 * t);
		const s = t * t * (3 - 2 * t);
		return lerp(t, s, smoothness);
	};
	const su = smooth(Math.min(1, Math.max(0, u)));
	const sv = smooth(Math.min(1, Math.max(0, v)));
	const top = lerpColor(colors[0]!, colors[1]!, su);
	const bottom = lerpColor(colors[3]!, colors[2]!, su);
	return lerpColor(top, bottom, sv);
}

function applyTransform(
	u: number,
	v: number,
	rotation: number,
	scale: number,
	offsetX: number,
	offsetY: number
): [number, number] {
	const cx = 0.5 + offsetX;
	const cy = 0.5 + offsetY;
	const rad = (rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = (u - cx) / scale;
	const dy = (v - cy) / scale;
	const rx = dx * cos - dy * sin + cx;
	const ry = dx * sin + dy * cos + cy;
	return [rx, ry];
}

export interface PatternMetrics {
	tile: number;
	stroke: number;
	radius: number;
	stripeWidth: number;
}

export function patternMetrics(density: number): PatternMetrics {
	const tile = Math.max(4, Math.round(24 * (0.5 + density * 0.8)));
	const stroke = Math.max(1, Math.round(tile * 0.12));
	const radius = Math.max(2, Math.round(tile * 0.22 * (0.5 + density)));
	const stripeWidth = Math.max(2, Math.round(tile * 0.45));
	return { tile, stroke, radius, stripeWidth };
}

// -- Efficient CPU render (hot fallback, uses Canvas2D where possible) --
export function renderBackgroundCpu(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	background: ProceduralBackground,
	width: number,
	height: number
): void {
	const bg = clampBackground(background);
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	ctx.clearRect(0, 0, w, h);

	if (bg.kind === 'mesh-gradient') {
		const imageData = ctx.getImageData(0, 0, w, h);
		const data = imageData.data;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const u0 = w > 1 ? (x + 0.5) / w : 0.5;
				const v0 = h > 1 ? (y + 0.5) / h : 0.5;
				const [u, v] = applyTransform(u0, v0, bg.rotation, bg.scale, bg.offsetX, bg.offsetY);
				const cu = Math.min(1, Math.max(0, u));
				const cv = Math.min(1, Math.max(0, v));
				const hex = bilinearMeshColor(bg.colors, cu, cv, bg.smoothness);
				const [r, g, b] = hexToRgb(hex);
				const idx = (y * w + x) * 4;
				data[idx] = r;
				data[idx + 1] = g;
				data[idx + 2] = b;
				data[idx + 3] = 255;
			}
		}
		ctx.putImageData(imageData, 0, 0);
		return;
	}

	// Efficient Canvas2D pattern path (preserves visual output, not necessarily pixel-exact to GPU hard-step)
	ctx.fillStyle = bg.background;
	ctx.fillRect(0, 0, w, h);
	ctx.save();
	ctx.translate(w * (0.5 + bg.offsetX), h * (0.5 + bg.offsetY));
	ctx.rotate((bg.rotation * Math.PI) / 180);
	ctx.scale(bg.scale, bg.scale);
	ctx.translate(-w * 0.5, -h * 0.5);
	const fgAlpha = Math.min(1, Math.max(0, bg.foregroundOpacity));
	if (fgAlpha > 0) {
		ctx.fillStyle = bg.foreground;
		ctx.globalAlpha = fgAlpha;
		const { tile, stroke, radius, stripeWidth } = patternMetrics(bg.density);
		const step = tile;
		switch (bg.pattern) {
			case 'dots': {
				for (let y = -step; y < h + step; y += step) {
					for (let x = -step; x < w + step; x += step) {
						ctx.beginPath();
						ctx.arc(x + step / 2, y + step / 2, radius, 0, Math.PI * 2);
						ctx.fill();
					}
				}
				break;
			}
			case 'grid': {
				ctx.strokeStyle = bg.foreground;
				ctx.lineWidth = stroke;
				for (let x = 0; x <= w; x += tile) {
					ctx.beginPath();
					ctx.moveTo(x, 0);
					ctx.lineTo(x, h);
					ctx.stroke();
				}
				for (let y = 0; y <= h; y += tile) {
					ctx.beginPath();
					ctx.moveTo(0, y);
					ctx.lineTo(w, y);
					ctx.stroke();
				}
				break;
			}
			case 'stripes': {
				ctx.fillStyle = bg.foreground;
				for (let x = -w; x < w * 2; x += tile) {
					ctx.fillRect(x, 0, stripeWidth, h);
				}
				break;
			}
			case 'checker': {
				for (let y = -tile; y < h + tile; y += tile) {
					for (let x = -tile; x < w + tile; x += tile) {
						const isFg = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
						if (isFg) ctx.fillRect(x, y, tile, tile);
					}
				}
				break;
			}
		}
	}
	ctx.restore();
}

// -- Reference CPU path (mathematically clear, per-pixel hard-step, shares exact pixel-space math with GPU) --
// Used only in parity tests, not hot path
export function renderBackgroundCpuReference(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	background: ProceduralBackground,
	width: number,
	height: number
): void {
	const bg = clampBackground(background);
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	ctx.clearRect(0, 0, w, h);
	if (bg.kind === 'mesh-gradient') {
		// Use fround to emulate 32-bit float like GPU
		const imageData = ctx.getImageData(0, 0, w, h);
		const data = imageData.data;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const u0 = w > 1 ? Math.fround((x + 0.5) / w) : 0.5;
				const v0 = h > 1 ? Math.fround((y + 0.5) / h) : 0.5;
				const cx = Math.fround(0.5 + bg.offsetX);
				const cy = Math.fround(0.5 + bg.offsetY);
				const rad = Math.fround((bg.rotation * Math.PI) / 180);
				const cs = Math.fround(Math.cos(rad));
				const sn = Math.fround(Math.sin(rad));
				const dx = Math.fround((u0 - cx) / bg.scale);
				const dy = Math.fround((v0 - cy) / bg.scale);
				const rx = Math.fround(dx * cs - dy * sn + cx);
				const ry = Math.fround(dx * sn + dy * cs + cy);
				const cu = Math.min(1, Math.max(0, rx));
				const cv = Math.min(1, Math.max(0, ry));
				const hex = bilinearMeshColor(bg.colors, cu, cv, bg.smoothness);
				const [r, g, b] = hexToRgb(hex);
				const idx = (y * w + x) * 4;
				data[idx] = r;
				data[idx + 1] = g;
				data[idx + 2] = b;
				data[idx + 3] = 255;
			}
		}
		ctx.putImageData(imageData, 0, 0);
		return;
	}
	const { tile, stroke, radius, stripeWidth } = patternMetrics(bg.density);
	const rad = Math.fround((bg.rotation * Math.PI) / 180);
	const cs = Math.fround(Math.cos(rad));
	const sn = Math.fround(Math.sin(rad));
	const fgAlpha = Math.min(1, Math.max(0, bg.foregroundOpacity));
	const [bgR, bgG, bgB] = hexToRgb(bg.background);
	const [fgR, fgG, fgB] = hexToRgb(bg.foreground);
	const centerX = Math.fround(w * 0.5);
	const centerY = Math.fround(h * 0.5);
	const offsetCenterX = Math.fround(w * (0.5 + bg.offsetX));
	const offsetCenterY = Math.fround(h * (0.5 + bg.offsetY));
	const scale = Math.fround(bg.scale);
	const imageData = ctx.getImageData(0, 0, w, h);
	const data = imageData.data;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const cX = Math.fround(x + 0.5 - offsetCenterX);
			const cY = Math.fround(y + 0.5 - offsetCenterY);
			const rcX = Math.fround((cX * cs + cY * sn) / scale + centerX);
			const rcY = Math.fround((-cX * sn + cY * cs) / scale + centerY);
			let useFg = false;
			if (fgAlpha > 0) {
				switch (bg.pattern) {
					case 'dots': {
						const qX = Math.floor(Math.fround(rcX / tile));
						const qY = Math.floor(Math.fround(rcY / tile));
						const cellX = Math.fround(rcX - qX * tile);
						const cellY = Math.fround(rcY - qY * tile);
						const dx = Math.fround(cellX - tile * 0.5);
						const dy = Math.fround(cellY - tile * 0.5);
						const dist = Math.fround(Math.hypot(dx, dy));
						if (dist < radius) useFg = true;
						break;
					}
					case 'grid': {
						const qX = Math.floor(Math.fround(rcX / tile));
						const qY = Math.floor(Math.fround(rcY / tile));
						const cellX = Math.fround(rcX - qX * tile);
						const cellY = Math.fround(rcY - qY * tile);
						const distX = Math.fround(Math.min(cellX, tile - cellX));
						const distY = Math.fround(Math.min(cellY, tile - cellY));
						if (distX < Math.fround(stroke * 0.5) || distY < Math.fround(stroke * 0.5))
							useFg = true;
						break;
					}
					case 'stripes': {
						const qX = Math.floor(Math.fround(rcX / tile));
						const cellX = Math.fround(rcX - qX * tile);
						if (cellX < stripeWidth) useFg = true;
						break;
					}
					case 'checker': {
						const fx = Math.floor(rcX / tile);
						const fy = Math.floor(rcY / tile);
						if ((fx + fy) % 2 === 0) useFg = true;
						break;
					}
				}
			}
			const idx = (y * w + x) * 4;
			if (useFg && fgAlpha > 0) {
				const a = fgAlpha;
				data[idx] = Math.round(bgR * (1 - a) + fgR * a);
				data[idx + 1] = Math.round(bgG * (1 - a) + fgG * a);
				data[idx + 2] = Math.round(bgB * (1 - a) + fgB * a);
				data[idx + 3] = 255;
			} else {
				data[idx] = bgR;
				data[idx + 1] = bgG;
				data[idx + 2] = bgB;
				data[idx + 3] = 255;
			}
		}
	}
	ctx.putImageData(imageData, 0, 0);
}

// -- GPU path: owned WebGL2 context/canvas, exact CPU parity, no per-frame allocations --

const MESH_VERTEX = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
void main(){ v_uv = a_position*0.5+0.5; gl_Position = vec4(a_position,0.0,1.0);} `;

function meshFragmentSource(): string {
	return `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec3 u_c0; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3;
uniform float u_smooth;
uniform float u_rotation;
uniform float u_scale;
uniform vec2 u_offset;
float smoothFn(float t,float s){
 if(s<=0.0) return t;
 if(s>=1.0) return t*t*(3.0-2.0*t);
 float sm = t*t*(3.0-2.0*t);
 return mix(t, sm, s);
}
void main(){
 vec2 flipped = vec2(v_uv.x, 1.0 - v_uv.y);
 vec2 offset = vec2(0.5) + u_offset;
 float rad = radians(u_rotation);
 float cs = cos(rad); float sn = sin(rad);
 vec2 d = (flipped - offset)/u_scale;
 vec2 uv = vec2(d.x*cs - d.y*sn + offset.x, d.x*sn + d.y*cs + offset.y);
 float su = smoothFn(clamp(uv.x,0.0,1.0), u_smooth);
 float sv = smoothFn(clamp(uv.y,0.0,1.0), u_smooth);
 vec3 top = mix(u_c0, u_c1, su);
 vec3 bottom = mix(u_c3, u_c2, su);
 vec3 col = mix(top, bottom, sv);
 outColor = vec4(col/255.0, 1.0);
}`;
}

function patternFragmentSource(): string {
	return `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec3 u_bg;
uniform vec3 u_fg;
uniform vec2 u_resolution;
uniform float u_tile;
uniform float u_stroke;
uniform float u_radius;
uniform float u_stripeWidth;
uniform float u_rotation;
uniform vec2 u_offset;
uniform float u_scale;
uniform float u_fgAlpha;
uniform int u_pattern;
void main(){
 vec2 flipped = vec2(v_uv.x, 1.0 - v_uv.y);
 vec2 pixelFlipped = flipped * u_resolution;
 vec2 offsetCenterPixel = (vec2(0.5) + u_offset) * u_resolution;
 vec2 centerPixel = u_resolution * 0.5;
 float rad = radians(u_rotation);
 float cs = cos(rad); float sn = sin(rad);
 vec2 cPixel = pixelFlipped - offsetCenterPixel;
 vec2 rcPixel = vec2(cPixel.x*cs + cPixel.y*sn, -cPixel.x*sn + cPixel.y*cs) / u_scale + centerPixel;
 vec2 pixel = rcPixel;
 vec3 bg = u_bg/255.0;
 vec3 fg = u_fg/255.0;
 float useFg = 0.0;
 if(u_pattern==0){
   vec2 cell = fract(pixel / u_tile);
   float dist = length((cell-0.5)*u_tile);
   if(dist < u_radius) useFg = 1.0;
 } else if(u_pattern==1){
   vec2 cell = fract(pixel / u_tile);
   float distX = min(cell.x, 1.0 - cell.x) * u_tile;
   float distY = min(cell.y, 1.0 - cell.y) * u_tile;
   if(distX < u_stroke*0.5 || distY < u_stroke*0.5) useFg = 1.0;
 } else if(u_pattern==2){
   float cell = fract(pixel.x / u_tile);
   if(cell < u_stripeWidth / u_tile) useFg = 1.0;
 } else {
   vec2 cell = floor(pixel / u_tile);
   if(mod(cell.x+cell.y,2.0)==0.0) useFg = 1.0;
 }
 vec3 col = mix(bg, fg, useFg * u_fgAlpha);
 outColor = vec4(col, 1.0);
}`;
}

function createShader(
	gl: WebGL2RenderingContext,
	type: number,
	source: string
): WebGLShader | null {
	const s = gl.createShader(type);
	if (!s) return null;
	gl.shaderSource(s, source);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(s);
		gl.deleteShader(s);
		throw new Error(log ?? 'shader compile failed');
	}
	return s;
}

function createProgram(
	gl: WebGL2RenderingContext,
	vsSource: string,
	fsSource: string
): WebGLProgram | null {
	const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
	const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
	if (!vs || !fs) return null;
	const prog = gl.createProgram();
	if (!prog) return null;
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(prog);
		gl.deleteProgram(prog);
		throw new Error(log ?? 'program link failed');
	}
	return prog;
}

function getWebGL2Context(
	canvas: OffscreenCanvas | HTMLCanvasElement
): WebGL2RenderingContext | null {
	const raw = canvas.getContext('webgl2', {
		antialias: false,
		premultipliedAlpha: false
	});
	if (raw instanceof WebGL2RenderingContext) return raw;
	// oxlint-disable-next-line anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion -- WebGL probe validates stub via method presence
	if (raw !== null && typeof (raw as WebGL2RenderingContext).viewport === 'function') {
		// SAFETY: validated by viewport method presence on the returned context
		return raw as WebGL2RenderingContext;
	}
	return null;
}

export function createBackgroundGpuRenderer(): BackgroundGpuAdapter | null {
	let ownedCanvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== 'undefined') {
		ownedCanvas = new OffscreenCanvas(1, 1);
	} else if (typeof document !== 'undefined') {
		ownedCanvas = document.createElement('canvas');
		ownedCanvas.width = 1;
		ownedCanvas.height = 1;
	} else {
		return null;
	}
	const gl = getWebGL2Context(ownedCanvas);
	if (!gl) return null;

	let failure: string | null = null;
	let meshProgram: WebGLProgram | null = null;
	let patternProgram: WebGLProgram | null = null;
	let buffer: WebGLBuffer | null = null;
	let vao: WebGLVertexArrayObject | null = null;

	// Cached uniform/attrib locations
	let meshLocs: {
		c0: WebGLUniformLocation | null;
		c1: WebGLUniformLocation | null;
		c2: WebGLUniformLocation | null;
		c3: WebGLUniformLocation | null;
		smooth: WebGLUniformLocation | null;
		rotation: WebGLUniformLocation | null;
		scale: WebGLUniformLocation | null;
		offset: WebGLUniformLocation | null;
		pos: number;
	} | null = null;
	let patternLocs: {
		bg: WebGLUniformLocation | null;
		fg: WebGLUniformLocation | null;
		resolution: WebGLUniformLocation | null;
		tile: WebGLUniformLocation | null;
		stroke: WebGLUniformLocation | null;
		radius: WebGLUniformLocation | null;
		stripeWidth: WebGLUniformLocation | null;
		rotation: WebGLUniformLocation | null;
		offset: WebGLUniformLocation | null;
		scale: WebGLUniformLocation | null;
		fgAlpha: WebGLUniformLocation | null;
		pattern: WebGLUniformLocation | null;
		pos: number;
	} | null = null;

	try {
		meshProgram = createProgram(gl, MESH_VERTEX, meshFragmentSource());
		patternProgram = createProgram(gl, MESH_VERTEX, patternFragmentSource());
	} catch (e) {
		failure = e instanceof Error ? e.message : String(e);
		if (meshProgram) gl.deleteProgram(meshProgram);
		if (patternProgram) gl.deleteProgram(patternProgram);
		return null;
	}
	if (!meshProgram || !patternProgram) {
		failure = 'failed to compile background shaders';
		return null;
	}

	// Cache locations once
	meshLocs = {
		c0: gl.getUniformLocation(meshProgram, 'u_c0'),
		c1: gl.getUniformLocation(meshProgram, 'u_c1'),
		c2: gl.getUniformLocation(meshProgram, 'u_c2'),
		c3: gl.getUniformLocation(meshProgram, 'u_c3'),
		smooth: gl.getUniformLocation(meshProgram, 'u_smooth'),
		rotation: gl.getUniformLocation(meshProgram, 'u_rotation'),
		scale: gl.getUniformLocation(meshProgram, 'u_scale'),
		offset: gl.getUniformLocation(meshProgram, 'u_offset'),
		pos: gl.getAttribLocation(meshProgram, 'a_position')
	};
	patternLocs = {
		bg: gl.getUniformLocation(patternProgram, 'u_bg'),
		fg: gl.getUniformLocation(patternProgram, 'u_fg'),
		resolution: gl.getUniformLocation(patternProgram, 'u_resolution'),
		tile: gl.getUniformLocation(patternProgram, 'u_tile'),
		stroke: gl.getUniformLocation(patternProgram, 'u_stroke'),
		radius: gl.getUniformLocation(patternProgram, 'u_radius'),
		stripeWidth: gl.getUniformLocation(patternProgram, 'u_stripeWidth'),
		rotation: gl.getUniformLocation(patternProgram, 'u_rotation'),
		offset: gl.getUniformLocation(patternProgram, 'u_offset'),
		scale: gl.getUniformLocation(patternProgram, 'u_scale'),
		fgAlpha: gl.getUniformLocation(patternProgram, 'u_fgAlpha'),
		pattern: gl.getUniformLocation(patternProgram, 'u_pattern'),
		pos: gl.getAttribLocation(patternProgram, 'a_position')
	};

	const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
	buffer = gl.createBuffer();
	if (!buffer) {
		failure = 'buffer creation failed';
		gl.deleteProgram(meshProgram);
		gl.deleteProgram(patternProgram);
		return null;
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
	vao = gl.createVertexArray();
	if (vao) {
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	}

	let disposed = false;

	return {
		canvas: ownedCanvas,
		failureReason() {
			return failure;
		},
		render(background, width, height) {
			if (disposed) {
				failure = 'renderer disposed';
				return false;
			}
			const bg = clampBackground(background);
			const w = Math.max(1, Math.round(width));
			const h = Math.max(1, Math.round(height));
			if (ownedCanvas.width !== w) ownedCanvas.width = w;
			if (ownedCanvas.height !== h) ownedCanvas.height = h;
			gl.viewport(0, 0, w, h);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);

			let ok = false;
			if (bg.kind === 'mesh-gradient') {
				const p = meshProgram!;
				const locs = meshLocs!;
				gl.useProgram(p);
				const cols = bg.colors;
				if (locs.c0) {
					const [r, g, b] = hexToRgb(cols[0]!);
					gl.uniform3f(locs.c0, r, g, b);
				}
				if (locs.c1) {
					const [r, g, b] = hexToRgb(cols[1]!);
					gl.uniform3f(locs.c1, r, g, b);
				}
				if (locs.c2) {
					const [r, g, b] = hexToRgb(cols[2]!);
					gl.uniform3f(locs.c2, r, g, b);
				}
				if (locs.c3) {
					const [r, g, b] = hexToRgb(cols[3]!);
					gl.uniform3f(locs.c3, r, g, b);
				}
				if (locs.smooth) gl.uniform1f(locs.smooth, bg.smoothness);
				if (locs.rotation) gl.uniform1f(locs.rotation, bg.rotation);
				if (locs.scale) gl.uniform1f(locs.scale, bg.scale);
				if (locs.offset) gl.uniform2f(locs.offset, bg.offsetX, bg.offsetY);
				if (vao) gl.bindVertexArray(vao);
				else gl.bindBuffer(gl.ARRAY_BUFFER, buffer!);
				if (locs.pos >= 0) {
					gl.enableVertexAttribArray(locs.pos);
					gl.vertexAttribPointer(locs.pos, 2, gl.FLOAT, false, 0, 0);
				}
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				if (vao) gl.bindVertexArray(null);
				ok = gl.getError() === gl.NO_ERROR;
				if (!ok) failure = `GPU background error ${gl.getError()}`;
				else failure = null;
			} else {
				const p = patternProgram!;
				const locs = patternLocs!;
				gl.useProgram(p);
				const { tile, stroke, radius, stripeWidth } = patternMetrics(bg.density);
				if (locs.bg) {
					const [r, g, b] = hexToRgb(bg.background);
					gl.uniform3f(locs.bg, r, g, b);
				}
				if (locs.fg) {
					const [r, g, b] = hexToRgb(bg.foreground);
					gl.uniform3f(locs.fg, r, g, b);
				}
				if (locs.resolution) gl.uniform2f(locs.resolution, w, h);
				if (locs.tile) gl.uniform1f(locs.tile, tile);
				if (locs.stroke) gl.uniform1f(locs.stroke, stroke);
				if (locs.radius) gl.uniform1f(locs.radius, radius);
				if (locs.stripeWidth) gl.uniform1f(locs.stripeWidth, stripeWidth);
				if (locs.rotation) gl.uniform1f(locs.rotation, bg.rotation);
				if (locs.offset) gl.uniform2f(locs.offset, bg.offsetX, bg.offsetY);
				if (locs.scale) gl.uniform1f(locs.scale, bg.scale);
				if (locs.fgAlpha) gl.uniform1f(locs.fgAlpha, bg.foregroundOpacity);
				if (locs.pattern)
					gl.uniform1i(
						locs.pattern,
						bg.pattern === 'dots' ? 0 : bg.pattern === 'grid' ? 1 : bg.pattern === 'stripes' ? 2 : 3
					);
				if (vao) gl.bindVertexArray(vao);
				else gl.bindBuffer(gl.ARRAY_BUFFER, buffer!);
				if (locs.pos >= 0) {
					gl.enableVertexAttribArray(locs.pos);
					gl.vertexAttribPointer(locs.pos, 2, gl.FLOAT, false, 0, 0);
				}
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				if (vao) gl.bindVertexArray(null);
				ok = gl.getError() === gl.NO_ERROR;
				if (!ok) failure = `GPU background error ${gl.getError()}`;
				else failure = null;
			}
			return ok;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			if (buffer) gl.deleteBuffer(buffer);
			if (vao) gl.deleteVertexArray(vao);
			if (meshProgram) gl.deleteProgram(meshProgram);
			if (patternProgram) gl.deleteProgram(patternProgram);
			buffer = null;
			vao = null;
			meshProgram = null;
			patternProgram = null;
			meshLocs = null;
			patternLocs = null;
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		}
	};
}

// High-level helper retained for compatibility (not used by compositor hot path)
export function renderBackground(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	background: ProceduralBackground,
	width: number,
	height: number,
	gpuRenderer?: BackgroundGpuAdapter | null
): boolean {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (gpuRenderer && w * h >= GPU_BACKGROUND_PIXEL_THRESHOLD) {
		const ok = gpuRenderer.render(background, w, h);
		if (ok) {
			ctx.clearRect(0, 0, w, h);
			ctx.drawImage(gpuRenderer.canvas, 0, 0);
			return true;
		}
	}
	renderBackgroundCpu(ctx, background, w, h);
	return false;
}
