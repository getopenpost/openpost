import {
	meshGradientFragmentShader,
	swirlFragmentShader,
	perlinNoiseFragmentShader,
	neuroNoiseFragmentShader
} from '@paper-design/shaders';
import type { BackgroundShader, ShaderBackground } from '../project/types';
import { shaderTime } from './shaders';

const FRAGMENTS = {
	mesh: meshGradientFragmentShader,
	swirl: swirlFragmentShader,
	clouds: perlinNoiseFragmentShader,
	neural: neuroNoiseFragmentShader
};

// Paper's public fragment shaders consume centered object/pattern coordinates.
// A fixed design height keeps the same composition at preview and export sizes.
const VERTEX = `#version 300 es
precision mediump float;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 offset;
uniform float patternScale;
out vec2 v_objectUV;
out vec2 v_patternUV;
void main() {
  vec2 position = vec2((gl_VertexID == 1) ? 3. : -1., (gl_VertexID == 2) ? 3. : -1.);
  gl_Position = vec4(position, 0., 1.);
  vec2 uv = position * .5 * u_resolution / min(u_resolution.x, u_resolution.y);
  uv += vec2(-offset.x, offset.y);
  float angle = radians(u_rotation);
  uv = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * uv / u_scale;
  v_objectUV = uv;
  v_patternUV = uv * patternScale;
}`;

interface CompiledShader {
	program: WebGLProgram;
	uniforms: Map<string, WebGLUniformLocation>;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Shader allocation failed.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(message ?? 'Shader compilation failed.');
	}
	return shader;
}

function color(hex: string): number[] {
	const rgb = Number.parseInt(hex.slice(1), 16);
	return [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1];
}

/** One context per compositor, also usable by export workers. No wall clock or DOM mount. */
export class ShaderBackgroundRenderer {
	private readonly canvas: OffscreenCanvas;
	private readonly gl: WebGL2RenderingContext;
	private readonly programs = new Map<BackgroundShader, CompiledShader>();
	private disposed = false;

	constructor() {
		this.canvas = new OffscreenCanvas(1, 1);
		const gl = this.canvas.getContext('webgl2', {
			alpha: false,
			antialias: false
		});
		if (!gl) throw new Error('Shader backgrounds require WebGL 2.');
		this.gl = gl;
	}

	private compile(shader: BackgroundShader): CompiledShader {
		const cached = this.programs.get(shader);
		if (cached) return cached;
		const gl = this.gl;
		const program = gl.createProgram();
		if (!program) throw new Error('Shader program allocation failed.');
		const stages: WebGLShader[] = [];
		try {
			stages.push(compileShader(gl, gl.VERTEX_SHADER, VERTEX));
			stages.push(compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENTS[shader]));
			for (const stage of stages) gl.attachShader(program, stage);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				throw new Error(gl.getProgramInfoLog(program) ?? 'Shader linking failed.');
			}
		} catch (error) {
			gl.deleteProgram(program);
			throw error;
		} finally {
			for (const stage of stages) gl.deleteShader(stage);
		}
		const uniforms = new Map<string, WebGLUniformLocation>();
		const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
		for (let index = 0; index < count; index++) {
			const info = gl.getActiveUniform(program, index);
			if (!info) continue;
			const location = gl.getUniformLocation(program, info.name);
			if (location) uniforms.set(info.name.replace('[0]', ''), location);
		}
		const compiled = { program, uniforms };
		this.programs.set(shader, compiled);
		return compiled;
	}

	render(
		background: ShaderBackground,
		width: number,
		height: number,
		seconds: number
	): OffscreenCanvas {
		if (this.disposed) throw new Error('Shader renderer is disposed.');
		const gl = this.gl;
		if (gl.isContextLost()) throw new Error('Shader graphics context was lost.');
		const { program, uniforms } = this.compile(background.shader);
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
		gl.viewport(0, 0, width, height);
		gl.useProgram(program);
		const scalar = (name: string, value: number): void => {
			const location = uniforms.get(name);
			if (location) gl.uniform1f(location, value);
		};
		const rgba = (name: string, hex: string): void => {
			const location = uniforms.get(name);
			if (location) gl.uniform4fv(location, color(hex));
		};
		gl.uniform2f(uniforms.get('u_resolution') ?? null, width, height);
		gl.uniform2f(uniforms.get('offset') ?? null, background.offsetX, background.offsetY);
		scalar('u_pixelRatio', 1);
		scalar('patternScale', background.shader === 'clouds' ? 0.8 : 10.8);
		scalar('u_time', shaderTime(background, seconds));
		scalar('u_scale', background.scale);
		scalar('u_rotation', background.rotation);
		const colors = uniforms.get('u_colors');
		if (colors) gl.uniform4fv(colors, background.colors.flatMap(color));
		scalar('u_colorsCount', 4);
		rgba('u_colorFront', background.colors[0]);
		rgba('u_colorMid', background.colors[1]);
		rgba('u_colorBack', background.colors[background.shader === 'neural' ? 2 : 1]);
		const detail = background.detail;
		scalar('u_distortion', detail);
		scalar('u_swirl', 0.35);
		scalar('u_grainMixer', 0);
		scalar('u_grainOverlay', 0);
		scalar('u_bandCount', 5);
		scalar('u_twist', detail);
		scalar('u_center', 0);
		scalar('u_proportion', 0.5);
		scalar('u_softness', background.shader === 'clouds' ? detail : 0.65);
		scalar('u_noise', 0.12);
		scalar('u_noiseFrequency', 0.4);
		scalar('u_octaveCount', 4);
		scalar('u_persistence', 0.5);
		scalar('u_lacunarity', 2);
		scalar('u_brightness', 0.4 + detail * 0.8);
		scalar('u_contrast', 0.35);
		// A full-screen triangle needs no vertex buffer and covers every output pixel.
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		if (gl.getError() !== gl.NO_ERROR) throw new Error('Shader background rendering failed.');
		return this.canvas;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const { program } of this.programs.values()) this.gl.deleteProgram(program);
		this.programs.clear();
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
