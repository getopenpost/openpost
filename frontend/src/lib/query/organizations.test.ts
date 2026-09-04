import { describe, expect, it } from 'vitest';
import { authQueryKeys, developerQueryKeys, organizationQueryKeys } from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import { invalidateOrganizationIdentityDependencies } from './organizations';

describe('organization query API', () => {
	it('refreshes every identity view after organization SSO changes', async () => {
		const client = new QueryClient();
		const detailKey = organizationQueryKeys.detailRoot('organization-1');
		const instanceAuditKey = organizationQueryKeys.instanceAuditRoot();
		const linkableKey = authQueryKeys.linkableOIDCProviders();
		const identitiesKey = authQueryKeys.oidcIdentities();
		const sessionsKey = authQueryKeys.sessions();
		const mcpActivityKey = developerQueryKeys.mcpActivityRoot();
		// A sibling organization must keep serving its cached views.
		const otherOrganizationKey = organizationQueryKeys.detailRoot('organization-2');
		for (const queryKey of [
			detailKey,
			instanceAuditKey,
			linkableKey,
			identitiesKey,
			sessionsKey,
			mcpActivityKey,
			otherOrganizationKey
		]) {
			client.setQueryData(queryKey, 'cached');
		}

		await invalidateOrganizationIdentityDependencies(client, 'organization-1');

		for (const queryKey of [
			detailKey,
			instanceAuditKey,
			linkableKey,
			identitiesKey,
			sessionsKey,
			mcpActivityKey
		]) {
			expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
		}
		expect(client.getQueryState(otherOrganizationKey)?.isInvalidated).not.toBe(true);
	});
});
