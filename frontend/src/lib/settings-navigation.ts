import { m } from '$lib/paraglide/messages';

export type SettingsDestinationGroup = 'personal' | 'workspace' | 'organization' | 'instance';
export type SettingsLoadingVariant = 'profile' | 'cards' | 'list' | 'form';

interface SettingsDestinationContext {
	workspaceName?: string;
}

interface SettingsDestinationDefinition {
	id: string;
	group: SettingsDestinationGroup;
	label: () => string;
	title?: () => string;
	description: (context: SettingsDestinationContext) => string;
	loadingVariant: SettingsLoadingVariant;
	aliases?: readonly string[];
}

const settingsDestinationDefinitions = [
	{
		id: 'profile',
		group: 'personal',
		label: m.settings_profile,
		description: m.settings_profile_description,
		loadingVariant: 'profile',
		aliases: ['account']
	},
	{
		id: 'notifications',
		group: 'personal',
		label: m.notifications_settings,
		description: m.notifications_settings_description,
		loadingVariant: 'cards'
	},
	{
		id: 'security',
		group: 'personal',
		label: m.settings_security,
		description: m.settings_account_security_body,
		loadingVariant: 'cards'
	},
	{
		id: 'developer',
		group: 'personal',
		label: m.settings_developer,
		description: m.settings_developer_description,
		loadingVariant: 'list',
		aliases: ['tokens']
	},
	{
		id: 'general',
		group: 'workspace',
		label: m.settings_general,
		description: ({ workspaceName }: SettingsDestinationContext) =>
			m.settings_general_description({ workspace: workspaceName || m.settings_workspace() }),
		loadingVariant: 'form',
		aliases: ['workspace', 'media']
	},
	{
		id: 'brand',
		group: 'workspace',
		label: m.media_brand,
		description: m.media_brand_description,
		loadingVariant: 'form'
	},
	{
		id: 'accounts',
		group: 'workspace',
		label: m.accounts_heading,
		description: m.accounts_description,
		loadingVariant: 'list',
		aliases: ['social-accounts']
	},
	{
		id: 'reposts',
		group: 'workspace',
		label: m.settings_reposts,
		description: m.settings_reposts_description,
		loadingVariant: 'list'
	},
	{
		id: 'schedule',
		group: 'workspace',
		label: m.settings_schedule,
		description: m.settings_schedule_description,
		loadingVariant: 'list'
	},
	{
		id: 'members',
		group: 'workspace',
		label: m.settings_members,
		title: m.settings_team_members,
		description: m.settings_members_description,
		loadingVariant: 'cards',
		aliases: ['team']
	},
	{
		id: 'plan',
		group: 'organization',
		label: m.settings_plan,
		description: m.settings_plan_description,
		loadingVariant: 'cards',
		aliases: ['billing', 'organization']
	},
	{
		id: 'sso',
		group: 'organization',
		label: m.settings_sso,
		description: m.settings_sso_description,
		loadingVariant: 'cards'
	},
	{
		id: 'audit',
		group: 'organization',
		label: m.settings_audit_title,
		description: m.settings_audit_description,
		loadingVariant: 'cards'
	},
	{
		id: 'ownership',
		group: 'organization',
		label: m.settings_ownership_heading,
		description: m.settings_ownership_body,
		loadingVariant: 'form'
	},
	{
		id: 'instance',
		group: 'instance',
		label: m.settings_instance,
		description: m.settings_instance_description,
		loadingVariant: 'list'
	},
	{
		id: 'configuration',
		group: 'instance',
		label: m.settings_configuration,
		description: m.settings_configuration_description,
		loadingVariant: 'list'
	},
	{
		id: 'ai-prompts',
		group: 'instance',
		label: m.settings_ai_prompts,
		description: m.settings_ai_prompts_description,
		loadingVariant: 'form'
	},
	{
		id: 'users',
		group: 'instance',
		label: m.settings_instance_users,
		description: m.settings_instance_users_page_description,
		loadingVariant: 'list'
	},
	{
		id: 'instance-audit',
		group: 'instance',
		label: m.settings_instance_audit_title,
		description: m.settings_instance_audit_description,
		loadingVariant: 'form'
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
	description: string;
	loadingVariant: SettingsLoadingVariant;
}

export const settingsTabIDs: readonly SettingsTabID[] = settingsDestinationDefinitions.map(
	(destination) => destination.id
);

export function getSettingsDestinations(
	includeInstance: boolean,
	context: SettingsDestinationContext = {}
): SettingsDestination[] {
	return settingsDestinationDefinitions
		.filter((destination) => includeInstance || destination.group !== 'instance')
		.map((destination) => resolveSettingsDestination(destination, context));
}

export function getSettingsDestination(
	id: SettingsDestinationID,
	context: SettingsDestinationContext = {}
): SettingsDestination {
	const destination = settingsDestinationDefinitions.find((candidate) => candidate.id === id);
	if (!destination) throw new Error(`Unknown settings destination: ${id}`);
	return resolveSettingsDestination(destination, context);
}

export function normalizeSettingsTab(
	value: string | null,
	includeInstance: boolean
): SettingsTabID {
	if (!value) return 'general';
	const destination = settingsDestinationDefinitions.find((candidate) => {
		const aliases: readonly string[] = 'aliases' in candidate ? candidate.aliases : [];
		return candidate.id === value || aliases.includes(value);
	});
	if (!destination || (!includeInstance && destination.group === 'instance')) return 'general';
	return destination.id;
}

function resolveSettingsDestination(
	destination: DeclaredSettingsDestination,
	context: SettingsDestinationContext
): SettingsDestination {
	const label = destination.label();
	return {
		id: destination.id,
		group: destination.group,
		label,
		title: 'title' in destination ? destination.title() : label,
		description: destination.description(context),
		loadingVariant: destination.loadingVariant
	};
}
