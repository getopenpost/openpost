import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthorizePage from './oauth-authorize-page.svelte';
import type { Workspace } from '$lib/api/client';

function workspace(id: string, name: string): Workspace {
	return {
		id,
		name,
		role: 'admin',
		avatar_url: '',
		can_edit: true,
		color: '',
		created_at: '2026-01-01T00:00:00Z',
		organization_id: '',
		organization_name: '',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
}

const mocks = (() => {
	type PageValue = { url: URL };
	type Subscriber<T> = (value: T) => void;

	const pageValue: PageValue = {
		url: new URL(
			'http://localhost/oauth/authorize?response_type=code&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=challenge&code_challenge_method=S256'
		)
	};
	const pageStore = {
		subscribe(run: Subscriber<PageValue>) {
			run(pageValue);
			return () => undefined;
		}
	};
	const authValue = {
		user: { id: 'user-1' },
		isLoading: false,
		isAuthenticated: true
	};
	const authStore = {
		subscribe(run: Subscriber<typeof authValue>) {
			run(authValue);
			return () => undefined;
		}
	};

	return {
		goto: vi.fn(),
		get: vi.fn(),
		post: vi.fn(),
		pageValue,
		pageStore,
		authStore,
		workspace: {
			currentWorkspace: workspace('workspace-1', 'Workspace One'),
			workspaces: [
				workspace('workspace-1', 'Workspace One'),
				workspace('workspace-2', 'Workspace Two'),
				workspace('workspace-empty', 'Empty Workspace')
			]
		}
	};
})();

function renderAuthorizePage() {
	return render(AuthorizePage, {
		dependencies: {
			page: mocks.pageStore,
			auth: mocks.authStore,
			workspace: mocks.workspace,
			get: mocks.get,
			post: mocks.post,
			navigate: mocks.goto
		}
	});
}

describe('OAuth authorization request validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.pageValue.url = new URL(
			'http://localhost/oauth/authorize?response_type=code&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=challenge&code_challenge_method=S256'
		);
	});

	it('disables denial when the request has no client ID', async () => {
		const screen = await renderAuthorizePage();

		await expect
			.element(screen.getByText('This OAuth request is missing a client ID.'))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('authorizes every eligible current workspace when selected', async () => {
		mocks.pageValue.url = new URL(
			'http://localhost/oauth/authorize?response_type=code&client_id=op_app_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=workspace%3Aread+accounts%3Aread&code_challenge=challenge&code_challenge_method=S256'
		);
		mocks.get.mockImplementation(async (path, options) => {
			if (path === '/external-applications/oauth/request') {
				return { data: { application: { name: 'Workflow app' } }, error: undefined };
			}
			const workspaceID = options?.params?.query?.workspace_id;
			if (workspaceID === 'workspace-empty') return { data: [], error: undefined };
			return {
				data: [
					{
						id: `account-${workspaceID}`,
						account_username: `account-${workspaceID}`,
						platform: 'x',
						is_active: true
					}
				],
				error: undefined
			};
		});
		mocks.post.mockResolvedValue({ data: undefined, error: { detail: 'stop redirect' } });

		const screen = await renderAuthorizePage();
		await expect.element(screen.getByText('Workflow app', { exact: true })).toBeVisible();
		await screen.getByText('Select all eligible workspaces').click();
		await expect.element(screen.getByText('account-workspace-2')).toBeVisible();
		await expect.element(screen.getByText('Empty Workspace')).toBeVisible();
		await screen.getByRole('button', { name: 'Authorize' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/external-applications/oauth/authorize', {
			body: expect.objectContaining({
				workspace_grants: [
					expect.objectContaining({
						workspace_id: 'workspace-1',
						account_ids: ['account-workspace-1']
					}),
					expect.objectContaining({
						workspace_id: 'workspace-2',
						account_ids: ['account-workspace-2']
					}),
					expect.objectContaining({
						workspace_id: 'workspace-empty',
						account_ids: []
					})
				]
			})
		});
	});

	it('blocks approval until every selected workspace account list is loaded', async () => {
		mocks.pageValue.url = new URL(
			'http://localhost/oauth/authorize?response_type=code&client_id=op_app_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=workspace%3Aread+accounts%3Aread&code_challenge=challenge&code_challenge_method=S256'
		);
		let resolveAccounts: ((value: { data: never[]; error: undefined }) => void) | undefined;
		mocks.get.mockImplementation(async (path) => {
			if (path === '/external-applications/oauth/request') {
				return { data: { application: { name: 'Workflow app' } }, error: undefined };
			}
			return new Promise((resolve) => {
				resolveAccounts = resolve;
			});
		});

		const screen = await renderAuthorizePage();
		await expect.element(screen.getByText('Workflow app', { exact: true })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled();
		expect(mocks.post).not.toHaveBeenCalled();

		resolveAccounts?.({ data: [], error: undefined });
		await expect.element(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled();
	});
});
