import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthorizePage from './+page.svelte';

const mocks = vi.hoisted(() => {
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
		post: vi.fn(),
		pageValue,
		pageStore,
		authStore,
		workspaceCtx: {
			currentWorkspace: { id: 'workspace-1', name: 'Workspace' }
		}
	};
});

vi.mock('$app/stores', () => ({ page: mocks.pageStore }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/stores/auth', () => ({ auth: mocks.authStore }));
vi.mock('$lib/stores/workspace.svelte', () => ({ workspaceCtx: mocks.workspaceCtx }));
vi.mock('$lib/api/client', () => ({ client: { POST: mocks.post } }));

describe('OAuth authorization request validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.pageValue.url = new URL(
			'http://localhost/oauth/authorize?response_type=code&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=challenge&code_challenge_method=S256'
		);
	});

	it('disables denial when the request has no client ID', async () => {
		const screen = await render(AuthorizePage);

		await expect
			.element(screen.getByText('This OAuth request is missing a client ID.'))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('explains that full MCP access can change publishing state', async () => {
		mocks.pageValue.url = new URL(
			'http://localhost/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=mcp%3Afull&code_challenge=challenge&code_challenge_method=S256'
		);

		const screen = await render(AuthorizePage);

		await expect
			.element(screen.getByText(/Full MCP access can create and edit drafts/))
			.toBeVisible();
		await expect
			.element(screen.getByText(/the MCP client decides when to show its approval prompt/))
			.toBeVisible();
	});

	it('explains the server-enforced read-only MCP scope', async () => {
		mocks.pageValue.url = new URL(
			'http://localhost/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=mcp%3Aread&code_challenge=challenge&code_challenge_method=S256'
		);

		const screen = await render(AuthorizePage);

		await expect
			.element(screen.getByText(/Read-only access can inspect the selected workspace/))
			.toBeVisible();
		await expect.element(screen.getByText(/cannot create or change data/)).toBeVisible();
	});
});
