import { QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';
import {
	adminQueryKeys,
	authQueryKeys,
	organizationQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { invalidateEmailChangeDependencies, invalidatePasswordChangeDependencies } from './auth';

describe('auth query API', () => {
	it('refreshes security status and revoked sessions after a password change', async () => {
		const client = new QueryClient();
		const securityKey = authQueryKeys.security();
		const sessionsKey = authQueryKeys.sessions();
		// Unrelated cached reads must stay fresh.
		const configurationKey = authQueryKeys.configuration();
		for (const queryKey of [securityKey, sessionsKey, configurationKey]) {
			client.setQueryData(queryKey, 'cached');
		}

		await invalidatePasswordChangeDependencies(client);

		expect(client.getQueryState(securityKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(sessionsKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(configurationKey)?.isInvalidated).not.toBe(true);
	});

	it('refreshes every email projection after a confirmed email change', async () => {
		const client = new QueryClient();
		const sessionsKey = authQueryKeys.sessions();
		const adminUsersKey = adminQueryKeys.usersRoot();
		const aiPromptsKey = adminQueryKeys.aiPrompts();
		const teamOneKey = workspaceSettingsQueryKeys.team('workspace-1');
		const teamTwoKey = workspaceSettingsQueryKeys.team('workspace-2');
		const orgTeamKey = organizationQueryKeys.team('organization-1');
		const ownershipKey = organizationQueryKeys.ownershipTransfer('organization-1');
		// Scopes outside the change keep serving cached views.
		const untouchedTeamKey = workspaceSettingsQueryKeys.team('workspace-9');
		for (const queryKey of [
			sessionsKey,
			adminUsersKey,
			aiPromptsKey,
			teamOneKey,
			teamTwoKey,
			orgTeamKey,
			ownershipKey,
			untouchedTeamKey
		]) {
			client.setQueryData(queryKey, 'cached');
		}

		await invalidateEmailChangeDependencies(client, {
			workspaceIDs: ['workspace-1', 'workspace-1', 'workspace-2'],
			organizationIDs: ['organization-1', 'organization-1']
		});

		for (const queryKey of [
			sessionsKey,
			adminUsersKey,
			aiPromptsKey,
			teamOneKey,
			teamTwoKey,
			orgTeamKey,
			ownershipKey
		]) {
			expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
		}
		expect(client.getQueryState(untouchedTeamKey)?.isInvalidated).not.toBe(true);
	});
});
