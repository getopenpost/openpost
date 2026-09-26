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
