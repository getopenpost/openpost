import { describe, expect, it, vi } from 'vitest';
import {
	adminQueryKeys,
	authQueryKeys,
	organizationQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
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
		const emailChange = { pending: undefined };
		const sessions = [{ id: 'session-1' }];
		const GET = vi
			.fn()
			.mockResolvedValueOnce({
				data: configuration,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: providers,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: security,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: identities,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: providers,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: emailChange,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: sessions,
				response: new Response(null, { status: 200 })
			});
		const api = createAuthQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await expect(api.getAuthConfiguration(signal)).resolves.toBe(configuration);
		await expect(api.listOIDCProviders(signal)).resolves.toBe(providers);
		await expect(api.getSecurityStatus(signal)).resolves.toBe(security);
		await expect(api.listOIDCIdentities(signal)).resolves.toBe(identities);
		await expect(api.listLinkableOIDCProviders(signal)).resolves.toBe(providers);
		await expect(api.getEmailChangeStatus(signal)).resolves.toBe(emailChange);
		await expect(api.listAuthSessions(signal)).resolves.toBe(sessions);
		expect(GET).toHaveBeenNthCalledWith(1, '/auth/config', { signal });
		expect(GET).toHaveBeenNthCalledWith(2, '/auth/oidc/providers', { signal });
		expect(GET).toHaveBeenNthCalledWith(3, '/auth/security', { signal });
		expect(GET).toHaveBeenNthCalledWith(4, '/auth/oidc/identities', { signal });
		expect(GET).toHaveBeenNthCalledWith(5, '/auth/oidc/link-providers', {
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(6, '/auth/email-change', { signal });
		expect(GET).toHaveBeenNthCalledWith(7, '/auth/sessions', { signal });
	});

	it('invalidates security status and revoked sessions after a password change', async () => {
		const invalidateQueries = vi.fn().mockResolvedValue(undefined);

		await invalidatePasswordChangeDependencies({ invalidateQueries } as never);

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
		const invalidateQueries = vi.fn().mockResolvedValue(undefined);

		await invalidateEmailChangeDependencies({ invalidateQueries } as never, {
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
