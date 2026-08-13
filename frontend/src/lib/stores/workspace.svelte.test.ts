import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/client';
import { WorkspaceContext } from './workspace.svelte';

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	patch: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
	client: {
		GET: mocks.get,
		PATCH: mocks.patch
	}
}));

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

function settings(timezone: string) {
	return {
		avatar_url: '',
		color: '#f97316',
		timezone,
		week_start: 1,
		media_cleanup_days: 365,
		random_delay_minutes: 5,
		draft_gap_minutes: 60,
		slot_start_hour: 6,
		slot_end_hour: 22,
		slot_interval_minutes: 30
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
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		localStorage.removeItem('openpost_current_workspace');
	});

	it('deduplicates concurrent workspace initialization requests', async () => {
		const workspaceLoad = deferred<{ data: Workspace[]; error: null }>();
		mocks.get.mockImplementation((path: string) => {
			if (path === '/workspaces') return workspaceLoad.promise;
			if (path === '/workspaces/{id}/settings') {
				return Promise.resolve({ data: settings('Europe/Lisbon'), error: null });
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const context = new WorkspaceContext();

		const firstInitialization = context.initialize();
		const secondInitialization = context.initialize();

		expect(mocks.get.mock.calls.filter(([path]) => path === '/workspaces')).toHaveLength(1);

		workspaceLoad.resolve({ data: [workspaceA], error: null });
		await Promise.all([firstInitialization, secondInitialization]);

		expect(mocks.get.mock.calls.filter(([path]) => path === '/workspaces')).toHaveLength(1);
		expect(
			mocks.get.mock.calls.filter(([path]) => path === '/workspaces/{id}/settings')
		).toHaveLength(1);
		expect(context.currentWorkspace?.id).toBe(workspaceA.id);
		expect(context.settings).not.toHaveProperty('media_cleanup_days');
		expect(context.settingsReady).toBe(true);
		expect(context.loading).toBe(false);
	});

	it('tags workspace failures so callers can show localized copy', async () => {
		mocks.get.mockResolvedValueOnce({ data: null, error: {} });
		const context = new WorkspaceContext();

		await expect(context.loadWorkspaces()).rejects.toMatchObject({
			name: 'WorkspaceContextError',
			code: 'load-workspaces'
		});
	});

	it('does not expose or save settings from the previous workspace after a failed switch', async () => {
		mocks.get
			.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null })
			.mockResolvedValueOnce({ data: null, error: { detail: 'Workspace B is unavailable.' } });
		const context = new WorkspaceContext();

		await context.setWorkspace(workspaceA);
		expect(context.settingsReady).toBe(true);
		expect(context.settings.timezone).toBe('Europe/Lisbon');

		await context.setWorkspace(workspaceB);

		expect(context.currentWorkspace?.id).toBe(workspaceB.id);
		expect(context.settings.timezone).toBe('UTC');
		expect(context.settingsWorkspaceID).toBe('');
		expect(context.settingsError).toBe('Workspace B is unavailable.');
		expect(context.settingsLoading).toBe(false);
		expect(context.settingsReady).toBe(false);
		await expect(context.saveSettings({ timezone: 'Europe/Paris' })).rejects.toThrow(
			'Workspace B is unavailable.'
		);
		await expect(context.saveSettings({ timezone: 'Europe/Paris' })).rejects.toMatchObject({
			code: 'settings-not-ready'
		});
		expect(mocks.patch).not.toHaveBeenCalled();
	});

	it('clears current and persisted settings when the account has no workspaces', async () => {
		mocks.get
			.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null })
			.mockResolvedValueOnce({ data: [], error: null });
		const context = new WorkspaceContext();

		await context.setWorkspace(workspaceA);
		expect(context.settingsReady).toBe(true);
		expect(localStorage.getItem('openpost_current_workspace')).not.toBeNull();

		await context.loadWorkspaces();

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
		mocks.get.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null });
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

	it('ignores settings that arrive after a newer workspace switch', async () => {
		const firstLoad = deferred<{ data: ReturnType<typeof settings>; error: null }>();
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
		mocks.get.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null });
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
		mocks.get.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null });
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
		mocks.get.mockResolvedValueOnce({ data: settings('Bad/Zone'), error: null });
		const context = new WorkspaceContext();

		await context.setWorkspace(workspaceA);

		expect(context.settings.timezone).toBe('UTC');
		expect(context.settingsReady).toBe(true);
	});

	it('tracks meaningful workspace edits until the explicit save succeeds', async () => {
		mocks.get.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null });
		mocks.patch.mockResolvedValueOnce({ data: settings('Europe/Lisbon'), error: null });
		const context = new WorkspaceContext();
		await context.setWorkspace(workspaceA);

		expect(context.settingsDirty).toBe(false);
		context.settings.color = '#2563eb';
		expect(context.settingsDirty).toBe(true);

		await context.saveSettings({ color: '#2563eb' });

		expect(context.settingsDirty).toBe(false);
		expect(context.currentWorkspace?.color).toBe('#2563eb');
	});
});
