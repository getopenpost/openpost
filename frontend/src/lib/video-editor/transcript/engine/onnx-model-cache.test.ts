import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOnnxModelBytes } from './onnx-model-cache';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');

function restoreGlobal(name: 'fetch' | 'caches', descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) Object.defineProperty(globalThis, name, descriptor);
	else Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
	restoreGlobal('fetch', originalFetch);
	restoreGlobal('caches', originalCaches);
});

describe('ONNX model downloads', () => {
	it('retries one transient network failure and returns the complete asset', async () => {
		const bytes = new Uint8Array([11, 22, 33, 44]);
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError('network error'))
			.mockResolvedValueOnce(
				new Response(bytes, {
					headers: { 'content-length': String(bytes.byteLength) }
				})
			);
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
		Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined });

		const result = new Uint8Array(
			await fetchOnnxModelBytes('https://models.invalid/transient-retry.onnx')
		);

		expect(result).toEqual(bytes);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not retry a permanent missing-model response', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
		Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined });

		await expect(fetchOnnxModelBytes('https://models.invalid/missing.onnx')).rejects.toThrow(
			'Failed to fetch model asset (404)'
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
