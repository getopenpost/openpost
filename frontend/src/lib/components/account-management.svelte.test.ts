import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { client, type SocialAccount, type Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { openPostQueryKeys } from '@openpost/query-catalog';
import AccountManagement from './account-management.svelte';
import '../../routes/layout.css';

const getMock = vi.fn();
const postMock = vi.fn();
vi.spyOn(client, 'GET').mockImplementation(getMock);
vi.spyOn(client, 'POST').mockImplementation(postMock);

const workspace = {
	id: 'workspace-62',
	name: 'Issue 62 Workspace',
	organization_id: 'organization-62',
	can_edit: true,
	created_at: '2026-08-09T12:00:00Z',
	avatar_url: '',
	color: '',
	organization_name: '',
	role: 'admin',
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

const links = {
	createPublicationHref: '/',
	createWorkspaceHref: '/',
	billingHref: '/settings?tab=plan',
	mastodonCallbackHref: '/accounts/mastodon/callback'
};

const account: SocialAccount = {
	id: 'account-1',
	workspace_id: workspace.id,
	slug: 'x-founder',
	platform: 'x',
	account_id: 'provider-account-1',
	account_username: 'old-founder',
	account_avatar_url: '',
	instance_url: '',
	is_active: true,
	thread_replies_supported: true,
	messaging_supported: true,
	messages_enabled: false,
	grant_destination_count: 1,
	shared_grant: false
};

const user = {
	id: 'user-62',
	email: 'founder@example.com',
	username: 'founder',
	public_profile_enabled: false,
	is_admin: false,
	is_managed: false,
	has_password: true,
	legal_acceptance_required: false,
	email_verified: true,
	created_at: '2026-08-09T12:00:00Z'
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('account management modes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryClient.clear();
		auth.setUser(user);
		postMock.mockResolvedValue({ data: null, error: null });
		getMock.mockImplementation((path: string) => {
			if (path === '/accounts') return Promise.resolve({ data: [], error: null });
			return Promise.resolve({ data: [], error: null });
		});
	});

	it('refreshes the open account identity without closing its details', async () => {
		await page.viewport(390, 844);
		getMock.mockImplementation((path: string) => {
			if (path === '/accounts') return Promise.resolve({ data: [account], error: null });
			return Promise.resolve({ data: [], error: null });
		});
		postMock.mockResolvedValue({
			data: {
				...account,
				account_username: 'current-founder',
				account_avatar_url: 'https://cdn.example/current-founder.jpg'
			},
			error: null
		});
		const onAccountsChanged = vi.fn();
		const screen = await render(AccountManagement, {
			workspace,
			workspaces: [workspace],
			links,
			onContinue: vi.fn(),
			onAccountsChanged
		});

		await screen.getByRole('button', { name: /Actions for/ }).click();
		await screen.getByRole('menuitem', { name: 'Account details' }).click();
		await page.screenshot({
			path: '../../../.svelte-kit/account-profile-refresh-before.png'
		});
		await screen.getByRole('button', { name: 'Refresh profile' }).click();

		expect(postMock).toHaveBeenCalledWith('/accounts/{account_id}/refresh-metadata', {
			params: { path: { account_id: 'account-1' } }
		});
		const drawer = screen.getByTestId('account-settings-drawer');
		await expect.element(drawer.getByText('@current-founder')).toBeVisible();
		await expect.element(drawer).toBeVisible();
		expect(drawer.element().querySelector('img')?.getAttribute('src')).toBe(
			'https://cdn.example/current-founder.jpg'
		);
		expect(onAccountsChanged).toHaveBeenCalledOnce();
		await page.screenshot({
			path: '../../../.svelte-kit/account-profile-refresh-after.png'
		});

		await page.viewport(320, 720);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		expect(
			drawer
				.getByRole('button', { name: /Refresh profile for/ })
				.element()
				.getBoundingClientRect().height
		).toBeGreaterThanOrEqual(44);
		await page.screenshot({
			path: '../../../.svelte-kit/account-profile-refresh-320.png'
		});

		document.documentElement.classList.add('dark');
		await page.screenshot({
			path: '../../../.svelte-kit/account-profile-refresh-dark.png'
		});
		document.documentElement.classList.remove('dark');
		await page.viewport(1280, 720);
		const refreshButton = drawer.getByRole('button', {
			name: /Refresh profile for/
		});
		refreshButton.element().focus();
		await expect.element(refreshButton).toHaveFocus();
		await page.screenshot({
			path: '../../../.svelte-kit/account-profile-refresh-desktop.png'
		});
	});

	it('keeps account details open and reports refresh failures', async () => {
		getMock.mockImplementation((path: string) => {
			if (path === '/accounts') return Promise.resolve({ data: [account], error: null });
			return Promise.resolve({ data: [], error: null });
		});
		let completeRefresh: (result: {
			data: null;
			error: { detail: string };
			response: Response;
		}) => void = () => {};
		postMock.mockReturnValue(
			new Promise((resolve) => {
				completeRefresh = resolve;
			})
		);
		const screen = await render(AccountManagement, {
			workspace,
			workspaces: [workspace],
			links,
			onContinue: vi.fn()
		});

		await screen.getByRole('button', { name: /Actions for/ }).click();
		await screen.getByRole('menuitem', { name: 'Account details' }).click();
		await screen.getByRole('button', { name: 'Refresh profile' }).click();
		await expect
			.element(screen.getByRole('button', { name: /Refresh profile for/ }))
			.toBeDisabled();
		await expect.element(screen.getByText('Refreshing…')).toBeVisible();

		completeRefresh({
			data: null,
			error: { detail: 'Unlocalized server detail.' },
			response: new Response(null, { status: 502 })
		});
		await expect
			.element(screen.getByText('The provider profile could not be refreshed. Try again.'))
			.toBeVisible();
		await expect.element(screen.getByTestId('account-settings-drawer')).toBeVisible();
	});

	it('does not project a mutation from an earlier session of the same user', async () => {
		getMock.mockImplementation((path: string) => {
			if (path === '/accounts') return Promise.resolve({ data: [account], error: null });
			return Promise.resolve({ data: [], error: null });
		});
		const refresh = deferred<{
			data: SocialAccount;
			error: null;
			response: Response;
		}>();
		postMock.mockReturnValueOnce(refresh.promise);
		const onAccountsChanged = vi.fn();
		const screen = await render(AccountManagement, {
			workspace,
			workspaces: [workspace],
			links,
			onContinue: vi.fn(),
			onAccountsChanged
		});

		await screen.getByRole('button', { name: /Actions for/ }).click();
		await screen.getByRole('menuitem', { name: 'Account details' }).click();
		await screen.getByRole('button', { name: 'Refresh profile' }).click();

		const identityCheck = vi.spyOn(auth, 'isIdentityCurrent');
		auth.clearLocal();
		auth.setUser(user);
		const currentSessionAccount = { ...account, account_username: 'current-session' };
		queryClient.setQueryData(openPostQueryKeys.accounts(workspace.id), [currentSessionAccount]);
		identityCheck.mockClear();
		refresh.resolve({
			data: { ...account, account_username: 'stale-session' },
			error: null,
			response: new Response(null, { status: 200 })
		});
		await vi.waitFor(() => expect(identityCheck).toHaveBeenCalledOnce());

		expect(queryClient.getQueryData(openPostQueryKeys.accounts(workspace.id))).toEqual([
			currentSessionAccount
		]);
		expect(onAccountsChanged).not.toHaveBeenCalled();
		identityCheck.mockRestore();
	});

	it('does not offer provider refresh for connector accounts', async () => {
		getMock.mockImplementation((path: string) => {
			if (path === '/accounts') {
				return Promise.resolve({
					data: [
						{
							...account,
							provider_installation_id: 'connector-installation-1'
						}
					],
					error: null
				});
			}
			return Promise.resolve({ data: [], error: null });
		});
		const screen = await render(AccountManagement, {
			workspace,
			workspaces: [workspace],
			links,
			onContinue: vi.fn()
		});

		await screen.getByRole('button', { name: /Actions for/ }).click();
		await screen.getByRole('menuitem', { name: 'Account details' }).click();
		await expect
			.element(screen.getByRole('button', { name: /Refresh profile for/ }))
			.not.toBeInTheDocument();
	});

	it('renders account content without duplicating the Settings navigation', async () => {
		const screen = await render(AccountManagement, {
			workspace,
			workspaces: [workspace],
			links,
			onContinue: vi.fn(),
			onAccountsChanged: vi.fn()
		});

		await expect
			.element(screen.getByRole('heading', { level: 2, name: 'Connected channels' }))
			.toBeVisible();
		await expect.element(screen.getByTestId('settings-navigation')).not.toBeInTheDocument();
		expect(getMock).toHaveBeenCalledWith('/accounts', {
			params: { query: { workspace_id: 'workspace-62' } },
			signal: expect.any(AbortSignal)
		});
	});

	it('embeds content in Settings and renders route-owned feedback', async () => {
		const onFeedbackDismiss = vi.fn();
		const screen = await render(AccountManagement, {
			workspace,
			workspaces: [workspace],
			links,
			feedback: {
				tone: 'error',
				message: 'The provider cancelled this connection.'
			},
			onFeedbackDismiss,
			onContinue: vi.fn(),
			onAccountsChanged: vi.fn()
		});

		await expect.element(screen.getByTestId('settings-navigation')).not.toBeInTheDocument();
		await expect.element(screen.getByText('The provider cancelled this connection.')).toBeVisible();
		await screen.getByRole('button', { name: 'Dismiss' }).click();
		expect(onFeedbackDismiss).toHaveBeenCalledOnce();
	});
});
