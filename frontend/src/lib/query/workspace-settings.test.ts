import { describe, expect, it, vi } from 'vitest';
import type { paths } from '@openpost/api-contract';
import { openPostWorkspaceKey } from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import createClient from 'openapi-fetch';
import {
	createWorkspaceSettingsQueryAPI,
	removeWorkspaceQueriesAfterAccessLoss
} from './workspace-settings';

describe('Workspace settings query API', () => {
	it('forwards Workspace scope, limits, and cancellation', async () => {
		const requests: Request[] = [];
		const fetchMock = vi.fn(async (request: Request) => {
			requests.push(request);
			return Response.json([]);
		});
		const api = createWorkspaceSettingsQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await api.getWorkspaceTeam('workspace-1', controller.signal);
		await api.listWorkspaceAccessAudit('workspace-1', 20, controller.signal);
		await api.getWorkspaceSetup('workspace-1', controller.signal);
		await api.getWorkspaceSettings('workspace-1', controller.signal);

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/api/v1/workspaces/workspace-1/team',
			'/api/v1/workspaces/workspace-1/access-audit',
			'/api/v1/workspaces/workspace-1/setup',
			'/api/v1/workspaces/workspace-1/settings'
		]);
		expect(Object.fromEntries(new URL(requests[1]!.url).searchParams)).toEqual({
			limit: '20'
		});
		expect(requests.every((request) => !request.signal.aborted)).toBe(true);
		controller.abort();
		expect(requests.every((request) => request.signal.aborted)).toBe(true);
	});

	it('removes every cached workspace view after confirmed access loss', () => {
		const client = new QueryClient();
		const removeQueries = vi.spyOn(client, 'removeQueries');

		removeWorkspaceQueriesAfterAccessLoss(client, 'workspace-1');

		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: openPostWorkspaceKey('workspace-1')
		});
	});
});
