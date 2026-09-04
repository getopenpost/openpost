import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthorizePage from './oauth-authorize-page.svelte';

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
		post: vi.fn(),
		pageValue,
		pageStore,
		authStore,
		workspace: {
			currentWorkspace: { id: 'workspace-1', name: 'Workspace' }
		}
	};
})();

function renderAuthorizePage() {
	return render(AuthorizePage, {
		dependencies: {
			page: mocks.pageStore,
			auth: mocks.authStore,
			workspace: mocks.workspace,
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
});
