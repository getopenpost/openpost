import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client, type User, type Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import { userProfileDefaults } from '$lib/test-fixtures/user-profile';
import CreateWorkspaceDialog from './create-workspace-dialog.svelte';

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/query/cache-plan', () => ({ executeQueryCachePlan: vi.fn() }));

const postMock = vi.spyOn(client, 'POST');
const loadWorkspacesMock = vi.spyOn(workspaceCtx, 'loadWorkspaces');

const workspace = {
	id: 'workspace-a',
	name: 'Workspace A',
	avatar_url: '',
	color: '#f97316',
	created_at: '2026-09-01T10:00:00Z',
	organization_id: '',
	organization_name: '',
	role: 'admin',
	can_edit: true,
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

function user(): User {
	return {
		...userProfileDefaults,
		id: 'user-1',
		email: 'user-1@example.com',
		username: 'user-1',
		public_profile_enabled: false,
		is_admin: false,
		is_managed: false,
		has_password: true,
		legal_acceptance_required: false,
		email_verified: true,
		created_at: '2026-09-01T10:00:00Z'
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('CreateWorkspaceDialog selection', () => {
	beforeEach(() => {
		queryClient.clear();
		postMock.mockReset();
		loadWorkspacesMock.mockReset();
		auth.setUser(user());
		workspaceCtx.currentWorkspace = workspace;
		workspaceCtx.workspaces = [workspace];
	});

	it('applies the new workspace selection even when the dialog unmounts mid-flight', async () => {
		const create = deferred<never>();
		postMock.mockReturnValue(create.promise);
		let capturedSelection: (() => boolean) | undefined;
		const refresh = deferred<never>();
		loadWorkspacesMock.mockImplementation(async (_id, options) => {
			capturedSelection = options?.selectionIsCurrent;
			return refresh.promise;
		});

		const screen = await render(CreateWorkspaceDialog, { open: true });
		await screen.getByRole('textbox', { name: 'Workspace name' }).fill('Project X');
		await screen.getByRole('button', { name: 'Create Workspace and continue' }).click();

		await vi.waitFor(() => expect(postMock).toHaveBeenCalled());
		// SAFETY: deferred<never> models the pending client promise; the cast bridges the
		// workspace-create payload whose data.id the dialog reads for selection.
		create.resolve({ data: { id: 'ws-new' }, response: new Response() } as never);
		await vi.waitFor(() => expect(loadWorkspacesMock).toHaveBeenCalled());
		expect(capturedSelection).toBeDefined();

		// Bootstrap invalidations can remount the dialog mid-flight, firing onDestroy
		// with the dialog still open. Selection of the just-created workspace must
		// survive that: the workspace exists server-side, so silently keeping the old
		// one leaves the user behind with no error.
		await screen.unmount();
		expect(capturedSelection!()).toBe(true);
		// SAFETY: deferred<never> models the pending refresh gate; resolving undefined releases
		// the held loadWorkspaces call after unmount, which the dialog must tolerate.
		refresh.resolve(undefined as never);
	});
});
