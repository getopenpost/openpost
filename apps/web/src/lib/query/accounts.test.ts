import { QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';
import {
	adminQueryKeys,
	openPostQueryKeys,
	publicProfileQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { invalidateAccountMutationDependencies } from './accounts';

describe('account catalogue query API', () => {
	it('refreshes every account-dependent view after a connection mutation', async () => {
		const client = new QueryClient();
		const profileKey = publicProfileQueryKeys.all();
		const accountsKey = openPostQueryKeys.accounts('workspace-1');
		const featuresKey = ['openpost', 'v1', 'workspace', 'workspace-1', 'account-features'] as const;
		const socialSetsKey = openPostQueryKeys.socialSets('workspace-1');
		const adminUsersKey = adminQueryKeys.usersRoot();
		const setupKey = workspaceSettingsQueryKeys.setup('workspace-1');
		// A sibling workspace must keep serving its cached views.
		const otherWorkspaceKey = openPostQueryKeys.accounts('workspace-2');
		for (const queryKey of [
			profileKey,
			accountsKey,
			featuresKey,
			socialSetsKey,
			adminUsersKey,
			setupKey,
			otherWorkspaceKey
		]) {
			client.setQueryData(queryKey, 'cached');
		}

		await invalidateAccountMutationDependencies(client, 'workspace-1');

		expect(client.getQueryData(profileKey)).toBeUndefined();
		for (const queryKey of [accountsKey, featuresKey, socialSetsKey, adminUsersKey, setupKey]) {
			expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
		}
		expect(client.getQueryState(otherWorkspaceKey)?.isInvalidated).not.toBe(true);
	});
});
