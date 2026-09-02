import type { paths } from '@openpost/api-contract';
import { describe, expect, it, vi } from 'vitest';
import { authQueryKeys, developerQueryKeys, organizationQueryKeys } from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import createClient from 'openapi-fetch';
import {
	createOrganizationQueryAPI,
	invalidateOrganizationIdentityDependencies
} from './organizations';

describe('organization query API', () => {
	it('forwards organization scope, filters, and cancellation', async () => {
		const requests: Request[] = [];
		const fetchMock = vi.fn(async (request: Request) => {
			requests.push(request);
			return Response.json([]);
		});
		const api = createOrganizationQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();
		const query = { action: 'member.updated', limit: 50 };

		await api.listOrganizations(controller.signal);
		await api.listIdentityProviders('organization-1', controller.signal);
		await api.listIdentityAuditEvents('organization-1', 20, controller.signal);
		await api.listOrganizationAuditEvents('organization-1', query, controller.signal);
		await api.listInstanceAuditEvents(query, controller.signal);

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/api/v1/organizations',
			'/api/v1/organizations/organization-1/identity-providers',
			'/api/v1/organizations/organization-1/identity-audit-events',
			'/api/v1/organizations/organization-1/audit-events',
			'/api/v1/admin/audit-events'
		]);
		expect(Object.fromEntries(new URL(requests[2]!.url).searchParams)).toEqual({
			limit: '20'
		});
		expect(Object.fromEntries(new URL(requests[3]!.url).searchParams)).toEqual({
			action: 'member.updated',
			limit: '50'
		});
		expect(Object.fromEntries(new URL(requests[4]!.url).searchParams)).toEqual({
			action: 'member.updated',
			limit: '50'
		});
		expect(requests.every((request) => !request.signal.aborted)).toBe(true);
		controller.abort();
		expect(requests.every((request) => request.signal.aborted)).toBe(true);
	});

	it('invalidates every identity view after organization SSO changes', async () => {
		const client = new QueryClient();
		const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

		await invalidateOrganizationIdentityDependencies(client, 'organization-1');

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
