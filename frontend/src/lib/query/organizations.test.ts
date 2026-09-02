import { describe, expect, it, vi } from 'vitest';
import { authQueryKeys, developerQueryKeys, organizationQueryKeys } from '@openpost/query-catalog';
import {
	createOrganizationQueryAPI,
	invalidateOrganizationIdentityDependencies
} from './organizations';

describe('organization query API', () => {
	it('forwards organization scope, filters, and cancellation', async () => {
		const GET = vi.fn().mockResolvedValue({
			data: [],
			response: new Response(null, { status: 200 })
		});
		const api = createOrganizationQueryAPI({ GET } as never);
		const signal = new AbortController().signal;
		const query = { action: 'member.updated', limit: 50 };

		await api.listOrganizations(signal);
		await api.listIdentityProviders('organization-1', signal);
		await api.listIdentityAuditEvents('organization-1', 20, signal);
		await api.listOrganizationAuditEvents('organization-1', query, signal);
		await api.listInstanceAuditEvents(query, signal);

		expect(GET).toHaveBeenNthCalledWith(1, '/organizations', { signal });
		expect(GET).toHaveBeenNthCalledWith(2, '/organizations/{organization_id}/identity-providers', {
			params: { path: { organization_id: 'organization-1' } },
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(
			3,
			'/organizations/{organization_id}/identity-audit-events',
			{
				params: {
					path: { organization_id: 'organization-1' },
					query: { limit: 20 }
				},
				signal
			}
		);
		expect(GET).toHaveBeenNthCalledWith(4, '/organizations/{id}/audit-events', {
			params: { path: { id: 'organization-1' }, query },
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(5, '/admin/audit-events', {
			params: { query },
			signal
		});
	});

	it('invalidates every identity view after organization SSO changes', async () => {
		const invalidateQueries = vi.fn().mockResolvedValue(undefined);

		await invalidateOrganizationIdentityDependencies(
			{ invalidateQueries } as never,
			'organization-1'
		);

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.detailRoot('organization-1')
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.instanceAuditRoot()
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: authQueryKeys.linkableOIDCProviders(),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: authQueryKeys.oidcIdentities(),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: authQueryKeys.sessions(),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: developerQueryKeys.mcpActivityRoot()
		});
	});
});
