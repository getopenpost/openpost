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

it('exposes the publication recovery queue as a named group', async () => {
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
	const failedPublication = {
		id: 'publication-failed-1',
		workspace_id: 'workspace-a',
		title: 'Failed launch post',
		source_text: 'Failed launch post',
		intent: 'post',
		status: 'failed',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		segments: [],
		renditions: [
			{
				id: 'rendition-1',
				platform: 'x',
				status: 'failed',
				social_account_id: 'account-1',
				target_key: 'profile',
				delivery: { state: 'failed', recovery_action: 'retry' }
			}
		]
	};
	vi.spyOn(client, 'GET').mockImplementation(async (path, options) => {
		if (path === '/publications') {
			const bucket = options?.params?.query?.activity_bucket;
			if (bucket === 'failed') {
				return {
					data: [failedPublication],
					response: new Response(null, { headers: { 'X-Total-Count': '1' } })
				} as never;
			}
		}
		// SAFETY: All other reads in this recovery-queue fixture return empty lists.
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
	await screen.getByRole('tab', { name: /Failed/ }).click();
	const group = screen.getByRole('group', { name: 'Publication recovery queue' });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole('button', { name: 'Retry destination' })).toBeVisible();
});
