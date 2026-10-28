import { afterEach, expect, it, vi } from 'vitest';
import { selectParakeetBackend } from './parakeet-model';
afterEach(() => vi.unstubAllGlobals());
it.each([
	{ name: 'fp16 available', features: ['shader-f16'], expected: 'webgpu' },
	{ name: 'fp16 absent', features: [], expected: 'wasm' },
	{ name: 'adapter failure', features: null, expected: 'wasm' }
])('selects a usable backend: $name', async ({ features, expected }) => {
	vi.stubGlobal('navigator', {
		gpu: {
			requestAdapter: async () => {
				if (features === null) throw new Error('Unavailable');
				return { features: new Set(features) };
			}
		}
	});
	expect(await selectParakeetBackend()).toBe(expected);
});
