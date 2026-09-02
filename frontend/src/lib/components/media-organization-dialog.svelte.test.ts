import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { client, type User } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import type { MediaTag } from '$lib/media-tags';
import MediaOrganizationDialog from './media-organization-dialog.svelte';

const postMock = vi.spyOn(client, 'POST');

interface MediaTagMutationResponse {
	data: MediaTag;
	response: Response;
}

describe('media organization mutation ownership', () => {
	beforeEach(() => {
		queryClient.clear();
		postMock.mockReset();
		auth.setUser(user('user-a'));
	});

	it('releases the old save when the actor and Workspace change', async () => {
		let resolveOldSave!: (value: MediaTagMutationResponse) => void;
		postMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOldSave = resolve;
				})
		);
		const onChanged = vi.fn();
		const screen = await render(MediaOrganizationDialog, {
			open: true,
			workspaceId: 'workspace-a',
			tags: [],
			onChanged
		});
		const name = screen.getByRole('textbox');
		const create = screen.getByRole('button', { name: 'Create tag' });
		await name.fill('Old actor tag');
		await create.click();
		await expect.element(create).toBeDisabled();

		auth.setUser(user('user-b'));
		await screen.rerender({
			open: true,
			workspaceId: 'workspace-b',
			tags: [],
			onChanged
		});
		resolveOldSave({
			data: tag('tag-a', 'workspace-a', 'Old actor tag'),
			response: new Response(null, { status: 201 })
		});
		await expect.element(create).not.toBeDisabled();
		expect(onChanged).not.toHaveBeenCalled();

		postMock.mockResolvedValueOnce({
			data: tag('tag-b', 'workspace-b', 'New actor tag'),
			response: new Response(null, { status: 201 })
		});
		await name.fill('New actor tag');
		await create.click();
		await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
		expect(postMock).toHaveBeenLastCalledWith('/media/tags', {
			body: { workspace_id: 'workspace-b', name: 'New actor tag' }
		});
	});
});

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

function tag(id: string, workspaceId: string, name: string): MediaTag {
	return {
		id,
		workspace_id: workspaceId,
		name,
		item_count: 0,
		created_at: '2026-09-01T10:00:00Z'
	};
}
