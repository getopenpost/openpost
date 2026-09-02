import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client, type Workspace } from '$lib/api/client';
import {
	billingQueryKeys,
	developerQueryKeys,
	openPostBootstrapQueryKeys,
	openPostQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { createAuthStore } from './auth';
import { WorkspaceContext } from './workspace.svelte';

const mocks = { delete: vi.fn(), get: vi.fn(), patch: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
vi.spyOn(client, 'PATCH').mockImplementation(mocks.patch);
vi.spyOn(client, 'DELETE').mockImplementation(mocks.delete);

const workspaceA = {
	id: 'workspace-a',
	name: 'Workspace A',
	avatar_url: '',
	color: '#f97316',
	created_at: '2026-01-01T00:00:00Z',
	organization_id: '',
	organization_name: '',
	role: 'admin',
	can_edit: true,
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

const workspaceB = {
	...workspaceA,
	id: 'workspace-b',
	name: 'Workspace B'
} satisfies Workspace;

const bootstrapUser = {
	id: 'user-1',
	email: 'person@example.com',
	username: 'person',
	display_name: 'Person',
	avatar_url: '',
	public_profile_enabled: false,
	public_profile_visible_fields: [],
	is_admin: false,
	is_managed: false,
	has_password: true,
	password_usable: true,
	legal_acceptance_required: false,
	email_verified: true,
	composer_experience: 'unified' as const,
	created_at: '2026-01-01T00:00:00Z'
};

function settings(timezone: string) {
	return {
		avatar_url: '',
		color: '#f97316',
		timezone,
		week_start: 1,
		media_cleanup_days: 14 as const,
		random_delay_minutes: 5,
		slot_start_hour: 6,
		slot_end_hour: 22,
		slot_interval_minutes: 30
	};
}

function bootstrap(
	workspaces: Workspace[],
	selectedWorkspaceID: string | null,
	selectedWorkspaceSettings: ReturnType<typeof settings> | null
) {
	return {
		authenticated: true,
		user: bootstrapUser,
		workspaces,
		selected_workspace_id: selectedWorkspaceID,
		selected_workspace_settings: selectedWorkspaceSettings
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('workspace settings state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.get.mockReset();
		mocks.patch.mockReset();
		mocks.delete.mockReset();
		queryClient.clear();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		localStorage.removeItem('openpost_current_workspace');
	});

	it('deduplicates concurrent workspace initialization requests', async () => {
		const workspaceLoad = deferred<{
			data: ReturnType<typeof bootstrap>;
			error: null;
			response: Response;
		}>();
		mocks.get.mockImplementation((path: string) => {
			if (path === '/app/bootstrap') return workspaceLoad.promise;
			throw new Error(`Unexpected GET ${path}`);
		});
		const context = new WorkspaceContext();

		const firstInitialization = context.initialize();
		const secondInitialization = context.initialize();

		expect(mocks.get.mock.calls.filter(([path]) => path === '/app/bootstrap')).toHaveLength(1);

		workspaceLoad.resolve({
			data: bootstrap([workspaceA], workspaceA.id, settings('Europe/Lisbon')),
			error: null,
			response: new Response(null, { status: 200 })
		});
		await Promise.all([firstInitialization, secondInitialization]);

		expect(mocks.get.mock.calls.filter(([path]) => path === '/app/bootstrap')).toHaveLength(1);
		expect(
			mocks.get.mock.calls.filter(([path]) => path === '/workspaces/{id}/settings')
		).toHaveLength(0);
		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(context.settings).not.toHaveProperty('media_cleanup_days');
		expect(context.settingsReady).toBe(true);
		expect(context.loading).toBe(false);
	});

	it('shares one bootstrap request between auth and Workspace startup', async () => {
		localStorage.setItem('openpost_current_workspace', JSON.stringify(workspaceA));
		mocks.get.mockResolvedValue({
			data: bootstrap([workspaceA], workspaceA.id, settings('Europe/Lisbon')),
			error: null,
			response: new Response(null, { status: 200 })
		});
		const auth = createAuthStore({
			isBrowser: true,
			getPasskeyAssertion: vi.fn(),
			notificationInbox: { clear: vi.fn() },
			identifyTelemetryUser: vi.fn(),
			resetTelemetryIdentity: vi.fn()
		});
		const context = new WorkspaceContext();

		await auth.initialize({ preferredWorkspaceID: workspaceA.id });
		await context.initialize();

		expect(mocks.get.mock.calls.filter(([path]) => path === '/app/bootstrap')).toHaveLength(1);
		expect(
			mocks.get.mock.calls.filter(([path]) => path === '/workspaces/{id}/settings')
		).toHaveLength(0);
		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(context.settingsReady).toBe(true);
		auth.clearLocal();
	});

	it('keeps a manual workspace selection made while bootstrap is refreshing', async () => {
		const workspaceLoad = deferred<{
			data: ReturnType<typeof bootstrap>;
			error: null;
			response: Response;
		}>();
		mocks.get.mockImplementation((path: string) => {
			if (path === '/app/bootstrap') return workspaceLoad.promise;
			throw new Error(`Unexpected GET ${path}`);
		});
		queryClient.setQueryData(
			openPostBootstrapQueryKeys.workspaceSettings(workspaceB.id),
			settings('Europe/Lisbon')
		);
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA, workspaceB];
		context.currentWorkspace = workspaceA;

		const pendingRefresh = context.loadWorkspaces(workspaceA.id);
		await context.setWorkspace(workspaceB);
		workspaceLoad.resolve({
			data: bootstrap([workspaceA, workspaceB], workspaceA.id, settings('Europe/Berlin')),
			error: null,
			response: new Response(null, { status: 200 })
		});
		await pendingRefresh;

		expect(context.currentWorkspace?.id).toBe(workspaceB.id);
		expect(context.settingsWorkspaceID).toBe(workspaceB.id);
		expect(context.settings.timezone).toBe('Europe/Lisbon');
		expect(JSON.parse(localStorage.getItem('openpost_current_workspace') ?? '{}')).toMatchObject({
			id: workspaceB.id
		});
	});

	it('does not restore a workspace after the requesting route becomes stale', async () => {
		const workspaceLoad = deferred<{
			data: ReturnType<typeof bootstrap>;
			error: null;
			response: Response;
		}>();
		mocks.get.mockImplementation((path: string) => {
			if (path === '/app/bootstrap') return workspaceLoad.promise;
			throw new Error(`Unexpected GET ${path}`);
		});
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA, workspaceB];
		context.currentWorkspace = workspaceA;
		let routeCurrent = true;

		const pendingInitialization = context.initialize(workspaceB.id, {
			selectionIsCurrent: () => routeCurrent
		});
		routeCurrent = false;
		workspaceLoad.resolve({
			data: bootstrap([workspaceA, workspaceB], workspaceB.id, settings('Europe/Berlin')),
			error: null,
			response: new Response(null, { status: 200 })
		});
		await pendingInitialization;

		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(context.workspaces).toEqual([workspaceA, workspaceB]);
	});

	it('refreshes workspace inventory without selecting for a stale dialog', async () => {
		const workspaceLoad = deferred<{
			data: ReturnType<typeof bootstrap>;
			error: null;
			response: Response;
		}>();
		mocks.get.mockImplementation((path: string) => {
			if (path === '/app/bootstrap') return workspaceLoad.promise;
			throw new Error(`Unexpected GET ${path}`);
		});
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA];
		context.currentWorkspace = workspaceA;
		let dialogCurrent = true;

		const pendingRefresh = context.loadWorkspaces(workspaceB.id, {
			selectionIsCurrent: () => dialogCurrent
		});
		dialogCurrent = false;
		workspaceLoad.resolve({
			data: bootstrap([workspaceA, workspaceB], workspaceB.id, settings('Europe/Berlin')),
			error: null,
			response: new Response(null, { status: 200 })
		});
		await pendingRefresh;

		expect(context.workspaces).toEqual([workspaceA, workspaceB]);
		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
	});

	it('evicts workspace data when refreshed SSO policy removes access', async () => {
		const lockedWorkspace = {
			...workspaceA,
			sso_required: true,
			sso_authenticated: false
		};
		mocks.get.mockResolvedValueOnce({
			data: bootstrap([lockedWorkspace], lockedWorkspace.id, null),
			error: null,
			response: new Response(null, { status: 200 })
		});
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA];
		context.currentWorkspace = workspaceA;
		queryClient.setQueryData(openPostQueryKeys.accounts(workspaceA.id), [{ id: 'account-a' }]);

		await context.loadWorkspaces(workspaceA.id);

		expect(context.currentWorkspace).toMatchObject({
			id: workspaceA.id,
			sso_required: true,
			sso_authenticated: false
		});
		expect(context.settingsReady).toBe(false);
		expect(queryClient.getQueryData(openPostQueryKeys.accounts(workspaceA.id))).toBeUndefined();
	});

	it('tags workspace failures so callers can show localized copy', async () => {
		mocks.get.mockResolvedValueOnce({
			data: null,
			error: {},
			response: new Response(null, { status: 400 })
		});
		const context = new WorkspaceContext();

		await expect(context.loadWorkspaces()).rejects.toMatchObject({
			name: 'WorkspaceContextError',
			code: 'load-workspaces'
		});
	});

	it('evicts a lost workspace and reselects an accessible fallback', async () => {
		mocks.get
			.mockResolvedValueOnce({
				data: settings('Europe/Lisbon'),
				error: null,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: null,
				error: { detail: 'Workspace B is unavailable.' },
				response: new Response(null, { status: 403 })
			})
			.mockResolvedValueOnce({
				data: settings('Europe/Lisbon'),
				error: null,
				response: new Response(null, { status: 200 })
			});
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA, workspaceB];
		queryClient.setQueryData(openPostQueryKeys.accounts(workspaceB.id), [{ id: 'account-b' }]);
		queryClient.setQueryData(billingQueryKeys.status(workspaceB.id), {
			workspace_id: workspaceB.id
		});

		await context.setWorkspace(workspaceA);
		expect(context.settingsReady).toBe(true);
		expect(context.settings.timezone).toBe('Europe/Lisbon');

		await context.setWorkspace(workspaceB);

		expect(context.workspaces).toEqual([workspaceA]);
		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(context.settings.timezone).toBe('Europe/Lisbon');
		expect(context.settingsWorkspaceID).toBe(workspaceA.id);
		expect(context.settingsError).toBe('');
		expect(context.settingsLoading).toBe(false);
		expect(context.settingsReady).toBe(true);
		expect(queryClient.getQueryData(openPostQueryKeys.accounts(workspaceB.id))).toBeUndefined();
		expect(queryClient.getQueryData(billingQueryKeys.status(workspaceB.id))).toBeUndefined();
		expect(mocks.patch).not.toHaveBeenCalled();
	});

	it('keeps cached settings usable when a background refresh fails', async () => {
		mocks.get
			.mockResolvedValueOnce({
				data: settings('Europe/Lisbon'),
				error: null,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: null,
				error: { detail: 'Settings refresh failed.' },
				response: new Response(null, { status: 400 })
			});
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		await queryClient.invalidateQueries({
			queryKey: openPostBootstrapQueryKeys.workspaceSettings(workspaceA.id)
		});

		await context.loadSettings();

		expect(context.settings.timezone).toBe('Europe/Lisbon');
		expect(context.settingsReady).toBe(true);
		expect(context.settingsError).toBe('');
		expect(context.settingsBackgroundError).toBe('Settings refresh failed.');
	});

	it('does not overwrite workspace edits when stale settings finish refreshing', async () => {
		const refresh = deferred<{
			data: ReturnType<typeof settings>;
			error: null;
			response: Response;
		}>();
		mocks.get
			.mockResolvedValueOnce({
				data: settings('Europe/Lisbon'),
				error: null,
				response: new Response(null, { status: 200 })
			})
			.mockReturnValueOnce(refresh.promise);
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		context.settings.timezone = 'Europe/Paris';
		await queryClient.invalidateQueries({
			queryKey: openPostBootstrapQueryKeys.workspaceSettings(workspaceA.id)
		});

		const revalidation = context.loadSettings();
		refresh.resolve({
			data: settings('Europe/Berlin'),
			error: null,
			response: new Response(null, { status: 200 })
		});
		await revalidation;

		expect(context.settings.timezone).toBe('Europe/Paris');
		expect(context.settingsDirty).toBe(true);
		expect(
			queryClient.getQueryData(openPostBootstrapQueryKeys.workspaceSettings(workspaceA.id))
		).toMatchObject({ timezone: 'Europe/Berlin' });
	});

	it('clears current and persisted settings when the account has no workspaces', async () => {
		mocks.get
			.mockResolvedValueOnce({
				data: settings('Europe/Lisbon'),
				error: null,
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: bootstrap([], null, null),
				error: null,
				response: new Response(null, { status: 200 })
			});
		const context = new WorkspaceContext();

		await context.setWorkspace(workspaceA);
		expect(context.settingsReady).toBe(true);
		expect(localStorage.getItem('openpost_current_workspace')).not.toBeNull();

		const loadedBootstrap = await context.loadWorkspaces();

		expect(loadedBootstrap?.user?.id).toBe(bootstrapUser.id);
		expect(context.workspaces).toEqual([]);
		expect(context.currentWorkspace).toBeNull();
		expect(context.settings.timezone).toBe('UTC');
		expect(context.settingsWorkspaceID).toBe('');
		expect(context.settingsError).toBe('');
		expect(context.settingsLoading).toBe(false);
		expect(context.settingsReady).toBe(false);
		expect(localStorage.getItem('openpost_current_workspace')).toBeNull();
	});

	it('resets all account-scoped workspace state after account deletion', async () => {
		mocks.get.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA];
		await context.setWorkspace(workspaceA);

		context.reset();

		expect(context.workspaces).toEqual([]);
		expect(context.currentWorkspace).toBeNull();
		expect(context.settings.timezone).toBe('UTC');
		expect(context.settingsReady).toBe(false);
		expect(context.loading).toBe(false);
		expect(localStorage.getItem('openpost_current_workspace')).toBeNull();
	});

	it('does not project saved settings after account state resets', async () => {
		const save = deferred<{
			data: null;
			error: null;
			response: Response;
		}>();
		mocks.patch.mockReturnValueOnce(save.promise);
		const context = new WorkspaceContext();
		context.currentWorkspace = workspaceA;
		context.workspaces = [workspaceA];
		context.settingsWorkspaceID = workspaceA.id;
		context.settings = {
			...context.settings,
			name: workspaceA.name,
			timezone: 'Europe/Lisbon'
		};
		context.savedSettings = { ...context.settings };

		const pendingSave = context.saveSettings({ name: 'First actor edit' });
		context.reset();
		queryClient.clear();
		const nextActorWorkspace = { ...workspaceA, name: 'Next actor workspace' };
		context.currentWorkspace = nextActorWorkspace;
		context.workspaces = [nextActorWorkspace];
		context.settingsWorkspaceID = nextActorWorkspace.id;
		context.settings = {
			...context.settings,
			name: nextActorWorkspace.name,
			timezone: 'Europe/Berlin'
		};
		context.savedSettings = { ...context.settings };
		queryClient.setQueryData(openPostBootstrapQueryKeys.workspaceSettings(nextActorWorkspace.id), {
			...settings('Europe/Berlin'),
			name: nextActorWorkspace.name
		});
		save.resolve({
			data: null,
			error: null,
			response: new Response(null, { status: 204 })
		});

		await expect(pendingSave).resolves.toBeUndefined();
		expect(context.currentWorkspace).toEqual(nextActorWorkspace);
		expect(context.workspaces).toEqual([nextActorWorkspace]);
		expect(context.settings).toMatchObject({
			name: nextActorWorkspace.name,
			timezone: 'Europe/Berlin'
		});
		expect(
			queryClient.getQueryData(openPostBootstrapQueryKeys.workspaceSettings(nextActorWorkspace.id))
		).toMatchObject({
			name: nextActorWorkspace.name,
			timezone: 'Europe/Berlin'
		});
	});

	it('invalidates developer data after workspace deletion', async () => {
		mocks.delete.mockResolvedValueOnce({
			data: null,
			error: null,
			response: new Response(null, { status: 204 })
		});
		const workspace = { ...workspaceA, organization_id: 'organization-a' };
		const context = new WorkspaceContext();
		context.workspaces = [workspace];
		queryClient.setQueryData(developerQueryKeys.apiTokens(), [{ id: 'token-1' }]);
		queryClient.setQueryData(developerQueryKeys.mcpActivity(8), [{ id: 'call-1' }]);
		queryClient.setQueryData(billingQueryKeys.status(workspaceB.id), {
			workspace_id: workspaceB.id
		});

		await context.deleteWorkspace(workspace.id, {
			confirmName: workspace.name,
			currentPassword: 'password'
		});

		expect(queryClient.getQueryState(developerQueryKeys.apiTokens())?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(developerQueryKeys.mcpActivity(8))?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(billingQueryKeys.status(workspaceB.id))?.isInvalidated).toBe(
			true
		);
	});

	it('invalidates developer data after organization deletion', async () => {
		mocks.delete.mockResolvedValueOnce({
			data: null,
			error: null,
			response: new Response(null, { status: 204 })
		});
		const workspace = { ...workspaceA, organization_id: 'organization-a' };
		const context = new WorkspaceContext();
		context.workspaces = [workspace];
		queryClient.setQueryData(developerQueryKeys.apiTokens(), [{ id: 'token-1' }]);
		queryClient.setQueryData(developerQueryKeys.mcpActivity(8), [{ id: 'call-1' }]);

		await context.deleteOrganization('organization-a', {
			confirmName: 'Organization A',
			currentPassword: 'password'
		});

		expect(queryClient.getQueryState(developerQueryKeys.apiTokens())?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(developerQueryKeys.mcpActivity(8))?.isInvalidated).toBe(true);
	});

	it('does not project a workspace deletion response after account state resets', async () => {
		const deletion = deferred<{
			data: null;
			error: null;
			response: Response;
		}>();
		mocks.delete.mockReturnValueOnce(deletion.promise);
		const context = new WorkspaceContext();
		context.workspaces = [workspaceA];

		const pendingDeletion = context.deleteWorkspace(workspaceA.id, {
			confirmName: workspaceA.name,
			currentPassword: 'password'
		});
		context.reset();
		const nextActorWorkspace = { ...workspaceA, name: 'Next actor workspace' };
		context.workspaces = [nextActorWorkspace];
		deletion.resolve({
			data: null,
			error: null,
			response: new Response(null, { status: 204 })
		});

		await expect(pendingDeletion).resolves.toBe(false);
		expect(context.workspaces).toEqual([nextActorWorkspace]);
	});

	it('does not project an organization deletion response after account state resets', async () => {
		const deletion = deferred<{
			data: null;
			error: null;
			response: Response;
		}>();
		mocks.delete.mockReturnValueOnce(deletion.promise);
		const context = new WorkspaceContext();
		const firstActorWorkspace = {
			...workspaceA,
			organization_id: 'shared-organization'
		};
		context.workspaces = [firstActorWorkspace];

		const pendingDeletion = context.deleteOrganization('shared-organization', {
			confirmName: 'Shared organization',
			currentPassword: 'password'
		});
		context.reset();
		const nextActorWorkspace = {
			...workspaceB,
			organization_id: 'shared-organization'
		};
		context.workspaces = [nextActorWorkspace];
		deletion.resolve({
			data: null,
			error: null,
			response: new Response(null, { status: 204 })
		});

		await expect(pendingDeletion).resolves.toBe(false);
		expect(context.workspaces).toEqual([nextActorWorkspace]);
	});

	it('ignores settings that arrive after a newer workspace switch', async () => {
		const firstLoad = deferred<{
			data: ReturnType<typeof settings>;
			error: null;
		}>();
		mocks.get
			.mockReturnValueOnce(firstLoad.promise)
			.mockResolvedValueOnce({ data: settings('Europe/Paris'), error: null });
		const context = new WorkspaceContext();

		const selectingA = context.setWorkspace(workspaceA);
		await context.setWorkspace(workspaceB);
		firstLoad.resolve({ data: settings('Europe/Lisbon'), error: null });
		await selectingA;

		expect(context.currentWorkspace?.id).toBe(workspaceB.id);
		expect(context.settingsWorkspaceID).toBe(workspaceB.id);
		expect(context.settings.timezone).toBe('Europe/Paris');
		expect(context.settingsReady).toBe(true);
	});

	it('keeps the current workspace when a switch guard declines', async () => {
		mocks.get.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		const guard = vi.fn(() => false);
		context.registerWorkspaceSwitchGuard(guard);

		await expect(context.setWorkspace(workspaceB)).resolves.toBe(false);

		expect(guard).toHaveBeenCalledWith({ from: workspaceA, to: workspaceB });
		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(context.settings.timezone).toBe('Europe/Lisbon');
		expect(localStorage.getItem('openpost_current_workspace')).toContain(workspaceA.id);
		expect(mocks.get).toHaveBeenCalledTimes(1);
	});

	it('fails a workspace switch closed when a guard throws', async () => {
		mocks.get.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		context.registerWorkspaceSwitchGuard(() => {
			throw new Error('guard unavailable');
		});

		await expect(context.setWorkspace(workspaceB)).resolves.toBe(false);

		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(mocks.get).toHaveBeenCalledTimes(1);
	});

	it('rejects a competing switch while a guarded decision is pending', async () => {
		mocks.get
			.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null })
			.mockResolvedValueOnce({ data: settings('Europe/Paris'), error: null });
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		const firstDecision = deferred<boolean>();
		const guard = vi.fn(() => firstDecision.promise);
		context.registerWorkspaceSwitchGuard(guard);
		const workspaceC = {
			...workspaceB,
			id: 'workspace-c',
			name: 'Workspace C'
		} satisfies Workspace;

		const firstSwitch = context.setWorkspace(workspaceB);
		const secondSwitch = context.setWorkspace(workspaceC);
		await expect(secondSwitch).resolves.toBe(false);
		firstDecision.resolve(true);
		await expect(firstSwitch).resolves.toBe(true);

		expect(context.currentWorkspace?.id).toBe(workspaceB.id);
		expect(context.settings.timezone).toBe('Europe/Paris');
		expect(localStorage.getItem('openpost_current_workspace')).toContain(workspaceB.id);
		expect(guard).toHaveBeenCalledTimes(1);
	});

	it('stops consulting a workspace switch guard after it is unregistered', async () => {
		mocks.get
			.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null })
			.mockResolvedValueOnce({ data: settings('Europe/Paris'), error: null });
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		const guard = vi.fn(() => false);
		const unregister = context.registerWorkspaceSwitchGuard(guard);
		unregister();

		await expect(context.setWorkspace(workspaceB)).resolves.toBe(true);

		expect(guard).not.toHaveBeenCalled();
		expect(context.currentWorkspace?.id).toBe(workspaceB.id);
	});

	it('falls back safely when legacy workspace data contains an invalid timezone', async () => {
		mocks.get.mockResolvedValueOnce({
			data: settings('Bad/Zone'),
			error: null
		});
		const context = new WorkspaceContext();

		await context.setWorkspace(workspaceA);

		expect(context.settings.timezone).toBe('UTC');
		expect(context.settingsReady).toBe(true);
	});

	it('tracks meaningful workspace edits until the explicit save succeeds', async () => {
		mocks.get.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		mocks.patch.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);

		expect(context.settingsDirty).toBe(false);
		context.settings.color = '#2563eb';
		expect(context.settingsDirty).toBe(true);

		await context.saveSettings({ color: '#2563eb' });

		expect(context.settingsDirty).toBe(false);
		expect(context.currentWorkspace?.color).toBe('#2563eb');
	});

	it('does not project a save after switching away and back to the same workspace', async () => {
		const save = deferred<{
			data: null;
			error: null;
			response: Response;
		}>();
		mocks.get.mockImplementation(
			(_path: string, options?: { params?: { path?: { id?: string } } }) =>
				Promise.resolve({
					data:
						options?.params?.path?.id === workspaceB.id
							? settings('Europe/Paris')
							: settings('Europe/Lisbon'),
					error: null
				})
		);
		mocks.patch.mockReturnValueOnce(save.promise);
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);

		const pendingSave = context.saveSettings({ name: 'Late server save' });
		await context.setWorkspace(workspaceB);
		await context.setWorkspace(workspaceA);
		context.settings.name = 'Current local draft';

		save.resolve({
			data: null,
			error: null,
			response: new Response(null, { status: 204 })
		});
		await pendingSave;

		expect(context.settings.name).toBe('Current local draft');
		expect(context.savedSettings.name).toBe(workspaceA.name);
		expect(context.currentWorkspace?.name).toBe(workspaceA.name);
		expect(localStorage.getItem('openpost_current_workspace')).toContain(workspaceA.name);
		expect(
			queryClient.getQueryData(openPostBootstrapQueryKeys.workspaceSettings(workspaceA.id))
		).not.toMatchObject({ name: 'Late server save' });
	});

	it('marks workspace setup stale after the workspace name changes', async () => {
		mocks.get.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		mocks.patch.mockResolvedValueOnce({
			data: settings('Europe/Lisbon'),
			error: null
		});
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);
		const setupKey = workspaceSettingsQueryKeys.setup(workspaceA.id);
		queryClient.setQueryData(setupKey, { completed: true });

		await context.saveSettings({ name: 'Renamed workspace' });

		expect(queryClient.getQueryState(setupKey)?.isInvalidated).toBe(true);
	});
});
