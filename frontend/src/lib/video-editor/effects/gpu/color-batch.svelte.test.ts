import { describe, expect, it } from 'vitest';
import { createGpuCompositor } from './compositor';

function quantize(value: number): number {
	return Math.round(Math.min(1, Math.max(0, value)) * 255) / 255;
}

describe('inline color effect GPU pass', () => {
	it('matches ordered RGBA8 color math while reducing four effects to one draw', () => {
		const output = document.createElement('canvas');
		const gl = output.getContext('webgl2', {
			alpha: true,
			premultipliedAlpha: false,
			antialias: false,
			depth: false,
			stencil: false
		});
		expect(gl).not.toBeNull();
		if (!gl) return;
		const originalDrawArrays = gl.drawArrays.bind(gl);
		let drawCalls = 0;
		gl.drawArrays = (...args) => {
			drawCalls++;
			originalDrawArrays(...args);
		};

		const source = document.createElement('canvas');
		source.width = 1;
		source.height = 1;
		const sourceContext = source.getContext('2d');
		expect(sourceContext).not.toBeNull();
		if (!sourceContext) return;
		sourceContext.fillStyle = 'rgb(64 128 192)';
		sourceContext.fillRect(0, 0, 1, 1);

		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		const rendered = compositor.render(source, 1, 1, [
			{ effectId: 'gpu-brightness', params: { amount: 0.1 } },
			{ effectId: 'gpu-contrast', params: { amount: 1.2 } },
			{ effectId: 'gpu-invert', params: {} },
			{ effectId: 'gpu-saturation', params: { amount: 0.8 } }
		]);

		expect(rendered, compositor.failureReason() ?? undefined).toBe(true);
		expect(drawCalls).toBe(2);
		const pixel = new Uint8Array(4);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

		let color = [64 / 255, 128 / 255, 192 / 255];
		color = color.map((channel) => quantize(channel + 0.1));
		color = color.map((channel) => quantize((channel - 0.5) * 1.2 + 0.5));
		color = color.map((channel) => quantize(1 - channel));
		const gray = color[0]! * 0.299 + color[1]! * 0.587 + color[2]! * 0.114;
		color = color.map((channel) => quantize(gray + (channel - gray) * 0.8));
		expect(Array.from(pixel)).toEqual([...color.map((channel) => Math.round(channel * 255)), 255]);

		compositor.dispose();
	});
});
