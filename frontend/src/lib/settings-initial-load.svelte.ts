import { createContext, onDestroy } from 'svelte';
import type { SettingsTabID } from '$lib/settings-navigation';

export const SETTINGS_INITIAL_LOAD_PARTICIPANT = {
	notifications: 'notifications.preferences',
	security: 'security.status',
	authSessions: 'security.sessions',
	apiTokens: 'developer.tokens',
	mcpActivity: 'developer.mcp-activity',
	brand: 'workspace.brand',
	accounts: 'workspace.accounts',
	accountProviders: 'workspace.account-providers',
	reposts: 'workspace.reposts',
	schedule: 'workspace.schedule',
	members: 'workspace.members',
	billing: 'organization.billing',
	sso: 'organization.sso',
	audit: 'organization.audit',
	ownership: 'organization.ownership',
	instanceOverview: 'instance.overview',
	instanceStatus: 'instance.status',
	instanceConfiguration: 'instance.configuration',
	instancePrompts: 'instance.prompts',
	instanceUsers: 'instance.users',
	instanceAudit: 'instance.audit'
} as const;

export type SettingsInitialLoadParticipantID =
	(typeof SETTINGS_INITIAL_LOAD_PARTICIPANT)[keyof typeof SETTINGS_INITIAL_LOAD_PARTICIPANT];

export interface SettingsInitialLoadPlan {
	key: string;
	participants: readonly SettingsInitialLoadParticipantID[];
}

interface SettingsInitialLoadScope {
	userID: string;
	workspaceID: string;
	organizationID: string;
	preferredOrganizationID?: string;
}

interface SettingsInitialLoadParticipant {
	update(pending: boolean): void;
	unregister(): void;
}

const NO_PARTICIPANTS: readonly SettingsInitialLoadParticipantID[] = [];

export function getSettingsInitialLoadPlan(
	tab: SettingsTabID,
	scope: SettingsInitialLoadScope
): SettingsInitialLoadPlan {
	switch (tab) {
		case 'notifications':
			return scopedPlan(tab, scope.userID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.notifications]);
		case 'security':
			return scopedPlan(tab, scope.userID, [
				SETTINGS_INITIAL_LOAD_PARTICIPANT.security,
				SETTINGS_INITIAL_LOAD_PARTICIPANT.authSessions
			]);
		case 'developer':
			return scopedPlan(tab, scope.userID, [
				SETTINGS_INITIAL_LOAD_PARTICIPANT.apiTokens,
				SETTINGS_INITIAL_LOAD_PARTICIPANT.mcpActivity
			]);
		case 'brand':
			return scopedPlan(tab, scope.workspaceID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.brand]);
		case 'accounts':
			return scopedPlan(tab, scope.workspaceID, [
				SETTINGS_INITIAL_LOAD_PARTICIPANT.accounts,
				SETTINGS_INITIAL_LOAD_PARTICIPANT.accountProviders
			]);
		case 'reposts':
			return scopedPlan(tab, scope.workspaceID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.reposts]);
		case 'schedule':
			return scopedPlan(tab, scope.workspaceID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]);
		case 'members':
			return scopedPlan(tab, scope.workspaceID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.members]);
		case 'plan':
			return scopedPlan(tab, scope.workspaceID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.billing]);
		case 'sso':
			return scopedPlan(tab, scope.organizationID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.sso]);
		case 'audit':
			return scopedPlan(
				tab,
				`${scope.userID}:${scope.organizationID}`,
				[SETTINGS_INITIAL_LOAD_PARTICIPANT.audit],
				Boolean(scope.userID)
			);
		case 'ownership':
			return scopedPlan(
				tab,
				`${scope.userID}:${scope.preferredOrganizationID ?? ''}`,
				[SETTINGS_INITIAL_LOAD_PARTICIPANT.ownership],
				Boolean(scope.userID)
			);
		case 'instance':
			return scopedPlan(tab, scope.userID, [
				SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceOverview,
				SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceStatus
			]);
		case 'configuration':
			return scopedPlan(tab, scope.userID, [
				SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceConfiguration
			]);
		case 'ai-prompts':
			return scopedPlan(tab, scope.userID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.instancePrompts]);
		case 'users':
			return scopedPlan(tab, scope.userID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceUsers]);
		case 'instance-audit':
			return scopedPlan(tab, scope.userID, [SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceAudit]);
		default:
			return { key: `${tab}:`, participants: NO_PARTICIPANTS };
	}
}

function scopedPlan(
	tab: SettingsTabID,
	scopeKey: string,
	participants: readonly SettingsInitialLoadParticipantID[],
	enabled = Boolean(scopeKey)
): SettingsInitialLoadPlan {
	return {
		key: `${tab}:${scopeKey}`,
		participants: enabled ? participants : NO_PARTICIPANTS
	};
}

export class SettingsInitialLoadBoundary {
	private generation = $state(0);
	private planSignature = '';
	private expectedParticipants = new Set<SettingsInitialLoadParticipantID>();
	private settledParticipants = new Set<SettingsInitialLoadParticipantID>();
	private pendingParticipants = $state.raw(new Set<SettingsInitialLoadParticipantID>());

	constructor(plan: SettingsInitialLoadPlan) {
		this.activate(plan);
	}

	get loading(): boolean {
		return this.pendingParticipants.size > 0;
	}

	get revision(): number {
		return this.generation;
	}

	activate(plan: SettingsInitialLoadPlan): void {
		const signature = `${plan.key}\u0000${plan.participants.join('\u0000')}`;
		if (signature === this.planSignature) return;

		this.planSignature = signature;
		this.generation += 1;
		this.expectedParticipants = new Set(plan.participants);
		this.settledParticipants = new Set();
		this.pendingParticipants = new Set(plan.participants);
	}

	register(id: SettingsInitialLoadParticipantID): SettingsInitialLoadParticipant {
		const generation = this.generation;
		let registered = this.expectedParticipants.has(id);

		return {
			update: (pending) => {
				if (!registered || generation !== this.generation) return;
				if (!pending) this.settle(id);
			},
			unregister: () => {
				if (!registered) return;
				registered = false;
				if (generation === this.generation) this.settle(id);
			}
		};
	}

	private settle(id: SettingsInitialLoadParticipantID): void {
		if (this.settledParticipants.has(id)) return;
		this.settledParticipants.add(id);
		if (!this.pendingParticipants.has(id)) return;
		const pending = new Set(this.pendingParticipants);
		pending.delete(id);
		this.pendingParticipants = pending;
	}
}

const [getSettingsInitialLoadBoundary, setSettingsInitialLoadBoundary] =
	createContext<SettingsInitialLoadBoundary>();

export function provideSettingsInitialLoadBoundary(
	readPlan: () => SettingsInitialLoadPlan
): SettingsInitialLoadBoundary {
	const boundary = new SettingsInitialLoadBoundary(readPlan());
	setSettingsInitialLoadBoundary(boundary);
	return boundary;
}

export function registerSettingsInitialLoad(
	id: SettingsInitialLoadParticipantID
): (pending: boolean) => void {
	let boundary: SettingsInitialLoadBoundary;
	try {
		boundary = getSettingsInitialLoadBoundary();
	} catch {
		return () => undefined;
	}

	let active = true;
	let participantRevision = -1;
	let participant: SettingsInitialLoadParticipant | null = null;
	onDestroy(() => {
		active = false;
		participant?.unregister();
	});

	return (pending) => {
		if (!active) return;
		const revision = boundary.revision;
		if (participantRevision !== revision) {
			participant?.unregister();
			participant = boundary.register(id);
			participantRevision = revision;
		}
		participant.update(pending);
	};
}
