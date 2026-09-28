import { afterEach, expect, it, vi } from 'vitest';
import { selectParakeetBackend } from './parakeet-model';
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])('selects fp16 only when shader-f16 is available (%s)', async (supported) => {
	vi.stubGlobal('navigator', {
		gpu: { requestAdapter: async () => ({ features: new Set(supported ? ['shader-f16'] : []) }) }
	});
	expect(await selectParakeetBackend()).toBe(supported ? 'webgpu' : 'wasm');
});
it('falls back when an adapter cannot be acquired', async () => {
	vi.stubGlobal('navigator', {
		gpu: {
			requestAdapter: async () => {
				throw new Error('Unavailable');
			}
		}
	});
	expect(await selectParakeetBackend()).toBe('wasm');
});
