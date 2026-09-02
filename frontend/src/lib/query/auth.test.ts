import type { paths } from '@openpost/api-contract';
import { describe, expect, it, vi } from 'vitest';
import {
	adminQueryKeys,
	authQueryKeys,
	organizationQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import createClient from 'openapi-fetch';
import {
	createAuthQueryAPI,
	invalidateEmailChangeDependencies,
	invalidatePasswordChangeDependencies
} from './auth';

describe('auth query API', () => {
	it('normalizes typed GET results and forwards the request signal', async () => {
		const configuration = { registration_enabled: true };
		const providers = [{ id: 'provider-1' }];
		const security = { passkeys: [] };
		const identities = [{ id: 'identity-1' }];
		const emailChange = {};
		const sessions = [{ id: 'session-1' }];
		const responses = [
			configuration,
			providers,
			security,
			identities,
			providers,
			emailChange,
			sessions
		];
		const requests: Request[] = [];
		let responseIndex = 0;
		const fetchMock = vi.fn(async (request: Request) => {
			requests.push(request);
			const response = responses[responseIndex];
			responseIndex += 1;
			return Response.json(response);
		});
		const api = createAuthQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await expect(api.getAuthConfiguration(controller.signal)).resolves.toEqual(configuration);
		await expect(api.listOIDCProviders(controller.signal)).resolves.toEqual(providers);
		await expect(api.getSecurityStatus(controller.signal)).resolves.toEqual(security);
		await expect(api.listOIDCIdentities(controller.signal)).resolves.toEqual(identities);
		await expect(api.listLinkableOIDCProviders(controller.signal)).resolves.toEqual(providers);
		await expect(api.getEmailChangeStatus(controller.signal)).resolves.toEqual(emailChange);
		await expect(api.listAuthSessions(controller.signal)).resolves.toEqual(sessions);
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/api/v1/auth/config',
			'/api/v1/auth/oidc/providers',
			'/api/v1/auth/security',
			'/api/v1/auth/oidc/identities',
			'/api/v1/auth/oidc/link-providers',
			'/api/v1/auth/email-change',
			'/api/v1/auth/sessions'
		]);
		expect(requests.every((request) => !request.signal.aborted)).toBe(true);
		controller.abort();
		expect(requests.every((request) => request.signal.aborted)).toBe(true);
	});

	it('invalidates security status and revoked sessions after a password change', async () => {
		const client = new QueryClient();
		const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

		await invalidatePasswordChangeDependencies(client);

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: authQueryKeys.security(),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: authQueryKeys.sessions(),
			exact: true
		});
	});

	it('invalidates every email projection after a confirmed email change', async () => {
		const client = new QueryClient();
		const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

		await invalidateEmailChangeDependencies(client, {
			workspaceIDs: ['workspace-1', 'workspace-1', 'workspace-2'],
			organizationIDs: ['organization-1', 'organization-1']
		});

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: authQueryKeys.sessions(),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: adminQueryKeys.usersRoot()
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: adminQueryKeys.aiPrompts(),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: workspaceSettingsQueryKeys.team('workspace-1'),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: workspaceSettingsQueryKeys.team('workspace-2'),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.team('organization-1'),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.ownershipTransfer('organization-1'),
			exact: true
		});
		expect(invalidateQueries).toHaveBeenCalledTimes(7);
	});
});
