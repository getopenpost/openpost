import type { QueryClient } from '@tanstack/query-core';
import {
	authQueryKeys,
	developerQueryKeys,
	isBillingStatusQueryKey,
	organizationQueryKeys,
	type OrganizationQueryAPI
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createOrganizationQueryAPI(transport: QueryTransport): OrganizationQueryAPI {
	return {
		async listOrganizations(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load organizations',
				request: (requestSignal) => transport.GET('/organizations', { signal: requestSignal })
			});
			return data ?? [];
		},
		async getOrganizationTeam(organizationId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load organization team',
				request: (requestSignal) =>
					transport.GET('/organizations/{id}/team', {
						params: { path: { id: organizationId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getOwnershipTransfer(organizationId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load ownership transfer',
				request: (requestSignal) =>
					transport.GET('/organizations/{id}/ownership-transfer', {
						params: { path: { id: organizationId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listIdentityProviders(organizationId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load identity providers',
				request: (requestSignal) =>
					transport.GET('/organizations/{organization_id}/identity-providers', {
						params: { path: { organization_id: organizationId } },
						signal: requestSignal
					})
			});
			return data ?? [];
		},
		async getSSOPolicy(organizationId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load SSO policy',
				request: (requestSignal) =>
					transport.GET('/organizations/{organization_id}/sso-policy', {
						params: { path: { organization_id: organizationId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listSSODomains(organizationId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load SSO domains',
				request: (requestSignal) =>
					transport.GET('/organizations/{organization_id}/sso-domains', {
						params: { path: { organization_id: organizationId } },
						signal: requestSignal
					})
			});
			return data ?? [];
		},
		async listIdentityAuditEvents(organizationId, limit, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load identity audit events',
				request: (requestSignal) =>
					transport.GET('/organizations/{organization_id}/identity-audit-events', {
						params: {
							path: { organization_id: organizationId },
							query: { limit }
						},
						signal: requestSignal
					})
			});
			return data ?? [];
		},
		async listOrganizationAuditEvents(organizationId, query, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load organization audit events',
				request: (requestSignal) =>
					transport.GET('/organizations/{id}/audit-events', {
						params: { path: { id: organizationId }, query },
						signal: requestSignal
					})
			});
			return data;
		},
		async listInstanceAuditEvents(query, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load instance audit events',
				request: (requestSignal) =>
					transport.GET('/admin/audit-events', {
						params: { query },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const organizationQueryAPI = createOrganizationQueryAPI(client);

export async function invalidateOrganizationIdentityDependencies(
	cache: Pick<QueryClient, 'invalidateQueries'>,
	organizationID: string
) {
	await Promise.all([
		cache.invalidateQueries({
			queryKey: organizationQueryKeys.detailRoot(organizationID)
		}),
		cache.invalidateQueries({
			queryKey: organizationQueryKeys.instanceAuditRoot()
		}),
		cache.invalidateQueries({
			queryKey: authQueryKeys.linkableOIDCProviders(),
			exact: true
		}),
		cache.invalidateQueries({
			queryKey: authQueryKeys.oidcIdentities(),
			exact: true
		}),
		cache.invalidateQueries({
			queryKey: authQueryKeys.sessions(),
			exact: true
		}),
		cache.invalidateQueries({ queryKey: developerQueryKeys.mcpActivityRoot() }),
		cache.invalidateQueries({
			predicate: (query) => isBillingStatusQueryKey(query.queryKey)
		})
	]);
}
