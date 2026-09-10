import { prepareLogoMask, type LogoMaskSource, type LogoMaskStyle } from './logo-mask';

const MASK_LONG_EDGE = 512;

/** A bounded mask cache for each logo effect; the source is the preceding effect pass. */
export class PaperLogoInput {
	private readonly readTarget: WebGLFramebuffer;
	private readonly drawTarget: WebGLFramebuffer;
	private readonly sample: WebGLTexture;
	private readonly prepared: WebGLTexture;
	private previous: Uint8Array | undefined;
	private previousKey = '';
	private size = '';

	constructor(private readonly gl: WebGL2RenderingContext) {
		const readTarget = gl.createFramebuffer(),
			drawTarget = gl.createFramebuffer();
		const sample = gl.createTexture(),
			prepared = gl.createTexture();
		if (!readTarget || !drawTarget || !sample || !prepared) {
			gl.deleteFramebuffer(readTarget);
			gl.deleteFramebuffer(drawTarget);
			gl.deleteTexture(sample);
			gl.deleteTexture(prepared);
			throw new Error('Logo mask allocation failed.');
		}
		this.readTarget = readTarget;
		this.drawTarget = drawTarget;
		this.sample = sample;
		this.prepared = prepared;
		for (const texture of [sample, prepared]) {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		}
	}

	texture(
		input: WebGLTexture,
		width: number,
		height: number,
		source: LogoMaskSource,
		style: LogoMaskStyle
	): WebGLTexture {
		const gl = this.gl;
		const maskWidth = Math.max(1, Math.round((MASK_LONG_EDGE * width) / Math.max(width, height)));
		const maskHeight = Math.max(1, Math.round((MASK_LONG_EDGE * height) / Math.max(width, height)));
		const size = `${maskWidth}:${maskHeight}`;
		// SAFETY: DRAW_FRAMEBUFFER_BINDING returns the bound WebGLFramebuffer or null.
		const target = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
		try {
			gl.bindTexture(gl.TEXTURE_2D, this.sample);
			if (size !== this.size) {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA8,
					maskWidth,
					maskHeight,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					null
				);
				this.size = size;
			}
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readTarget);
			gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, input, 0);
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.drawTarget);
			gl.framebufferTexture2D(
				gl.DRAW_FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				this.sample,
				0
			);
			if (
				gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE ||
				gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
			)
				throw new Error('Logo mask framebuffer is incomplete.');
			gl.blitFramebuffer(
				0,
				0,
				width,
				height,
				0,
				0,
				maskWidth,
				maskHeight,
				gl.COLOR_BUFFER_BIT,
				gl.LINEAR
			);
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.drawTarget);
			const pixels = new Uint8Array(maskWidth * maskHeight * 4);
			gl.readPixels(0, 0, maskWidth, maskHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			if (gl.getError() !== gl.NO_ERROR) throw new Error('Could not read the logo source frame.');
			const key = `${size}:${source}:${style}`;
			if (
				key !== this.previousKey ||
				!this.previous ||
				pixels.some((value, i) => value !== this.previous![i])
			) {
				const prepared = prepareLogoMask(pixels, maskWidth, maskHeight, source, style);
				gl.bindTexture(gl.TEXTURE_2D, this.prepared);
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA8,
					maskWidth,
					maskHeight,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					prepared
				);
				if (gl.getError() !== gl.NO_ERROR) throw new Error('Could not upload the logo mask.');
				this.previous = pixels;
				this.previousKey = key;
			}
			return this.prepared;
		} finally {
			gl.bindFramebuffer(gl.FRAMEBUFFER, target);
		}
	}

	dispose(): void {
		this.gl.deleteFramebuffer(this.readTarget);
		this.gl.deleteFramebuffer(this.drawTarget);
		this.gl.deleteTexture(this.sample);
		this.gl.deleteTexture(this.prepared);
		this.previous = undefined;
	}
}
