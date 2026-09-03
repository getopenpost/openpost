import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createPublicProfileQueryAPI } from './public-profiles';

describe('public profile query API', () => {
	it('loads the named profile with the request signal', async () => {
		const profile = { username: 'founder' };
		let request: Request | undefined;
		const fetchMock = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return Response.json(profile);
		});
		const api = createPublicProfileQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await expect(api.getPublicProfile('founder', controller.signal)).resolves.toEqual(profile);
		expect(request).toBeDefined();
		expect(new URL(request!.url).pathname).toBe('/api/v1/public/profiles/founder');
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});
});
