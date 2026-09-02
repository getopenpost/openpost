import type { paths } from '@openpost/api-contract';
import { describe, expect, it, vi } from 'vitest';
import {
	adminQueryKeys,
	openPostQueryKeys,
	publicProfileQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import createClient from 'openapi-fetch';
import { createAccountCatalogQueryAPI, invalidateAccountMutationDependencies } from './accounts';

describe('account catalogue query API', () => {
	it('forwards Workspace and cancellation', async () => {
		let request: Request | undefined;
		const fetchMock = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return Response.json([{ id: 'provider-1' }]);
		});
		const api = createAccountCatalogQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await api.listAccountProviders('workspace-1', controller.signal);

		expect(request).toBeDefined();
		const url = new URL(request!.url);
		expect(url.pathname).toBe('/api/v1/accounts/providers');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			workspace_id: 'workspace-1'
		});
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});

	it('invalidates every account-dependent view after a connection mutation', async () => {
		const client = new QueryClient();
		const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
		const removeQueries = vi.spyOn(client, 'removeQueries');

		await invalidateAccountMutationDependencies(client, 'workspace-1');

		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: publicProfileQueryKeys.all()
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: openPostQueryKeys.accounts('workspace-1'),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['openpost', 'v1', 'workspace', 'workspace-1', 'account-features']
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: openPostQueryKeys.socialSets('workspace-1'),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: adminQueryKeys.usersRoot()
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: workspaceSettingsQueryKeys.setup('workspace-1'),
			exact: true
		});
	});
});
