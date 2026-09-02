import { describe, expect, it, vi } from 'vitest';
import { openPostWorkspaceKey } from '@openpost/query-catalog';
import {
	createWorkspaceSettingsQueryAPI,
	removeWorkspaceQueriesAfterAccessLoss
} from './workspace-settings';

describe('Workspace settings query API', () => {
	it('forwards Workspace scope, limits, and cancellation', async () => {
		const GET = vi.fn().mockResolvedValue({
			data: [],
			response: new Response(null, { status: 200 })
		});
		const api = createWorkspaceSettingsQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await api.getWorkspaceTeam('workspace-1', signal);
		await api.listWorkspaceAccessAudit('workspace-1', 20, signal);
		await api.getWorkspaceSetup('workspace-1', signal);
		await api.getWorkspaceSettings('workspace-1', signal);

		expect(GET).toHaveBeenNthCalledWith(1, '/workspaces/{id}/team', {
			params: { path: { id: 'workspace-1' } },
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(2, '/workspaces/{id}/access-audit', {
			params: { path: { id: 'workspace-1' }, query: { limit: 20 } },
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(3, '/workspaces/{id}/setup', {
			params: { path: { id: 'workspace-1' } },
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(4, '/workspaces/{id}/settings', {
			params: { path: { id: 'workspace-1' } },
			signal
		});
	});

	it('removes every cached workspace view after confirmed access loss', () => {
		const removeQueries = vi.fn();

		removeWorkspaceQueriesAfterAccessLoss({ removeQueries } as never, 'workspace-1');

		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: openPostWorkspaceKey('workspace-1')
		});
	});
});
