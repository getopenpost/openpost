import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createFeedbackQueryAPI } from './feedback';

describe('feedback query API', () => {
	it('loads configuration with the request signal', async () => {
		const configuration = { enabled: true };
		let request: Request | undefined;
		const fetchMock = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return Response.json(configuration);
		});
		const api = createFeedbackQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await expect(api.getFeedbackConfig(controller.signal)).resolves.toEqual(configuration);
		expect(request).toBeDefined();
		expect(new URL(request!.url).pathname).toBe('/api/v1/feedback/config');
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});
});
