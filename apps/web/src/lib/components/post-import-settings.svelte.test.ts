import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { tick } from 'svelte';
import { postImportQueryKey } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import PostImportSettings from './post-import-settings.svelte';
import '../../routes/layout.css';

const getMock = vi.spyOn(client, 'GET');
const putMock = vi.spyOn(client, 'PUT');

beforeEach(() => {
	queryClient.clear();
	getMock.mockReset();
	putMock.mockReset();
});

it('opts an account into native post imports from account settings', async () => {
	const overview = {
		account_id: 'account-1',
		platform: 'bluesky',
		supported: true,
		enabled: false,
		status: '',
		posts: []
	};
	getMock.mockResolvedValue({ data: overview, response: new Response() });
	putMock.mockResolvedValue({ data: { ...overview, enabled: true }, response: new Response() });

	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1' },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText('No imported posts yet.')).toBeVisible();
	await screen.getByRole('button', { name: 'Turn on' }).click();
	await expect.element(screen.getByRole('button', { name: 'Turn off' })).toBeVisible();
	expect(putMock).toHaveBeenCalledWith('/accounts/{account_id}/post-imports', {
		params: { path: { account_id: 'account-1' } },
		body: { workspace_id: 'workspace-1', enabled: true }
	});
});

it('loads older imported posts from the next page', async () => {
	const post = (id: string) => ({
		id,
		title: `Post ${id}`,
		text: `Post ${id}`,
		external_url: '',
		published_at: '2026-09-26T10:00:00Z'
	});
	getMock
		.mockResolvedValueOnce({
			data: {
				account_id: 'account-1',
				platform: 'bluesky',
				supported: true,
				enabled: true,
				status: 'complete',
				posts: [post('new')],
				next_cursor: 'older'
			},
			response: new Response()
		})
		.mockResolvedValueOnce({
			data: {
				account_id: 'account-1',
				platform: 'bluesky',
				supported: true,
				enabled: true,
				status: 'complete',
				posts: [post('old')]
			},
			response: new Response()
		});
	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1' },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText('Post new')).toBeVisible();
	await screen.getByRole('button', { name: 'Load more' }).click();
	await expect.element(screen.getByText('Post old')).toBeVisible();
	expect(getMock).toHaveBeenLastCalledWith('/accounts/{account_id}/post-imports', {
		params: {
			path: { account_id: 'account-1' },
			query: { workspace_id: 'workspace-1', cursor: 'older' }
		},
		signal: expect.any(AbortSignal)
	});
});

it('discards loaded pages when the first page refreshes', async () => {
	const post = (id: string) => ({
		id,
		title: `Post ${id}`,
		text: `Post ${id}`,
		external_url: '',
		published_at: '2026-09-26T10:00:00Z'
	});
	const overview = {
		account_id: 'account-1',
		platform: 'bluesky',
		supported: true,
		enabled: true,
		status: 'complete',
		posts: [post('new')],
		next_cursor: 'older'
	};
	getMock
		.mockResolvedValueOnce({ data: overview, response: new Response() })
		.mockResolvedValueOnce({
			data: { ...overview, posts: [post('old')], next_cursor: undefined },
			response: new Response()
		})
		.mockResolvedValueOnce({
			data: { ...overview, posts: [post('fresh-old')], next_cursor: undefined },
			response: new Response()
		});
	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1' },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText('Post new')).toBeVisible();
	await screen.getByRole('button', { name: 'Load more' }).click();
	await expect.element(screen.getByText('Post old')).toBeVisible();
	queryClient.setQueryData(postImportQueryKey('workspace-1', 'account-1'), {
		...overview,
		posts: [post('newer'), post('new')],
		next_cursor: 'older'
	});
	await expect.element(screen.getByText('Post newer')).toBeVisible();
	await expect.element(screen.getByText('Post old')).not.toBeInTheDocument();
	await expect.element(screen.getByRole('button', { name: 'Load more' })).toBeVisible();
	await screen.getByRole('button', { name: 'Load more' }).click();
	await expect.element(screen.getByText('Post fresh-old')).toBeVisible();
	expect(getMock).toHaveBeenCalledTimes(3);
});

it('ignores an older page response after the first page refreshes', async () => {
	const post = (id: string) => ({
		id,
		title: `Post ${id}`,
		text: `Post ${id}`,
		external_url: '',
		published_at: '2026-09-26T10:00:00Z'
	});
	const overview = {
		account_id: 'account-1',
		platform: 'bluesky',
		supported: true,
		enabled: true,
		status: 'complete',
		posts: [post('new')],
		next_cursor: 'older'
	};
	let finishPage: (() => void) | undefined;
	getMock.mockResolvedValueOnce({ data: overview, response: new Response() });
	getMock.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			finishPage = resolve;
		});
		return {
			data: { ...overview, posts: [post('old')], next_cursor: undefined },
			response: new Response()
		};
	});
	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1' },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText('Post new')).toBeVisible();
	await screen.getByRole('button', { name: 'Load more' }).click();
	expect(finishPage).toBeTypeOf('function');
	queryClient.setQueryData(postImportQueryKey('workspace-1', 'account-1'), {
		...overview,
		posts: [post('newer'), post('new')],
		next_cursor: 'new-cursor'
	});
	await expect.element(screen.getByText('Post newer')).toBeVisible();
	finishPage?.();
	await getMock.mock.results[1]?.value;
	await tick();
	await expect.element(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
	await expect.element(screen.getByText('Post old')).not.toBeInTheDocument();
});
