/** Some drivers expose WebGPU but cannot import Canvas2D textures. */
export async function createCanvasGpuDevice(): Promise<GPUDevice | null> {
	const gpu = globalThis.navigator?.gpu;
	if (!gpu || typeof OffscreenCanvas !== 'function') return null;
	let device: GPUDevice | undefined;
	let texture: GPUTexture | undefined;
	try {
		const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) return null;
		device = await adapter.requestDevice();
		const source = new OffscreenCanvas(2, 2);
		const context = source.getContext('2d');
		if (!context) {
			device.destroy();
			return null;
		}
		context.fillRect(0, 0, 2, 2);
		device.pushErrorScope('validation');
		texture = device.createTexture({
			size: [2, 2],
			format: 'rgba8unorm',
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT
		});
		device.queue.copyExternalImageToTexture({ source }, { texture }, [2, 2]);
		if (await device.popErrorScope()) {
			device.destroy();
			return null;
		}
		return device;
	} catch {
		device?.destroy();
		return null;
	} finally {
		texture?.destroy();
	}
}
