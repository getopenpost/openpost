import { paperFragmentSource } from './fragment';
import { getPaperShader } from './catalog';
import type { PaperRenderSettings, PaperShaderDefinition } from './types';
import { PAPER_VERTEX } from './vertex';
import { paperNoisePixels } from './noise';
import { PaperLogoInput } from './logo-input';

interface Uniform {
	location: WebGLUniformLocation;
	type: number;
}
interface Program {
	program: WebGLProgram;
	uniforms: Map<string, Uniform>;
}
type UniformValue = number | boolean | number[];

function rgba(hex: string): number[] {
	return [1, 3, 5, 7].map((offset) =>
		offset >= hex.length ? 1 : Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
	);
}

function shaderStage(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Paper shader allocation failed.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(message ?? 'Paper shader compilation failed.');
	}
	return shader;
}

/** Runs Paper's public fragment shaders in the editor's existing WebGL context. */
export class PaperShaderRenderer {
	private programs = new Map<string, Program>();
	private noise: WebGLTexture | undefined;
	private logos = new Map<string, PaperLogoInput>();

	constructor(private readonly gl: WebGL2RenderingContext) {}

	private compile(shader: PaperShaderDefinition): Program {
		const cached = this.programs.get(shader.id);
		if (cached) return cached;
		const gl = this.gl;
		const program = gl.createProgram();
		if (!program) throw new Error('Paper shader program allocation failed.');
		const stages: WebGLShader[] = [];
		try {
			stages.push(shaderStage(gl, gl.VERTEX_SHADER, PAPER_VERTEX));
			stages.push(shaderStage(gl, gl.FRAGMENT_SHADER, paperFragmentSource(shader)));
			for (const stage of stages) gl.attachShader(program, stage);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS))
				throw new Error(gl.getProgramInfoLog(program) ?? 'Paper shader linking failed.');
		} catch (error) {
			gl.deleteProgram(program);
			throw error;
		} finally {
			for (const stage of stages) gl.deleteShader(stage);
		}
		const uniforms = new Map<string, Uniform>();
		const count = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
		for (let i = 0; i < count; i++) {
			const info = gl.getActiveUniform(program, i);
			if (!info) continue;
			const location = gl.getUniformLocation(program, info.name);
			if (location) uniforms.set(info.name.replace('[0]', ''), { location, type: info.type });
		}
		const compiled = { program, uniforms };
		this.programs.set(shader.id, compiled);
		return compiled;
	}

	private set(uniforms: Map<string, Uniform>, name: string, value: UniformValue): void {
		const uniform = uniforms.get(name);
		if (!uniform) return;
		const { location, type } = uniform;
		const gl = this.gl;
		if (Array.isArray(value)) {
			if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, value);
			else if (type === gl.FLOAT_VEC4) gl.uniform4fv(location, value);
			else throw new Error(`Unsupported Paper vector uniform: ${name}`);
		} else if (type === gl.BOOL || type === gl.INT || type === gl.SAMPLER_2D)
			gl.uniform1i(location, Number(value));
		else gl.uniform1f(location, Number(value));
	}

	private bindNoise(): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE1);
		if (!this.noise) {
			const texture = gl.createTexture();
			if (!texture) throw new Error('Paper noise texture allocation failed.');
			const pixels = paperNoisePixels();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA8,
				pixels.width,
				pixels.height,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixels.data
			);
			this.noise = texture;
		}
		gl.bindTexture(gl.TEXTURE_2D, this.noise);
	}

	draw(
		id: string,
		settings: PaperRenderSettings,
		width: number,
		height: number,
		input?: WebGLTexture
	): void {
		const gl = this.gl;
		if (gl.isContextLost()) throw new Error('Paper shader graphics context was lost.');
		const shader = getPaperShader(id);
		if (!shader) throw new Error(`Unknown Paper shader: ${id}`);
		const { program, uniforms } = this.compile(shader);
		const { params } = settings;
		let image = input;
		if (input && shader.category === 'logo') {
			let logo = this.logos.get(id);
			if (!logo) {
				logo = new PaperLogoInput(gl);
				this.logos.set(id, logo);
			}
			const maskSource =
				params.maskSource === 'dark' || params.maskSource === 'light' ? params.maskSource : 'alpha';
			image = logo.texture(
				input,
				width,
				height,
				maskSource,
				id === 'heatmap' ? 'heatmap' : 'contour'
			);
		}
		gl.useProgram(program);
		gl.viewport(0, 0, width, height);
		const common = {
			u_resolution: [width, height],
			u_pixelRatio: Math.min(width, height) / 1080,
			u_time: settings.phase + Math.max(0, settings.seconds) * settings.speed,
			u_scale: settings.scale,
			u_rotation: settings.rotation,
			u_offsetX: settings.offsetX,
			u_offsetY: settings.offsetY,
			u_originX: 0.5,
			u_originY: 0.5,
			u_worldWidth: 0,
			u_worldHeight: 0,
			u_fit: 1,
			u_imageAspectRatio: width / height,
			u_flipImage: false,
			u_isImage: Boolean(image),
			u_shape: 0,
			u_image: 0,
			u_noiseTexture: 1
		};
		for (const [name, value] of Object.entries(common)) this.set(uniforms, name, value);
		const palette: number[] = [];
		for (const control of shader.controls) {
			const value = params[control.name] ?? control.default;
			if (control.uniform.startsWith('palette:')) {
				palette.push(...rgba(String(value)));
				continue;
			}
			this.set(
				uniforms,
				control.uniform,
				control.type === 'color'
					? rgba(String(value))
					: control.type === 'boolean'
						? Boolean(value)
						: Number(value)
			);
		}
		if (palette.length) this.set(uniforms, 'u_colors', palette);
		if (uniforms.has('u_noiseTexture')) this.bindNoise();
		if (image) {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, image);
		}
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		if (gl.getError() !== gl.NO_ERROR) throw new Error(`Paper shader rendering failed: ${id}`);
	}

	dispose(): void {
		for (const { program } of this.programs.values()) this.gl.deleteProgram(program);
		this.programs.clear();
		if (this.noise) this.gl.deleteTexture(this.noise);
		for (const logo of this.logos.values()) logo.dispose();
		this.logos.clear();
	}
}
