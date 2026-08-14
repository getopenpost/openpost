import type { components } from '$lib/api/types';

export const timezones = [
	{ group: 'Americas', value: 'America/New_York', label: 'New York (ET)' },
	{ group: 'Americas', value: 'America/Chicago', label: 'Chicago (CT)' },
	{ group: 'Americas', value: 'America/Denver', label: 'Denver (MT)' },
	{ group: 'Americas', value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
	{ group: 'Americas', value: 'America/Phoenix', label: 'Phoenix (AZ)' },
	{ group: 'Americas', value: 'America/Anchorage', label: 'Anchorage (AK)' },
	{ group: 'Americas', value: 'Pacific/Honolulu', label: 'Honolulu (HI)' },
	{ group: 'Americas', value: 'America/Toronto', label: 'Toronto (ET)' },
	{ group: 'Americas', value: 'America/Vancouver', label: 'Vancouver (PT)' },
	{ group: 'Americas', value: 'America/Mexico_City', label: 'Mexico City (CT)' },
	{ group: 'Americas', value: 'America/Bogota', label: 'Bogota' },
	{ group: 'Americas', value: 'America/Lima', label: 'Lima' },
	{ group: 'Americas', value: 'America/Santiago', label: 'Santiago' },
	{ group: 'Americas', value: 'America/Sao_Paulo', label: 'Sao Paulo' },
	{ group: 'Americas', value: 'America/Buenos_Aires', label: 'Buenos Aires' },
	{ group: 'Europe', value: 'UTC', label: 'UTC' },
	{ group: 'Europe', value: 'Europe/London', label: 'London (GMT/BST)' },
	{ group: 'Europe', value: 'Europe/Dublin', label: 'Dublin (GMT/IST)' },
	{ group: 'Europe', value: 'Europe/Lisbon', label: 'Lisbon (WET/WEST)' },
	{ group: 'Europe', value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Brussels', label: 'Brussels (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Vienna', label: 'Vienna (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Zurich', label: 'Zurich (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Stockholm', label: 'Stockholm (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Oslo', label: 'Oslo (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Copenhagen', label: 'Copenhagen (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Helsinki', label: 'Helsinki (EET/EEST)' },
	{ group: 'Europe', value: 'Europe/Warsaw', label: 'Warsaw (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Prague', label: 'Prague (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Budapest', label: 'Budapest (CET/CEST)' },
	{ group: 'Europe', value: 'Europe/Athens', label: 'Athens (EET/EEST)' },
	{ group: 'Europe', value: 'Europe/Bucharest', label: 'Bucharest (EET/EEST)' },
	{ group: 'Europe', value: 'Europe/Kiev', label: 'Kiev (EET/EEST)' },
	{ group: 'Europe', value: 'Europe/Moscow', label: 'Moscow (MSK)' },
	{ group: 'Europe', value: 'Europe/Istanbul', label: 'Istanbul (TRT)' },
	{ group: 'Asia', value: 'Asia/Dubai', label: 'Dubai (GST)' },
	{ group: 'Asia', value: 'Asia/Riyadh', label: 'Riyadh (AST)' },
	{ group: 'Asia', value: 'Asia/Tehran', label: 'Tehran (IRST/IRDT)' },
	{ group: 'Asia', value: 'Asia/Kolkata', label: 'Mumbai/Delhi (IST)' },
	{ group: 'Asia', value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
	{ group: 'Asia', value: 'Asia/Jakarta', label: 'Jakarta (WIB)' },
	{ group: 'Asia', value: 'Asia/Singapore', label: 'Singapore (SGT)' },
	{ group: 'Asia', value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
	{ group: 'Asia', value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
	{ group: 'Asia', value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
	{ group: 'Asia', value: 'Asia/Seoul', label: 'Seoul (KST)' },
	{ group: 'Asia', value: 'Asia/Manila', label: 'Manila (PHT)' },
	{ group: 'Asia', value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT)' },
	{ group: 'Pacific', value: 'Australia/Perth', label: 'Perth (AWST)' },
	{ group: 'Pacific', value: 'Australia/Eucla', label: 'Eucla (AWST+)' },
	{ group: 'Pacific', value: 'Australia/Adelaide', label: 'Adelaide (ACST)' },
	{ group: 'Pacific', value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
	{ group: 'Pacific', value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
	{ group: 'Pacific', value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
	{ group: 'Pacific', value: 'Pacific/Fiji', label: 'Fiji (FJT/FJST)' },
	{ group: 'Africa', value: 'Africa/Cairo', label: 'Cairo (EET)' },
	{ group: 'Africa', value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
	{ group: 'Africa', value: 'Africa/Lagos', label: 'Lagos (WAT)' },
	{ group: 'Africa', value: 'Africa/Nairobi', label: 'Nairobi (EAT)' }
];

export const inviteRoleOptions = ['editor', 'viewer', 'admin'] as const;

export type APITokenScope = NonNullable<components['schemas']['CreateAPITokenInputBody']['scope']>;

export const apiTokenScopeOptions = [
	'api:read',
	'api:write',
	'mcp:read',
	'mcp:full',
	'cli:full'
] as const satisfies readonly APITokenScope[];

export function isAPITokenScope(value: string): value is APITokenScope {
	return (apiTokenScopeOptions as readonly string[]).includes(value);
}

export type APITokenExpiryPreset = '30' | '90' | '365' | 'custom';

const dayMilliseconds = 24 * 60 * 60 * 1000;

export function apiTokenCustomExpiryMin(now = new Date()) {
	return new Date(now.getTime() + dayMilliseconds).toISOString().slice(0, 10);
}

export function apiTokenCustomExpiryMax(now = new Date()) {
	// Custom dates are submitted at the end of the selected UTC day. Keeping
	// the picker one day inside the server's 365-day limit makes its last
	// selectable date valid at every time of day. The exact 365-day preset
	// remains available separately.
	return new Date(now.getTime() + 364 * dayMilliseconds).toISOString().slice(0, 10);
}

export function apiTokenExpiresAt(
	preset: APITokenExpiryPreset,
	customExpiry: string,
	now = new Date()
) {
	if (preset === 'custom') {
		if (!customExpiry) return '';
		return new Date(`${customExpiry}T23:59:59.000Z`).toISOString();
	}
	return new Date(now.getTime() + Number(preset) * dayMilliseconds).toISOString();
}

export function buildProfileUpdateBody(input: {
	displayName: string;
	username: string;
	publicProfilesAvailable: boolean | null;
	publicProfileEnabled: boolean;
	publicProfileVisibleFields: string[];
}) {
	return {
		display_name: input.displayName,
		username: input.username,
		...(input.publicProfilesAvailable === true
			? {
					public_profile_enabled: input.publicProfileEnabled,
					public_profile_visible_fields: input.publicProfileVisibleFields
				}
			: {})
	};
}

export const billingPlans = [
	{
		id: 'starter',
		monthlyPriceUSD: 15,
		featured: false,
		limits: [
			{ kind: 'workspaces', count: 1 },
			{ kind: 'social_accounts', count: 3 },
			{ kind: 'scheduled_posts_monthly', count: 100 },
			{ kind: 'media_gb', count: 1 }
		]
	},
	{
		id: 'founder',
		monthlyPriceUSD: 25,
		limits: [
			{ kind: 'workspaces', count: 3 },
			{ kind: 'social_accounts', count: 6 },
			{ kind: 'scheduled_posts_monthly', count: 500 },
			{ kind: 'media_gb', count: 5 }
		],
		featured: true
	},
	{
		id: 'pro',
		monthlyPriceUSD: 49,
		featured: false,
		limits: [
			{ kind: 'workspaces', count: 10 },
			{ kind: 'social_accounts', count: 15 },
			{ kind: 'scheduled_posts_monthly', count: 2500 },
			{ kind: 'media_gb', count: 25 }
		]
	},
	{
		id: 'team',
		monthlyPriceUSD: 99,
		featured: false,
		limits: [
			{ kind: 'workspaces', count: 10 },
			{ kind: 'social_accounts', count: 25 },
			{ kind: 'scheduled_posts_monthly', count: 5000 },
			{ kind: 'included_seats', count: 3 }
		]
	},
	{
		id: 'agency',
		monthlyPriceUSD: 199,
		featured: false,
		limits: [
			{ kind: 'workspaces', count: 50 },
			{ kind: 'social_accounts', count: 150 },
			{ kind: 'scheduled_posts_monthly', count: 25000 },
			{ kind: 'included_seats', count: 5 }
		]
	}
] as const;

export type SecurityStatus = components['schemas']['SecurityStatusOutputBody'];

export interface OIDCIdentitySummary {
	id: string;
	provider_id: string;
	provider_name: string;
	linked_email?: string;
	linked_name?: string;
	active: boolean;
	created_at: string;
	last_login_at?: string;
}

export function activeReauthProviderID(identities: OIDCIdentitySummary[]): string {
	return identities.find((identity) => identity.active)?.provider_id ?? '';
}

export interface OIDCProviderSummary {
	id: string;
	name: string;
	kind: 'oauth' | 'sso';
	organization?: string;
	start_url: string;
}

export interface AuthSessionSummary {
	id: string;
	user_agent: string;
	device_name?: string;
	ip_address: string;
	current: boolean;
	expires_at: string;
	last_used_at: string;
	created_at: string;
}

export interface EmailChangeSummary {
	id: string;
	new_email: string;
	expires_at: string;
	sent_at?: string;
}

export interface APITokenSummary {
	id: string;
	name: string;
	token_prefix: string;
	scope: string;
	workspace_id?: string;
	expires_at?: string | null;
	last_used_at?: string | null;
	revoked_at?: string | null;
	created_at: string;
	status: 'active' | 'expired' | 'revoked';
}

export interface MCPActivityItem {
	id: string;
	workspace_id?: string;
	client_id?: string;
	client_name?: string;
	client_scope?: string;
	client_token_prefix?: string;
	tool_name: string;
	status: string;
	error_message?: string;
	duration_ms: number;
	created_at: string;
}

export type ProviderCostSummary = components['schemas']['ProviderCostSummary'];
export type UpdateStatus = components['schemas']['UpdateStatusResponse'];

export interface BillingStatus {
	organization_id: string;
	workspace_id: string;
	provider?: string;
	billing_contact_email?: string;
	status: string;
	plan_id?: string;
	current_period_end?: string;
	can_manage_billing: boolean;
	access_restricted: boolean;
	past_due_since?: string;
	cancel_at_period_end: boolean;
	limits?: Record<string, number>;
	usage?: Record<string, number>;
	period_start?: string;
	provider_costs: ProviderCostSummary[] | null;
}

export interface TeamMember {
	user_id: string;
	email: string;
	role: string;
	status: 'active' | 'inactive';
	created_at: string;
	updated_at: string;
	deactivated_at?: string;
}

export type WorkspaceInvitation = components['schemas']['WorkspaceInvitationResponse'];

export interface WorkspaceTeam {
	members: TeamMember[];
	invitations: WorkspaceInvitation[];
	current_seats: number;
	can_manage: boolean;
}

export interface WorkspaceAccessAuditEvent {
	id: string;
	workspace_id: string;
	actor_user_id?: string;
	subject_user_id?: string;
	invitation_id?: string;
	subject_email?: string;
	action: string;
	previous_role?: string;
	role?: string;
	previous_status?: string;
	status?: string;
	created_at: string;
}

export interface PostingSchedule {
	id: string;
	workspace_id: string;
	utc_hour: number;
	utc_minute: number;
	day_of_week: number;
	local_hour: number;
	local_minute: number;
	local_day_of_week: number;
	label?: string;
	is_active: boolean;
	created_at: string;
}

export interface ScheduleRow {
	key: string;
	local_hour: number;
	local_minute: number;
	label: string;
	days: Record<number, PostingSchedule | undefined>;
}

export function getTimezoneLabel(value: string): string {
	return timezones.find((timezone) => timezone.value === value)?.label ?? value;
}
