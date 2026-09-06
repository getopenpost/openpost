import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { readable } from 'svelte/store';
import type { Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import InvitePage from './invite-page.svelte';
import '../layout.css';

const user = {
	id: 'invite-user',
	email: 'invite@example.com',
	username: 'invite-user',
	public_profile_enabled: false,
	is_admin: false,
	is_managed: false,
	has_password: true,
	legal_acceptance_required: false,
	email_verified: true,
	created_at: '2026-09-02T12:00:00Z'
};

const acceptedWorkspace = {
	id: 'accepted-workspace',
	name: 'Accepted Workspace',
	organization_id: 'accepted-organization',
	can_edit: true,
	created_at: '2026-09-02T12:00:00Z',
	avatar_url: '',
	color: '',
	organization_name: 'Accepted Organization',
	role: 'editor',
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

describe('invitation acceptance refresh recovery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryClient.clear();
		auth.clearLocal();
		auth.setUser(user);
	});

	it('retries a failed workspace refresh without accepting the invitation twice', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const post = vi.fn().mockResolvedValue({
			data: { workspace_id: acceptedWorkspace.id, role: 'editor' },
			error: null
		});
		// SAFETY: This mutable fixture models only the typed Workspace collection used by the page.
		const workspace = {
			workspaces: [] as Workspace[],
			loadWorkspaces: vi
				.fn()
				.mockRejectedValueOnce(new Error('Workspace refresh unavailable'))
				.mockImplementationOnce(async () => {
					workspace.workspaces = [acceptedWorkspace];
					return {
						authenticated: true,
						user,
						workspaces: [acceptedWorkspace],
						selected_workspace_id: acceptedWorkspace.id,
						selected_workspace_settings: null
					};
				})
		};
		const screen = await render(InvitePage, {
			dependencies: {
				page: readable({ url: new URL('http://localhost/invite?token=accepted-token') }),
				auth,
				workspace,
				post,
				navigate: vi.fn(),
				cache: queryClient
			}
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Invitation accepted' }))
			.toBeVisible();
		const refreshError = screen.getByTestId('invite-workspace-refresh-error');
		await expect.element(refreshError).toBeVisible();

		await refreshError.getByRole('button', { name: 'Try again' }).click();

		await expect.element(refreshError).not.toBeInTheDocument();
		await expect.element(screen.getByRole('link', { name: 'Open Workspace' })).toBeVisible();
		expect(post).toHaveBeenCalledOnce();
		expect(workspace.loadWorkspaces).toHaveBeenCalledTimes(2);
	});
});
