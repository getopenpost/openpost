import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthorizePage from './+page.svelte';

const mocks = vi.hoisted(() => {
	type PageValue = { url: URL };
	type Subscriber<T> = (value: T) => void;

	let pageValue: PageValue = {
		url: new URL('http://localhost/cli/authorize?user_code=CODE-A')
	};
	const pageSubscribers = new Set<Subscriber<PageValue>>();
	const pageStore = {
		subscribe(run: Subscriber<PageValue>) {
			pageSubscribers.add(run);
			run(pageValue);
			return () => pageSubscribers.delete(run);
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
		get: vi.fn(),
		post: vi.fn(),
		goto: vi.fn(),
		pageStore,
		authStore,
		setPage(path: string) {
			pageValue = { url: new URL(path, 'http://localhost') };
			for (const subscriber of pageSubscribers) subscriber(pageValue);
		}
	};
});

vi.mock('$app/stores', () => ({ page: mocks.pageStore }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/stores/auth', () => ({ auth: mocks.authStore }));
vi.mock('$lib/stores/workspace.svelte', () => ({
	workspaceCtx: {
		currentWorkspace: { id: 'workspace-a', name: 'Launch' },
		workspaces: [
			{ id: 'workspace-a', name: 'Launch' },
			{ id: 'workspace-b', name: 'Support' }
		]
	}
}));
vi.mock('$lib/api/client', () => ({
	client: {
		GET: mocks.get,
		POST: mocks.post
	}
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('CLI authorization request identity', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.setPage('/cli/authorize?user_code=CODE-A');
		mocks.post.mockResolvedValue({ data: {}, error: null });
	});

	it('ignores a late session response and submits the code for the displayed client', async () => {
		const codeA = deferred<{ data: { client_name: string }; error: null }>();
		const codeB = deferred<{ data: { client_name: string }; error: null }>();
		mocks.get.mockImplementation(
			(_path: string, options: { params: { query: { user_code: string } } }) =>
				options.params.query.user_code === 'CODE-A' ? codeA.promise : codeB.promise
		);
		const screen = await render(AuthorizePage);

		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
		mocks.setPage('/cli/authorize?user_code=CODE-B');
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));

		codeB.resolve({ data: { client_name: 'Client B' }, error: null });
		await expect.element(screen.getByText('Client B')).toBeVisible();

		codeA.resolve({ data: { client_name: 'Client A' }, error: null });
		await vi.waitFor(() => expect(screen.container.textContent).not.toContain('Client A'));

		await screen.getByRole('button', { name: 'Approve' }).click();
		expect(mocks.post).toHaveBeenCalledWith('/cli/auth/approve', {
			body: { user_code: 'CODE-B', name: 'OpenPost CLI', workspace_id: 'workspace-a' }
		});
	});

	it('allows a failed session load to be retried safely', async () => {
		mocks.get
			.mockResolvedValueOnce({ data: null, error: { detail: 'Authorization lookup failed.' } })
			.mockResolvedValueOnce({ data: { client_name: 'Recovered client' }, error: null });
		const screen = await render(AuthorizePage);

		await expect.element(screen.getByText('Authorization lookup failed.')).toBeVisible();
		await screen.getByRole('button', { name: 'Try again' }).click();

		await expect.element(screen.getByText('Recovered client')).toBeVisible();
		expect(mocks.get).toHaveBeenCalledTimes(2);
		expect(mocks.get).toHaveBeenLastCalledWith('/cli/auth/session', {
			params: { query: { user_code: 'CODE-A' } }
		});
	});

	it('submits an explicit all-workspace boundary when selected', async () => {
		mocks.get.mockResolvedValue({ data: { client_name: 'Automation client' }, error: null });
		const screen = await render(AuthorizePage);

		await expect.element(screen.getByText('Automation client')).toBeVisible();
		await expect
			.element(screen.getByText(/cli:full token can still use account-level commands, but not/))
			.toBeVisible();
		await screen.getByText('Launch', { exact: true }).click();
		await screen.getByText('All workspaces', { exact: true }).click();
		await expect
			.element(
				screen.getByText(/cli:full token can also use account- and organization-level commands/)
			)
			.toBeVisible();
		await screen.getByRole('button', { name: 'Approve' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/cli/auth/approve', {
			body: { user_code: 'CODE-A', name: 'OpenPost CLI', workspace_id: '' }
		});
	});
});
