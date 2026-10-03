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
		{ workspaceID: 'workspace-1', accountID: 'account-1', canEdit: true },
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
		{ workspaceID: 'workspace-1', accountID: 'account-1', canEdit: true },
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
		{ workspaceID: 'workspace-1', accountID: 'account-1', canEdit: true },
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
		{ workspaceID: 'workspace-1', accountID: 'account-1', canEdit: true },
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

it('can turn off existing imports when the account no longer has read permission', async () => {
	const overview = {
		account_id: 'account-1',
		platform: 'tiktok',
		supported: false,
		unavailable_reason: 'Reconnect this account with permission to read posts.',
		enabled: true,
		status: 'permission_required',
		posts: []
	};
	getMock.mockResolvedValue({ data: overview, response: new Response() });
	putMock.mockResolvedValue({ data: { ...overview, enabled: false }, response: new Response() });
	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1', canEdit: true },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText(overview.unavailable_reason)).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Turn off' })).toBeEnabled();
	await screen.getByRole('button', { name: 'Turn off' }).click();
	await expect.element(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
});

it('shows the server reason and leaves the choice unchanged after a rejected save', async () => {
	getMock.mockResolvedValue({
		data: {
			account_id: 'account-1',
			platform: 'threads',
			supported: true,
			enabled: false,
			status: '',
			posts: []
		},
		response: new Response()
	});
	putMock.mockResolvedValue({
		error: { detail: 'Read permission was revoked. Reconnect this account.' },
		response: new Response(null, { status: 409 })
	});
	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1', canEdit: true },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await screen.getByRole('button', { name: 'Turn on' }).click();
	await expect
		.element(screen.getByText('Read permission was revoked. Reconnect this account.'))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
});

it('keeps the library readable without offering a workspace mutation to viewers', async () => {
	getMock.mockResolvedValue({
		data: {
			account_id: 'account-1',
			platform: 'bluesky',
			supported: true,
			enabled: true,
			status: 'complete',
			posts: [
				{
					id: 'post',
					title: 'Imported update',
					text: 'Update',
					external_url: 'https://bsky.app/profile/owner/post/post',
					published_at: '2026-10-03T12:00:00Z'
				}
			]
		},
		response: new Response()
	});
	const screen = await render(
		PostImportSettings,
		{ workspaceID: 'workspace-1', accountID: 'account-1' },
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByRole('link', { name: 'Imported update' })).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled();
	expect(putMock).not.toHaveBeenCalled();
});
