import { describe, expect, it, vi } from 'vitest';
import { createDeveloperQueryAPI } from './developer';

describe('developer query API', () => {
	it('forwards limits and cancellation', async () => {
		const GET = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: 'token-1' }],
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: [{ id: 'activity-1' }],
				response: new Response(null, { status: 200 })
			});
		const api = createDeveloperQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await api.listAPITokens(signal);
		await api.listMCPActivity(8, signal);

		expect(GET).toHaveBeenNthCalledWith(1, '/api-tokens', { signal });
		expect(GET).toHaveBeenNthCalledWith(2, '/mcp/activity', {
			params: { query: { limit: 8 } },
			signal
		});
	});
});
