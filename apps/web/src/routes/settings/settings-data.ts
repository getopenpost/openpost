import { planCatalog } from '@openpost/plan-catalog';
import type { components } from '$lib/api/types';

export interface TimezoneOption {
	group: string;
	value: string;
	label: string;
}

const timezoneLabels = new Map<string, string>();

function timezoneLabel(value: string, locale?: string): string {
	const key = `${locale ?? ''}|${value}`;
	let label = timezoneLabels.get(key);
	if (label === undefined) {
		label = formatTimezoneLabel(value, locale);
		timezoneLabels.set(key, label);
	}
	return label;
}

function formatTimezoneLabel(value: string, locale?: string): string {
	const place = value.includes('/')
		? value
				.slice(value.indexOf('/') + 1)
				.replaceAll('_', ' ')
				.replaceAll('/', ' / ')
		: value;
	try {
		const name = new Intl.DateTimeFormat(locale, { timeZone: value, timeZoneName: 'longGeneric' })
			.formatToParts(0)
			.find((part) => part.type === 'timeZoneName')?.value;
		return name && name !== place ? `${place} (${name})` : place;
	} catch {
		return place;
	}
}

function canonicalTimezone(value: string): string {
	try {
		return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
	} catch {
		return value;
	}
}

/**
 * Lists every IANA zone the browser supports, grouped by region. The server accepts any IANA
 * zone, so a fixed list would hide valid choices. Engines may list an alias of the stored zone
 * (for example Asia/Calcutta for Asia/Kolkata); the stored value replaces that alias so it stays
 * selected, and an unknown stored value is kept as its own option.
 */
export function timezoneOptions(current = '', locale?: string): TimezoneOption[] {
	let zones: string[] = [];
	try {
		zones = Intl.supportedValuesOf('timeZone');
	} catch {
		zones = [];
	}
	if (current && !zones.includes(current)) {
		const alias = canonicalTimezone(current);
		const index = zones.indexOf(alias);
		zones = [...zones];
		if (index >= 0) zones[index] = current;
		else zones.push(current);
	}
	return [...new Set(['UTC', ...zones])].map((value) => ({
		group: value.includes('/') ? value.slice(0, value.indexOf('/')) : 'UTC',
		value,
		label: value === 'UTC' ? 'UTC' : timezoneLabel(value, locale)
	}));
}

export const inviteRoleOptions = ['editor', 'viewer', 'admin'] as const;

export type APITokenScope = NonNullable<components['schemas']['CreateAPITokenInputBody']['scope']>;

export const apiTokenScopeOptions = [
	'api:read',
	'api:write',
	'mcp:read',
	'mcp:full',
	'cli:full'
] as const satisfies readonly APITokenScope[];
const apiTokenScopes = new Set<string>(apiTokenScopeOptions);

export function isAPITokenScope(value: string): value is APITokenScope {
	return apiTokenScopes.has(value);
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
	const body: components['schemas']['UpdateProfileInputBody'] = {
		display_name: input.displayName,
		username: input.username
	};
	if (input.publicProfilesAvailable === true) {
		body.public_profile_enabled = input.publicProfileEnabled;
		body.public_profile_visible_fields = input.publicProfileVisibleFields;
	}
	return body;
}

export const billingPlans = planCatalog.plans.map((plan) => ({
	id: plan.id,
	monthlyPriceUSD: plan.monthly_price_usd,
	workspaces: plan.limits.workspaces,
	featured: plan.featured,
	limits: [
		{ kind: 'social_accounts', count: plan.limits.social_accounts },
		{ kind: 'scheduled_posts_monthly', count: plan.limits.scheduled_posts_monthly },
		{ kind: 'media_gb', count: plan.limits.media_bytes_stored / 1_000_000_000 },
		{ kind: 'included_seats', count: plan.limits.team_members }
	] as const
}));

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

export function getTimezoneLabel(value: string, locale?: string): string {
	return value === 'UTC' ? value : timezoneLabel(value, locale);
}
