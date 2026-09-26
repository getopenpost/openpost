import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
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
