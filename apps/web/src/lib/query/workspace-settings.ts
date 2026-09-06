import type { QueryClient } from '@tanstack/query-core';
import { openPostWorkspaceKey, type WorkspaceSettingsQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createWorkspaceSettingsQueryAPI(
	transport: QueryTransport
): WorkspaceSettingsQueryAPI {
	return {
		async getWorkspaceTeam(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load Workspace team',
				request: (requestSignal) =>
					transport.GET('/workspaces/{id}/team', {
						params: { path: { id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listWorkspaceAccessAudit(workspaceId, limit, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load Workspace access history',
				request: (requestSignal) =>
					transport.GET('/workspaces/{id}/access-audit', {
						params: { path: { id: workspaceId }, query: { limit } },
						signal: requestSignal
					})
			});
			return data ?? [];
		},
		async getWorkspaceSetup(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load Workspace setup',
				request: (requestSignal) =>
					transport.GET('/workspaces/{id}/setup', {
						params: { path: { id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getWorkspaceSettings(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load Workspace settings',
				request: (requestSignal) =>
					transport.GET('/workspaces/{id}/settings', {
						params: { path: { id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const workspaceSettingsQueryAPI = createWorkspaceSettingsQueryAPI(client);

export function removeWorkspaceQueriesAfterAccessLoss(
	cache: Pick<QueryClient, 'removeQueries'>,
	workspaceID: string
) {
	cache.removeQueries({ queryKey: openPostWorkspaceKey(workspaceID) });
}
