import type { QueryClient } from '@tanstack/query-core';
import {
	emailChangeCachePlan,
	passwordChangeCachePlan,
	type AuthQueryAPI
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { executeQueryCachePlan } from './cache-plan';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createAuthQueryAPI(transport: QueryTransport): AuthQueryAPI {
	return {
		async getAuthConfiguration(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load authentication settings',
				request: (requestSignal) => transport.GET('/auth/config', { signal: requestSignal })
			});
			return data;
		},
		async listOIDCProviders(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load sign-in providers',
				request: (requestSignal) => transport.GET('/auth/oidc/providers', { signal: requestSignal })
			});
			return data;
		},
		async getSecurityStatus(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load security settings',
				request: (requestSignal) => transport.GET('/auth/security', { signal: requestSignal })
			});
			return data;
		},
		async listOIDCIdentities(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load linked identities',
				request: (requestSignal) =>
					transport.GET('/auth/oidc/identities', { signal: requestSignal })
			});
			return data ?? [];
		},
		async listLinkableOIDCProviders(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load identity providers',
				request: (requestSignal) =>
					transport.GET('/auth/oidc/link-providers', { signal: requestSignal })
			});
			return data ?? [];
		},
		async getEmailChangeStatus(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load pending email change',
				request: (requestSignal) => transport.GET('/auth/email-change', { signal: requestSignal })
			});
			return data;
		},
		async listAuthSessions(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load sessions',
				request: (requestSignal) => transport.GET('/auth/sessions', { signal: requestSignal })
			});
			return data ?? [];
		}
	};
}

export const authQueryAPI = createAuthQueryAPI(client);

export async function invalidatePasswordChangeDependencies(
	cache: Pick<QueryClient, 'invalidateQueries'>
) {
	await executeQueryCachePlan(cache, passwordChangeCachePlan());
}

export async function invalidateEmailChangeDependencies(
	cache: Pick<QueryClient, 'invalidateQueries'>,
	scope: {
		workspaceIDs: readonly string[];
		organizationIDs: readonly string[];
	}
) {
	await executeQueryCachePlan(
		cache,
		emailChangeCachePlan({
			workspaceIds: scope.workspaceIDs,
			organizationIds: scope.organizationIDs
		})
	);
}
