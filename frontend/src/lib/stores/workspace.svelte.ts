import { browser } from '$app/environment';
import { client, type Workspace } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';

export type WorkspaceContextErrorCode =
	| 'load-workspaces'
	| 'load-settings'
	| 'settings-not-ready'
	| 'save-settings'
	| 'delete-workspace';

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
	draft_gap_minutes: number;
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

function defaultWorkspaceSettings(): WorkspaceSettings {
	return {
		name: '',
		avatar_url: '',
		color: '#f97316',
		timezone: 'UTC',
		week_start: 1,
		random_delay_minutes: 0,
		draft_gap_minutes: 60,
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

export class WorkspaceContext {
	private initializePromise: Promise<void> | null = null;
	private settingsRequestSequence = 0;
	private workspaceSwitchRequestSequence = 0;
	private workspaceSwitchGuardPending = false;
	private readonly workspaceSwitchGuards = new Set<WorkspaceSwitchGuard>();

	currentWorkspace = $state<Workspace | null>(null);
	workspaces = $state<Workspace[]>([]);
	settings = $state<WorkspaceSettings>(defaultWorkspaceSettings());
	savedSettings = $state<WorkspaceSettings>(defaultWorkspaceSettings());
	settingsLoading = $state(false);
	settingsError = $state('');
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

	async initialize(preferredWorkspaceID?: string) {
		if (!browser) return;
		if (this.initializePromise) {
			await this.initializePromise;
			if (preferredWorkspaceID && this.currentWorkspace?.id !== preferredWorkspaceID) {
				await this.initialize(preferredWorkspaceID);
			}
			return;
		}

		this.loading = true;
		this.initializePromise = this.performInitialize(preferredWorkspaceID);
		try {
			await this.initializePromise;
		} finally {
			this.initializePromise = null;
			this.loading = false;
		}
	}

	private async performInitialize(preferredWorkspaceID?: string) {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			try {
				this.currentWorkspace = JSON.parse(stored);
			} catch {
				// ignore
			}
		}

		await this.loadWorkspaces(preferredWorkspaceID);
	}

	private clearWorkspaceState() {
		this.settingsRequestSequence += 1;
		this.currentWorkspace = null;
		this.settings = defaultWorkspaceSettings();
		this.savedSettings = defaultWorkspaceSettings();
		this.settingsLoading = false;
		this.settingsError = '';
		this.settingsWorkspaceID = '';
		if (browser) {
			localStorage.removeItem(STORAGE_KEY);
		}
	}

	reset() {
		this.workspaceSwitchRequestSequence += 1;
		this.workspaceSwitchGuardPending = false;
		this.initializePromise = null;
		this.loading = false;
		this.workspaces = [];
		this.clearWorkspaceState();
	}

	async loadWorkspaces(preferredWorkspaceID?: string) {
		try {
			const { data, error } = await client.GET('/workspaces', {});
			if (error) {
				throw new WorkspaceContextError(
					'load-workspaces',
					error.detail || m.workspace_load_failed()
				);
			}
			this.workspaces = data ?? [];
			if (this.workspaces.length === 0) {
				this.clearWorkspaceState();
				return;
			}

			const preferredWorkspace = preferredWorkspaceID
				? this.workspaces.find((workspace) => workspace.id === preferredWorkspaceID)
				: null;

			if (preferredWorkspace) {
				await this.setWorkspace(preferredWorkspace);
			} else if (this.workspaces.length > 0 && !this.currentWorkspace) {
				await this.setWorkspace(this.workspaces[0]);
			} else if (this.currentWorkspace) {
				const exists = this.workspaces.find((w) => w.id === this.currentWorkspace?.id);
				if (!exists && this.workspaces.length > 0) {
					await this.setWorkspace(this.workspaces[0]);
				} else if (exists?.sso_required && !exists.sso_authenticated) {
					this.currentWorkspace = exists;
					localStorage.setItem(STORAGE_KEY, JSON.stringify(exists));
					this.settings = defaultWorkspaceSettings();
					this.savedSettings = defaultWorkspaceSettings();
					this.settingsLoading = false;
					this.settingsError = '';
					this.settingsWorkspaceID = '';
				} else if (exists) {
					await this.loadSettings();
				}
			}
		} catch (e) {
			console.error('Failed to load workspaces:', e);
			throw e;
		}
	}

	registerWorkspaceSwitchGuard(guard: WorkspaceSwitchGuard): () => void {
		this.workspaceSwitchGuards.add(guard);
		return () => this.workspaceSwitchGuards.delete(guard);
	}

	async setWorkspace(workspace: Workspace): Promise<boolean> {
		const current = this.currentWorkspace;
		if (current?.id === workspace.id) {
			this.currentWorkspace = workspace;
			if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
			if (workspace.sso_required && !workspace.sso_authenticated) {
				this.settings = defaultWorkspaceSettings();
				this.savedSettings = defaultWorkspaceSettings();
				this.settingsLoading = false;
				this.settingsError = '';
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

		if (requestSequence !== this.workspaceSwitchRequestSequence) return false;
		this.currentWorkspace = workspace;
		if (browser) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
		}
		if (workspace.sso_required && !workspace.sso_authenticated) {
			this.settings = defaultWorkspaceSettings();
			this.settingsLoading = false;
			this.settingsError = '';
			this.settingsWorkspaceID = '';
			return true;
		}
		await this.loadSettings(workspace.id);
		return this.currentWorkspace?.id === workspace.id;
	}

	async loadSettings(workspaceID = this.currentWorkspace?.id) {
		if (!workspaceID || this.currentWorkspace?.id !== workspaceID) return;
		const requestSequence = ++this.settingsRequestSequence;
		this.settings = defaultWorkspaceSettings();
		this.settingsWorkspaceID = '';
		this.settingsLoading = true;
		this.settingsError = '';

		try {
			const { data, error } = await client.GET('/workspaces/{id}/settings', {
				params: { path: { id: workspaceID } }
			});
			if (error || !data) {
				throw new WorkspaceContextError(
					'load-settings',
					error?.detail || m.workspace_settings_load_failed()
				);
			}
			if (
				requestSequence !== this.settingsRequestSequence ||
				this.currentWorkspace?.id !== workspaceID
			) {
				return;
			}

			const loadedSettings: WorkspaceSettings = {
				name: data.name || this.currentWorkspace.name || '',
				avatar_url: data.avatar_url || '',
				color: data.color || '#f97316',
				timezone: safeWorkspaceTimezone(data.timezone),
				week_start: data.week_start ?? 1,
				random_delay_minutes: data.random_delay_minutes ?? 0,
				draft_gap_minutes: data.draft_gap_minutes ?? 60,
				slot_start_hour: data.slot_start_hour ?? 5,
				slot_end_hour: data.slot_end_hour ?? 23,
				slot_interval_minutes: data.slot_interval_minutes ?? 15
			};
			this.settings = loadedSettings;
			this.savedSettings = structuredClone(loadedSettings);
			this.settingsWorkspaceID = workspaceID;
			this.currentWorkspace = {
				...this.currentWorkspace,
				name: data.name || this.currentWorkspace.name || '',
				avatar_url: data.avatar_url || '',
				color: data.color || '#f97316'
			} as Workspace;
			if (browser) {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentWorkspace));
			}
		} catch (e) {
			if (
				requestSequence !== this.settingsRequestSequence ||
				this.currentWorkspace?.id !== workspaceID
			) {
				return;
			}
			this.settingsError =
				e instanceof Error && e.message ? e.message : m.workspace_settings_load_failed();
			console.error('Failed to load workspace settings:', e);
		} finally {
			if (
				requestSequence === this.settingsRequestSequence &&
				this.currentWorkspace?.id === workspaceID
			) {
				this.settingsLoading = false;
			}
		}
	}

	async saveSettings(updates: Partial<WorkspaceSettings>) {
		if (!this.currentWorkspace || !this.settingsReady) {
			throw new WorkspaceContextError(
				'settings-not-ready',
				this.settingsError || m.workspace_settings_not_ready()
			);
		}
		const workspaceID = this.currentWorkspace.id;

		try {
			const { error } = await client.PATCH('/workspaces/{id}/settings', {
				params: { path: { id: workspaceID } },
				body: updates
			});
			if (error) {
				throw new WorkspaceContextError(
					'save-settings',
					error.detail || m.workspace_settings_save_failed()
				);
			}
			if (this.currentWorkspace?.id !== workspaceID) return;

			if (updates.timezone !== undefined) {
				this.settings.timezone = safeWorkspaceTimezone(updates.timezone);
			}
			if (updates.name !== undefined && this.currentWorkspace) {
				this.settings.name = updates.name;
				this.currentWorkspace = { ...this.currentWorkspace, name: updates.name } as Workspace;
				if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentWorkspace));
			}
			if (updates.avatar_url !== undefined) {
				this.settings.avatar_url = updates.avatar_url;
				if (this.currentWorkspace) {
					this.currentWorkspace = {
						...this.currentWorkspace,
						avatar_url: updates.avatar_url
					} as Workspace;
					if (browser) {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentWorkspace));
					}
				}
			}
			if (updates.color !== undefined) {
				this.settings.color = updates.color;
				if (this.currentWorkspace) {
					this.currentWorkspace = { ...this.currentWorkspace, color: updates.color } as Workspace;
					if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentWorkspace));
				}
			}
			if (updates.week_start !== undefined) this.settings.week_start = updates.week_start;
			if (updates.random_delay_minutes !== undefined)
				this.settings.random_delay_minutes = updates.random_delay_minutes;
			if (updates.draft_gap_minutes !== undefined)
				this.settings.draft_gap_minutes = updates.draft_gap_minutes;
			if (updates.slot_start_hour !== undefined)
				this.settings.slot_start_hour = updates.slot_start_hour;
			if (updates.slot_end_hour !== undefined) this.settings.slot_end_hour = updates.slot_end_hour;
			if (updates.slot_interval_minutes !== undefined)
				this.settings.slot_interval_minutes = updates.slot_interval_minutes;
			this.savedSettings = { ...this.savedSettings, ...structuredClone(updates) };
		} catch (e) {
			console.error('Failed to save workspace settings:', e);
			throw e;
		}
	}

	async deleteWorkspace(
		workspaceID: string,
		confirmation: { confirmName: string; currentPassword: string; reauthGrant?: string }
	): Promise<void> {
		const { error } = await client.DELETE('/workspaces/{id}', {
			params: { path: { id: workspaceID } },
			body: {
				confirm_name: confirmation.confirmName,
				current_password: confirmation.currentPassword,
				reauth_grant: confirmation.reauthGrant
			}
		});
		if (error) {
			throw new WorkspaceContextError(
				'delete-workspace',
				error.detail || m.workspace_delete_failed()
			);
		}
		this.workspaces = this.workspaces.filter((workspace) => workspace.id !== workspaceID);
		const fallback = this.workspaces[0] ?? null;
		if (this.currentWorkspace?.id === workspaceID) {
			this.clearWorkspaceState();
			if (fallback) await this.setWorkspace(fallback);
		}
	}

	get weekStartsOn(): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
		return this.settings.week_start as 0 | 1 | 2 | 3 | 4 | 5 | 6;
	}
}

export const workspaceCtx = new WorkspaceContext();
