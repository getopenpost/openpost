import type { components } from '$lib/api/types';
import { describe, expect, it, vi } from 'vitest';
import { loadPublicationForWorkspace, PublicationWorkspaceMismatchError } from './publication-load';

type Publication = components['schemas']['PublicationResponse'];

function publicationFixture(workspaceId: string): Publication {
	return {
		content_profile: '',
		created_at: '2026-01-01T00:00:00Z',
		created_by: 'user-1',
		creation_preset: '',
		id: 'publication-1',
		intent: 'single',
		media: [],
		metadata: {},
		random_delay_inherited: false,
		random_delay_minutes: 0,
		renditions: [],
		repost_override: { mode: 'inherit' },
		revision: 1,
		segments: [],
		source_text: '',
		status: 'draft',
		title: '',
		updated_at: '2026-01-01T00:00:00Z',
		workspace_id: workspaceId
	};
}

describe('publication Workspace loading', () => {
	it('keeps the Workspace captured when the request started', async () => {
		let currentWorkspaceId = 'workspace-1';
		const capturedWorkspaceId = currentWorkspaceId;
		const loader = vi.fn(async (_publicationId: string, workspaceId: string) => {
			return publicationFixture(workspaceId);
		});

		const request = loadPublicationForWorkspace(loader, {
			publicationId: 'publication-1',
			workspaceId: capturedWorkspaceId
		});
		currentWorkspaceId = 'workspace-2';

		await expect(request).resolves.toEqual(
			expect.objectContaining({ id: 'publication-1', workspace_id: 'workspace-1' })
		);
		expect(currentWorkspaceId).toBe('workspace-2');
		expect(loader).toHaveBeenCalledWith('publication-1', 'workspace-1', false);
	});

	it('rejects and navigates away from a publication returned by another Workspace', async () => {
		const navigateAway = vi.fn();
		const loader = vi.fn(async () => publicationFixture('workspace-2'));

		await expect(
			loadPublicationForWorkspace(loader, {
				publicationId: 'publication-1',
				workspaceId: 'workspace-1',
				onWorkspaceMismatch: navigateAway
			})
		).rejects.toEqual(
			expect.objectContaining<Partial<PublicationWorkspaceMismatchError>>({
				name: 'PublicationWorkspaceMismatchError',
				expectedWorkspaceId: 'workspace-1',
				actualWorkspaceId: 'workspace-2'
			})
		);
		expect(navigateAway).toHaveBeenCalledOnce();
		expect(navigateAway).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedWorkspaceId: 'workspace-1',
				actualWorkspaceId: 'workspace-2'
			})
		);
	});
});
