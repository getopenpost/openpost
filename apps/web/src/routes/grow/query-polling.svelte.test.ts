import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import GrowPage from './+page.svelte';

afterEach(() => {
	queryClient.clear();
	vi.restoreAllMocks();
});

it('continues polling unchanged queued work until it completes', async () => {
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
	let reads = 0;
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/accounts')
			// SAFETY: This account supplies the identity and active platform fields used by Grow.
			return {
				data: [
					{
						id: 'account-a',
						workspace_id: 'workspace-a',
						platform: 'bluesky',
						is_active: true,
						account_username: 'founder'
					}
				],
				response: new Response()
			} as never;
		if (path === '/account-features')
			// SAFETY: The feature response enables Grow for the fixture account.
			return {
				data: [{ social_account_id: 'account-a', feature: 'grow', effective_enabled: true }],
				response: new Response()
			} as never;
		if (path === '/growth') {
			reads++;
			// SAFETY: The growth endpoint supplies empty results and the complete polling state used here.
			return {
				data: {
					items: [],
					follow_updates: [],
					sync_state: {
						workspace_id: 'workspace-a',
						social_account_id: 'account-a',
						status: reads < 3 ? 'queued' : 'ok',
						last_success_at: reads < 3 ? null : '2026-09-01T10:00:00Z'
					}
				},
				response: new Response()
			} as never;
		}
		throw new Error(`Unexpected GET ${path}`);
	});
	const screen = await render(
		GrowPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await vi.waitFor(() => expect(reads).toBe(3), { timeout: 12500 });
	await expect.element(screen.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
	await new Promise((resolve) => setTimeout(resolve, 5200));
	expect(reads).toBe(3);
}, 22000);
