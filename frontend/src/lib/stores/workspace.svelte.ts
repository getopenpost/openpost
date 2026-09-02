import { browser } from '$app/environment';
import { client, type Workspace } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import {
	appBootstrapQueryOptions,
	adminQueryKeys,
	authQueryKeys,
	confirmedBootstrapWorkspaceId,
	developerQueryKeys,
	isBillingStatusQueryKey,
	OpenPostQueryError,
	openPostBootstrapQueryKeys,
	openPostWorkspaceKey,
	organizationQueryKeys,
	publicProfileQueryKeys,
	seedAppBootstrap,
	workspaceSettingsQueryKeys,
	workspaceSettingsQueryOptions,
	type AppBootstrap,
	type AppBootstrapWorkspaceSettings
} from '@openpost/query-catalog';
import { appBootstrapQueryAPI } from '$lib/query/bootstrap';
import { queryClient } from '$lib/query/client';
import { workspaceSettingsQueryAPI } from '$lib/query/workspace-settings';

export type WorkspaceContextErrorCode =
	| 'load-workspaces'
	| 'load-settings'
	| 'settings-not-ready'
	| 'save-settings'
	| 'delete-workspace'
	| 'delete-organization';

export class WorkspaceContextError extends Error {
	constructor(
		readonly code: WorkspaceContextErrorCode,
		message: string
	) {
		super(message);
		this.name = 'WorkspaceContextError';
	}
}

interface WorkspaceSettings {
	name: string;
	avatar_url: string;
	color: string;
	timezone: string;
	week_start: number;
	random_delay_minutes: number;
	slot_start_hour: number;
	slot_end_hour: number;
	slot_interval_minutes: number;
}

export interface WorkspaceSwitchRequest {
	from: Workspace;
	to: Workspace;
}

export type WorkspaceSwitchGuard = (request: WorkspaceSwitchRequest) => boolean | Promise<boolean>;

const STORAGE_KEY = 'openpost_current_workspace';
type LoadedWorkspaceSettings = NonNullable<AppBootstrapWorkspaceSettings>;

function defaultWorkspaceSettings(): WorkspaceSettings {
	return {
		name: '',
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

function safeWorkspaceTimezone(value: string | null | undefined): string {
	const timezone = value?.trim() || 'UTC';
	try {
		new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
		return timezone;
	} catch {
		return 'UTC';
	}
}

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function safeWeekStart(value: number): WeekStart {
	switch (value) {
		case 0:
		case 1:
		case 2:
		case 3:
		case 4:
		case 5:
		case 6:
			return value;
		default:
			return 1;
	}
}

export class WorkspaceContext {
	private initializePromise: Promise<void> | null = null;
	private bootstrapRequestGeneration = 0;
	private settingsRequestSequence = 0;
	private settingsSaveGeneration = 0;
	private workspaceSwitchRequestSequence = 0;
	private workspaceSwitchGuardPending = false;
	private stateEpoch = 0;
	private readonly workspaceSwitchGuards = new Set<WorkspaceSwitchGuard>();

	currentWorkspace = $state<Workspace | null>(null);
	workspaces = $state<Workspace[]>([]);
	settings = $state<WorkspaceSettings>(defaultWorkspaceSettings());
	savedSettings = $state<WorkspaceSettings>(defaultWorkspaceSettings());
	settingsLoading = $state(false);
	settingsError = $state('');
	settingsBackgroundError = $state('');
	settingsWorkspaceID = $state('');
	loading = $state(false);

	get settingsReady() {
		return (
			Boolean(this.currentWorkspace) &&
			this.settingsWorkspaceID === this.currentWorkspace?.id &&
			!this.settingsLoading &&
			!this.settingsError
		);
	}

	get settingsDirty() {
		return (
			this.settingsReady && JSON.stringify(this.settings) !== JSON.stringify(this.savedSettings)
		);
	}

	async initialize(
		preferredWorkspaceID?: string,
		options: { selectionIsCurrent?: () => boolean } = {}
	) {
		if (!browser) return;
		if (this.initializePromise) {
			await this.initializePromise;
			if (options.selectionIsCurrent && !options.selectionIsCurrent()) return;
			if (preferredWorkspaceID && this.currentWorkspace?.id !== preferredWorkspaceID) {
				await this.initialize(preferredWorkspaceID, options);
			}
			return;
		}

		this.loading = true;
		const initializePromise = this.performInitialize(
			preferredWorkspaceID,
			options.selectionIsCurrent
		);
		this.initializePromise = initializePromise;
		try {
			await initializePromise;
		} finally {
			if (this.initializePromise === initializePromise) {
				this.initializePromise = null;
				this.loading = false;
			}
		}
	}

	private async performInitialize(
		preferredWorkspaceID?: string,
		selectionIsCurrent?: () => boolean
	) {
		const storedWorkspace = this.storedWorkspace();
		if (storedWorkspace) this.currentWorkspace = storedWorkspace;
		await this.fetchBootstrap({
			preferredWorkspaceID: preferredWorkspaceID ?? storedWorkspace?.id,
			selectionIsCurrent
		});
	}

	preferredWorkspaceID(): string | undefined {
		return this.storedWorkspace()?.id;
	}

	private storedWorkspace(): Workspace | null {
		if (!browser) return null;
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return null;
		try {
			return JSON.parse(stored);
		} catch {
			return null;
		}
	}

	private clearWorkspaceState() {
		this.settingsRequestSequence += 1;
		this.currentWorkspace = null;
		this.settings = defaultWorkspaceSettings();
		this.savedSettings = defaultWorkspaceSettings();
		this.settingsLoading = false;
		this.settingsError = '';
		this.settingsBackgroundError = '';
		this.settingsWorkspaceID = '';
		if (browser) {
			localStorage.removeItem(STORAGE_KEY);
		}
	}

	reset() {
		this.stateEpoch += 1;
		this.bootstrapRequestGeneration += 1;
		this.settingsSaveGeneration += 1;
		this.workspaceSwitchRequestSequence += 1;
		this.workspaceSwitchGuardPending = false;
		this.initializePromise = null;
		this.loading = false;
		this.workspaces = [];
		this.clearWorkspaceState();
	}

	private syncWorkspaceListCache() {
		queryClient.setQueryData(openPostBootstrapQueryKeys.workspaces(), this.workspaces);
	}

	private invalidateBootstrapCache() {
		return queryClient.invalidateQueries({
			queryKey: openPostBootstrapQueryKeys.appRoot()
		});
	}

	async loadWorkspaces(
		preferredWorkspaceID?: string,
		options: { selectionIsCurrent?: () => boolean } = {}
	) {
		try {
			return await this.fetchBootstrap({
				preferredWorkspaceID:
					preferredWorkspaceID ?? this.currentWorkspace?.id ?? this.preferredWorkspaceID(),
				refresh: true,
				selectionIsCurrent: options.selectionIsCurrent
			});
		} catch (e) {
			console.error('Failed to load workspaces:', e);
			if (e instanceof WorkspaceContextError) throw e;
			throw new WorkspaceContextError(
				'load-workspaces',
				e instanceof Error && e.message ? e.message : m.workspace_load_failed()
			);
		}
	}

	private async fetchBootstrap(options: {
		preferredWorkspaceID?: string;
		refresh?: boolean;
		selectionIsCurrent?: () => boolean;
	}): Promise<AppBootstrap | undefined> {
		const requestGeneration = ++this.bootstrapRequestGeneration;
		const workspaceSelectionRevision = this.workspaceSwitchRequestSequence;
		const queryOptions = appBootstrapQueryOptions(
			appBootstrapQueryAPI,
			options.preferredWorkspaceID
		);
		if (options.refresh) {
			await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
		}
		let bootstrap: AppBootstrap;
		try {
			bootstrap = await queryClient.fetchQuery(queryOptions);
		} catch (error) {
			if (requestGeneration !== this.bootstrapRequestGeneration) return;
			throw error;
		}
		if (requestGeneration !== this.bootstrapRequestGeneration) return;
		seedAppBootstrap(queryClient, bootstrap);
		await this.applyBootstrap(bootstrap, workspaceSelectionRevision, options.selectionIsCurrent);
		return bootstrap;
	}

	private async applyBootstrap(
		bootstrap: AppBootstrap,
		workspaceSelectionRevision: number,
		selectionIsCurrent?: () => boolean
	) {
		const previousWorkspaces = this.workspaces;
		this.workspaces = bootstrap.workspaces ?? [];
		const nextWorkspaces = new Map(this.workspaces.map((workspace) => [workspace.id, workspace]));
		for (const previousWorkspace of previousWorkspaces) {
			const nextWorkspace = nextWorkspaces.get(previousWorkspace.id);
			const previouslyAuthorized =
				!previousWorkspace.sso_required || previousWorkspace.sso_authenticated;
			const remainsAuthorized =
				Boolean(nextWorkspace) &&
				(!nextWorkspace?.sso_required || Boolean(nextWorkspace.sso_authenticated));
			if (previouslyAuthorized && !remainsAuthorized) {
				queryClient.removeQueries({
					queryKey: openPostWorkspaceKey(previousWorkspace.id)
				});
			}
		}
		if (
			workspaceSelectionRevision !== this.workspaceSwitchRequestSequence ||
			(selectionIsCurrent && !selectionIsCurrent())
		) {
			const currentWorkspace = this.currentWorkspace;
			const refreshedCurrentWorkspace = this.workspaces.find(
				(workspace) => workspace.id === currentWorkspace?.id
			);
			if (refreshedCurrentWorkspace) {
				this.currentWorkspace = refreshedCurrentWorkspace;
				if (browser) {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshedCurrentWorkspace));
				}
			} else if (currentWorkspace) {
				this.clearWorkspaceState();
			}
			return;
		}
		if (this.workspaces.length === 0) {
			this.clearWorkspaceState();
			return;
		}

		const selectedWorkspaceID = confirmedBootstrapWorkspaceId(bootstrap);
		const selectedWorkspace =
			this.workspaces.find((workspace) => workspace.id === selectedWorkspaceID) ??
			this.workspaces[0];
		if (!selectedWorkspace) {
			this.clearWorkspaceState();
			return;
		}
		await this.setWorkspace(selectedWorkspace, selectionIsCurrent);
	}

	registerWorkspaceSwitchGuard(guard: WorkspaceSwitchGuard): () => void {
		this.workspaceSwitchGuards.add(guard);
		return () => this.workspaceSwitchGuards.delete(guard);
	}

	async setWorkspace(
		workspace: Workspace,
		selectionIsCurrent: () => boolean = () => true
	): Promise<boolean> {
		if (!selectionIsCurrent()) return false;
		const current = this.currentWorkspace;
		if (current?.id === workspace.id) {
			this.currentWorkspace = workspace;
			if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
			if (workspace.sso_required && !workspace.sso_authenticated) {
				this.settings = defaultWorkspaceSettings();
				this.savedSettings = defaultWorkspaceSettings();
				this.settingsLoading = false;
				this.settingsError = '';
				this.settingsBackgroundError = '';
				this.settingsWorkspaceID = '';
				return true;
			}
			await this.loadSettings(workspace.id);
			return true;
		}

		if (current && this.workspaceSwitchGuards.size > 0 && this.workspaceSwitchGuardPending) {
			return false;
		}
		const requestSequence = ++this.workspaceSwitchRequestSequence;
		if (current) {
			this.workspaceSwitchGuardPending = true;
			try {
				for (const guard of [...this.workspaceSwitchGuards]) {
					let allowed = false;
					try {
						allowed = await guard({ from: current, to: workspace });
					} catch (error) {
						console.error('Workspace switch guard failed:', error);
					}
					if (!allowed) return false;
					if (requestSequence !== this.workspaceSwitchRequestSequence) return false;
				}
			} finally {
				this.workspaceSwitchGuardPending = false;
			}
		}

		if (requestSequence !== this.workspaceSwitchRequestSequence || !selectionIsCurrent())
			return false;
		this.currentWorkspace = workspace;
		if (browser) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
		}
		if (workspace.sso_required && !workspace.sso_authenticated) {
			this.settings = defaultWorkspaceSettings();
			this.savedSettings = defaultWorkspaceSettings();
			this.settingsLoading = false;
			this.settingsError = '';
			this.settingsBackgroundError = '';
			this.settingsWorkspaceID = '';
			return true;
		}
		await this.loadSettings(workspace.id);
		return this.currentWorkspace?.id === workspace.id;
	}

	async loadSettings(workspaceID = this.currentWorkspace?.id) {
		if (!workspaceID || this.currentWorkspace?.id !== workspaceID) return;
		const stateEpoch = this.stateEpoch;
		const requestSequence = ++this.settingsRequestSequence;
		const settingsKey = openPostBootstrapQueryKeys.workspaceSettings(workspaceID);
		const cachedSettings = queryClient.getQueryData<LoadedWorkspaceSettings>(settingsKey);
		const preserveLocalSettings = this.settingsWorkspaceID === workspaceID && this.settingsDirty;
		if (cachedSettings && !preserveLocalSettings) {
			this.applyWorkspaceSettings(workspaceID, cachedSettings);
		} else if (!cachedSettings && !preserveLocalSettings) {
			this.settings = defaultWorkspaceSettings();
			this.savedSettings = defaultWorkspaceSettings();
			this.settingsWorkspaceID = '';
		}
		this.settingsLoading = !cachedSettings && !preserveLocalSettings;
		this.settingsError = '';
		this.settingsBackgroundError = '';

		try {
			const data = await queryClient.fetchQuery(
				workspaceSettingsQueryOptions(workspaceSettingsQueryAPI, workspaceID)
			);
			const currentWorkspace = this.currentWorkspace;
			if (
				requestSequence !== this.settingsRequestSequence ||
				currentWorkspace?.id !== workspaceID
			) {
				return;
			}

			if (!this.settingsDirty) this.applyWorkspaceSettings(workspaceID, data);
		} catch (e) {
			if (
				stateEpoch !== this.stateEpoch ||
				requestSequence !== this.settingsRequestSequence ||
				this.currentWorkspace?.id !== workspaceID
			) {
				return;
			}
			const message =
				e instanceof Error && e.message ? e.message : m.workspace_settings_load_failed();
			if (e instanceof OpenPostQueryError && (e.status === 403 || e.status === 404)) {
				const lostWorkspace = this.workspaces.find((workspace) => workspace.id === workspaceID);
				queryClient.removeQueries({
					queryKey: openPostWorkspaceKey(workspaceID)
				});
				queryClient.removeQueries({ queryKey: publicProfileQueryKeys.all() });
				this.workspaces = this.workspaces.filter((workspace) => workspace.id !== workspaceID);
				this.syncWorkspaceListCache();
				const fallback = this.workspaces[0] ?? null;
				this.clearWorkspaceState();
				await Promise.all([
					this.invalidateBootstrapCache(),
					queryClient.invalidateQueries({
						queryKey: adminQueryKeys.usersRoot()
					}),
					queryClient.invalidateQueries({ queryKey: developerQueryKeys.all }),
					queryClient.invalidateQueries({
						queryKey: organizationQueryKeys.all(),
						exact: true
					}),
					...(lostWorkspace?.organization_id
						? [
								queryClient.invalidateQueries({
									queryKey: organizationQueryKeys.detailRoot(lostWorkspace.organization_id)
								})
							]
						: [])
				]);
				if (stateEpoch !== this.stateEpoch) return;
				if (fallback) await this.setWorkspace(fallback);
				else this.settingsError = message;
			} else if (e instanceof OpenPostQueryError && e.status === 401) {
				queryClient.removeQueries({ queryKey: settingsKey, exact: true });
				this.settings = defaultWorkspaceSettings();
				this.savedSettings = defaultWorkspaceSettings();
				this.settingsWorkspaceID = '';
				this.settingsBackgroundError = '';
				this.settingsError = message;
			} else if (cachedSettings) this.settingsBackgroundError = message;
			else this.settingsError = message;
			console.error('Failed to load workspace settings:', e);
		} finally {
			if (
				stateEpoch === this.stateEpoch &&
				requestSequence === this.settingsRequestSequence &&
				this.currentWorkspace?.id === workspaceID
			) {
				this.settingsLoading = false;
			}
		}
	}

	private applyWorkspaceSettings(workspaceID: string, data: LoadedWorkspaceSettings) {
		const currentWorkspace = this.currentWorkspace;
		if (!currentWorkspace || currentWorkspace.id !== workspaceID) return;
		const loadedSettings: WorkspaceSettings = {
			name: data.name || currentWorkspace.name || '',
			avatar_url: data.avatar_url || '',
			color: data.color || '#f97316',
			timezone: safeWorkspaceTimezone(data.timezone),
			week_start: data.week_start ?? 1,
			random_delay_minutes: data.random_delay_minutes ?? 0,
			slot_start_hour: data.slot_start_hour ?? 5,
			slot_end_hour: data.slot_end_hour ?? 23,
			slot_interval_minutes: data.slot_interval_minutes ?? 15
		};
		this.settings = loadedSettings;
		this.savedSettings = structuredClone(loadedSettings);
		this.settingsWorkspaceID = workspaceID;
		this.currentWorkspace = {
			...currentWorkspace,
			name: data.name || currentWorkspace.name || '',
			avatar_url: data.avatar_url || '',
			color: data.color || '#f97316'
		};
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentWorkspace));
	}

	async saveSettings(updates: Partial<WorkspaceSettings>) {
		if (!this.currentWorkspace || !this.settingsReady) {
			throw new WorkspaceContextError(
				'settings-not-ready',
				this.settingsError || m.workspace_settings_not_ready()
			);
		}
		const stateEpoch = this.stateEpoch;
		const workspaceID = this.currentWorkspace.id;
		const workspaceSelectionRevision = this.workspaceSwitchRequestSequence;
		const saveGeneration = ++this.settingsSaveGeneration;
		const settingsKey = openPostBootstrapQueryKeys.workspaceSettings(workspaceID);
		const canProjectSave = () =>
			stateEpoch === this.stateEpoch &&
			workspaceSelectionRevision === this.workspaceSwitchRequestSequence &&
			saveGeneration === this.settingsSaveGeneration &&
			this.currentWorkspace?.id === workspaceID;

		try {
			const { error } = await client.PATCH('/workspaces/{id}/settings', {
				params: { path: { id: workspaceID } },
				body: updates
			});
			if (stateEpoch !== this.stateEpoch) return;
			if (error) {
				throw new WorkspaceContextError(
					'save-settings',
					error.detail || m.workspace_settings_save_failed()
				);
			}
			const projectSave = canProjectSave();
			const cachedSettings = queryClient.getQueryData<LoadedWorkspaceSettings>(settingsKey);
			if (projectSave && cachedSettings) {
				queryClient.setQueryData(settingsKey, {
					...cachedSettings,
					...updates,
					timezone:
						updates.timezone === undefined
							? cachedSettings.timezone
							: safeWorkspaceTimezone(updates.timezone)
				});
			}
			const invalidations = [
				queryClient.invalidateQueries({
					queryKey: settingsKey,
					exact: true,
					refetchType: 'none'
				}),
				this.invalidateBootstrapCache()
			];
			if (updates.name !== undefined) {
				invalidations.push(
					queryClient.invalidateQueries({
						queryKey: workspaceSettingsQueryKeys.setup(workspaceID),
						exact: true,
						refetchType: 'none'
					})
				);
				queryClient.removeQueries({ queryKey: publicProfileQueryKeys.all() });
			}
			await Promise.all(invalidations);
			if (!canProjectSave()) return;
			this.workspaces = this.workspaces.map((workspace) => {
				if (workspace.id !== workspaceID) return workspace;
				const updated = { ...workspace };
				if (updates.name !== undefined) updated.name = updates.name;
				if (updates.avatar_url !== undefined) updated.avatar_url = updates.avatar_url;
				if (updates.color !== undefined) updated.color = updates.color;
				return updated;
			});
			this.syncWorkspaceListCache();

			const currentWorkspace = this.currentWorkspace;
			if (stateEpoch !== this.stateEpoch || currentWorkspace?.id !== workspaceID) return;

			if (updates.timezone !== undefined) {
				this.settings.timezone = safeWorkspaceTimezone(updates.timezone);
			}
			let updatedWorkspace = currentWorkspace;
			if (updates.name !== undefined) {
				this.settings.name = updates.name;
				updatedWorkspace = { ...updatedWorkspace, name: updates.name };
			}
			if (updates.avatar_url !== undefined) {
				this.settings.avatar_url = updates.avatar_url;
				updatedWorkspace = {
					...updatedWorkspace,
					avatar_url: updates.avatar_url
				};
			}
			if (updates.color !== undefined) {
				this.settings.color = updates.color;
				updatedWorkspace = { ...updatedWorkspace, color: updates.color };
			}
			if (updatedWorkspace !== currentWorkspace) {
				this.currentWorkspace = updatedWorkspace;
				if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedWorkspace));
			}
			if (updates.week_start !== undefined) this.settings.week_start = updates.week_start;
			if (updates.random_delay_minutes !== undefined)
				this.settings.random_delay_minutes = updates.random_delay_minutes;
			if (updates.slot_start_hour !== undefined)
				this.settings.slot_start_hour = updates.slot_start_hour;
			if (updates.slot_end_hour !== undefined) this.settings.slot_end_hour = updates.slot_end_hour;
			if (updates.slot_interval_minutes !== undefined)
				this.settings.slot_interval_minutes = updates.slot_interval_minutes;
			this.savedSettings = {
				...this.savedSettings,
				...structuredClone(updates)
			};
			this.workspaces = this.workspaces.map((workspace) =>
				workspace.id === workspaceID ? (this.currentWorkspace ?? workspace) : workspace
			);
			this.syncWorkspaceListCache();
		} catch (e) {
			console.error('Failed to save workspace settings:', e);
			throw e;
		}
	}

	async deleteWorkspace(
		workspaceID: string,
		confirmation: {
			confirmName: string;
			currentPassword: string;
			reauthGrant?: string;
		}
	): Promise<boolean> {
		const stateEpoch = this.stateEpoch;
		const organizationID = this.workspaces.find(
			(workspace) => workspace.id === workspaceID
		)?.organization_id;
		const { error } = await client.DELETE('/workspaces/{id}', {
			params: { path: { id: workspaceID } },
			body: {
				confirm_name: confirmation.confirmName,
				current_password: confirmation.currentPassword,
				reauth_grant: confirmation.reauthGrant
			}
		});
		if (stateEpoch !== this.stateEpoch) return false;
		if (error) {
			throw new WorkspaceContextError(
				'delete-workspace',
				error.detail || m.workspace_delete_failed()
			);
		}
		this.workspaces = this.workspaces.filter((workspace) => workspace.id !== workspaceID);
		this.syncWorkspaceListCache();
		queryClient.removeQueries({ queryKey: openPostWorkspaceKey(workspaceID) });
		const invalidations = [
			this.invalidateBootstrapCache(),
			queryClient.invalidateQueries({
				queryKey: adminQueryKeys.overview(),
				exact: true
			}),
			queryClient.invalidateQueries({ queryKey: adminQueryKeys.usersRoot() }),
			queryClient.invalidateQueries({ queryKey: developerQueryKeys.all }),
			queryClient.invalidateQueries({
				predicate: (query) => isBillingStatusQueryKey(query.queryKey)
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.instanceAuditRoot()
			})
		];
		queryClient.removeQueries({ queryKey: publicProfileQueryKeys.all() });
		if (organizationID) {
			invalidations.push(
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.detailRoot(organizationID)
				})
			);
		}
		await Promise.all(invalidations);
		if (stateEpoch !== this.stateEpoch) return false;
		const fallback = this.workspaces[0] ?? null;
		if (this.currentWorkspace?.id === workspaceID) {
			this.clearWorkspaceState();
			if (fallback) await this.setWorkspace(fallback);
		}
		return stateEpoch === this.stateEpoch;
	}

	async deleteOrganization(
		organizationID: string,
		confirmation: {
			confirmName: string;
			currentPassword: string;
			reauthGrant?: string;
		}
	): Promise<boolean> {
		const stateEpoch = this.stateEpoch;
		const { error } = await client.DELETE('/organizations/{id}', {
			params: { path: { id: organizationID } },
			body: {
				confirm_name: confirmation.confirmName,
				current_password: confirmation.currentPassword,
				reauth_grant: confirmation.reauthGrant
			}
		});
		if (stateEpoch !== this.stateEpoch) return false;
		if (error) {
			throw new WorkspaceContextError(
				'delete-organization',
				error.detail || m.organization_delete_failed()
			);
		}
		const deletedWorkspaceIDs = this.workspaces
			.filter((workspace) => workspace.organization_id === organizationID)
			.map((workspace) => workspace.id);
		this.workspaces = this.workspaces.filter(
			(workspace) => workspace.organization_id !== organizationID
		);
		this.syncWorkspaceListCache();
		for (const workspaceID of deletedWorkspaceIDs) {
			queryClient.removeQueries({
				queryKey: openPostWorkspaceKey(workspaceID)
			});
		}
		queryClient.removeQueries({
			queryKey: organizationQueryKeys.detailRoot(organizationID)
		});
		queryClient.removeQueries({
			queryKey: organizationQueryKeys.all(),
			exact: true
		});
		queryClient.removeQueries({ queryKey: publicProfileQueryKeys.all() });
		await Promise.all([
			this.invalidateBootstrapCache(),
			queryClient.invalidateQueries({
				queryKey: adminQueryKeys.overview(),
				exact: true
			}),
			queryClient.invalidateQueries({ queryKey: adminQueryKeys.usersRoot() }),
			queryClient.invalidateQueries({ queryKey: developerQueryKeys.all }),
			queryClient.invalidateQueries({
				queryKey: authQueryKeys.linkableOIDCProviders(),
				exact: true
			}),
			queryClient.invalidateQueries({
				queryKey: authQueryKeys.oidcIdentities(),
				exact: true
			}),
			queryClient.invalidateQueries({
				queryKey: authQueryKeys.security(),
				exact: true
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.instanceAuditRoot()
			})
		]);
		if (stateEpoch !== this.stateEpoch) return false;
		const fallback = this.workspaces[0] ?? null;
		if (this.currentWorkspace?.organization_id === organizationID) {
			this.clearWorkspaceState();
			if (fallback) await this.setWorkspace(fallback);
		}
		return stateEpoch === this.stateEpoch;
	}

	get weekStartsOn(): WeekStart {
		return safeWeekStart(this.settings.week_start);
	}
}

export const workspaceCtx = new WorkspaceContext();
