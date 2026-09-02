import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/query-core';
import { client, type User } from '$lib/api/client';
import { authQueryKeys, type AppBootstrap } from '@openpost/query-catalog';
import {
	captureQueryAuthorizationIdentity,
	settleQueryUnauthorized
} from '$lib/query/authorization-boundary';
import { createAuthStore, registerAuthQueryAuthorizationBoundary } from './auth';

const apiMocks = {
	post: vi.fn()
};

const auth = createAuthStore({
	client: { GET: client.GET, POST: apiMocks.post },
	getPasskeyAssertion: vi.fn(),
	notificationInbox: { clear: vi.fn() },
	identifyTelemetryUser: vi.fn(),
	resetTelemetryIdentity: vi.fn()
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('auth recovery-code verification', () => {
	afterEach(() => {
		auth.clearLocal();
		apiMocks.post.mockReset();
	});

	it('submits the pending MFA token and authenticates after a valid recovery code', async () => {
		const user = {
			id: 'user-1',
			email: 'person@example.com',
			username: 'person',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		apiMocks.post.mockResolvedValue({ data: { token: 'session-token', user } });

		const result = await auth.verifyRecoveryCode('mfa-challenge', 'ABCD-EFGH-JKMP-QRST');

		expect(result).toEqual({ success: true });
		expect(apiMocks.post).toHaveBeenCalledWith('/auth/login/recovery-code', {
			body: {
				mfa_token: 'mfa-challenge',
				code: 'ABCD-EFGH-JKMP-QRST'
			}
		});
		let current: { isAuthenticated: boolean; user: { id: string } | null } | undefined;
		const unsubscribe = auth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isAuthenticated: true,
			user: { id: 'user-1' }
		});
	});

	it('keeps the pending login unauthenticated when the code is rejected', async () => {
		apiMocks.post.mockResolvedValue({
			error: { detail: 'invalid recovery code' }
		});

		const result = await auth.verifyRecoveryCode('mfa-challenge', 'USED-CODE');

		expect(result).toEqual({ success: false, error: 'invalid recovery code' });
	});

	it('clears authentication when the projected user becomes null', () => {
		auth.setUser({
			id: 'user-null-test',
			email: 'person@example.com',
			username: 'person',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		});

		auth.setUser(null);

		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = auth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({ isAuthenticated: false, user: null });
	});

	it('clears the actor when a forced bootstrap reports an expired session', () => {
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});
		const user = {
			id: 'expiring-user',
			email: 'person@example.com',
			username: 'person',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		isolatedAuth.setUser(user);
		const projection = isolatedAuth.captureUserProjection(user.id);

		expect(
			isolatedAuth.projectBootstrap(
				{
					authenticated: false,
					user: null,
					workspaces: [],
					selected_workspace_id: null,
					selected_workspace_settings: null
				},
				projection
			)
		).toBe(false);

		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({ isAuthenticated: false, user: null });
	});

	it('preserves a newer same-actor projection when an older workspace bootstrap resolves', () => {
		const cache = new QueryClient();
		const initialUser: User = {
			id: 'same-actor',
			email: 'before@example.com',
			username: 'before',
			display_name: 'Before',
			avatar_url: '',
			composer_experience: 'specialized',
			public_profile_enabled: false,
			public_profile_visible_fields: [],
			is_admin: false,
			is_managed: false,
			has_password: false,
			password_usable: false,
			legal_acceptance_required: false,
			privacy_version: 'baseline-privacy',
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const bootstrapUser: User = {
			...initialUser,
			has_password: true,
			password_usable: true
		};
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: cache,
			resetWorkspaceState: vi.fn()
		});
		isolatedAuth.setUser(initialUser);
		const projection = isolatedAuth.captureUserProjection(initialUser.id);
		const staleBootstrap: AppBootstrap = {
			authenticated: true,
			user: bootstrapUser,
			workspaces: [{ id: 'workspace-after-password-change' }] as AppBootstrap['workspaces'],
			selected_workspace_id: 'workspace-after-password-change',
			selected_workspace_settings: null
		};
		const bootstrapKey = [
			'openpost',
			'v1',
			'app',
			'bootstrap',
			{ preferredWorkspaceId: 'workspace-after-password-change' }
		] as const;
		cache.setQueryData(bootstrapKey, staleBootstrap);
		cache.setQueryData(authQueryKeys.security(), {
			user: initialUser,
			passkeys: [],
			totp: { enabled: false },
			recovery_codes: { remaining: 0 }
		});

		const projectedUser: User = {
			...initialUser,
			email: 'after@example.com',
			username: 'after',
			terms_version: 'projected-terms'
		};
		delete projectedUser.privacy_version;
		isolatedAuth.setUser(projectedUser);

		expect(isolatedAuth.projectBootstrap(staleBootstrap, projection)).toBe(true);
		let current: { user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current?.user).toMatchObject({
			id: initialUser.id,
			email: 'after@example.com',
			username: 'after',
			has_password: true,
			password_usable: true,
			terms_version: 'projected-terms'
		});
		expect(current?.user).not.toHaveProperty('privacy_version');
		expect(cache.getQueryData(bootstrapKey)).toMatchObject({
			user: {
				email: 'after@example.com',
				username: 'after',
				has_password: true,
				password_usable: true,
				terms_version: 'projected-terms'
			},
			workspaces: [{ id: 'workspace-after-password-change' }],
			selected_workspace_id: 'workspace-after-password-change'
		});
		expect(cache.getQueryData(bootstrapKey)).not.toHaveProperty('user.privacy_version');
		expect(cache.getQueryData(authQueryKeys.security())).toMatchObject({
			user: {
				email: 'after@example.com',
				has_password: true,
				terms_version: 'projected-terms'
			}
		});
		expect(cache.getQueryData(authQueryKeys.security())).not.toHaveProperty('user.privacy_version');
	});

	it('accepts an authoritative bootstrap actor change and clears the prior workspace scope', () => {
		const clear = vi.fn();
		const resetWorkspaceState = vi.fn();
		const firstUser = {
			id: 'first-actor',
			email: 'first@example.com',
			username: 'first',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const secondUser = {
			...firstUser,
			id: 'second-actor',
			email: 'second@example.com'
		};
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear,
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState
		});
		isolatedAuth.setUser(firstUser);
		const projection = isolatedAuth.captureUserProjection(firstUser.id);

		expect(
			isolatedAuth.projectBootstrap(
				{
					authenticated: true,
					user: secondUser,
					workspaces: [{ id: 'second-workspace' }] as AppBootstrap['workspaces'],
					selected_workspace_id: 'second-workspace',
					selected_workspace_settings: null
				},
				projection
			)
		).toBe(false);

		let current: { user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current?.user).toMatchObject({
			id: secondUser.id,
			email: secondUser.email
		});
		expect(clear).toHaveBeenCalledTimes(1);
		expect(resetWorkspaceState).toHaveBeenCalledTimes(1);
	});

	it('clears anonymous query data before accepting a new account', async () => {
		const clear = vi.fn();
		const resetWorkspaceState = vi.fn();
		const setQueriesData = vi.fn();
		const setQueryData = vi.fn();
		const user = {
			id: 'user-2',
			email: 'next@example.com',
			username: 'next',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const post = vi.fn().mockResolvedValue({
			data: { user }
		});
		const isolatedAuth = createAuthStore({
			client: { GET: client.GET, POST: post },
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear,
				fetchQuery: vi.fn(),
				setQueryData,
				setQueriesData
			},
			resetWorkspaceState
		});
		isolatedAuth.clearLocal();

		await expect(isolatedAuth.login('next@example.com', 'password')).resolves.toEqual({
			success: true
		});

		expect(clear).toHaveBeenCalledTimes(1);
		expect(resetWorkspaceState).toHaveBeenCalledTimes(1);

		isolatedAuth.setUser({ ...user, email: 'updated@example.com' });
		const updateBootstrap = setQueriesData.mock.lastCall?.[1];
		expect(
			updateBootstrap?.({
				authenticated: true,
				user,
				workspaces: [],
				selected_workspace_id: null,
				selected_workspace_settings: null
			})
		).toMatchObject({ user: { email: 'updated@example.com' } });
		const updateSecurity = setQueryData.mock.calls
			.filter(([queryKey]) => JSON.stringify(queryKey) === JSON.stringify(authQueryKeys.security()))
			.at(-1)?.[1];
		expect(
			updateSecurity?.({
				user,
				passkeys: [],
				totp: { enabled: false },
				recovery_codes: { remaining: 0 }
			})
		).toMatchObject({ user: { email: 'updated@example.com' } });
	});

	it('tears down the captured account after an authenticated query reports 401', () => {
		const clear = vi.fn();
		const resetWorkspaceState = vi.fn();
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear,
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState
		});
		isolatedAuth.setUser({
			id: 'expired-user',
			email: 'expired@example.com',
			username: 'expired',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		});
		const restoreBoundary = registerAuthQueryAuthorizationBoundary(isolatedAuth);

		try {
			const identity = captureQueryAuthorizationIdentity();
			settleQueryUnauthorized(identity);
		} finally {
			restoreBoundary();
		}

		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({ isAuthenticated: false, user: null });
		expect(clear).toHaveBeenCalledTimes(1);
		expect(resetWorkspaceState).toHaveBeenCalledTimes(1);
	});

	it('does not clear a new actor when an earlier logout request finishes', async () => {
		let resolveLogout!: () => void;
		const logoutResponse = new Promise<void>((resolve) => {
			resolveLogout = resolve;
		});
		const firstUser = {
			id: 'logout-first-user',
			email: 'first@example.com',
			username: 'first',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const secondUser = {
			...firstUser,
			id: 'logout-second-user',
			email: 'second@example.com'
		};
		const isolatedAuth = createAuthStore({
			client: {
				GET: client.GET,
				POST: vi.fn(() => logoutResponse)
			},
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});
		isolatedAuth.setUser(firstUser);
		const firstIdentity = isolatedAuth.captureIdentity();
		const logout = isolatedAuth.logout();
		isolatedAuth.setUser(secondUser);

		resolveLogout();
		await logout;

		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isAuthenticated: true,
			user: { id: secondUser.id, email: secondUser.email }
		});
		expect(isolatedAuth.isIdentityCurrent(firstIdentity)).toBe(false);
	});

	it('still clears the same actor when their projection changes during logout', async () => {
		const logoutResponse = deferred<void>();
		const user = {
			id: 'logout-projected-user',
			email: 'before@example.com',
			username: 'projected',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const post = vi.fn(() => logoutResponse.promise);
		const isolatedAuth = createAuthStore({
			client: { GET: client.GET, POST: post },
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});
		isolatedAuth.setUser(user);
		const logout = isolatedAuth.logout();
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

		isolatedAuth.setUser({ ...user, email: 'after@example.com' });
		logoutResponse.resolve();

		await expect(logout).resolves.toBe(true);
		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({ isAuthenticated: false, user: null });
	});

	it('serializes login responses before applying the newer actor', async () => {
		const firstResponse = deferred<unknown>();
		const secondResponse = deferred<unknown>();
		const post = vi
			.fn()
			.mockReturnValueOnce(firstResponse.promise)
			.mockResolvedValueOnce({})
			.mockReturnValueOnce(secondResponse.promise);
		const firstUser = {
			id: 'out-of-order-first',
			email: 'first@example.com',
			username: 'first',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const secondUser = {
			...firstUser,
			id: 'out-of-order-second',
			email: 'second@example.com'
		};
		const isolatedAuth = createAuthStore({
			client: { GET: client.GET, POST: post },
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});

		const firstLogin = isolatedAuth.login(firstUser.email, 'password');
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const secondLogin = isolatedAuth.login(secondUser.email, 'password');
		expect(post).toHaveBeenCalledTimes(1);
		firstResponse.resolve({ data: { user: firstUser } });
		await expect(firstLogin).resolves.toEqual({ success: false });
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(3));
		secondResponse.resolve({ data: { user: secondUser } });
		await expect(secondLogin).resolves.toEqual({ success: true });

		let current: { user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current?.user).toMatchObject({
			id: secondUser.id,
			email: secondUser.email
		});
		expect(post.mock.calls.map(([path]) => path)).toEqual([
			'/auth/login',
			'/auth/logout',
			'/auth/login'
		]);
	});

	it('clears a superseded login session before a newer login can fail', async () => {
		const firstResponse = deferred<unknown>();
		const secondResponse = deferred<unknown>();
		const staleUser = {
			id: 'superseded-session-user',
			email: 'stale@example.com',
			username: 'stale',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const post = vi
			.fn()
			.mockReturnValueOnce(firstResponse.promise)
			.mockResolvedValueOnce({})
			.mockReturnValueOnce(secondResponse.promise);
		const isolatedAuth = createAuthStore({
			client: { GET: client.GET, POST: post },
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});

		const staleLogin = isolatedAuth.login(staleUser.email, 'password');
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const latestLogin = isolatedAuth.login('invalid@example.com', 'wrong-password');
		firstResponse.resolve({ data: { user: staleUser } });
		await expect(staleLogin).resolves.toEqual({ success: false });
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(3));
		secondResponse.resolve({ error: { detail: 'Invalid credentials' } });

		await expect(latestLogin).resolves.toEqual({
			success: false,
			error: 'Invalid credentials'
		});
		expect(post.mock.calls.map(([path]) => path)).toEqual([
			'/auth/login',
			'/auth/logout',
			'/auth/login'
		]);
		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({ isAuthenticated: false, user: null });
	});

	it('keeps the server actor visible when superseded-session cleanup fails', async () => {
		const firstResponse = deferred<unknown>();
		const retryResponse = deferred<unknown>();
		const staleUser = {
			id: 'uncleared-session-user',
			email: 'uncleared@example.com',
			username: 'uncleared',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const post = vi
			.fn()
			.mockReturnValueOnce(firstResponse.promise)
			.mockResolvedValueOnce({ error: { detail: 'Logout failed' } })
			.mockReturnValueOnce(retryResponse.promise);
		const isolatedAuth = createAuthStore({
			client: { GET: client.GET, POST: post },
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});

		const staleLogin = isolatedAuth.login(staleUser.email, 'password');
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const blockedLogin = isolatedAuth.login('invalid@example.com', 'wrong-password');
		firstResponse.resolve({ data: { user: staleUser } });

		await expect(staleLogin).resolves.toEqual({ success: false });
		await expect(blockedLogin).resolves.toEqual({ success: false });
		expect(post).toHaveBeenCalledTimes(2);

		const retryLogin = isolatedAuth.login('invalid@example.com', 'wrong-password');
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(3));
		retryResponse.resolve({ error: { detail: 'Invalid credentials' } });
		await expect(retryLogin).resolves.toEqual({
			success: false,
			error: 'Invalid credentials'
		});

		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isAuthenticated: true,
			user: { id: staleUser.id }
		});
		expect(post.mock.calls.map(([path]) => path)).toEqual([
			'/auth/login',
			'/auth/logout',
			'/auth/login'
		]);
	});

	it('serializes an older MFA response before applying the newer actor', async () => {
		const firstResponse = deferred<unknown>();
		const secondResponse = deferred<unknown>();
		const post = vi
			.fn()
			.mockReturnValueOnce(firstResponse.promise)
			.mockReturnValueOnce(secondResponse.promise);
		const user = {
			id: 'newer-authenticated-user',
			email: 'newer@example.com',
			username: 'newer',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const isolatedAuth = createAuthStore({
			client: { GET: client.GET, POST: post },
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn(),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});

		const olderLogin = isolatedAuth.login('older@example.com', 'password');
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const newerLogin = isolatedAuth.login(user.email, 'password');
		expect(post).toHaveBeenCalledTimes(1);
		firstResponse.resolve({
			data: {
				requires_mfa: true,
				mfa_token: 'older-token',
				mfa_methods: ['totp']
			}
		});
		await expect(olderLogin).resolves.toEqual({ success: false });
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
		secondResponse.resolve({ data: { user } });
		await expect(newerLogin).resolves.toEqual({ success: true });

		let current: { isAuthenticated: boolean; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isAuthenticated: true,
			user: { id: user.id }
		});
	});

	it('re-seeds bootstrap state after a repeated initialization changes actors', async () => {
		const clear = vi.fn();
		const resetWorkspaceState = vi.fn();
		const setQueryData = vi.fn();
		const anonymousBootstrap = {
			authenticated: false,
			user: null,
			workspaces: [],
			selected_workspace_id: null,
			selected_workspace_settings: null
		};
		const authenticatedBootstrap = {
			authenticated: true,
			user: {
				id: 'user-3',
				email: 'third@example.com',
				username: 'third',
				public_profile_enabled: false,
				is_admin: false,
				is_managed: false,
				has_password: true,
				legal_acceptance_required: false,
				email_verified: true,
				created_at: '2026-08-09T00:00:00Z'
			},
			workspaces: [],
			selected_workspace_id: null,
			selected_workspace_settings: null
		};
		const fetchQuery = vi
			.fn()
			.mockResolvedValueOnce(anonymousBootstrap)
			.mockResolvedValueOnce(authenticatedBootstrap);
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear,
				fetchQuery,
				setQueryData,
				setQueriesData: vi.fn()
			},
			resetWorkspaceState
		});

		await isolatedAuth.initialize();
		await isolatedAuth.initialize();

		expect(clear).toHaveBeenCalledTimes(1);
		expect(resetWorkspaceState).toHaveBeenCalledTimes(1);
		expect(setQueryData).toHaveBeenCalledWith(
			['openpost', 'v1', 'app', 'bootstrap', { preferredWorkspaceId: '' }],
			authenticatedBootstrap
		);
		expect(setQueryData).toHaveBeenLastCalledWith(
			['openpost', 'v1', 'workspaces'],
			authenticatedBootstrap.workspaces
		);
	});

	it('lets optional public routes render when bootstrap is unavailable', async () => {
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery: vi.fn().mockRejectedValue(new Error('bootstrap unavailable')),
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});

		await isolatedAuth.initialize({ optional: true });

		let current:
			| {
					isLoading: boolean;
					isAuthenticated: boolean;
					initializationError: string;
			  }
			| undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isLoading: false,
			isAuthenticated: false,
			initializationError: ''
		});
	});

	it('clears anonymous public data when login follows an optional bootstrap failure', async () => {
		const clear = vi.fn();
		const resetWorkspaceState = vi.fn();
		const setQueryData = vi.fn();
		const user = {
			id: 'user-after-public-failure',
			email: 'signed-in@example.com',
			username: 'signed-in',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			client: {
				GET: client.GET,
				POST: vi.fn().mockResolvedValue({ data: { user } })
			},
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear,
				fetchQuery: vi.fn().mockRejectedValue(new Error('bootstrap unavailable')),
				setQueryData,
				setQueriesData: vi.fn()
			},
			resetWorkspaceState
		});

		await isolatedAuth.initialize({ optional: true });
		setQueryData(['openpost', 'v1', 'public-profile', 'founder'], {
			username: 'founder'
		});
		await isolatedAuth.login('signed-in@example.com', 'password');

		expect(clear).toHaveBeenCalledTimes(1);
		expect(resetWorkspaceState).toHaveBeenCalledTimes(1);
	});

	it('keeps an authenticated shell visible when bootstrap refresh fails', async () => {
		const user = {
			id: 'user-4',
			email: 'fourth@example.com',
			username: 'fourth',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const fetchQuery = vi.fn().mockRejectedValue(new Error('bootstrap unavailable'));
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery,
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});
		isolatedAuth.setUser(user);

		await isolatedAuth.initialize();

		let current:
			| {
					isLoading: boolean;
					isAuthenticated: boolean;
					initializationError: string;
					user: User | null;
			  }
			| undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isLoading: false,
			isAuthenticated: true,
			initializationError: '',
			user: { id: 'user-4' }
		});
	});

	it('ignores an initialization failure superseded by a projected user', async () => {
		let rejectBootstrap!: (cause: Error) => void;
		const fetchQuery = vi.fn(
			() =>
				new Promise((_, reject) => {
					rejectBootstrap = reject;
				})
		);
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: {
				clear: vi.fn(),
				fetchQuery,
				setQueryData: vi.fn(),
				setQueriesData: vi.fn()
			},
			resetWorkspaceState: vi.fn()
		});
		const projectedUser = {
			id: 'new-user',
			email: 'before@example.com',
			username: 'new',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		isolatedAuth.setUser(projectedUser);
		const initialization = isolatedAuth.initialize();
		isolatedAuth.setUser({ ...projectedUser, email: 'new@example.com' });
		rejectBootstrap(new Error('cancelled'));
		await initialization;

		let current: { isLoading: boolean; initializationError: string; user: User | null } | undefined;
		const unsubscribe = isolatedAuth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({
			isLoading: false,
			initializationError: '',
			user: { id: 'new-user', email: 'new@example.com' }
		});
	});

	it('repairs a bootstrap response committed after its initialization was superseded', async () => {
		let resolveBootstrap!: (bootstrap: AppBootstrap) => void;
		const bootstrapPromise = new Promise<AppBootstrap>((resolve) => {
			resolveBootstrap = resolve;
		});
		const cache = new QueryClient();
		const initialUser = {
			id: 'same-user',
			email: 'before@example.com',
			username: 'same',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		const isolatedAuth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn(),
			queryClient: cache,
			appBootstrapQueryAPI: {
				getAppBootstrap: vi.fn(() => bootstrapPromise)
			},
			resetWorkspaceState: vi.fn()
		});
		isolatedAuth.setUser(initialUser);
		const initialization = isolatedAuth.initialize();
		isolatedAuth.setUser({ ...initialUser, email: 'after@example.com' });
		resolveBootstrap({
			authenticated: true,
			user: initialUser,
			workspaces: [{ id: 'stale-workspace' }] as AppBootstrap['workspaces'],
			selected_workspace_id: 'stale-workspace',
			selected_workspace_settings: null
		});
		await initialization;

		expect(
			cache.getQueryData(['openpost', 'v1', 'app', 'bootstrap', { preferredWorkspaceId: '' }])
		).toMatchObject({
			user: { email: 'after@example.com' },
			workspaces: [],
			selected_workspace_id: null
		});
	});
});
