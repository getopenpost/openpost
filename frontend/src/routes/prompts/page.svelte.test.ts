import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { promptQueryKeys, type Prompt } from '@openpost/query-catalog';
import { client, type User, type Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { FIRST_VIEWPORT_LOADING_DELAY_MS } from '$lib/query/presentation.svelte';
import { auth } from '$lib/stores/auth';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import PromptsPage from './+page.svelte';

const getMock = vi.spyOn(client, 'GET');
const postMock = vi.spyOn(client, 'POST');
const deleteMock = vi.spyOn(client, 'DELETE');

describe('prompts page', () => {
	beforeEach(() => {
		queryClient.clear();
		getMock.mockReset();
		postMock.mockReset();
		deleteMock.mockReset();
		auth.setUser(user('user-a'));
		selectWorkspace('workspace-a');
		queryClient.setQueryData(promptQueryKeys.categories(), ['Ideas']);
		queryClient.setQueryData(promptQueryKeys.list('workspace-a'), []);
		getMock.mockImplementation(async (path, request) => {
			if (path === '/prompts/categories') {
				// SAFETY: The fixture contains every response field consumed by the component.
				return response({ categories: ['Ideas'] }) as never;
			}
			if (path !== '/prompts') throw new Error(`Unexpected GET ${path}`);
			const workspaceID = request?.params?.query?.workspace_id ?? '';
			// SAFETY: The fixture contains every response field consumed by the component.
			return response([prompt(workspaceID)]) as never;
		});
	});

	afterEach(() => vi.useRealTimers());

	it('keeps one page placeholder until prompts and uncached categories resolve', async () => {
		vi.useFakeTimers();
		queryClient.clear();
		const promptsRead = deferred<ReturnType<typeof response<Prompt[]>>>();
		const categoriesRead = deferred<ReturnType<typeof response<{ categories: string[] }>>>();
		getMock.mockImplementation((path) => {
			if (path === '/prompts/categories') {
				// SAFETY: The deferred fixture matches the categories endpoint response contract.
				return categoriesRead.promise as never;
			}
			if (path === '/prompts') {
				// SAFETY: The deferred fixture matches the prompts endpoint response contract.
				return promptsRead.promise as never;
			}
			throw new Error(`Unexpected GET ${path}`);
		});

		const screen = await renderPromptsPage();
		await vi.waitFor(() => {
			expect(promptReadCount('workspace-a')).toBe(1);
			expect(categoryReadCount()).toBe(1);
		});

		promptsRead.resolve(response([prompt('workspace-a')]));
		await vi.waitFor(() => {
			expect(queryClient.getQueryData(promptQueryKeys.list('workspace-a'))).toHaveLength(1);
		});
		await vi.advanceTimersByTimeAsync(FIRST_VIEWPORT_LOADING_DELAY_MS);

		await expect.element(screen.getByTestId('page-loading')).toBeVisible();
		expect(screen.container.querySelectorAll('[data-slot="page-loading"]')).toHaveLength(1);
		await expect.element(screen.getByText('workspace-a prompt')).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Add prompt' }))
			.not.toBeInTheDocument();

		categoriesRead.resolve(response({ categories: ['Ideas'] }));
		await vi.waitFor(() => {
			expect(queryClient.getQueryData(promptQueryKeys.categories())).toEqual(['Ideas']);
		});
		await vi.advanceTimersByTimeAsync(0);
		await expect.element(screen.getByText('workspace-a prompt')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Add prompt' })).toBeVisible();
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();
	});

	it('keeps cached categories and page content visible during a category refresh', async () => {
		vi.useFakeTimers();
		queryClient.setQueryData(promptQueryKeys.categories(), ['Ideas'], { updatedAt: 1 });
		queryClient.setQueryData(promptQueryKeys.list('workspace-a'), [prompt('workspace-a')]);
		const categoriesRead = deferred<ReturnType<typeof response<{ categories: string[] }>>>();
		getMock.mockImplementation((path, request) => {
			if (path === '/prompts/categories') {
				// SAFETY: The deferred fixture matches the categories endpoint response contract.
				return categoriesRead.promise as never;
			}
			if (path !== '/prompts') throw new Error(`Unexpected GET ${path}`);
			const workspaceID = request?.params?.query?.workspace_id ?? '';
			// SAFETY: The prompt fixture contains every response field consumed by the component.
			return Promise.resolve(response([prompt(workspaceID)])) as never;
		});

		const screen = await renderPromptsPage();
		await vi.waitFor(() => expect(categoryReadCount()).toBe(1));
		await vi.advanceTimersByTimeAsync(FIRST_VIEWPORT_LOADING_DELAY_MS);

		await expect.element(screen.getByText('workspace-a prompt')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Add prompt' })).toBeVisible();
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();
		expect(
			screen.container.querySelectorAll('[data-slot="page-header-actions"] [data-slot="skeleton"]')
		).toHaveLength(0);

		categoriesRead.resolve(response({ categories: ['Ideas', 'Updates'] }));
		await vi.waitFor(() => {
			expect(queryClient.getQueryData(promptQueryKeys.categories())).toEqual(['Ideas', 'Updates']);
		});
		await expect.element(screen.getByText('workspace-a prompt')).toBeVisible();
	});

	it('does not refresh or report an old prompt creation in a new Workspace', async () => {
		const creation = deferred<{ data: Prompt; error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		postMock.mockReturnValue(creation.promise as never);
		const screen = await render(
			PromptsPage,
			{},
			{
				wrapper: QueryClientProvider,
				wrapperProps: { client: queryClient }
			}
		);
		await screen.getByTestId('page-header').getByRole('button', { name: 'Add prompt' }).click();
		const dialog = screen.getByRole('dialog');
		await dialog.getByRole('textbox', { name: 'Prompt text' }).fill('Workspace A prompt');
		await dialog.getByRole('button', { name: 'Add prompt' }).click();
		expect(postMock).toHaveBeenCalledWith('/prompts', {
			body: {
				workspace_id: 'workspace-a',
				text: 'Workspace A prompt',
				example: '',
				category: 'Ideas'
			}
		});

		queryClient.setQueryData(promptQueryKeys.list('workspace-b'), [prompt('workspace-b')]);
		selectWorkspace('workspace-b');
		await expect.element(screen.getByText('workspace-b prompt')).toBeVisible();
		const workspaceBReads = promptReadCount('workspace-b');

		creation.resolve({
			data: prompt('workspace-a'),
			error: undefined,
			response: new Response(null, { status: 201 })
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(promptReadCount('workspace-b')).toBe(workspaceBReads);
		await expect.element(screen.getByText('Prompt created')).not.toBeInTheDocument();
	});

	it('does not refresh or report an old prompt deletion in a new Workspace', async () => {
		const deletion = deferred<{ error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		deleteMock.mockReturnValue(deletion.promise as never);
		queryClient.setQueryData(promptQueryKeys.list('workspace-a'), [prompt('workspace-a')]);
		const screen = await render(
			PromptsPage,
			{},
			{
				wrapper: QueryClientProvider,
				wrapperProps: { client: queryClient }
			}
		);
		await expect.element(screen.getByText('workspace-a prompt')).toBeVisible();
		await screen.getByRole('button', { name: 'Delete prompt' }).click();
		await screen.getByRole('dialog').getByRole('button', { name: 'Delete prompt' }).click();
		expect(deleteMock).toHaveBeenCalledWith('/prompts/{id}', {
			params: { path: { id: 'workspace-a-prompt' } }
		});

		queryClient.setQueryData(promptQueryKeys.list('workspace-b'), [prompt('workspace-b')]);
		selectWorkspace('workspace-b');
		await expect.element(screen.getByText('workspace-b prompt')).toBeVisible();
		const workspaceBReads = promptReadCount('workspace-b');

		deletion.resolve({ error: undefined, response: new Response(null, { status: 204 }) });
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(promptReadCount('workspace-b')).toBe(workspaceBReads);
		await expect.element(screen.getByText('Prompt deleted')).not.toBeInTheDocument();
	});

	function promptReadCount(workspaceID: string) {
		return getMock.mock.calls.filter(
			([path, request]) =>
				path === '/prompts' && request?.params?.query?.workspace_id === workspaceID
		).length;
	}

	function categoryReadCount() {
		return getMock.mock.calls.filter(([path]) => path === '/prompts/categories').length;
	}
});

function renderPromptsPage() {
	return render(
		PromptsPage,
		{},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
}

function response<T>(data: T) {
	return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function prompt(workspaceID: string): Prompt {
	return {
		id: `${workspaceID}-prompt`,
		workspace_id: workspaceID,
		user_id: 'user-a',
		category: 'Ideas',
		created_at: '2026-09-01T10:00:00Z',
		example: '',
		is_built_in: false,
		text: `${workspaceID} prompt`
	};
}

function selectWorkspace(id: string) {
	workspaceCtx.currentWorkspace = workspace(id);
	workspaceCtx.settingsWorkspaceID = id;
}

function workspace(id: string): Workspace {
	return {
		id,
		name: id,
		avatar_url: '',
		can_edit: true,
		color: '#f97316',
		created_at: '2026-09-01T10:00:00Z',
		organization_id: 'organization-1',
		organization_name: 'Organization',
		role: 'admin',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function user(id: string): User {
	return {
		id,
		email: `${id}@example.com`,
		username: id,
		public_profile_enabled: false,
		is_admin: false,
		is_managed: false,
		has_password: true,
		legal_acceptance_required: false,
		email_verified: true,
		created_at: '2026-09-01T10:00:00Z'
	};
}
