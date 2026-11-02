import { m } from '$lib/paraglide/messages';

export type SettingsDestinationGroup = 'you' | 'workspace' | 'plan' | 'advanced';
export type SettingsLoadingVariant = 'profile' | 'cards' | 'list' | 'form';

interface SettingsDestinationContext {
	workspaceName?: string;
}

interface SettingsDestinationDefinition {
	id: string;
	group: SettingsDestinationGroup;
	label: () => string;
	title?: () => string;
	loadingVariant: SettingsLoadingVariant;
	aliases?: readonly string[];
	/** Only instance admins can reach this destination. */
	instanceAdminOnly?: boolean;
	/**
	 * The destination lives elsewhere now. It never renders inside Settings;
	 * `settingsTabRedirect` sends visitors to its current home.
	 */
	moved?: boolean;
}

const settingsDestinationDefinitions = [
	{
		id: 'profile',
		group: 'you',
		label: m.settings_profile,
		loadingVariant: 'profile',
		aliases: ['account']
	},
	{
		id: 'notifications',
		group: 'you',
		label: m.notifications_settings,
		loadingVariant: 'cards'
	},
	{
		id: 'security',
		group: 'you',
		label: m.settings_security,
		loadingVariant: 'cards'
	},
	{
		id: 'developer',
		group: 'you',
		label: m.settings_developer,
		loadingVariant: 'list',
		aliases: ['tokens']
	},
	{
		id: 'general',
		group: 'workspace',
		label: m.settings_general,
		loadingVariant: 'form',
		aliases: ['workspace', 'media']
	},
	{
		id: 'brand',
		group: 'workspace',
		label: m.settings_brand,
		loadingVariant: 'form',
		aliases: ['app-branding']
	},
	{
		id: 'schedule',
		group: 'workspace',
		label: m.settings_schedule,
		loadingVariant: 'list'
	},
	{
		id: 'members',
		group: 'workspace',
		label: m.settings_members,
		title: m.settings_team_members,
		loadingVariant: 'cards',
		aliases: ['team']
	},
	{
		id: 'plan',
		group: 'plan',
		label: m.settings_plan,
		loadingVariant: 'cards',
		aliases: ['billing', 'organization']
	},
	{
		id: 'appearance',
		group: 'advanced',
		label: m.settings_appearance,
		loadingVariant: 'cards'
	},
	{
		id: 'sso',
		group: 'advanced',
		label: m.settings_sso,
		loadingVariant: 'cards'
	},
	{
		id: 'audit',
		group: 'advanced',
		label: m.settings_audit_title,
		loadingVariant: 'cards'
	},
	{
		id: 'ownership',
		group: 'advanced',
		label: m.settings_ownership_heading,
		loadingVariant: 'form'
	},
	{
		id: 'instance',
		group: 'advanced',
		label: m.settings_instance,
		loadingVariant: 'list',
		instanceAdminOnly: true
	},
	{
		id: 'configuration',
		group: 'advanced',
		label: m.settings_configuration,
		loadingVariant: 'list',
		instanceAdminOnly: true
	},
	{
		id: 'ai-prompts',
		group: 'advanced',
		label: m.settings_ai_prompts,
		loadingVariant: 'form',
		instanceAdminOnly: true
	},
	{
		id: 'users',
		group: 'advanced',
		label: m.settings_instance_users,
		loadingVariant: 'list',
		instanceAdminOnly: true
	},
	{
		id: 'instance-audit',
		group: 'advanced',
		label: m.settings_instance_audit_title,
		loadingVariant: 'form',
		instanceAdminOnly: true
	},
	// Destinations that moved out of Settings. They stay addressable so old
	// `?tab=` URLs and aliases keep resolving, then redirect.
	{
		id: 'app-branding',
		group: 'workspace',
		label: m.app_branding_title,
		loadingVariant: 'form',
		moved: true
	},
	{
		id: 'accounts',
		group: 'workspace',
		label: m.accounts_heading,
		loadingVariant: 'list',
		aliases: ['social-accounts'],
		moved: true
	},
	{
		id: 'reposts',
		group: 'workspace',
		label: m.settings_reposts,
		loadingVariant: 'list',
		moved: true
	}
] as const satisfies readonly SettingsDestinationDefinition[];

export type SettingsTabID = (typeof settingsDestinationDefinitions)[number]['id'];
export type SettingsDestinationID = SettingsTabID;
type DeclaredSettingsDestination = (typeof settingsDestinationDefinitions)[number];

export interface SettingsDestination {
	id: SettingsDestinationID;
	group: SettingsDestinationGroup;
	label: string;
	title: string;
	loadingVariant: SettingsLoadingVariant;
}

export function getSettingsDestinations(
	includeInstance: boolean,
	_context: SettingsDestinationContext = {},
	includeHostedBilling = true
): SettingsDestination[] {
	return settingsDestinationDefinitions
		.filter(
			(destination) =>
				!('moved' in destination && destination.moved) &&
				(includeInstance ||
					!('instanceAdminOnly' in destination && destination.instanceAdminOnly)) &&
				(includeHostedBilling || destination.id !== 'plan')
		)
		.map((destination) => resolveSettingsDestination(destination));
}

export function getSettingsDestination(id: SettingsDestinationID): SettingsDestination {
	const destination = settingsDestinationDefinitions.find((candidate) => candidate.id === id);
	if (!destination) throw new Error(`Unknown settings destination: ${id}`);
	return resolveSettingsDestination(destination);
}

export function normalizeSettingsTab(
	value: string | null,
	includeInstance: boolean,
	includeHostedBilling = true
): SettingsTabID {
	if (!value) return 'general';
	const destination = settingsDestinationDefinitions.find((candidate) => {
		const aliases: readonly string[] = 'aliases' in candidate ? candidate.aliases : [];
		return candidate.id === value || aliases.includes(value);
	});
	if (
		!destination ||
		(!includeInstance && 'instanceAdminOnly' in destination && destination.instanceAdminOnly)
	)
		return 'general';
	if (!includeHostedBilling && destination.id === 'plan') return 'general';
	return destination.id;
}

/**
 * Where a moved destination now lives, or null when the tab renders in
 * Settings. Query parameters survive the move so deep links and OAuth
 * callbacks keep working.
 */
export function settingsTabRedirect(id: SettingsDestinationID, url: URL): string | null {
	if (id === 'accounts') {
		const params = new URLSearchParams(url.searchParams);
		params.delete('tab');
		const search = params.toString();
		return `/accounts${search ? `?${search}` : ''}${url.hash}`;
	}
	if (id === 'reposts') return '/workflows/reposts';
	return null;
}

function resolveSettingsDestination(destination: DeclaredSettingsDestination): SettingsDestination {
	const label = destination.label();
	return {
		id: destination.id,
		group: destination.group,
		label,
		title: 'title' in destination ? destination.title() : label,
		loadingVariant: destination.loadingVariant
	};
}
