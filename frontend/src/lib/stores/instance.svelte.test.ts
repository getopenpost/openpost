import { afterEach, describe, expect, it, vi } from 'vitest';

import { testInstanceConnection } from './instance.svelte';

describe('instance store connection checks', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('checks the readiness endpoint instead of liveness only', async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await testInstanceConnection('https://app.openpost.test');

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith('https://app.openpost.test/api/v1/ready', {
			signal: expect.any(AbortSignal)
		});
	});

	it('rejects OpenPost instances that are alive but not ready', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				return new Response(JSON.stringify({ status: 'starting', database: 'ok' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const result = await testInstanceConnection('https://app.openpost.test');

		expect(result.ok).toBe(false);
		expect(result.error).toContain('not ready');
	});
});
