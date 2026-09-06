import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client, type User, type Workspace } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import SidebarPlanner from './sidebar-planner.svelte';

type Publication = components['schemas']['PublicationResponse'];

const getMock = vi.spyOn(client, 'GET');
const deleteMock = vi.spyOn(client, 'DELETE');

describe('sidebar draft mutation ownership', () => {
	beforeEach(() => {
		queryClient.clear();
		getMock.mockReset();
		deleteMock.mockReset();
		auth.setUser(user('user-a'));
		selectWorkspace('workspace-a');
		getMock.mockImplementation(async (path, request) => {
			if (path !== '/publications') throw new Error(`Unexpected GET ${path}`);
			const query = request?.params?.query;
			const workspaceID = query?.workspace_id ?? '';
			const data = query?.status === 'draft' ? [publication(workspaceID)] : [];
			// SAFETY: The fixture contains every response field consumed by the component.
			return {
				data,
				error: undefined,
				response: new Response(null, { status: 200 })
			} as never;
		});
	});

	it('does not remove a new Workspace draft when an old delete completes', async () => {
		const deletion = deferred<{ error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		deleteMock.mockReturnValue(deletion.promise as never);
		const onNavigate = vi.fn();
		const screen = await render(SidebarPlanner, { onNavigate });
		const workspaceADraft = screen.getByRole('link', {
			name: 'Resume draft: Workspace workspace-a draft'
		});
		await expect.element(workspaceADraft).toBeVisible();
		await workspaceADraft.click({ button: 'right' });
		await screen.getByRole('menuitem', { name: 'Delete' }).click();
		await screen.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		expect(deleteMock).toHaveBeenCalledWith('/publications/{id}', {
			params: {
				path: { id: 'shared-draft' },
				query: { confirm: true, expected_revision: 1 }
			}
		});

		selectWorkspace('workspace-b');
		const workspaceBDraft = screen.getByRole('link', {
			name: 'Resume draft: Workspace workspace-b draft'
		});
		await expect.element(workspaceBDraft).toBeVisible();
		const workspaceBDraftReads = draftReadCount('workspace-b');

		deletion.resolve({ error: undefined, response: new Response(null, { status: 204 }) });
		await new Promise((resolve) => setTimeout(resolve, 20));

		await expect.element(workspaceBDraft).toBeVisible();
		expect(draftReadCount('workspace-b')).toBe(workspaceBDraftReads);
		expect(onNavigate).not.toHaveBeenCalled();
	});

	function draftReadCount(workspaceID: string) {
		return getMock.mock.calls.filter(
			([path, request]) =>
				path === '/publications' &&
				request?.params?.query?.workspace_id === workspaceID &&
				request.params.query.status === 'draft'
		).length;
	}
});

function selectWorkspace(id: string) {
	workspaceCtx.currentWorkspace = workspace(id);
	workspaceCtx.settingsWorkspaceID = id;
	workspaceCtx.settings = {
		name: id,
		avatar_url: '',
		color: '#f97316',
		timezone: 'UTC',
		week_start: 1,
		random_delay_minutes: 0,
		slot_start_hour: 5,
		slot_end_hour: 23,
		slot_interval_minutes: 15
	};
}

function workspace(id: string): Workspace {
	return {
		id,
		name: id,
		avatar_url: '',
		can_edit: true,
		color: '#f97316',
		created_at: '2026-09-01T10:00:00Z',
		organization_id: 'organization-1',
		organization_name: 'Organization',
		role: 'admin',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
}

function publication(workspaceID: string): Publication {
	return {
		id: 'shared-draft',
		workspace_id: workspaceID,
		revision: 1,
		status: 'draft',
		content_profile: 'default',
		created_at: '2026-09-01T10:00:00Z',
		created_by: 'user-a',
		creation_preset: 'post',
		intent: 'post',
		media: [],
		metadata: {},
		random_delay_inherited: true,
		random_delay_minutes: 0,
		renditions: [],
		repost_override: {},
		segments: [],
		source_text: `Workspace ${workspaceID} draft`,
		title: '',
		updated_at: '2026-09-01T10:00:00Z'
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

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
