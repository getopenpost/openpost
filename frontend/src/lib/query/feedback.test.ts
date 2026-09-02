import { describe, expect, it, vi } from 'vitest';
import { createFeedbackQueryAPI } from './feedback';

describe('feedback query API', () => {
	it('loads configuration with the request signal', async () => {
		const configuration = { enabled: true };
		const GET = vi.fn(async () => ({
			data: configuration,
			response: new Response(null, { status: 200 })
		}));
		const api = createFeedbackQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await expect(api.getFeedbackConfig(signal)).resolves.toBe(configuration);
		expect(GET).toHaveBeenCalledWith('/feedback/config', { signal });
	});
});
