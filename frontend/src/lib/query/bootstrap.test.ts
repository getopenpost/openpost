import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createAppBootstrapQueryAPI } from './bootstrap';

describe('application bootstrap query API', () => {
	it('forwards the preferred Workspace and cancellation', async () => {
		const bootstrap = { authenticated: false, workspaces: [] };
		let request: Request | undefined;
		const fetchMock = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return Response.json(bootstrap);
		});
		const api = createAppBootstrapQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await expect(api.getAppBootstrap('workspace-1', controller.signal)).resolves.toEqual(bootstrap);
		expect(request).toBeDefined();
		const url = new URL(request!.url);
		expect(url.pathname).toBe('/api/v1/app/bootstrap');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			preferred_workspace_id: 'workspace-1'
		});
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});
});
