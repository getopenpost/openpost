export class WebGLFrameCompositor {
	readonly context: OffscreenCanvasRenderingContext2D;
	private readonly output: OffscreenCanvas;
	private readonly surface: OffscreenCanvas;
	private readonly gl: WebGL2RenderingContext;
	private readonly program: WebGLProgram;
	private readonly texture: WebGLTexture;
	private readonly vertexArray: WebGLVertexArrayObject;
	private readonly vertexBuffer: WebGLBuffer;

	constructor(output: OffscreenCanvas, width: number, height: number) {
		this.output = output;
		this.surface = new OffscreenCanvas(width, height);
		const context = this.surface.getContext('2d', {
			alpha: false,
			desynchronized: true,
			colorSpace: 'srgb'
		});
		if (!context) throw new Error('The shared frame compositor could not create its draw surface.');
		this.context = context;
		const gl = output.getContext('webgl2', {
			alpha: false,
			antialias: false,
			depth: false,
			desynchronized: true,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true
		});
		if (!gl) throw new Error('WebGL2 is required for the shared frame compositor.');
		this.gl = gl;
		this.program = createProgram(gl);
		this.texture = required(gl.createTexture(), 'texture');
		this.vertexArray = required(gl.createVertexArray(), 'vertex array');
		this.vertexBuffer = required(gl.createBuffer(), 'vertex buffer');
		gl.bindVertexArray(this.vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([
				-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1
			]),
			gl.STATIC_DRAW
		);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		this.resize(width, height);
	}

	resize(width: number, height: number): void {
		if (this.output.width !== width) this.output.width = width;
		if (this.output.height !== height) this.output.height = height;
		if (this.surface.width !== width) this.surface.width = width;
		if (this.surface.height !== height) this.surface.height = height;
		this.gl.viewport(0, 0, width, height);
	}

	present(): void {
		const gl = this.gl;
		gl.useProgram(this.program);
		gl.bindVertexArray(this.vertexArray);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.surface);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.flush();
	}

	dispose(): void {
		this.gl.deleteTexture(this.texture);
		this.gl.deleteVertexArray(this.vertexArray);
		this.gl.deleteBuffer(this.vertexBuffer);
		this.gl.deleteProgram(this.program);
	}
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const vertex = compileShader(
		gl,
		gl.VERTEX_SHADER,
		`#version 300 es
		layout(location = 0) in vec2 position;
		layout(location = 1) in vec2 textureCoordinate;
		out vec2 uv;
		void main() {
			uv = textureCoordinate;
			gl_Position = vec4(position, 0.0, 1.0);
		}`
	);
	const fragment = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		`#version 300 es
		precision mediump float;
		uniform sampler2D frameTexture;
		in vec2 uv;
		out vec4 color;
		void main() {
			color = texture(frameTexture, uv);
		}`
	);
	const program = required(gl.createProgram(), 'shader program');
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const detail = gl.getProgramInfoLog(program) || 'Unknown shader link error.';
		gl.deleteProgram(program);
		throw new Error(`The shared frame compositor could not link its shaders. ${detail}`);
	}
	gl.useProgram(program);
	gl.uniform1i(gl.getUniformLocation(program, 'frameTexture'), 0);
	return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = required(gl.createShader(type), 'shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const detail = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error.';
		gl.deleteShader(shader);
		throw new Error(`The shared frame compositor could not compile a shader. ${detail}`);
	}
	return shader;
}

function required<T>(value: T | null, name: string): T {
	if (!value) throw new Error(`The shared frame compositor could not create its ${name}.`);
	return value;
}
