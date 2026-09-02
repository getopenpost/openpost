import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createDeveloperQueryAPI } from './developer';

describe('developer query API', () => {
	it('forwards limits and cancellation', async () => {
		const requests: Request[] = [];
		const responses = [[{ id: 'token-1' }], [{ id: 'activity-1' }]];
		let responseIndex = 0;
		const fetchMock = vi.fn(async (request: Request) => {
			requests.push(request);
			const response = responses[responseIndex];
			responseIndex += 1;
			return Response.json(response);
		});
		const api = createDeveloperQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await api.listAPITokens(controller.signal);
		await api.listMCPActivity(8, controller.signal);

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/api/v1/api-tokens',
			'/api/v1/mcp/activity'
		]);
		expect(Object.fromEntries(new URL(requests[1]!.url).searchParams)).toEqual({
			limit: '8'
		});
		expect(requests.every((request) => !request.signal.aborted)).toBe(true);
		controller.abort();
		expect(requests.every((request) => request.signal.aborted)).toBe(true);
	});
});
