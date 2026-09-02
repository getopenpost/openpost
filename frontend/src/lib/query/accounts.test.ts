import { describe, expect, it, vi } from 'vitest';
import {
	adminQueryKeys,
	openPostQueryKeys,
	publicProfileQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { createAccountCatalogQueryAPI, invalidateAccountMutationDependencies } from './accounts';

describe('account catalogue query API', () => {
	it('forwards Workspace and cancellation', async () => {
		const GET = vi.fn().mockResolvedValueOnce({
			data: [{ id: 'provider-1' }],
			response: new Response(null, { status: 200 })
		});
		const api = createAccountCatalogQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await api.listAccountProviders('workspace-1', signal);

		expect(GET).toHaveBeenNthCalledWith(1, '/accounts/providers', {
			params: { query: { workspace_id: 'workspace-1' } },
			signal
		});
	});

	it('invalidates every account-dependent view after a connection mutation', async () => {
		const invalidateQueries = vi.fn().mockResolvedValue(undefined);
		const removeQueries = vi.fn();

		await invalidateAccountMutationDependencies(
			{ invalidateQueries, removeQueries } as never,
			'workspace-1'
		);

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
