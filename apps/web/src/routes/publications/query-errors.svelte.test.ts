import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import PublicationsPage from './+page.svelte';

afterEach(() => {
	queryClient.clear();
	vi.restoreAllMocks();
});

it('shows a retryable notice when cached publications fail to refresh', async () => {
	queryClient.clear();
	workspaceCtx.currentWorkspace = {
		id: 'workspace-a',
		name: 'Workspace',
		avatar_url: '',
		color: '',
		can_edit: true,
		role: 'admin',
		created_at: '',
		organization_id: '',
		organization_name: '',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
	let fail = false;
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/publications' && fail)
			// SAFETY: The refresh returns the API error envelope without success data.
			return {
				error: { detail: 'Refresh failed' },
				response: new Response(null, { status: 503 })
			} as never;
		// SAFETY: All successful reads in this empty Activity fixture return lists.
		return {
			data: [],
			response: new Response(null, { headers: { 'X-Total-Count': '0' } })
		} as never;
	});
	const screen = await render(
		PublicationsPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByRole('tab', { name: /Published/ })).toBeVisible();
	fail = true;
	await queryClient.invalidateQueries();
	await expect.element(screen.getByText('Failed to load posts')).toBeVisible();
	await expect.element(screen.getByRole('tab', { name: /Published/ })).toBeVisible();
});
