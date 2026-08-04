<script lang="ts">
	import { page } from '$app/state';
	import { WorkspaceContextError, workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PageContainer from '$lib/components/page-container.svelte';
	import SettingsNavigation from '$lib/components/settings-navigation.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import InstanceAdminOverview from '$lib/components/instance-admin-overview.svelte';
	import InstanceConfiguration from '$lib/components/instance-configuration.svelte';
	import InstanceAdminUsers from '$lib/components/instance-admin-users.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import ProfileAvatarUploader from '$lib/components/profile-avatar-uploader.svelte';
	import AccountDataCard from '$lib/components/account-data-card.svelte';
	import OrganizationSSOSettings from '$lib/components/organization-sso-settings.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import MediaPreviewImage from '$lib/components/media-preview-image.svelte';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import BrandKitEditor from '$lib/studio/components/brand-kit-editor.svelte';
	import StudioColorPicker from '$lib/studio/components/studio-color-picker.svelte';
	import AccountsPage from '../accounts/+page.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import type { SettingsTabID } from '$lib/settings-navigation';
	import { loadStudioBrandKit } from '$lib/studio/api';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import type { StudioBrandKit } from '$lib/studio/types';
	import { createPasskeyCredential } from '$lib/auth/webauthn';
	import { acquireReauthGrant, startOIDCIdentityLink } from '$lib/auth/reauth';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import SettingsIcon from 'lucide-svelte/icons/settings';
	import ClockIcon from 'lucide-svelte/icons/clock';
	import ImageIcon from 'lucide-svelte/icons/image';
	import CalendarIcon from 'lucide-svelte/icons/calendar';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import TrashIcon from 'lucide-svelte/icons/trash';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';
	import SmartphoneIcon from 'lucide-svelte/icons/smartphone';
	import KeyRoundIcon from 'lucide-svelte/icons/key-round';
	import TerminalIcon from 'lucide-svelte/icons/terminal';
	import CreditCardIcon from 'lucide-svelte/icons/credit-card';
	import ExternalLinkIcon from 'lucide-svelte/icons/external-link';
	import ActivityIcon from 'lucide-svelte/icons/activity';
	import UsersIcon from 'lucide-svelte/icons/users';
	import UserPlusIcon from 'lucide-svelte/icons/user-plus';
	import CopyIcon from 'lucide-svelte/icons/copy';
	import MonitorIcon from 'lucide-svelte/icons/monitor';
	import LogOutIcon from 'lucide-svelte/icons/log-out';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import AlertCircleIcon from 'lucide-svelte/icons/alert-circle';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import ServerCogIcon from 'lucide-svelte/icons/server-cog';
	import { client } from '$lib/api/client';
	import { showToast } from '$lib/toast';
	import { getLocaleTag } from '$lib/i18n';
	import { checkoutPathForPlan, hostedPlanFromSearchParams } from '$lib/billing';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import {
		apiTokenScopeOptions as apiTokenScopes,
		billingPlans as billingPlanDefinitions,
		cleanupDaysOptions as cleanupDayValues,
		getTimezoneLabel,
		inviteRoleOptions as inviteRoles,
		timezones,
		type APITokenSummary,
		type AuthSessionSummary,
		type BillingStatus,
		type MCPActivityItem,
		type OIDCIdentitySummary,
		type OIDCProviderSummary,
		type PostingSchedule,
		type ProviderCostSummary,
		type ScheduleRow,
		type SecurityStatus,
		type UpdateStatus,
		type WorkspaceInvitation,
		type WorkspaceTeam
	} from './settings-data';

	type SettingsDestructiveAction =
		| { kind: 'invitation'; invitationID: string }
		| { kind: 'session'; session: AuthSessionSummary }
		| { kind: 'api-token'; tokenID: string }
		| { kind: 'time-row'; row: ScheduleRow }
		| { kind: 'workspace' };

	const groupedTimezones = $derived.by(() => {
		const groups: Record<string, typeof timezones> = {};
		for (const tz of timezones) {
			if (!groups[tz.group]) groups[tz.group] = [];
			groups[tz.group].push(tz);
		}
		return groups;
	});

	let saving = $state(false);
	const unsavedChanges = getOptionalUnsavedChanges();
	let profileDisplayName = $state('');
	let profileUsername = $state('');
	let profilePublic = $state(false);
	let profileBusy = $state(false);
	let profileError = $state('');
	let avatarUploaderOpen = $state(false);
	let loadingSecurity = $state(true);
	let securityBusy = $state(false);
	let securityError = $state('');
	let authSessions = $state.raw<AuthSessionSummary[]>([]);
	let authSessionsLoading = $state(true);
	let authSessionsError = $state('');
	let authSessionBusyID = $state('');
	let totpCurrentPassword = $state('');
	let passkeyCurrentPassword = $state('');
	let totpSetupChallengeId = $state('');
	let totpManualEntryKey = $state('');
	let totpQRCodeDataURL = $state('');
	let totpCode = $state('');
	let newPasskeyName = $state('');

	let securityStatus = $state<SecurityStatus | null>(null);
	let linkedIdentities = $state.raw<OIDCIdentitySummary[]>([]);
	let linkableProviders = $state.raw<OIDCProviderSummary[]>([]);
	let identityPassword = $state('');
	let identityBusy = $state('');
	let apiTokens = $state<APITokenSummary[]>([]);
	let apiTokensLoading = $state(true);
	let apiTokensLoadError = $state('');
	let apiTokenError = $state('');
	let mcpActivity = $state.raw<MCPActivityItem[]>([]);
	let mcpActivityLoading = $state(true);
	let mcpActivityError = $state('');
	let apiTokenBusy = $state(false);
	let apiTokenName = $state('OpenPost MCP');
	let apiTokenScope = $state('mcp:read');
	let apiTokenWorkspaceScope = $state('current');
	let savedAPITokenDraft = $state(
		JSON.stringify({ name: 'OpenPost MCP', scope: 'mcp:read', workspace: 'current' })
	);
	let createdAPIToken = $state('');
	let billingBusyPlan = $state('');
	let billingPortalBusy = $state(false);
	let billingError = $state('');
	let billingLoadError = $state('');
	let billingStatusLoading = $state(false);
	let billingStatus = $state<BillingStatus | null>(null);
	let updateStatus = $state.raw<UpdateStatus | null>(null);
	let updateStatusLoading = $state(false);
	let updateStatusError = $state('');
	let handledCheckoutPlan = '';
	let teamLoading = $state(false);
	let teamBusy = $state(false);
	let teamError = $state('');
	let teamLoadError = $state('');
	let workspaceTeam = $state<WorkspaceTeam | null>(null);
	let brandKit = $state.raw<StudioBrandKit | null>(null);
	let brandLoading = $state(false);
	let brandError = $state('');
	let inviteEmail = $state('');
	let inviteRole = $state<'viewer' | 'editor' | 'admin'>('editor');
	let createdInviteURL = $state('');
	let loadedBillingWorkspaceID = '';
	let loadedTeamWorkspaceID = '';
	let loadedScheduleWorkspaceID = '';
	let loadedBrandWorkspaceID = '';
	let loadedSecurityUserID = '';
	let loadedUpdateStatusUserID = '';
	let loadedAPITokensUserID = '';
	let apiTokensRequestUserID = '';
	let loadedMCPActivityUserID = '';
	let billingRequestSequence = 0;
	let teamRequestSequence = 0;
	let scheduleRequestSequence = 0;
	let brandRequestSequence = 0;
	let apiTokensRequestSequence = 0;
	let destructiveDialogOpen = $state(false);
	let destructiveAction = $state.raw<SettingsDestructiveAction | null>(null);
	let workspaceImagePickerOpen = $state(false);

	function notify(message: string, tone: 'success' | 'error' = 'success') {
		showToast(message, tone);
	}

	function requestDestructiveAction(action: SettingsDestructiveAction) {
		destructiveAction = action;
		destructiveDialogOpen = true;
	}

	function destructiveActionTitle() {
		if (destructiveAction?.kind === 'invitation') return m.settings_revoke_invitation_title();
		if (destructiveAction?.kind === 'session') {
			return destructiveAction.session.current
				? m.settings_sign_out_session_title()
				: m.settings_revoke_session_title();
		}
		if (destructiveAction?.kind === 'api-token') return m.settings_revoke_token_title();
		if (destructiveAction?.kind === 'time-row') {
			return m.settings_remove_time_title({
				time: formatTime(destructiveAction.row.local_hour, destructiveAction.row.local_minute)
			});
		}
		if (destructiveAction?.kind === 'workspace') return m.workspace_delete_title();
		return '';
	}

	function destructiveActionDescription() {
		if (destructiveAction?.kind === 'invitation') return m.settings_revoke_invitation_body();
		if (destructiveAction?.kind === 'session') {
			return destructiveAction.session.current
				? m.settings_sign_out_session_body()
				: m.settings_revoke_session_body();
		}
		if (destructiveAction?.kind === 'api-token') return m.settings_revoke_token_body();
		if (destructiveAction?.kind === 'time-row') return m.settings_remove_time_body();
		if (destructiveAction?.kind === 'workspace') return m.workspace_delete_description();
		return '';
	}

	function destructiveActionConfirmLabel() {
		if (destructiveAction?.kind === 'session' && destructiveAction.session.current) {
			return m.settings_sign_out();
		}
		if (destructiveAction?.kind === 'time-row') return m.settings_remove();
		if (destructiveAction?.kind === 'workspace') return m.workspace_delete_confirm();
		return m.settings_revoke();
	}

	async function confirmDestructiveAction() {
		const action = destructiveAction;
		if (!action) return;
		if (action.kind === 'invitation') {
			await revokeWorkspaceInvitation(action.invitationID);
			return;
		}
		if (action.kind === 'session') {
			await revokeAuthSession(action.session);
			return;
		}
		if (action.kind === 'api-token') {
			await revokeAPIToken(action.tokenID);
			return;
		}
		if (action.kind === 'time-row') {
			await removeTimeRow(action.row);
			return;
		}
		await deleteCurrentWorkspace();
	}

	async function deleteCurrentWorkspace() {
		const workspace = workspaceCtx.currentWorkspace;
		if (!workspace) return;
		try {
			await workspaceCtx.deleteWorkspace(workspace.id);
			notify(m.workspace_delete_success(), 'success');
			await goto(resolve('/'));
		} catch (cause) {
			notify(m.workspace_delete_failed(), 'error');
			console.error('Failed to delete workspace:', cause);
		}
	}

	function isCurrentWorkspace(workspaceID: string) {
		return workspaceCtx.currentWorkspace?.id === workspaceID;
	}

	function isCurrentBillingTarget(workspaceID: string, organizationID: string) {
		return (
			isCurrentWorkspace(workspaceID) &&
			(workspaceCtx.currentWorkspace?.organization_id ?? '') === organizationID
		);
	}

	function cleanupDaysLabel(value: number) {
		if (value === 0) return m.settings_disabled();
		if (value === 365) return m.settings_cleanup_one_year();
		return m.settings_cleanup_days({ count: value });
	}

	function roleLabel(value: string) {
		if (value === 'editor') return m.settings_role_editor();
		if (value === 'viewer') return m.settings_role_viewer();
		if (value === 'admin') return m.settings_role_admin();
		return value;
	}

	function roleDescription(value: string) {
		if (value === 'editor') return m.settings_role_editor_description();
		if (value === 'viewer') return m.settings_role_viewer_description();
		if (value === 'admin') return m.settings_role_admin_description();
		return '';
	}

	function apiTokenScopeLabel(value: string) {
		if (value === 'mcp:read') return m.settings_token_scope_mcp_read();
		if (value === 'mcp:full') return m.settings_token_scope_mcp();
		if (value === 'cli:full') return m.settings_token_scope_cli();
		return value;
	}

	function apiTokenScopeDescription(value: string) {
		if (value === 'mcp:read') return m.settings_token_scope_mcp_read_description();
		if (value === 'mcp:full') return m.settings_token_scope_mcp_description();
		if (value === 'cli:full') return m.settings_token_scope_cli_description();
		return '';
	}

	function billingPlanName(planID: string) {
		if (planID === 'starter') return m.settings_plan_starter();
		if (planID === 'creator') return m.settings_plan_creator();
		if (planID === 'pro') return m.settings_plan_pro();
		if (planID === 'team') return m.settings_plan_team();
		if (planID === 'agency') return m.settings_plan_agency();
		return planID;
	}

	function billingPlanDescription(planID: string) {
		if (planID === 'starter') return m.settings_plan_starter_description();
		if (planID === 'creator') return m.settings_plan_creator_description();
		if (planID === 'pro') return m.settings_plan_pro_description();
		if (planID === 'team') return m.settings_plan_team_description();
		if (planID === 'agency') return m.settings_plan_agency_description();
		return '';
	}

	function billingPlanLimitLabel(limit: { readonly kind: string; readonly count: number }) {
		const value = new Intl.NumberFormat(getLocaleTag()).format(limit.count);
		if (limit.kind === 'workspaces') {
			return limit.count === 1
				? m.settings_plan_limit_workspace_one()
				: m.settings_plan_limit_workspaces({ value });
		}
		if (limit.kind === 'social_accounts') {
			return limit.count === 1
				? m.settings_plan_limit_social_account_one()
				: m.settings_plan_limit_social_accounts({ value });
		}
		if (limit.kind === 'scheduled_posts_monthly') {
			return m.settings_plan_limit_scheduled_posts({ value });
		}
		if (limit.kind === 'media_gb') return m.settings_plan_limit_media({ value });
		if (limit.kind === 'included_seats') return m.settings_plan_limit_seats({ value });
		return value;
	}

	function billingMetricLabel(metric: string) {
		if (metric === 'scheduled_posts_monthly') return m.settings_usage_scheduled_posts();
		if (metric === 'published_posts_monthly') return m.settings_usage_published_posts();
		if (metric === 'media_bytes_uploaded_monthly') return m.settings_usage_uploaded_media();
		if (metric === 'provider_write_calls_monthly') return m.settings_usage_provider_calls();
		return metric;
	}

	function billingStatusLabel(status: string) {
		const normalized = status.toLowerCase();
		if (normalized === 'none') return m.settings_billing_status_none();
		if (normalized === 'active') return m.settings_billing_status_active();
		if (normalized === 'trialing') return m.settings_billing_status_trialing();
		if (normalized === 'past_due') return m.settings_billing_status_past_due();
		if (normalized === 'canceled' || normalized === 'cancelled') {
			return m.settings_billing_status_canceled();
		}
		return status;
	}

	function providerCostName(provider: string) {
		return provider === 'x' ? 'X API' : provider;
	}

	function providerCostOperationLabel(operation: string) {
		if (operation === 'post_create') return m.settings_provider_cost_post_create();
		if (operation === 'post_create_with_url') {
			return m.settings_provider_cost_post_create_with_url();
		}
		return operation;
	}

	function providerCostRequestLabel(count: number) {
		const formatted = new Intl.NumberFormat(getLocaleTag()).format(count);
		return count === 1
			? m.settings_provider_cost_request_one()
			: m.settings_provider_cost_requests({ count: formatted });
	}

	function providerCostReservationLabel(count: number) {
		const formatted = new Intl.NumberFormat(getLocaleTag()).format(count);
		return count === 1
			? m.settings_provider_cost_reservation_one()
			: m.settings_provider_cost_reservations({ count: formatted });
	}

	function formatProviderCost(microunits: number, currency: string) {
		const amount = microunits / 1_000_000;
		try {
			return new Intl.NumberFormat(getLocaleTag(), {
				style: 'currency',
				currency,
				minimumFractionDigits: 2,
				maximumFractionDigits: 3
			}).format(amount);
		} catch {
			return `${amount.toFixed(3)} ${currency}`;
		}
	}

	function providerCostExposure(cost: ProviderCostSummary) {
		return cost.cost_microusd + cost.reserved_cost_microusd;
	}

	function providerCostBudgetLabel(cost: ProviderCostSummary) {
		return m.settings_provider_cost_budget({
			confirmed: formatProviderCost(cost.cost_microusd, cost.currency),
			reserved: formatProviderCost(cost.reserved_cost_microusd, cost.currency),
			budget: formatProviderCost(cost.budget_microusd, cost.currency)
		});
	}

	function providerCostProgress(cost: ProviderCostSummary) {
		const exposure = providerCostExposure(cost);
		if (cost.budget_microusd <= 0) return exposure > 0 ? 100 : 0;
		return Math.min(100, Math.round((exposure / cost.budget_microusd) * 100));
	}

	function shortBuild(value: string) {
		const normalized = value.trim();
		if (normalized === 'unknown' || normalized.length <= 12) return normalized;
		return normalized.slice(0, 12);
	}

	function mcpStatusLabel(status: string) {
		if (status === 'success') return m.settings_mcp_status_success();
		if (status === 'error') return m.settings_mcp_status_error();
		if (status === 'failed') return m.settings_mcp_status_failed();
		if (status === 'pending') return m.settings_mcp_status_pending();
		return status;
	}

	function securityMethodLabel(method: string) {
		if (method === 'password') return m.settings_security_method_password();
		if (method === 'totp') return m.settings_security_method_authenticator();
		if (method === 'passkey' || method === 'passkeys') {
			return m.settings_security_method_passkey();
		}
		return method;
	}

	const authState = $derived($auth);
	const weekdayFormatter = $derived(
		new Intl.DateTimeFormat(getLocaleTag(), { weekday: 'short', timeZone: 'UTC' })
	);
	const longWeekdayFormatter = $derived(
		new Intl.DateTimeFormat(getLocaleTag(), { weekday: 'long', timeZone: 'UTC' })
	);
	const passkeyCount = $derived((securityStatus?.passkeys ?? []).length);
	const hasPasswordCredential = $derived(securityStatus?.user.has_password ?? true);
	const reauthProviderID = $derived(linkedIdentities[0]?.provider_id ?? '');
	const unlinkedProviders = $derived(
		linkableProviders.filter(
			(provider) => !linkedIdentities.some((identity) => identity.provider_id === provider.id)
		)
	);
	const hasStepUpMethod = $derived(
		hasPasswordCredential || passkeyCount > 0 || Boolean(reauthProviderID)
	);
	const teamMembers = $derived(workspaceTeam?.members ?? []);
	const pendingInvitations = $derived(workspaceTeam?.invitations ?? []);
	const currentTeamSeats = $derived(workspaceTeam?.current_seats ?? 0);
	const cleanupDaysOptions = $derived(
		cleanupDayValues.map((value) => ({ value, label: cleanupDaysLabel(value) }))
	);
	const inviteRoleOptions = $derived(
		inviteRoles.map((value) => ({
			value,
			label: roleLabel(value),
			description: roleDescription(value)
		}))
	);
	const apiTokenScopeOptions = $derived(
		apiTokenScopes.map((value) => ({
			value,
			label: apiTokenScopeLabel(value),
			description: apiTokenScopeDescription(value)
		}))
	);
	const billingPlans = $derived(
		billingPlanDefinitions.map((plan) => ({
			...plan,
			name: billingPlanName(plan.id),
			description: billingPlanDescription(plan.id),
			limits: plan.limits.map(billingPlanLimitLabel)
		}))
	);
	const selectedInviteRole = $derived(
		inviteRoleOptions.find((option) => option.value === inviteRole) ?? inviteRoleOptions[0]
	);
	const selectedAPITokenScope = $derived(
		apiTokenScopeOptions.find((option) => option.value === apiTokenScope) ?? apiTokenScopeOptions[0]
	);
	const apiTokenWorkspaceOptions = $derived([
		{
			value: 'current',
			label: m.settings_current_workspace(),
			description: workspaceCtx.currentWorkspace?.name ?? m.settings_current_workspace_body()
		},
		{
			value: 'all',
			label: m.settings_all_workspaces(),
			description: m.settings_all_workspaces_body()
		}
	]);
	const selectedAPITokenWorkspaceScope = $derived(
		apiTokenWorkspaceOptions.find((option) => option.value === apiTokenWorkspaceScope) ??
			apiTokenWorkspaceOptions[0]
	);
	const settingsTabs = $derived([
		{ id: 'profile', label: m.settings_profile() },
		{ id: 'security', label: m.settings_security() },
		{ id: 'developer', label: m.settings_developer() },
		{ id: 'general', label: m.settings_general() },
		{ id: 'brand', label: m.media_brand() },
		{ id: 'accounts', label: m.accounts_heading() },
		{ id: 'schedule', label: m.settings_schedule() },
		{ id: 'members', label: m.settings_members() },
		{ id: 'sso', label: m.settings_sso() },
		{ id: 'plan', label: m.settings_plan() },
		...(authState.user?.is_admin
			? [
					{ id: 'instance' as const, label: m.settings_instance() },
					{ id: 'configuration' as const, label: m.settings_configuration() },
					{ id: 'users' as const, label: m.settings_instance_users() }
				]
			: [])
	]);
	const activeSettingsTab = $derived.by(() => {
		const requested = normalizeSettingsTab(
			page.url.searchParams.get('tab') || page.url.hash.replace(/^#/, '') || null
		);
		return (requested === 'instance' || requested === 'configuration' || requested === 'users') &&
			!authState.user?.is_admin
			? 'general'
			: requested;
	});
	const settingsLoadingVariant = $derived.by(() => {
		if (activeSettingsTab === 'profile') return 'profile' as const;
		if (['members', 'sso', 'plan', 'security'].includes(activeSettingsTab)) return 'cards' as const;
		if (
			['developer', 'schedule', 'accounts', 'instance', 'configuration', 'users'].includes(
				activeSettingsTab
			)
		)
			return 'list' as const;
		return 'form' as const;
	});
	const profileEmail = $derived(authState.user?.email ?? '');
	const canDeleteCurrentWorkspace = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const profileDirty = $derived(
		profileDisplayName !== (authState.user?.display_name ?? '') ||
			profileUsername !== (authState.user?.username ?? '') ||
			profilePublic !== Boolean(authState.user?.public_profile_enabled)
	);
	const securityDraftDirty = $derived(Boolean(identityPassword || otherSecurityDraftDirty()));
	const developerDraftDirty = $derived(apiTokenDraftSnapshot() !== savedAPITokenDraft);
	const memberDraftDirty = $derived(Boolean(inviteEmail.trim()) || inviteRole !== 'editor');
	const profileAvatarURL = $derived(authState.user?.avatar_url ?? '');
	const profileInitials = $derived.by(() => {
		const source = profileDisplayName || profileEmail || 'OP';
		const parts = source
			.replace(/@.*/, '')
			.split(/[\s._-]+/)
			.filter(Boolean);
		return (parts[0]?.[0] ?? 'O').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
	});
	const currentBillingPlan = $derived(
		billingPlans.find((plan) => plan.id === billingStatus?.plan_id) ?? null
	);
	const providerCosts = $derived(billingStatus?.provider_costs ?? []);
	const hasActiveBillingPlan = $derived(
		Boolean(
			billingStatus?.plan_id &&
			['active', 'trialing'].includes((billingStatus.status ?? '').toLowerCase())
		)
	);
	const activeSettingsTitle = $derived.by(() => {
		if (activeSettingsTab === 'profile') return m.settings_profile();
		if (activeSettingsTab === 'security') return m.settings_security();
		if (activeSettingsTab === 'developer') return m.settings_developer();
		if (activeSettingsTab === 'instance') return m.settings_instance();
		if (activeSettingsTab === 'configuration') return m.settings_configuration();
		if (activeSettingsTab === 'users') return m.settings_instance_users();
		if (activeSettingsTab === 'members') return m.settings_team_members();
		if (activeSettingsTab === 'sso') return m.settings_sso();
		if (activeSettingsTab === 'plan') return m.settings_plan();
		if (activeSettingsTab === 'schedule') return m.settings_schedule();
		if (activeSettingsTab === 'brand') return m.media_brand();
		if (activeSettingsTab === 'accounts') return m.accounts_heading();
		return m.settings_general();
	});
	const activeSettingsDescription = $derived.by(() => {
		if (activeSettingsTab === 'profile') return m.settings_profile_description();
		if (activeSettingsTab === 'security') return m.settings_account_security_body();
		if (activeSettingsTab === 'developer') return m.settings_developer_description();
		if (activeSettingsTab === 'instance') return m.settings_instance_description();
		if (activeSettingsTab === 'configuration') return m.settings_configuration_description();
		if (activeSettingsTab === 'users') return m.settings_instance_users_page_description();
		if (activeSettingsTab === 'members') return m.settings_members_description();
		if (activeSettingsTab === 'sso') return m.settings_sso_description();
		if (activeSettingsTab === 'plan') return m.settings_plan_description();
		if (activeSettingsTab === 'schedule') return m.settings_schedule_description();
		if (activeSettingsTab === 'brand') return m.media_brand_description();
		if (activeSettingsTab === 'accounts') return m.accounts_description();
		return m.settings_general_description({
			workspace: workspaceCtx.currentWorkspace?.name || m.settings_workspace()
		});
	});
	const requestedBillingPlan = $derived.by(() => {
		const planID = hostedPlanFromSearchParams(page.url.searchParams);
		return billingPlans.some((plan) => plan.id === planID) ? planID : '';
	});
	const monthlyBillingUsageRows = $derived.by(() => {
		if (!billingStatus) return [];
		return Object.entries(billingStatus.limits)
			.filter(([metric]) => metric.endsWith('_monthly'))
			.map(([metric, limit]) => ({
				metric,
				label: billingMetricLabel(metric),
				current: billingStatus?.usage[metric] ?? 0,
				limit
			}));
	});
	function isSettingsTab(value: string): value is SettingsTabID {
		return settingsTabs.some((tab) => tab.id === value);
	}

	function localizedWeekday(dayIndex: number, format: 'short' | 'long' = 'short') {
		const date = new Date(Date.UTC(2026, 6, 5 + dayIndex));
		return (format === 'long' ? longWeekdayFormatter : weekdayFormatter).format(date);
	}

	function normalizeSettingsTab(value: string | null): SettingsTabID {
		if (value === 'billing' || value === 'organization') return 'plan';
		if (value === 'team') return 'members';
		if (value === 'tokens' || value === 'account')
			return value === 'tokens' ? 'developer' : 'profile';
		if (value === 'workspace' || value === 'media') return 'general';
		if (value === 'social-accounts' || value === 'accounts') return 'accounts';
		return value && isSettingsTab(value) ? value : 'general';
	}

	async function saveProfile(event: SubmitEvent) {
		event.preventDefault();
		profileBusy = true;
		profileError = '';
		try {
			const { data, error: err } = await client.PATCH('/auth/profile', {
				body: {
					display_name: profileDisplayName,
					username: profileUsername,
					public_profile_enabled: profilePublic
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			auth.setUser(data);
			profileDisplayName = data.display_name ?? '';
			profileUsername = data.username ?? '';
			profilePublic = Boolean(data.public_profile_enabled);
			notify(m.settings_profile_updated());
		} catch (e) {
			profileError = (e as Error).message;
		} finally {
			profileBusy = false;
		}
	}

	function handleAvatarUploaded(avatarURL: string) {
		if (authState.user) {
			auth.setUser({ ...authState.user, avatar_url: avatarURL });
		}
		notify(m.settings_picture_updated());
	}

	async function removeAvatar() {
		if (!profileAvatarURL) return;
		profileBusy = true;
		profileError = '';
		try {
			const { error: err } = await client.DELETE('/auth/profile/avatar', {});
			if (err) throw new Error(err.detail || m.settings_action_failed());
			if (authState.user) {
				auth.setUser({ ...authState.user, avatar_url: '' });
			}
			notify(m.settings_picture_removed());
		} catch (e) {
			profileError = (e as Error).message;
		} finally {
			profileBusy = false;
		}
	}

	async function loadSecurityStatus() {
		loadingSecurity = true;
		securityError = '';
		try {
			const [securityResult, identityResult, providerResult] = await Promise.all([
				client.GET('/auth/security'),
				client.GET('/auth/oidc/identities'),
				client.GET('/auth/oidc/link-providers')
			]);
			if (securityResult.error || !securityResult.data) {
				throw new Error(securityResult.error?.detail || m.settings_action_failed());
			}
			if (identityResult.error) {
				throw new Error(identityResult.error.detail || m.settings_action_failed());
			}
			if (providerResult.error) {
				throw new Error(providerResult.error.detail || m.settings_action_failed());
			}
			securityStatus = securityResult.data;
			linkedIdentities = (identityResult.data ?? []) as OIDCIdentitySummary[];
			linkableProviders = (providerResult.data ?? []) as OIDCProviderSummary[];
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			loadingSecurity = false;
		}
	}

	async function linkIdentity(providerID: string) {
		identityBusy = `link-${providerID}`;
		securityError = '';
		try {
			const grant = await acquireReauthGrant('identity.link', {
				password: hasPasswordCredential ? identityPassword : '',
				providerID: reauthProviderID,
				hasPasskey: passkeyCount > 0
			});
			if (grant === null) return;
			await startOIDCIdentityLink(providerID, grant);
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			identityBusy = '';
		}
	}

	async function unlinkIdentity(identityID: string) {
		identityBusy = `unlink-${identityID}`;
		securityError = '';
		try {
			const grant = await acquireReauthGrant('identity.unlink', {
				password: hasPasswordCredential ? identityPassword : '',
				providerID: reauthProviderID,
				hasPasskey: passkeyCount > 0
			});
			if (grant === null) return;
			const { error } = await client.DELETE('/auth/oidc/identities/{identity_id}', {
				params: { path: { identity_id: identityID } },
				body: { reauth_grant: grant }
			});
			if (error) throw new Error(error.detail || m.settings_action_failed());
			identityPassword = '';
			await loadSecurityStatus();
			notify(m.settings_identity_unlinked());
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			identityBusy = '';
		}
	}

	async function loadAuthSessions() {
		authSessionsLoading = true;
		authSessionsError = '';
		try {
			const { data, error: err } = await client.GET('/auth/sessions');
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			authSessions = data as AuthSessionSummary[];
		} catch (e) {
			authSessions = [];
			authSessionsError = (e as Error).message;
		} finally {
			authSessionsLoading = false;
		}
	}

	async function loadAPITokens(userID = authState.user?.id ?? '') {
		if (!userID) return;
		const requestSequence = ++apiTokensRequestSequence;
		apiTokensRequestUserID = userID;
		apiTokensLoading = true;
		apiTokensLoadError = '';
		if (loadedAPITokensUserID && loadedAPITokensUserID !== userID) apiTokens = [];
		try {
			const { data, error: err } = await client.GET('/api-tokens');
			if (err || !data) throw new Error(err?.detail || m.settings_tokens_load_failed());
			if (requestSequence !== apiTokensRequestSequence || authState.user?.id !== userID) return;
			apiTokens = data as APITokenSummary[];
			loadedAPITokensUserID = userID;
		} catch (e) {
			if (requestSequence !== apiTokensRequestSequence || authState.user?.id !== userID) return;
			apiTokensLoadError = (e as Error).message;
			if (loadedAPITokensUserID === userID) loadedAPITokensUserID = '';
		} finally {
			if (requestSequence === apiTokensRequestSequence) {
				apiTokensRequestUserID = '';
				apiTokensLoading = false;
			}
		}
	}

	async function loadMCPActivity() {
		mcpActivityLoading = true;
		mcpActivityError = '';
		try {
			const { data, error: err } = await client.GET('/mcp/activity', {
				params: { query: { limit: 8 } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			mcpActivity = data as MCPActivityItem[];
		} catch (e) {
			mcpActivityError = (e as Error).message;
			mcpActivity = [];
		} finally {
			mcpActivityLoading = false;
		}
	}

	async function loadWorkspaceTeam(workspaceID = workspaceCtx.currentWorkspace?.id ?? '') {
		if (!workspaceID) return;
		const requestSequence = ++teamRequestSequence;
		const workspaceChanged = loadedTeamWorkspaceID !== workspaceID;
		loadedTeamWorkspaceID = workspaceID;
		teamLoading = true;
		teamError = '';
		teamLoadError = '';
		workspaceTeam = null;
		if (workspaceChanged) createdInviteURL = '';
		try {
			const { data, error: err } = await client.GET('/workspaces/{id}/team', {
				params: { path: { id: workspaceID } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_team_load_failed());
			if (requestSequence !== teamRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			workspaceTeam = data as WorkspaceTeam;
		} catch (e) {
			if (requestSequence !== teamRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			loadedTeamWorkspaceID = '';
			workspaceTeam = null;
			teamLoadError = (e as Error).message || m.settings_team_load_failed();
		} finally {
			if (requestSequence === teamRequestSequence) teamLoading = false;
		}
	}

	async function createWorkspaceInvitation(event: SubmitEvent) {
		event.preventDefault();
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!workspaceID) return;
		teamBusy = true;
		teamError = '';
		createdInviteURL = '';
		try {
			const { data, error: err } = await client.POST('/workspaces/{id}/invitations', {
				params: { path: { id: workspaceID } },
				body: {
					email: inviteEmail.trim(),
					role: inviteRole
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			if (!isCurrentWorkspace(workspaceID)) return;
			const invitation = data as WorkspaceInvitation;
			createdInviteURL =
				invitation.accept_url ||
				(invitation.token ? `${window.location.origin}/invite?token=${invitation.token}` : '');
			inviteEmail = '';
			inviteRole = 'editor';
			await loadWorkspaceTeam(workspaceID);
			notify(m.settings_invite_created());
		} catch (e) {
			if (isCurrentWorkspace(workspaceID)) teamError = (e as Error).message;
		} finally {
			teamBusy = false;
		}
	}

	async function revokeWorkspaceInvitation(invitationID: string) {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!workspaceID) return;
		teamBusy = true;
		teamError = '';
		try {
			const { error: err } = await client.DELETE('/workspaces/{id}/invitations/{invitation_id}', {
				params: { path: { id: workspaceID, invitation_id: invitationID } }
			});
			if (err) throw new Error(err.detail || m.settings_action_failed());
			if (!isCurrentWorkspace(workspaceID)) return;
			await loadWorkspaceTeam(workspaceID);
			notify(m.settings_invitation_revoked());
		} catch (e) {
			if (isCurrentWorkspace(workspaceID)) teamError = (e as Error).message;
		} finally {
			teamBusy = false;
		}
	}

	async function copyCreatedInviteURL() {
		if (!createdInviteURL) return;
		await navigator.clipboard.writeText(createdInviteURL);
		notify(m.settings_invite_copied());
	}

	async function createAPIToken() {
		apiTokenBusy = true;
		apiTokenError = '';
		createdAPIToken = '';
		const fallbackName = apiTokenScope.startsWith('mcp:') ? 'OpenPost MCP' : 'OpenPost CLI';
		const workspaceID =
			apiTokenWorkspaceScope === 'current' ? (workspaceCtx.currentWorkspace?.id ?? '') : '';
		try {
			const { data, error: err } = await client.POST('/api-tokens', {
				body: {
					name: apiTokenName.trim() || fallbackName,
					scope: apiTokenScope,
					...(workspaceID ? { workspace_id: workspaceID } : {})
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			createdAPIToken = data.token;
			apiTokenName = fallbackName;
			savedAPITokenDraft = apiTokenDraftSnapshot();
			await loadAPITokens();
		} catch (e) {
			apiTokenError = (e as Error).message;
		} finally {
			apiTokenBusy = false;
		}
	}

	function apiTokenDraftSnapshot() {
		return JSON.stringify({
			name: apiTokenName,
			scope: apiTokenScope,
			workspace: apiTokenWorkspaceScope
		});
	}

	async function revokeAuthSession(session: AuthSessionSummary) {
		authSessionBusyID = session.id;
		authSessionsError = '';
		try {
			const { data, error: err } = await client.DELETE('/auth/sessions/{session_id}', {
				params: { path: { session_id: session.id } }
			});
			if (err) throw new Error(err.detail || m.settings_action_failed());
			if (data?.revoked_current || session.current) {
				await auth.logout();
				await goto(resolve('/login'));
				return;
			}
			await loadAuthSessions();
			notify(m.settings_session_revoked());
		} catch (e) {
			authSessionsError = (e as Error).message;
		} finally {
			authSessionBusyID = '';
		}
	}

	async function revokeAPIToken(tokenID: string) {
		apiTokenBusy = true;
		apiTokenError = '';
		try {
			const { error: err } = await client.DELETE('/api-tokens/{id}', {
				params: { path: { id: tokenID } }
			});
			if (err) throw new Error(err.detail || m.settings_action_failed());
			await loadAPITokens();
			notify(m.settings_token_revoked());
		} catch (e) {
			apiTokenError = (e as Error).message;
		} finally {
			apiTokenBusy = false;
		}
	}

	async function loadBillingStatus(
		workspaceID = workspaceCtx.currentWorkspace?.id ?? '',
		organizationID = workspaceCtx.currentWorkspace?.organization_id ?? ''
	) {
		if (!workspaceID) return;
		const requestSequence = ++billingRequestSequence;
		loadedBillingWorkspaceID = workspaceID;
		billingStatusLoading = true;
		billingError = '';
		billingLoadError = '';
		billingStatus = null;
		try {
			const { data, error: err } = await client.GET('/billing/status', {
				params: { query: { workspace_id: workspaceID } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_billing_load_failed());
			if (
				requestSequence !== billingRequestSequence ||
				!isCurrentBillingTarget(workspaceID, organizationID)
			)
				return;
			billingStatus = data as BillingStatus;
		} catch (e) {
			if (
				requestSequence !== billingRequestSequence ||
				!isCurrentBillingTarget(workspaceID, organizationID)
			)
				return;
			loadedBillingWorkspaceID = '';
			billingStatus = null;
			billingLoadError = (e as Error).message || m.settings_billing_load_failed();
		} finally {
			if (requestSequence === billingRequestSequence) billingStatusLoading = false;
		}
	}

	async function loadUpdateStatus(userID = authState.user?.id ?? '') {
		if (!userID || !authState.user?.is_admin) return;
		loadedUpdateStatusUserID = userID;
		updateStatusLoading = true;
		updateStatusError = '';
		try {
			const { data, error } = await client.GET('/admin/update-status');
			if (error || !data) {
				throw new Error(error?.detail || m.settings_instance_status_load_failed());
			}
			if (authState.user?.id !== userID) return;
			updateStatus = data;
		} catch (error) {
			if (authState.user?.id !== userID) return;
			loadedUpdateStatusUserID = '';
			updateStatus = null;
			updateStatusError = (error as Error).message || m.settings_instance_status_load_failed();
		} finally {
			if (authState.user?.id === userID) updateStatusLoading = false;
		}
	}

	async function startCheckout(planID: string) {
		billingBusyPlan = planID;
		await goto(resolve(checkoutPathForPlan(planID) as '/'));
		billingBusyPlan = '';
	}

	async function openBillingPortal() {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		const organizationID =
			billingStatus?.organization_id ?? workspaceCtx.currentWorkspace?.organization_id ?? '';
		if (!workspaceID) return;
		billingPortalBusy = true;
		billingError = '';
		try {
			const { data, error: err } = organizationID
				? await client.POST('/organizations/{id}/billing/portal', {
						params: { path: { id: organizationID } }
					})
				: await client.POST('/billing/portal', {
						body: { workspace_id: workspaceID }
					});
			if (err || !data?.url) throw new Error(err?.detail || m.settings_action_failed());
			if (!isCurrentBillingTarget(workspaceID, organizationID)) return;
			window.location.assign(data.url);
		} catch (e) {
			if (isCurrentBillingTarget(workspaceID, organizationID)) {
				billingError = (e as Error).message;
			}
		} finally {
			billingPortalBusy = false;
		}
	}

	async function startTOTPSetup() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = hasPasswordCredential
				? ''
				: await acquireReauthGrant('security.totp.setup', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST('/auth/security/totp/setup', {
				body: {
					current_password: totpCurrentPassword,
					reauth_grant: grant || undefined
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			totpSetupChallengeId = data.challenge_id;
			totpManualEntryKey = data.manual_entry_key;
			totpQRCodeDataURL = data.qr_code_data_url;
			totpCode = '';
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			securityBusy = false;
		}
	}

	async function confirmTOTPSetup() {
		if (!totpSetupChallengeId) return;
		securityBusy = true;
		securityError = '';
		try {
			const { data, error: err } = await client.POST('/auth/security/totp/confirm', {
				body: {
					challenge_id: totpSetupChallengeId,
					code: totpCode
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			totpSetupChallengeId = '';
			totpManualEntryKey = '';
			totpQRCodeDataURL = '';
			totpCode = '';
			totpCurrentPassword = '';
			notify(m.settings_authenticator_enabled_notice());
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			securityBusy = false;
		}
	}

	async function disableTOTP() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = hasPasswordCredential
				? ''
				: await acquireReauthGrant('security.totp.disable', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST('/auth/security/totp/disable', {
				body: {
					current_password: totpCurrentPassword,
					reauth_grant: grant || undefined
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			totpCurrentPassword = '';
			notify(m.settings_authenticator_disabled_notice());
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			securityBusy = false;
		}
	}

	async function addPasskey() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = hasPasswordCredential
				? ''
				: await acquireReauthGrant('security.passkey.add', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data: beginData, error: beginError } = await client.POST(
				'/auth/security/passkeys/begin',
				{
					body: {
						current_password: passkeyCurrentPassword,
						name: newPasskeyName,
						reauth_grant: grant || undefined
					}
				}
			);
			if (beginError || !beginData) {
				throw new Error(beginError?.detail || m.settings_action_failed());
			}

			const credential = await createPasskeyCredential(beginData.options);
			const { data, error: err } = await client.POST('/auth/security/passkeys/finish', {
				body: {
					challenge_id: beginData.challenge_id,
					name: newPasskeyName,
					credential
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			passkeyCurrentPassword = '';
			newPasskeyName = '';
			notify(m.settings_passkey_added());
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			securityBusy = false;
		}
	}

	async function removePasskey(passkeyId: string) {
		securityBusy = true;
		securityError = '';
		try {
			const grant = hasPasswordCredential
				? ''
				: await acquireReauthGrant('security.passkey.remove', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST(
				'/auth/security/passkeys/{passkey_id}/remove',
				{
					params: { path: { passkey_id: passkeyId } },
					body: {
						current_password: passkeyCurrentPassword,
						reauth_grant: grant || undefined
					}
				}
			);
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			passkeyCurrentPassword = '';
			notify(m.settings_passkey_removed());
		} catch (e) {
			securityError = (e as Error).message;
		} finally {
			securityBusy = false;
		}
	}

	async function saveSettings() {
		saving = true;
		try {
			await workspaceCtx.saveSettings({
				avatar_url: workspaceCtx.settings.avatar_url,
				color: workspaceCtx.settings.color,
				timezone: workspaceCtx.settings.timezone,
				week_start: workspaceCtx.settings.week_start,
				media_cleanup_days: workspaceCtx.settings.media_cleanup_days,
				random_delay_minutes: workspaceCtx.settings.random_delay_minutes,
				draft_gap_minutes: workspaceCtx.settings.draft_gap_minutes,
				slot_start_hour: workspaceCtx.settings.slot_start_hour,
				slot_end_hour: workspaceCtx.settings.slot_end_hour,
				slot_interval_minutes: workspaceCtx.settings.slot_interval_minutes
			});
			notify(m.settings_saved());
		} catch (e) {
			notify(
				e instanceof WorkspaceContextError ? m.settings_action_failed() : (e as Error).message,
				'error'
			);
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		unsavedChanges?.set(
			'workspace-settings',
			workspaceCtx.settingsDirty,
			m.settings_unsaved_changes()
		);
		return () => unsavedChanges?.clear('workspace-settings');
	});

	$effect(() => {
		unsavedChanges?.set('profile-settings', profileDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('profile-settings');
	});

	$effect(() => {
		unsavedChanges?.set('security-settings', securityDraftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('security-settings');
	});

	$effect(() => {
		unsavedChanges?.set('developer-settings', developerDraftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('developer-settings');
	});

	$effect(() => {
		unsavedChanges?.set('member-settings', memberDraftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('member-settings');
	});

	function otherSecurityDraftDirty() {
		return Boolean(
			totpCurrentPassword ||
			passkeyCurrentPassword ||
			totpCode ||
			newPasskeyName ||
			totpSetupChallengeId
		);
	}

	function parseDurationInput(input: string, allowZero: boolean = false): number | null {
		input = input.trim().toLowerCase();
		const direct = parseInt(input, 10);
		if (!isNaN(direct) && String(direct) === input && (direct > 0 || (allowZero && direct === 0))) {
			return direct;
		}
		const hourMatch = input.match(/(\d+)\s*h/);
		const minMatch = input.match(/(\d+)\s*m/);
		let total = 0;
		if (hourMatch) total += parseInt(hourMatch[1], 10) * 60;
		if (minMatch) total += parseInt(minMatch[1], 10);
		if (total > 0) return total;
		return null;
	}

	let intervalInput = $state(String(workspaceCtx.settings.slot_interval_minutes));
	let intervalError = $state('');
	let draftGapInput = $state(String(workspaceCtx.settings.draft_gap_minutes));
	let draftGapError = $state('');

	function handleIntervalChange(value: string) {
		intervalInput = value;
		const parsed = parseDurationInput(value);
		if (parsed !== null && parsed >= 1 && parsed <= 180) {
			intervalError = '';
			workspaceCtx.settings.slot_interval_minutes = parsed;
		} else {
			intervalError = m.settings_interval_invalid();
		}
	}

	function handleDraftGapChange(value: string) {
		draftGapInput = value;
		const parsed = parseDurationInput(value, true);
		if (parsed !== null && parsed >= 0 && parsed <= 24 * 60) {
			draftGapError = '';
			workspaceCtx.settings.draft_gap_minutes = parsed;
		} else {
			draftGapError = m.settings_draft_gap_invalid();
		}
	}

	let schedules = $state<PostingSchedule[]>([]);
	let loadingSchedules = $state(false);
	let scheduleError = $state('');
	let showSuggestSchedule = $state(false);
	let suggestedPostsPerDay = $state(3);
	let generatingSchedule = $state(false);
	let newTimeInput = $state('09:00');
	let newTimeError = $state('');
	let newTimeDays = $state<number[]>([1, 2, 3, 4, 5]);
	let savedScheduleDraft = $state(JSON.stringify({ time: '09:00', days: [1, 2, 3, 4, 5] }));
	const scheduleDraftDirty = $derived(scheduleDraftSnapshot() !== savedScheduleDraft);

	$effect(() => {
		unsavedChanges?.set('schedule-draft', scheduleDraftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('schedule-draft');
	});

	function scheduleDraftSnapshot() {
		return JSON.stringify({ time: newTimeInput, days: newTimeDays });
	}

	const dayOrder = $derived.by(() => {
		const start = workspaceCtx.settings.week_start === 0 ? 0 : 1;
		return Array.from({ length: 7 }, (_, index) => (start + index) % 7);
	});

	const scheduleRows = $derived.by(() => {
		const rows: Record<string, ScheduleRow> = {};
		for (const schedule of schedules) {
			const key = `${schedule.local_hour}:${schedule.local_minute}`;
			if (!rows[key]) {
				rows[key] = {
					key,
					local_hour: schedule.local_hour,
					local_minute: schedule.local_minute,
					label: schedule.label ?? '',
					days: {}
				};
			}
			const row = rows[key];
			row.days[schedule.local_day_of_week] = schedule;
			if (!row.label && schedule.label) {
				row.label = schedule.label;
			}
		}
		return Object.values(rows).sort(
			(a, b) => a.local_hour * 60 + a.local_minute - (b.local_hour * 60 + b.local_minute)
		);
	});

	async function loadSchedules(workspaceID = workspaceCtx.currentWorkspace?.id ?? '') {
		if (!workspaceID) return;
		const requestSequence = ++scheduleRequestSequence;
		loadedScheduleWorkspaceID = workspaceID;
		loadingSchedules = true;
		scheduleError = '';
		schedules = [];
		try {
			const { data, error: err } = await client.GET('/posting-schedules', {
				params: { query: { workspace_id: workspaceID } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_schedule_load_failed());
			if (requestSequence !== scheduleRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			schedules = data;
		} catch (e) {
			if (requestSequence !== scheduleRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			loadedScheduleWorkspaceID = '';
			schedules = [];
			scheduleError = (e as Error).message || m.settings_schedule_load_failed();
			console.error('Failed to load schedules:', e);
		} finally {
			if (requestSequence === scheduleRequestSequence) loadingSchedules = false;
		}
	}

	async function loadBrandKit(workspaceID = workspaceCtx.currentWorkspace?.id ?? '') {
		if (!workspaceID) return;
		const requestSequence = ++brandRequestSequence;
		loadedBrandWorkspaceID = workspaceID;
		brandLoading = true;
		brandError = '';
		brandKit = null;
		try {
			const kit = await loadStudioBrandKit(workspaceID);
			if (requestSequence !== brandRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			brandKit = kit;
		} catch (cause) {
			if (requestSequence !== brandRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			loadedBrandWorkspaceID = '';
			brandError = cause instanceof Error ? cause.message : m.media_hub_load_failed();
		} finally {
			if (requestSequence === brandRequestSequence) brandLoading = false;
		}
	}

	function parseClockInput(value: string): { hour: number; minute: number } | null {
		const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
		if (!match) return null;
		const hour = Number(match[1]);
		const minute = Number(match[2]);
		if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
		return { hour, minute };
	}

	async function createSchedule(
		workspaceID: string,
		dayOfWeek: number,
		localHour: number,
		localMinute: number
	) {
		const { error: err } = await client.POST('/posting-schedules', {
			body: {
				workspace_id: workspaceID,
				local_day_of_week: dayOfWeek,
				local_hour: localHour,
				local_minute: localMinute,
				day_of_week: 0,
				utc_hour: 0,
				utc_minute: 0,
				label: ''
			}
		});
		if (err) throw err;
	}

	async function addTimeRow() {
		const parsed = parseClockInput(newTimeInput);
		if (!parsed) {
			newTimeError = m.settings_time_format_invalid();
			return;
		}
		if (newTimeDays.length === 0) {
			newTimeError = m.settings_time_day_required();
			return;
		}
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!workspaceID || !workspaceCtx.settingsReady) {
			newTimeError = m.settings_workspace_load_failed();
			return;
		}
		newTimeError = '';
		try {
			for (const day of newTimeDays) {
				const exists = schedules.some(
					(schedule) =>
						schedule.local_day_of_week === day &&
						schedule.local_hour === parsed.hour &&
						schedule.local_minute === parsed.minute
				);
				if (!exists) {
					await createSchedule(workspaceID, day, parsed.hour, parsed.minute);
				}
			}
			if (isCurrentWorkspace(workspaceID)) {
				await loadSchedules(workspaceID);
				savedScheduleDraft = scheduleDraftSnapshot();
				notify(m.settings_time_added());
			}
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	async function deleteSchedule(id: string) {
		try {
			const { error: err } = await client.DELETE('/posting-schedules/{id}', {
				params: { path: { id } }
			});
			if (err) throw err;
			await loadSchedules();
			notify(m.settings_schedule_deleted());
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	async function toggleScheduleCell(row: ScheduleRow, dayOfWeek: number) {
		try {
			const existing = row.days[dayOfWeek];
			if (existing) {
				await deleteSchedule(existing.id);
				return;
			}
			const workspaceID = workspaceCtx.currentWorkspace?.id;
			if (!workspaceID || !workspaceCtx.settingsReady) return;
			await createSchedule(workspaceID, dayOfWeek, row.local_hour, row.local_minute);
			if (isCurrentWorkspace(workspaceID)) {
				await loadSchedules(workspaceID);
				notify(m.settings_schedule_updated());
			}
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	async function removeTimeRow(row: ScheduleRow) {
		try {
			for (const schedule of Object.values(row.days)) {
				if (schedule) {
					const { error: err } = await client.DELETE('/posting-schedules/{id}', {
						params: { path: { id: schedule.id } }
					});
					if (err) throw err;
				}
			}
			await loadSchedules();
			notify(m.settings_time_removed());
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	function toggleNewDay(dayOfWeek: number) {
		if (newTimeDays.includes(dayOfWeek)) {
			newTimeDays = newTimeDays.filter((value) => value !== dayOfWeek);
			return;
		}
		newTimeDays = [...newTimeDays, dayOfWeek].sort((a, b) => a - b);
	}

	async function generateSuggestedSchedule() {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!workspaceID || !workspaceCtx.settingsReady) return;
		generatingSchedule = true;
		try {
			const { error: err } = await client.POST('/posting-schedules/suggest', {
				body: {
					workspace_id: workspaceID,
					posts_per_day: suggestedPostsPerDay
				}
			});
			if (err) throw err;
			showSuggestSchedule = false;
			if (isCurrentWorkspace(workspaceID)) {
				await loadSchedules(workspaceID);
				notify(
					suggestedPostsPerDay === 1
						? m.settings_schedule_generated_one()
						: m.settings_schedule_generated({ count: suggestedPostsPerDay })
				);
			}
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		} finally {
			generatingSchedule = false;
		}
	}

	function formatTime(hour: number, minute: number): string {
		return new Date(Date.UTC(2024, 0, 1, hour, minute)).toLocaleTimeString(getLocaleTag(), {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'UTC'
		});
	}

	function formatBillingValue(metric: string, value: number): string {
		if (metric.includes('bytes')) {
			return formatBytes(value);
		}
		return new Intl.NumberFormat(getLocaleTag()).format(value);
	}

	function formatPlanPrice(amount: number): string {
		return new Intl.NumberFormat(getLocaleTag(), {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0
		}).format(amount);
	}

	function formatBytes(value: number): string {
		if (value >= 1_000_000_000) {
			return `${new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 1 }).format(value / 1_000_000_000)} GB`;
		}
		if (value >= 1_000_000) {
			return `${new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 1 }).format(value / 1_000_000)} MB`;
		}
		return `${new Intl.NumberFormat(getLocaleTag()).format(value)} B`;
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag()).format(new Date(value));
	}

	function formatDateTime(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function formatSessionUserAgent(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return m.settings_unknown_browser();

		const browser = sessionBrowserName(trimmed);
		const device = sessionDeviceName(trimmed);
		return m.settings_browser_on_device({ browser, device });
	}

	function sessionBrowserName(userAgent: string): string {
		if (/Edg\//.test(userAgent)) return 'Edge';
		if (/OPR\//.test(userAgent) || /Opera\//.test(userAgent)) return 'Opera';
		if (/Firefox\//.test(userAgent)) return 'Firefox';
		if (/CriOS\//.test(userAgent)) return 'Chrome';
		if (/Chrome\//.test(userAgent) || /Chromium\//.test(userAgent)) return 'Chrome';
		if (/Safari\//.test(userAgent)) return 'Safari';
		return m.settings_browser();
	}

	function sessionDeviceName(userAgent: string): string {
		if (/iPad/.test(userAgent)) return 'iPad';
		if (/iPhone/.test(userAgent)) return 'iPhone';
		if (/Android/.test(userAgent))
			return /Mobile/.test(userAgent) ? m.settings_android_phone() : m.settings_android_tablet();
		if (/Macintosh|Mac OS X/.test(userAgent)) return 'MacBook';
		if (/Windows NT/.test(userAgent)) return 'Windows';
		if (/Linux/.test(userAgent)) return 'Linux';
		return m.settings_device();
	}

	function formatSessionTime(value: string): string {
		if (!value || value.startsWith('0001-01-01')) return m.settings_never();
		return formatDateTime(value);
	}

	let lastProfileUserID = $state('');
	$effect(() => {
		const user = authState.user;
		if (user?.id && user.id !== lastProfileUserID) {
			lastProfileUserID = user.id;
			profileDisplayName = user.display_name || '';
			profileUsername = user.username || '';
			profilePublic = Boolean(user.public_profile_enabled);
		}
	});

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		const organizationID = workspaceCtx.currentWorkspace?.organization_id ?? '';
		const tab = activeSettingsTab;
		if (!workspaceID) return;

		if (tab === 'plan' && loadedBillingWorkspaceID !== workspaceID) {
			void loadBillingStatus(workspaceID, organizationID);
		}
		if (tab === 'members' && loadedTeamWorkspaceID !== workspaceID) {
			void loadWorkspaceTeam(workspaceID);
		}
		if (tab === 'schedule' && loadedScheduleWorkspaceID !== workspaceID) {
			void loadSchedules(workspaceID);
		}
		if (tab === 'brand' && loadedBrandWorkspaceID !== workspaceID) {
			void loadBrandKit(workspaceID);
		}
		if (tab === 'general' && loadedBrandWorkspaceID !== workspaceID) {
			void loadBrandKit(workspaceID);
		}
	});

	$effect(() => {
		if (
			requestedBillingPlan &&
			workspaceCtx.currentWorkspace &&
			handledCheckoutPlan !== requestedBillingPlan &&
			!billingBusyPlan
		) {
			handledCheckoutPlan = requestedBillingPlan;
			startCheckout(requestedBillingPlan);
		}
	});

	$effect(() => {
		const userID = authState.user?.id ?? '';
		const tab = activeSettingsTab;
		if (!authState.isAuthenticated || !userID) return;

		if (tab === 'security' && loadedSecurityUserID !== userID) {
			loadedSecurityUserID = userID;
			void loadSecurityStatus();
			void loadAuthSessions();
		}
		if (tab === 'developer') {
			if (loadedAPITokensUserID !== userID && apiTokensRequestUserID !== userID) {
				void loadAPITokens(userID);
			}
			if (loadedMCPActivityUserID !== userID) {
				loadedMCPActivityUserID = userID;
				void loadMCPActivity();
			}
		}
		if (tab === 'instance' && authState.user?.is_admin && loadedUpdateStatusUserID !== userID) {
			void loadUpdateStatus(userID);
		}
	});

	$effect(() => {
		intervalInput = String(workspaceCtx.settings.slot_interval_minutes);
		draftGapInput = String(workspaceCtx.settings.draft_gap_minutes);
		intervalError = '';
		draftGapError = '';
	});

	function handleTimezoneChange(value: string) {
		workspaceCtx.settings.timezone = value;
	}

	function handleWeekStartChange(value: number) {
		workspaceCtx.settings.week_start = value;
	}

	function handleCleanupDaysChange(value: number) {
		workspaceCtx.settings.media_cleanup_days = value;
	}
</script>

<svelte:head>
	<title>{m.settings_page_title()}</title>
</svelte:head>

<PageContainer
	title={activeSettingsTitle}
	description={activeSettingsDescription}
	icon={SettingsIcon}
	loading={!workspaceCtx.currentWorkspace || workspaceCtx.settingsLoading}
	loadingMessage={m.settings_loading_workspace()}
	loadingLayout="settings"
	loadingVariant={settingsLoadingVariant}
	loadingItems={8}
>
	{#if workspaceCtx.settingsError}
		<InlineNotice tone="error" message={m.settings_workspace_load_failed()}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => void workspaceCtx.loadSettings()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else}
		<div class="grid min-w-0 items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
			<SettingsNavigation
				active={activeSettingsTab}
				showInstance={Boolean(authState.user?.is_admin)}
			/>

			<div class="min-w-0 space-y-6">
				<section id="profile" class:hidden={activeSettingsTab !== 'profile'} class="scroll-mt-24">
					{#if avatarUploaderOpen}
						<ProfileAvatarUploader
							bind:open={avatarUploaderOpen}
							onComplete={handleAvatarUploaded}
							onError={(message) => (profileError = message)}
						/>
					{/if}

					<form onsubmit={saveProfile} class="space-y-6">
						<div class="flex flex-col gap-6 sm:flex-row sm:items-center">
							<div class="group relative h-24 w-24 shrink-0">
								{#if profileAvatarURL}
									<img
										src={profileAvatarURL}
										alt={m.settings_profile_avatar_alt()}
										class="h-24 w-24 rounded-full border bg-muted object-cover"
									/>
								{:else}
									<div
										class="flex h-24 w-24 items-center justify-center rounded-full border border-dashed bg-muted text-xl font-semibold text-muted-foreground"
									>
										{profileInitials}
									</div>
								{/if}
								<button
									type="button"
									onclick={() => (avatarUploaderOpen = true)}
									class="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:inset-auto [@media(pointer:coarse)]:right-0 [@media(pointer:coarse)]:bottom-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:border-2 [@media(pointer:coarse)]:border-background [@media(pointer:coarse)]:opacity-100"
									aria-label={m.settings_change_profile_picture()}
								>
									<CameraIcon class="h-6 w-6" />
								</button>
							</div>

							<div class="min-w-0 flex-1 space-y-3">
								<div class="space-y-2">
									<Label for="profile-display-name">{m.settings_display_name()}</Label>
									<Input
										id="profile-display-name"
										bind:value={profileDisplayName}
										placeholder={m.settings_your_name()}
										maxlength={120}
									/>
								</div>
								<div class="space-y-2">
									<Label for="profile-username">{m.settings_username()}</Label>
									<div class="relative">
										<span
											class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
											aria-hidden="true">@</span
										>
										<Input
											id="profile-username"
											bind:value={profileUsername}
											class="pl-7"
											required
											minlength={3}
											maxlength={30}
											pattern="[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?"
											autocomplete="username"
											aria-describedby="profile-username-help"
										/>
									</div>
									<p id="profile-username-help" class="text-xs leading-5 text-muted-foreground">
										{m.settings_username_help()}
									</p>
								</div>
								<p class="text-sm text-muted-foreground">{profileEmail}</p>
								<div class="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										onclick={() => (avatarUploaderOpen = true)}
									>
										<CameraIcon class="mr-2 h-4 w-4" />
										{m.settings_change_picture()}
									</Button>
									{#if profileAvatarURL}
										<Button
											type="button"
											variant="ghost"
											class="text-destructive hover:text-destructive"
											onclick={removeAvatar}
											disabled={profileBusy}
										>
											<TrashIcon class="mr-2 h-4 w-4" />
											{m.settings_remove()}
										</Button>
									{/if}
								</div>
							</div>
						</div>

						<div class="flex items-start gap-3 rounded-xl border bg-muted/25 p-4">
							<Checkbox
								id="profile-public"
								bind:checked={profilePublic}
								aria-describedby="profile-public-description"
							/>
							<div class="min-w-0 flex-1">
								<Label for="profile-public" class="font-medium">
									{m.settings_public_profile()}
								</Label>
								<p
									id="profile-public-description"
									class="mt-1 text-sm leading-6 text-muted-foreground"
								>
									{m.settings_public_profile_description()}
								</p>
								{#if authState.user?.public_profile_enabled && authState.user.username}
									<a
										href={`/u/${authState.user.username}`}
										target="_blank"
										rel="noreferrer"
										class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
									>
										{m.settings_view_public_profile()}
										<ExternalLinkIcon class="size-4" aria-hidden="true" />
									</a>
								{/if}
							</div>
						</div>

						{#if profileError}
							<InlineNotice tone="error" message={profileError} />
						{/if}

						<SettingsFormFooter
							label={m.settings_save_profile()}
							savingLabel={m.settings_save_profile()}
							saving={profileBusy}
							type="submit"
						/>
					</form>
				</section>

				<section id="accounts" class:hidden={activeSettingsTab !== 'accounts'} class="scroll-mt-24">
					{#if activeSettingsTab === 'accounts'}
						<AccountsPage />
					{/if}
				</section>

				{#if authState.user?.is_admin}
					<section id="users" class:hidden={activeSettingsTab !== 'users'} class="scroll-mt-24">
						{#if activeSettingsTab === 'users'}
							<InstanceAdminUsers />
						{/if}
					</section>

					<section
						id="instance"
						class:hidden={activeSettingsTab !== 'instance'}
						class="scroll-mt-24 space-y-6"
					>
						{#if activeSettingsTab === 'instance'}
							<InstanceAdminOverview />
						{/if}

						<div>
							<SectionHeader
								title={m.settings_instance_status()}
								description={m.settings_instance_status_body()}
								icon={ServerCogIcon}
								class="mb-4"
							/>

							{#if updateStatusLoading}
								<PageLoading layout="list" label={m.common_loading()} items={3} />
							{:else if updateStatusError}
								<InlineNotice tone="error" message={updateStatusError}>
									{#snippet actions()}
										<Button variant="outline" size="sm" onclick={() => void loadUpdateStatus()}>
											{m.common_retry()}
										</Button>
									{/snippet}
								</InlineNotice>
							{:else if updateStatus}
								<div class="space-y-4" data-testid="instance-update-status">
									{#if updateStatus.state === 'update_available'}
										<InlineNotice tone="warning">
											<div
												class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
											>
												<div>
													<p class="font-medium">
														{m.settings_instance_update_available({
															version: updateStatus.latest_version ?? ''
														})}
													</p>
													<p class="mt-0.5 text-current/80">
														{m.settings_instance_update_available_body()}
													</p>
												</div>
												{#if updateStatus.release_url}
													<Button
														href={updateStatus.release_url}
														target="_blank"
														rel="noreferrer"
														variant="outline"
														size="sm"
													>
														{m.settings_instance_view_release()}
														<ExternalLinkIcon class="ml-1 h-3.5 w-3.5" />
													</Button>
												{/if}
											</div>
										</InlineNotice>
									{:else if updateStatus.state === 'stale'}
										<InlineNotice tone="info" message={m.settings_instance_stale()} />
									{:else if updateStatus.state === 'unavailable'}
										<InlineNotice tone="info" message={m.settings_instance_unavailable()} />
									{:else if updateStatus.state === 'disabled'}
										<InlineNotice tone="info" message={m.settings_instance_disabled()} />
									{:else if updateStatus.state === 'development'}
										<InlineNotice tone="info" message={m.settings_instance_development()} />
									{:else}
										<InlineNotice tone="success" message={m.settings_instance_current()} />
									{/if}

									<dl class="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
										<div class="min-w-0">
											<dt class="text-sm text-muted-foreground">
												{m.settings_instance_running_version()}
											</dt>
											<dd class="mt-1 font-medium">{updateStatus.running_version}</dd>
										</div>
										<div class="min-w-0">
											<dt class="text-sm text-muted-foreground">
												{m.settings_instance_running_build()}
											</dt>
											<dd
												class="mt-1 truncate font-mono text-sm"
												title={updateStatus.running_build}
											>
												{shortBuild(updateStatus.running_build)}
											</dd>
										</div>
										{#if updateStatus.latest_version}
											<div class="min-w-0">
												<dt class="text-sm text-muted-foreground">
													{m.settings_instance_latest_version()}
												</dt>
												<dd class="mt-1 font-medium">{updateStatus.latest_version}</dd>
											</div>
										{/if}
										{#if updateStatus.checked_at}
											<div class="min-w-0">
												<dt class="text-sm text-muted-foreground">
													{m.settings_instance_last_checked()}
												</dt>
												<dd class="mt-1">{formatDateTime(updateStatus.checked_at)}</dd>
											</div>
										{/if}
									</dl>

									<p class="max-w-2xl text-sm text-muted-foreground">
										{m.settings_instance_no_auto_update()}
									</p>
								</div>
							{/if}
						</div>
					</section>

					<section
						id="configuration"
						class:hidden={activeSettingsTab !== 'configuration'}
						class="scroll-mt-24"
					>
						{#if activeSettingsTab === 'configuration'}
							<InstanceConfiguration active />
						{/if}
					</section>
				{/if}

				<section
					id="workspace"
					class:hidden={activeSettingsTab !== 'general'}
					class="scroll-mt-24 space-y-4"
				>
					<div class="rounded-lg border bg-muted/20 p-4">
						{#if workspaceImagePickerOpen}
							<MediaPicker
								bind:open={workspaceImagePickerOpen}
								workspaceId={workspaceCtx.currentWorkspace?.id ?? ''}
								accept={['image/*']}
								maxSelection={1}
								multiple={false}
								showCreate={false}
								title={m.settings_workspace_image_url()}
								onConfirm={(ids) => {
									if (ids[0]) workspaceCtx.settings.avatar_url = `/media/${ids[0]}`;
								}}
							/>
						{/if}
						<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
							<div
								class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-lg font-semibold text-muted-foreground"
							>
								{#if workspaceCtx.settings.avatar_url}
									<img
										src={getAuthenticatedMediaURL(workspaceCtx.settings.avatar_url)}
										alt={workspaceCtx.currentWorkspace?.name || m.settings_workspace()}
										class="h-full w-full object-cover"
									/>
								{:else}
									{(workspaceCtx.currentWorkspace?.name?.[0] ?? 'W').toUpperCase()}
								{/if}
							</div>
							<div class="min-w-0 flex-1 space-y-3">
								<div class="flex flex-col gap-1">
									<span class="text-sm font-medium">{workspaceCtx.currentWorkspace?.name}</span>
									<span class="text-sm text-muted-foreground">
										{workspaceCtx.currentWorkspace?.organization_name ||
											m.settings_personal_workspace()}
									</span>
								</div>
								<div class="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										onclick={() => (workspaceImagePickerOpen = true)}
									>
										<ImageIcon class="mr-2 size-4" />
										{m.settings_workspace_image_url()}
									</Button>
									{#if workspaceCtx.settings.avatar_url}
										<Button
											type="button"
											variant="ghost"
											class="text-destructive hover:text-destructive"
											onclick={() => (workspaceCtx.settings.avatar_url = '')}
										>
											<TrashIcon class="mr-2 size-4" />{m.settings_remove()}
										</Button>
									{/if}
								</div>
							</div>
						</div>
					</div>

					<div class="mt-4 max-w-sm space-y-2">
						<Label for="workspace-color">{m.settings_workspace_color()}</Label>
						<div class="[&>button]:min-h-11">
							<StudioColorPicker
								id="workspace-color"
								label={m.settings_workspace_color()}
								value={workspaceCtx.settings.color}
								brandColors={brandKit?.colors ?? []}
								onChange={(color) => (workspaceCtx.settings.color = color)}
							/>
						</div>
						<p class="text-sm text-muted-foreground">
							{m.settings_workspace_color_description()}
						</p>
					</div>
					<div
						class="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"
					>
						<div>
							<p class="text-sm font-medium">{m.settings_connected_channels()}</p>
							<p class="text-sm text-muted-foreground">{m.settings_connected_channels_body()}</p>
						</div>
						<Button variant="outline" onclick={() => goto(resolve('/settings?tab=accounts'))}
							>{m.settings_manage_accounts()}</Button
						>
					</div>
					{#if canDeleteCurrentWorkspace}
						<div
							class="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<div>
								<p class="text-sm font-medium text-destructive">{m.workspace_delete_title()}</p>
								<p class="text-sm text-muted-foreground">
									{m.workspace_delete_description()}
								</p>
							</div>
							<Button
								variant="destructive"
								class="shrink-0"
								disabled={workspaceCtx.workspaces.length <= 1}
								title={workspaceCtx.workspaces.length <= 1
									? m.workspace_delete_only_workspace()
									: undefined}
								onclick={() => requestDestructiveAction({ kind: 'workspace' })}
							>
								{m.workspace_delete_confirm()}
							</Button>
						</div>
					{/if}
				</section>

				<section id="team" class:hidden={activeSettingsTab !== 'members'} class="scroll-mt-24">
					{#snippet teamHeaderActions()}
						{#if !teamLoading && workspaceTeam}
							<div class="rounded-md border bg-muted/20 px-3 py-2 text-sm">
								<span class="text-muted-foreground">
									{currentTeamSeats === 1
										? m.settings_seat_reserved()
										: m.settings_seats_reserved({ count: currentTeamSeats })}
								</span>
							</div>
						{/if}
					{/snippet}
					<SectionHeader
						title={m.settings_team()}
						description={m.settings_team_body()}
						icon={UsersIcon}
						actions={!teamLoading && workspaceTeam ? teamHeaderActions : undefined}
						class="mb-4"
					/>

					{#if teamLoadError}
						<div data-testid="team-load-error" class="mb-4">
							<InlineNotice tone="error" message={teamLoadError}>
								{#snippet actions()}
									<Button
										variant="outline"
										size="sm"
										onclick={() => void loadWorkspaceTeam()}
										disabled={teamLoading}
									>
										{m.common_retry()}
									</Button>
								{/snippet}
							</InlineNotice>
						</div>
					{/if}
					{#if teamError}
						<div data-testid="team-error" class="mb-4">
							<InlineNotice tone="error" message={teamError} />
						</div>
					{/if}

					<form
						onsubmit={createWorkspaceInvitation}
						class="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]"
					>
						<div class="space-y-2">
							<Label for="team-invite-email">{m.settings_invite_email()}</Label>
							<Input
								id="team-invite-email"
								data-testid="team-invite-email"
								type="email"
								bind:value={inviteEmail}
								placeholder="teammate@example.com"
								autocomplete="email"
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="team-invite-role">{m.settings_role()}</Label>
							<Select.Root
								type="single"
								value={inviteRole}
								onValueChange={(value) => {
									if (value === 'viewer' || value === 'editor' || value === 'admin') {
										inviteRole = value;
									}
								}}
							>
								<Select.Trigger id="team-invite-role" data-testid="team-invite-role" class="w-full">
									{selectedInviteRole.label}
								</Select.Trigger>
								<Select.Content>
									{#each inviteRoleOptions as option (option.value)}
										<Select.Item value={option.value}>
											<div class="flex flex-col gap-0.5 text-left">
												<span>{option.label}</span>
												<span class="text-xs text-muted-foreground">{option.description}</span>
											</div>
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={teamBusy || !inviteEmail.trim()}>
								{#if teamBusy}
									<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
								{:else}
									<UserPlusIcon class="mr-2 h-4 w-4" />
								{/if}
								{m.settings_send_invite()}
							</Button>
						</div>
					</form>

					{#if createdInviteURL}
						<div
							data-testid="team-invite-link"
							data-feedback-redact
							class="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4"
						>
							<p class="text-sm font-medium text-emerald-900">{m.settings_invite_created()}</p>
							<div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
								<p
									class="min-w-0 flex-1 rounded-md bg-background px-3 py-2 font-mono text-xs break-all"
								>
									{createdInviteURL}
								</p>
								<Button type="button" variant="outline" size="sm" onclick={copyCreatedInviteURL}>
									<CopyIcon class="mr-2 h-4 w-4" />
									{m.common_copy()}
								</Button>
							</div>
						</div>
					{/if}

					{#if teamLoading}
						<PageLoading layout="grid" label={m.common_loading()} items={2} />
					{:else if !teamLoadError}
						<div class="grid gap-4 lg:grid-cols-2">
							<div>
								<h3 class="mb-2 text-sm font-semibold">{m.settings_members_heading()}</h3>
								<div data-testid="team-members-list" class="space-y-2">
									{#each teamMembers as member (member.user_id)}
										<div
											class="flex flex-col gap-2 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
										>
											<div class="min-w-0">
												<p class="truncate text-sm font-medium">{member.email}</p>
											</div>
											<span
												class="inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize"
											>
												{roleLabel(member.role)}
											</span>
										</div>
									{:else}
										<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
											{m.settings_no_members()}
										</p>
									{/each}
								</div>
							</div>

							<div>
								<h3 class="mb-2 text-sm font-semibold">{m.settings_pending_invitations()}</h3>
								<div data-testid="team-invitations-list" class="space-y-2">
									{#each pendingInvitations as invitation (invitation.id)}
										<div
											class="flex flex-col gap-2 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
										>
											<div class="min-w-0">
												<p class="truncate text-sm font-medium">{invitation.email}</p>
												<p class="text-xs text-muted-foreground">
													{m.settings_invitation_expires({
														role: roleLabel(invitation.role),
														date: formatDate(invitation.expires_at)
													})}
												</p>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="text-destructive hover:text-destructive"
												onclick={() =>
													requestDestructiveAction({
														kind: 'invitation',
														invitationID: invitation.id
													})}
												disabled={teamBusy}
											>
												{m.settings_revoke()}
											</Button>
										</div>
									{:else}
										<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
											{m.settings_no_invitations()}
										</p>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</section>

				<section id="sso" class:hidden={activeSettingsTab !== 'sso'} class="scroll-mt-24">
					<OrganizationSSOSettings
						organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
						active={activeSettingsTab === 'sso'}
					/>
				</section>

				<section id="billing" class:hidden={activeSettingsTab !== 'plan'} class="scroll-mt-24">
					<SectionHeader
						title={m.settings_billing()}
						description={m.settings_billing_body()}
						icon={CreditCardIcon}
						class="mb-4"
					>
						{#snippet actions()}
							<Button variant="outline" onclick={openBillingPortal} disabled={billingPortalBusy}>
								{#if billingPortalBusy}
									<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
								{:else}
									<ExternalLinkIcon class="mr-2 h-4 w-4" />
								{/if}
								{m.settings_customer_portal()}
							</Button>
						{/snippet}
					</SectionHeader>

					{#if billingLoadError}
						<InlineNotice tone="error" message={billingLoadError} class="mb-4">
							{#snippet actions()}
								<Button
									variant="outline"
									size="sm"
									onclick={() => void loadBillingStatus()}
									disabled={billingStatusLoading}
								>
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					{:else if billingStatusLoading}
						<div class="mb-4">
							<PageLoading layout="grid" label={m.common_loading()} items={2} />
						</div>
					{:else if billingStatus}
						<div class="mb-4 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
							<div class="rounded-lg border bg-muted/20 p-4">
								<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
									{m.settings_current_plan()}
								</p>
								<div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
									<p class="text-2xl font-semibold">
										{currentBillingPlan?.name ??
											(billingStatus.plan_id || m.settings_no_active_plan())}
									</p>
									<p class="pb-1 text-sm text-muted-foreground">
										{billingStatusLabel(billingStatus.status)}
									</p>
								</div>
								{#if billingStatus.current_period_end}
									<p class="mt-2 text-sm text-muted-foreground">
										{m.settings_billing_period_ends({
											date: formatDate(billingStatus.current_period_end)
										})}
										{#if billingStatus.cancel_at_period_end}
											· {m.settings_billing_cancels_after_period()}
										{/if}
									</p>
								{:else if hasActiveBillingPlan}
									<p class="mt-2 text-sm text-muted-foreground">
										{m.settings_active_plan()}
									</p>
								{:else}
									<p class="mt-2 text-sm text-muted-foreground">
										{m.settings_start_checkout()}
									</p>
								{/if}
							</div>

							<div class="rounded-lg border bg-muted/20 p-4">
								<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
									{m.settings_usage_month()}
								</p>
								{#if monthlyBillingUsageRows.length}
									<div class="mt-3 grid gap-3 sm:grid-cols-2">
										{#each monthlyBillingUsageRows as row (row.metric)}
											<div>
												<div class="mb-1 flex items-center justify-between gap-2 text-sm">
													<span>{row.label}</span>
													<span class="text-muted-foreground">
														{formatBillingValue(row.metric, row.current)} / {formatBillingValue(
															row.metric,
															row.limit
														)}
													</span>
												</div>
												<div class="h-2 overflow-hidden rounded-full bg-muted">
													<div
														class="h-full rounded-full bg-primary"
														style:width={`${Math.min(100, Math.round((row.current / Math.max(row.limit, 1)) * 100))}%`}
													></div>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<p class="mt-2 text-sm text-muted-foreground">
										{m.settings_usage_empty()}
									</p>
								{/if}
							</div>
						</div>

						{#if providerCosts.length}
							<div
								class="mb-4 rounded-lg border bg-background p-4"
								data-testid="provider-cost-usage"
							>
								{#each providerCosts as providerCost (providerCost.provider)}
									<div class="min-w-0">
										<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
											<div class="max-w-2xl">
												<h3 class="font-semibold">{m.settings_provider_costs()}</h3>
												<p class="mt-1 text-sm text-muted-foreground">
													{m.settings_provider_costs_body()}
												</p>
											</div>
											<div class="shrink-0 text-left sm:text-right">
												<p class="font-medium">{providerCostName(providerCost.provider)}</p>
												<p class="text-sm text-muted-foreground">
													{providerCostBudgetLabel(providerCost)}
												</p>
											</div>
										</div>

										<div
											class="mt-4 h-2 overflow-hidden rounded-full bg-muted"
											role="progressbar"
											aria-label={providerCostBudgetLabel(providerCost)}
											aria-valuemin="0"
											aria-valuemax={Math.max(providerCost.budget_microusd, 1)}
											aria-valuenow={Math.min(
												providerCostExposure(providerCost),
												Math.max(providerCost.budget_microusd, 1)
											)}
										>
											<div
												class={[
													'h-full rounded-full',
													providerCostProgress(providerCost) >= 100
														? 'bg-destructive'
														: providerCostProgress(providerCost) >= 80
															? 'bg-amber-500'
															: 'bg-primary'
												]}
												style:width={`${providerCostProgress(providerCost)}%`}
											></div>
										</div>

										{#if providerCost.operations?.length}
											<ul class="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
												{#each providerCost.operations as operation (operation.operation)}
													<li class="flex min-w-0 items-baseline justify-between gap-3 text-sm">
														<div class="min-w-0">
															<p class="truncate">
																{providerCostOperationLabel(operation.operation)}
															</p>
															<p class="text-xs text-muted-foreground">
																{providerCostRequestLabel(operation.event_count)}
															</p>
															{#if operation.reserved_event_count > 0}
																<p class="text-xs text-amber-700 dark:text-amber-300">
																	{providerCostReservationLabel(operation.reserved_event_count)}
																</p>
															{/if}
														</div>
														<div class="shrink-0 text-right">
															<p class="font-medium">
																{formatProviderCost(operation.cost_microusd, providerCost.currency)}
															</p>
															{#if operation.reserved_cost_microusd > 0}
																<p class="text-xs text-amber-700 dark:text-amber-300">
																	{m.settings_provider_cost_reserved_amount({
																		amount: formatProviderCost(
																			operation.reserved_cost_microusd,
																			providerCost.currency
																		)
																	})}
																</p>
															{/if}
														</div>
													</li>
												{/each}
											</ul>
										{/if}

										<div
											class="mt-4 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"
										>
											<p class="max-w-2xl text-xs text-muted-foreground">
												{m.settings_provider_cost_estimate_note()}
											</p>
											<Button
												href={providerCost.pricing_source_url}
												target="_blank"
												rel="noreferrer"
												variant="ghost"
												size="sm"
												class="self-start sm:self-auto"
											>
												{m.settings_provider_cost_view_pricing()}
												<ExternalLinkIcon class="ml-1 h-3.5 w-3.5" />
											</Button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					<details class="border-t pt-4" open={!hasActiveBillingPlan}>
						<summary
							class="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						>
							{hasActiveBillingPlan ? m.settings_compare_plan() : m.settings_choose_plan()}
						</summary>
						<div class="mt-4 grid gap-3 lg:grid-cols-3">
							{#each billingPlans as plan (plan.id)}
								<article
									class={`rounded-lg border p-4 ${plan.featured ? 'border-primary bg-primary/5 shadow-sm' : 'bg-background'}`}
								>
									<div class="mb-3 flex items-start justify-between gap-3">
										<div>
											<h3 class="font-semibold">{plan.name}</h3>
											<p class="text-sm text-muted-foreground">{plan.description}</p>
										</div>
										<div class="text-right">
											<div class="text-xl font-semibold">
												{formatPlanPrice(plan.monthlyPriceUSD)}
											</div>
											<div class="text-xs text-muted-foreground">
												{m.settings_price_per_month()}
											</div>
										</div>
									</div>
									<ul class="mb-4 space-y-1 text-sm text-muted-foreground">
										{#each plan.limits as limit (limit)}
											<li>{limit}</li>
										{/each}
									</ul>
									<Button
										class="w-full"
										variant={plan.featured ? 'default' : 'outline'}
										onclick={() => startCheckout(plan.id)}
										disabled={Boolean(billingBusyPlan) || hasActiveBillingPlan}
									>
										{#if billingBusyPlan === plan.id}
											<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
										{/if}
										{#if hasActiveBillingPlan && billingStatus?.plan_id === plan.id}
											{m.settings_current_plan()}
										{:else if hasActiveBillingPlan}
											{m.settings_use_portal()}
										{:else}
											{m.settings_choose_named_plan({ plan: plan.name })}
										{/if}
									</Button>
								</article>
							{/each}
						</div>
					</details>

					{#if billingError}
						<InlineNotice tone="error" message={billingError} class="mt-4" />
					{/if}
				</section>

				<section id="security" class:hidden={activeSettingsTab !== 'security'} class="scroll-mt-24">
					{#if loadingSecurity}
						<PageLoading layout="grid" label={m.common_loading()} items={2} />
					{:else}
						<div class="space-y-4">
							<div class="border-y py-3">
								<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<p class="text-sm font-medium">{securityStatus?.user.email}</p>
										<p class="text-sm text-muted-foreground">
											{m.settings_active_methods()}
											{securityStatus?.methods?.length
												? (securityStatus.methods ?? []).map(securityMethodLabel).join(', ')
												: m.settings_none_configured()}
										</p>
									</div>
									<p class="text-sm text-muted-foreground">
										{m.settings_passkey_count({ count: passkeyCount })}
									</p>
								</div>
							</div>

							<div class="rounded-lg border p-4">
								<div class="mb-4 flex items-center justify-between gap-3">
									<div>
										<h3 class="flex items-center gap-2 font-medium">
											<MonitorIcon class="h-4 w-4 text-muted-foreground" />
											{m.settings_active_sessions()}
										</h3>
										<p class="mt-1 text-sm text-muted-foreground">
											{m.settings_active_sessions_body()}
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										onclick={loadAuthSessions}
										disabled={authSessionsLoading}
									>
										{#if authSessionsLoading}
											<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
										{/if}
										{m.common_refresh()}
									</Button>
								</div>

								{#if authSessionsError}
									<InlineNotice tone="error" message={authSessionsError} class="mb-3" />
								{/if}

								{#if authSessionsLoading}
									<PageLoading layout="list" label={m.common_loading()} items={2} />
								{:else if authSessions.length === 0}
									<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
										{m.settings_no_sessions()}
									</p>
								{:else}
									<div class="space-y-2" data-testid="auth-session-list">
										{#each authSessions as session (session.id)}
											<div
												class="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
												data-testid="auth-session-row"
											>
												<div class="min-w-0">
													<div class="flex flex-wrap items-center gap-2">
														<p class="truncate text-sm font-medium" title={session.user_agent}>
															{formatSessionUserAgent(session.user_agent)}
														</p>
														{#if session.current}
															<span
																class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
															>
																{m.settings_current()}
															</span>
														{/if}
													</div>
													<p class="mt-1 text-xs text-muted-foreground">
														{session.ip_address || m.settings_unknown_ip()} · {m.settings_last_used()}
														{formatSessionTime(session.last_used_at)} · {m.settings_expires()}
														{formatSessionTime(session.expires_at)}
													</p>
												</div>
												<Button
													variant="ghost"
													size="sm"
													class="self-start text-destructive hover:text-destructive sm:self-center"
													onclick={() => requestDestructiveAction({ kind: 'session', session })}
													disabled={Boolean(authSessionBusyID)}
												>
													{#if authSessionBusyID === session.id}
														<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
													{:else}
														<LogOutIcon class="mr-2 h-4 w-4" />
													{/if}
													{session.current ? m.settings_sign_out() : m.settings_revoke()}
												</Button>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<div class="rounded-lg border p-4">
								<div class="mb-4">
									<h3 class="flex items-center gap-2 font-medium">
										<KeyRoundIcon class="h-4 w-4 text-muted-foreground" />
										{m.settings_linked_identities()}
									</h3>
									<p class="mt-1 text-sm text-muted-foreground">
										{m.settings_linked_identities_body()}
									</p>
								</div>

								{#if hasPasswordCredential && (linkedIdentities.length || unlinkedProviders.length)}
									<div class="mb-3 max-w-sm space-y-2">
										<Label for="identity-link-password">{m.settings_current_password()}</Label>
										<Input
											id="identity-link-password"
											type="password"
											bind:value={identityPassword}
											autocomplete="current-password"
										/>
									</div>
								{:else if !hasPasswordCredential && (linkedIdentities.length || unlinkedProviders.length)}
									<p class="mb-3 text-sm text-muted-foreground">{m.settings_step_up_body()}</p>
								{/if}

								<div class="space-y-2">
									{#each linkedIdentities as identity (identity.id)}
										<div
											class="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
										>
											<div class="min-w-0">
												<p class="text-sm font-medium">{identity.provider_name}</p>
												<p class="truncate text-xs text-muted-foreground">
													{identity.linked_email ?? securityStatus?.user.email}
												</p>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="self-start text-destructive hover:text-destructive sm:self-auto"
												disabled={Boolean(identityBusy) ||
													(hasPasswordCredential ? !identityPassword.trim() : !hasStepUpMethod)}
												onclick={() => void unlinkIdentity(identity.id)}
											>
												{m.settings_unlink_identity()}
											</Button>
										</div>
									{/each}
								</div>

								{#if unlinkedProviders.length}
									<div class="mt-4 flex flex-wrap gap-2">
										{#each unlinkedProviders as provider (provider.id)}
											<Button
												type="button"
												variant="outline"
												disabled={Boolean(identityBusy) ||
													(hasPasswordCredential ? !identityPassword.trim() : !hasStepUpMethod)}
												onclick={() => void linkIdentity(provider.id)}
											>
												{m.settings_link_identity({ provider: provider.name })}
											</Button>
										{/each}
									</div>
								{:else if linkedIdentities.length === 0}
									<p class="text-sm text-muted-foreground">{m.settings_no_linkable_identities()}</p>
								{/if}
							</div>

							<div class="grid gap-4 lg:grid-cols-2">
								<div class="rounded-lg border p-4">
									<div class="mb-3 flex items-center gap-2">
										<SmartphoneIcon class="h-4 w-4 text-muted-foreground" />
										<h3 class="font-medium">{m.settings_authenticator()}</h3>
									</div>
									<p class="mb-4 text-sm text-muted-foreground">
										{m.settings_authenticator_body()}
									</p>

									{#if securityStatus?.totp_enabled}
										<div class="space-y-3">
											<div class="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
												{m.settings_authenticator_enabled()}
											</div>
											{#if hasPasswordCredential}
												<div class="space-y-2">
													<Label for="disable-password">{m.settings_current_password()}</Label>
													<Input
														id="disable-password"
														type="password"
														bind:value={totpCurrentPassword}
														autocomplete="current-password"
														placeholder={m.settings_password_required_disable()}
													/>
												</div>
											{:else}
												<p class="text-sm text-muted-foreground">
													{m.settings_step_up_body()}
												</p>
											{/if}
											<Button
												variant="outline"
												onclick={disableTOTP}
												disabled={securityBusy ||
													(hasPasswordCredential ? !totpCurrentPassword.trim() : !hasStepUpMethod)}
											>
												{m.settings_disable_authenticator()}
											</Button>
										</div>
									{:else}
										<div class="space-y-3">
											{#if hasPasswordCredential}
												<div class="space-y-2">
													<Label for="totp-password">{m.settings_current_password()}</Label>
													<Input
														id="totp-password"
														type="password"
														bind:value={totpCurrentPassword}
														autocomplete="current-password"
														placeholder={m.settings_password_required_setup()}
													/>
												</div>
											{:else}
												<p class="text-sm text-muted-foreground">
													{m.settings_step_up_body()}
												</p>
											{/if}
											<Button
												onclick={startTOTPSetup}
												disabled={securityBusy ||
													(hasPasswordCredential ? !totpCurrentPassword.trim() : !hasStepUpMethod)}
											>
												{m.settings_start_authenticator()}
											</Button>

											{#if totpSetupChallengeId}
												<div
													class="space-y-3 rounded-lg border bg-muted/20 p-4"
													data-feedback-redact
												>
													<img
														src={totpQRCodeDataURL}
														alt={m.settings_totp_qr_alt()}
														class="mx-auto h-48 w-48 rounded-lg border bg-white p-2"
													/>
													<div class="space-y-1">
														<p class="text-sm font-medium">{m.settings_manual_key()}</p>
														<p class="font-mono text-xs break-all text-muted-foreground">
															{totpManualEntryKey}
														</p>
													</div>
													<div class="space-y-2">
														<Label for="totp-code">{m.settings_totp_code()}</Label>
														<Input
															id="totp-code"
															bind:value={totpCode}
															inputmode="numeric"
															autocomplete="one-time-code"
															maxlength={6}
															placeholder="123456"
														/>
													</div>
													<Button
														onclick={confirmTOTPSetup}
														disabled={securityBusy || totpCode.trim().length !== 6}
													>
														{m.settings_confirm_authenticator()}
													</Button>
												</div>
											{/if}
										</div>
									{/if}
								</div>

								<div class="rounded-lg border p-4">
									<div class="mb-3 flex items-center gap-2">
										<KeyRoundIcon class="h-4 w-4 text-muted-foreground" />
										<h3 class="font-medium">{m.settings_passkeys()}</h3>
									</div>
									<p class="mb-4 text-sm text-muted-foreground">
										{m.settings_passkeys_body()}
									</p>

									<div class="space-y-3">
										{#if hasPasswordCredential}
											<div class="space-y-2">
												<Label for="passkey-password">{m.settings_current_password()}</Label>
												<Input
													id="passkey-password"
													type="password"
													bind:value={passkeyCurrentPassword}
													autocomplete="current-password"
													placeholder={m.settings_password_required_passkeys()}
												/>
											</div>
										{:else}
											<p class="text-sm text-muted-foreground">
												{m.settings_step_up_body()}
											</p>
										{/if}
										<div class="space-y-2">
											<Label for="passkey-name">{m.settings_passkey_name()}</Label>
											<Input
												id="passkey-name"
												bind:value={newPasskeyName}
												placeholder={m.settings_passkey_name_placeholder()}
											/>
										</div>
										<Button
											onclick={addPasskey}
											disabled={securityBusy ||
												(hasPasswordCredential ? !passkeyCurrentPassword.trim() : !hasStepUpMethod)}
										>
											{m.settings_add_passkey()}
										</Button>
									</div>

									<div class="mt-4 space-y-2">
										{#if (securityStatus?.passkeys ?? []).length}
											{#each securityStatus?.passkeys ?? [] as passkey (passkey.id)}
												<div class="flex items-center justify-between rounded-md border px-3 py-2">
													<div>
														<p class="text-sm font-medium">{passkey.name}</p>
														<p class="text-xs text-muted-foreground">
															{#if passkey.last_used_at && passkey.last_used_at !== '0001-01-01T00:00:00Z'}
																{m.settings_passkey_last_used({
																	date: formatDateTime(passkey.last_used_at)
																})}
															{:else}
																{m.settings_passkey_added_on({
																	date: formatDateTime(passkey.created_at)
																})}
															{/if}
														</p>
													</div>
													<Button
														variant="ghost"
														size="sm"
														class="text-destructive hover:text-destructive"
														onclick={() => removePasskey(passkey.id)}
														disabled={securityBusy ||
															(hasPasswordCredential
																? !passkeyCurrentPassword.trim()
																: !hasStepUpMethod)}
													>
														{m.settings_remove()}
													</Button>
												</div>
											{/each}
										{:else}
											<p class="text-sm text-muted-foreground">{m.settings_no_passkeys()}</p>
										{/if}
									</div>
								</div>
							</div>

							<AccountDataCard
								email={securityStatus?.user.email ?? profileEmail}
								hasPassword={hasPasswordCredential}
								{reauthProviderID}
								hasPasskey={passkeyCount > 0}
							/>

							{#if securityError}
								<InlineNotice tone="error" message={securityError} />
							{/if}
						</div>
					{/if}
				</section>

				<section id="tokens" class:hidden={activeSettingsTab !== 'developer'} class="scroll-mt-24">
					<SectionHeader
						title={m.settings_tokens_heading()}
						description={m.settings_tokens_body()}
						icon={TerminalIcon}
						class="mb-4"
					/>

					{#if apiTokenScope === 'mcp:read'}
						<InlineNotice
							tone="info"
							message={m.settings_token_scope_mcp_read_boundary()}
							class="mb-4"
						/>
					{:else if apiTokenScope === 'mcp:full'}
						<InlineNotice
							tone="warning"
							message={m.settings_token_scope_mcp_full_boundary()}
							class="mb-4"
						/>
					{/if}

					{#if apiTokensLoadError}
						<div data-testid="api-tokens-load-error" class="mb-4">
							<InlineNotice tone="error" message={apiTokensLoadError}>
								{#snippet actions()}
									<Button
										variant="outline"
										size="sm"
										onclick={() => void loadAPITokens()}
										disabled={apiTokensLoading}
									>
										{m.common_retry()}
									</Button>
								{/snippet}
							</InlineNotice>
						</div>
					{/if}
					{#if apiTokenError}
						<InlineNotice tone="error" message={apiTokenError} class="mb-4" />
					{/if}

					<div class="mb-4 grid gap-3 lg:grid-cols-[1fr_240px_240px_auto]">
						<div class="space-y-2">
							<Label for="api-token-name">{m.settings_token_name()}</Label>
							<Input
								id="api-token-name"
								bind:value={apiTokenName}
								placeholder={m.settings_token_name_placeholder()}
							/>
						</div>
						<div class="space-y-2">
							<Label for="api-token-scope">{m.settings_token_scope()}</Label>
							<Select.Root
								type="single"
								value={apiTokenScope}
								onValueChange={(value) => value && (apiTokenScope = value)}
							>
								<Select.Trigger id="api-token-scope" data-testid="api-token-scope" class="w-full">
									{selectedAPITokenScope.label}
								</Select.Trigger>
								<Select.Content>
									{#each apiTokenScopeOptions as option (option.value)}
										<Select.Item value={option.value}>
											<div class="flex flex-col gap-0.5 text-left">
												<span>{option.label}</span>
												<span class="text-xs text-muted-foreground">{option.description}</span>
											</div>
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="space-y-2">
							<Label for="api-token-workspace">{m.settings_access_boundary()}</Label>
							<Select.Root
								type="single"
								value={apiTokenWorkspaceScope}
								onValueChange={(value) => value && (apiTokenWorkspaceScope = value)}
							>
								<Select.Trigger id="api-token-workspace" class="w-full">
									{selectedAPITokenWorkspaceScope.label}
								</Select.Trigger>
								<Select.Content>
									{#each apiTokenWorkspaceOptions as option (option.value)}
										<Select.Item value={option.value}>
											<div class="flex flex-col gap-0.5 text-left">
												<span>{option.label}</span>
												<span class="text-xs text-muted-foreground">{option.description}</span>
											</div>
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-end">
							<Button
								onclick={createAPIToken}
								disabled={apiTokenBusy ||
									(apiTokenWorkspaceScope === 'current' && !workspaceCtx.currentWorkspace)}
							>
								{#if apiTokenBusy}
									<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
								{/if}
								{m.settings_create_token()}
							</Button>
						</div>
					</div>

					{#if createdAPIToken}
						<div
							class="mb-4 rounded-lg border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-950"
							data-feedback-redact
						>
							<p class="font-medium">{m.settings_copy_token_now()}</p>
							<p class="mt-2 font-mono text-xs break-all">{createdAPIToken}</p>
						</div>
					{/if}

					{#if apiTokensLoading && apiTokens.length === 0}
						<PageLoading layout="list" label={m.common_loading()} items={2} />
					{:else if apiTokens.length === 0 && !apiTokensLoadError}
						<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
							{m.settings_no_tokens()}
						</p>
					{:else if apiTokens.length > 0}
						<div class="space-y-2">
							{#each apiTokens as token (token.id)}
								<div
									class="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div>
										<p class="text-sm font-medium">{token.name}</p>
										<p class="text-xs text-muted-foreground">
											{m.settings_token_prefix()}
											<span class="font-mono">{token.token_prefix}</span> ·
											{apiTokenScopeLabel(token.scope)} ·
											{m.settings_token_created({ date: formatDateTime(token.created_at) })}
											{#if token.workspace_id}
												· {m.settings_token_workspace()}
												<span class="font-mono">{token.workspace_id}</span>
											{:else}
												· {m.settings_all_workspaces()}
											{/if}
											{#if token.last_used_at}
												· {m.settings_token_last_used({
													date: formatDateTime(token.last_used_at)
												})}
											{/if}
										</p>
									</div>
									<Button
										variant="ghost"
										size="sm"
										class="text-destructive hover:text-destructive"
										onclick={() =>
											requestDestructiveAction({ kind: 'api-token', tokenID: token.id })}
										disabled={apiTokenBusy}
									>
										{m.settings_revoke()}
									</Button>
								</div>
							{/each}
						</div>
					{/if}

					<div class="mt-6 border-t pt-6">
						<div class="mb-4 flex items-center justify-between gap-3">
							<div>
								<h3 class="flex items-center gap-2 text-sm font-semibold">
									<ActivityIcon class="h-4 w-4 text-muted-foreground" />
									{m.settings_mcp_activity()}
								</h3>
								<p class="mt-1 text-sm text-muted-foreground">
									{m.settings_mcp_activity_body()}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								onclick={loadMCPActivity}
								disabled={mcpActivityLoading}
							>
								{#if mcpActivityLoading}
									<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
								{/if}
								{m.common_refresh()}
							</Button>
						</div>

						{#if mcpActivityError}
							<div data-testid="mcp-activity-error" class="mb-3">
								<InlineNotice tone="error" message={mcpActivityError} />
							</div>
						{/if}

						{#if mcpActivityLoading}
							<PageLoading layout="list" label={m.common_loading()} items={2} />
						{:else if mcpActivity.length === 0}
							<p
								data-testid="mcp-activity-empty"
								class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground"
							>
								{m.settings_no_mcp_activity()}
							</p>
						{:else}
							<div data-testid="mcp-activity-list" class="space-y-2">
								{#each mcpActivity as call (call.id)}
									<div class="rounded-md border px-3 py-3">
										<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
											<div class="min-w-0">
												<p class="truncate text-sm font-medium">{call.tool_name}</p>
												<p class="mt-1 text-xs text-muted-foreground">
													{formatDateTime(call.created_at)} · {call.duration_ms} ms
													{#if call.workspace_id}
														· {m.settings_mcp_workspace()}
														<span class="font-mono">{call.workspace_id}</span>
													{/if}
												</p>
												{#if call.client_name || call.client_scope}
													<p class="mt-1 truncate text-xs text-muted-foreground">
														{m.settings_mcp_client()}
														{call.client_name || apiTokenScopeLabel(call.client_scope ?? '')}
														{#if call.client_token_prefix}
															· <span class="font-mono">{call.client_token_prefix}</span>
														{/if}
													</p>
												{/if}
											</div>
											<span
												class={[
													'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium',
													call.status === 'success'
														? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
														: 'border-destructive/30 bg-destructive/10 text-destructive'
												]}
											>
												{mcpStatusLabel(call.status)}
											</span>
										</div>
										{#if call.error_message}
											<p class="mt-2 text-xs text-destructive">{call.error_message}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>

				<section
					id="date-time"
					class:hidden={activeSettingsTab !== 'general'}
					class="scroll-mt-24 space-y-4"
				>
					<SectionHeader title={m.settings_date_time()} icon={ClockIcon} class="mb-4" />
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<label class="text-sm font-medium" for="timezone-select"
								>{m.settings_timezone()}</label
							>
							<Select.Root
								type="single"
								value={workspaceCtx.settings.timezone}
								onValueChange={handleTimezoneChange}
							>
								<Select.Trigger id="timezone-select" class="w-full">
									{getTimezoneLabel(workspaceCtx.settings.timezone)}
								</Select.Trigger>
								<Select.Content class="max-h-80 overflow-y-auto">
									{#each Object.entries(groupedTimezones) as [group, tzs] (group)}
										<Select.Group>
											<Select.GroupHeading class="text-xs">{group}</Select.GroupHeading>
											{#each tzs as tz (tz.value)}
												<Select.Item value={tz.value}>{tz.label}</Select.Item>
											{/each}
										</Select.Group>
									{/each}
								</Select.Content>
							</Select.Root>
							<p class="text-sm text-muted-foreground">
								{m.settings_timezone_body()}
							</p>
						</div>

						<div class="space-y-2">
							<label class="text-sm font-medium" for="week-start-select"
								>{m.settings_week_starts()}</label
							>
							<Select.Root
								type="single"
								value={String(workspaceCtx.settings.week_start)}
								onValueChange={(v) => handleWeekStartChange(Number(v))}
							>
								<Select.Trigger id="week-start-select" class="w-full">
									{workspaceCtx.settings.week_start === 0
										? m.settings_sunday()
										: m.settings_monday()}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="0">{m.settings_sunday()}</Select.Item>
									<Select.Item value="1">{m.settings_monday()}</Select.Item>
								</Select.Content>
							</Select.Root>
							<p class="text-sm text-muted-foreground">
								{m.settings_week_start_body()}
							</p>
						</div>
					</div>
				</section>

				<section id="brand" class:hidden={activeSettingsTab !== 'brand'} class="scroll-mt-24">
					{#if brandLoading}
						<PageLoading layout="sections" label={m.media_loading_brand()} />
					{:else if brandError}
						<InlineNotice tone="error" message={brandError}>
							{#snippet actions()}
								<Button variant="outline" size="sm" onclick={() => void loadBrandKit()}>
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					{:else if brandKit}
						{#if brandKit.can_edit}
							<BrandKitEditor kit={brandKit} onSaved={(saved) => (brandKit = saved)} />
						{:else}
							<div class="space-y-8">
								<InlineNotice tone="info" message={m.brand_read_only()} />
								<div class="grid gap-8 lg:grid-cols-2">
									<section class="space-y-4">
										<div class="flex items-center gap-2">
											<PaletteIcon class="size-4 text-primary" />
											<h2 class="font-semibold">{m.brand_colors_backgrounds()}</h2>
										</div>
										<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
											{#each brandKit.colors as color (color.id || color.name)}
												<div class="overflow-hidden rounded-xl border">
													<div class="h-16" style:background={color.value}></div>
													<div class="px-3 py-2 text-xs">
														<p class="font-medium">{color.name}</p>
														<p class="text-muted-foreground">{color.value}</p>
													</div>
												</div>
											{/each}
										</div>
										<div>
											<h3 class="mb-2 text-sm font-medium">{m.brand_page_backgrounds()}</h3>
											<div class="flex flex-wrap gap-2">
												{#each brandKit.backgrounds as background (background)}
													<span
														class="size-11 rounded-lg border"
														style:background
														title={background}
													></span>
												{/each}
											</div>
										</div>
									</section>
									<section class="space-y-4">
										<div>
											<h2 class="font-semibold">{m.media_logos_fonts()}</h2>
											<p class="mt-1 text-sm text-muted-foreground">
												{m.media_brand_assets_body()}
											</p>
										</div>
										<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
											{#each brandKit.assets as asset (asset.id)}
												<div class="overflow-hidden rounded-xl border">
													<div
														class="flex aspect-square items-center justify-center bg-muted/20 p-3"
													>
														<MediaPreviewImage
															mediaId={asset.media_id}
															alt={asset.name || asset.role}
															class="max-h-full max-w-full object-contain"
														/>
													</div>
													<p class="truncate border-t px-3 py-2 text-xs">
														{asset.name || asset.role}
													</p>
												</div>
											{/each}
										</div>
										<div class="divide-y rounded-xl border">
											{#each brandKit.fonts as font (font.id)}
												<div class="px-3 py-3">
													<p class="text-sm font-medium">{font.family}</p>
													<p class="text-xs text-muted-foreground">
														{font.weight} · {font.style}
													</p>
												</div>
											{/each}
										</div>
										{#if brandKit.assets.length === 0 && brandKit.fonts.length === 0}
											<p class="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
												{m.studio_brand_empty()}
											</p>
										{/if}
									</section>
								</div>
							</div>
						{/if}
					{/if}
				</section>

				<section
					id="media-cleanup"
					class:hidden={activeSettingsTab !== 'general'}
					class="scroll-mt-24 space-y-4"
				>
					<SectionHeader title={m.settings_media_cleanup()} icon={ImageIcon} class="mb-4" />
					<div class="space-y-2">
						<label class="text-sm font-medium" for="cleanup-select"
							>{m.settings_auto_delete_media()}</label
						>
						<Select.Root
							type="single"
							value={String(workspaceCtx.settings.media_cleanup_days)}
							onValueChange={(v) => handleCleanupDaysChange(Number(v))}
						>
							<Select.Trigger id="cleanup-select" class="w-full">
								{cleanupDaysOptions.find(
									(o) => o.value === workspaceCtx.settings.media_cleanup_days
								)?.label || m.settings_disabled()}
							</Select.Trigger>
							<Select.Content>
								{#each cleanupDaysOptions as option (option.value)}
									<Select.Item value={String(option.value)}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-sm text-muted-foreground">
							{m.settings_auto_delete_media_body()}
						</p>
					</div>
				</section>

				<section
					id="posting-schedule"
					class:hidden={activeSettingsTab !== 'schedule'}
					class="scroll-mt-24"
				>
					<SectionHeader
						title={m.settings_posting_schedule()}
						description={m.settings_schedule_body()}
						icon={CalendarIcon}
						class="mb-4"
					>
						{#snippet actions()}
							<Button
								onclick={() => (showSuggestSchedule = !showSuggestSchedule)}
								variant="outline"
								size="sm"
							>
								<SparklesIcon class="mr-2 h-4 w-4" />
								{m.settings_suggest_pattern()}
							</Button>
						{/snippet}
					</SectionHeader>

					<div class="mb-4 rounded-xl border bg-muted/20 p-4">
						<div class="grid gap-4 lg:grid-cols-[180px_1fr_auto]">
							<div class="space-y-2">
								<label class="text-sm font-medium" for="new-time">{m.settings_add_time_row()}</label
								>
								<Input id="new-time" bind:value={newTimeInput} type="time" step="900" />
							</div>
							<div class="space-y-2">
								<span class="text-sm font-medium">{m.settings_active_days()}</span>
								<div class="flex flex-wrap gap-3">
									{#each dayOrder as dayIndex (dayIndex)}
										<label
											class="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
										>
											<Checkbox
												checked={newTimeDays.includes(dayIndex)}
												onCheckedChange={() => toggleNewDay(dayIndex)}
											/>
											<span>{localizedWeekday(dayIndex)}</span>
										</label>
									{/each}
								</div>
							</div>
							<div class="flex items-end">
								<Button onclick={addTimeRow} class="w-full lg:w-auto">
									<PlusIcon class="mr-2 h-4 w-4" />
									{m.settings_add_time()}
								</Button>
							</div>
						</div>
						{#if newTimeError}
							<p class="mt-3 text-xs text-destructive">{newTimeError}</p>
						{:else}
							<p class="mt-3 text-xs text-muted-foreground">
								{m.settings_new_rows_timezone({
									timezone: getTimezoneLabel(workspaceCtx.settings.timezone)
								})}
							</p>
						{/if}
					</div>

					{#if showSuggestSchedule}
						<div class="mb-4 rounded-xl border bg-background p-4">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
								<div class="space-y-2">
									<label class="text-sm font-medium" for="posts-per-day"
										>{m.settings_suggested_posts_day()}</label
									>
									<Select.Root
										type="single"
										value={String(suggestedPostsPerDay)}
										onValueChange={(v) => (suggestedPostsPerDay = Number(v))}
									>
										<Select.Trigger id="posts-per-day" class="w-28">
											{suggestedPostsPerDay}
										</Select.Trigger>
										<Select.Content class="max-h-60 overflow-y-auto">
											{#each Array.from({ length: 10 }, (_, i) => i + 1) as n (n)}
												<Select.Item value={String(n)}>{n}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
								<div class="flex gap-2">
									<Button onclick={() => (showSuggestSchedule = false)} variant="outline" size="sm"
										>{m.common_cancel()}</Button
									>
									<Button
										onclick={generateSuggestedSchedule}
										size="sm"
										disabled={generatingSchedule}
									>
										{#if generatingSchedule}
											<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
										{/if}
										{m.settings_generate()}
									</Button>
								</div>
							</div>
						</div>
					{/if}

					{#if scheduleError}
						<InlineNotice tone="error" message={scheduleError} class="mb-4">
							{#snippet actions()}
								<Button
									variant="outline"
									size="sm"
									onclick={() => void loadSchedules()}
									disabled={loadingSchedules}
								>
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					{:else if loadingSchedules}
						<PageLoading layout="list" label={m.common_loading()} items={3} />
					{:else if scheduleRows.length === 0}
						<div class="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
							{m.settings_no_posting_times()}
						</div>
					{:else}
						<div class="space-y-3 xl:hidden">
							{#each scheduleRows as row (row.key)}
								<div class="rounded-xl border bg-card p-4">
									<div class="mb-3 flex items-start justify-between gap-3">
										<div>
											<div class="font-medium">{formatTime(row.local_hour, row.local_minute)}</div>
											{#if row.label}
												<div class="text-xs text-muted-foreground">{row.label}</div>
											{/if}
										</div>
										<Button
											variant="ghost"
											size="icon-sm"
											onclick={() => requestDestructiveAction({ kind: 'time-row', row })}
											aria-label={m.settings_remove_time_row({
												time: formatTime(row.local_hour, row.local_minute)
											})}
										>
											<TrashIcon class="size-4" />
										</Button>
									</div>
									<div
										class="grid grid-cols-2 gap-2 sm:grid-cols-4"
										role="group"
										aria-label={formatTime(row.local_hour, row.local_minute)}
									>
										{#each dayOrder as dayIndex (`mobile-${row.key}-${dayIndex}`)}
											<label
												class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm"
											>
												<Checkbox
													checked={Boolean(row.days[dayIndex])}
													onCheckedChange={() => toggleScheduleCell(row, dayIndex)}
												/>
												<span>{localizedWeekday(dayIndex)}</span>
											</label>
										{/each}
									</div>
								</div>
							{/each}
						</div>

						<div class="hidden overflow-x-auto rounded-xl border xl:block">
							<div class="min-w-[680px]">
								<div
									class="grid grid-cols-[120px_repeat(7,minmax(56px,1fr))_52px] border-b bg-muted/30"
								>
									<div
										class="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
									>
										{m.settings_time()}
									</div>
									{#each dayOrder as dayIndex (dayIndex)}
										<div
											class="px-2 py-3 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
										>
											{localizedWeekday(dayIndex)}
										</div>
									{/each}
									<div class="px-2 py-3"></div>
								</div>

								{#each scheduleRows as row (row.key)}
									<div
										class="grid grid-cols-[120px_repeat(7,minmax(56px,1fr))_52px] border-b last:border-b-0"
									>
										<div class="px-4 py-3">
											<div class="font-medium">{formatTime(row.local_hour, row.local_minute)}</div>
											{#if row.label}
												<div class="text-xs text-muted-foreground">{row.label}</div>
											{/if}
										</div>
										{#each dayOrder as dayIndex (`${row.key}-${dayIndex}`)}
											<div class="flex items-center justify-center px-2 py-3">
												<Checkbox
													checked={Boolean(row.days[dayIndex])}
													onCheckedChange={() => toggleScheduleCell(row, dayIndex)}
													aria-label={m.settings_toggle_schedule_cell({
														day: localizedWeekday(dayIndex, 'long'),
														time: formatTime(row.local_hour, row.local_minute)
													})}
												/>
											</div>
										{/each}
										<div class="flex items-center justify-center px-2 py-3">
											<Button
												variant="ghost"
												size="icon"
												class="h-8 w-8"
												onclick={() => requestDestructiveAction({ kind: 'time-row', row })}
												aria-label={m.settings_remove_time_row({
													time: formatTime(row.local_hour, row.local_minute)
												})}
											>
												<TrashIcon class="h-4 w-4" />
											</Button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</section>

				<section
					id="natural-posting"
					class:hidden={activeSettingsTab !== 'schedule'}
					class="scroll-mt-24 space-y-4"
				>
					<SectionHeader
						title={m.settings_advanced_scheduling()}
						description={m.settings_advanced_scheduling_body()}
						icon={ClockIcon}
						class="mb-4"
					/>
					<div class="space-y-4">
						<div class="space-y-2">
							<label class="text-sm font-medium" for="random-delay"
								>{m.settings_time_variation()}</label
							>
							<Select.Root
								type="single"
								value={String(workspaceCtx.settings.random_delay_minutes)}
								onValueChange={(v) => (workspaceCtx.settings.random_delay_minutes = Number(v))}
							>
								<Select.Trigger id="random-delay" class="w-full sm:w-64">
									{#if workspaceCtx.settings.random_delay_minutes === 0}
										{m.settings_no_delay()}
									{:else}
										±{m.settings_minutes({
											minutes: workspaceCtx.settings.random_delay_minutes
										})}
									{/if}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="0">{m.settings_no_delay()}</Select.Item>
									{#each [5, 10, 15, 30, 45] as delay (delay)}
										<Select.Item value={String(delay)}
											>±{m.settings_minutes({ minutes: delay })}</Select.Item
										>
									{/each}
									<Select.Item value="60">±{m.settings_one_hour()}</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="space-y-2">
							<label class="text-sm font-medium" for="draft-gap">{m.settings_queue_full()}</label>
							<Input
								id="draft-gap"
								type="text"
								value={draftGapInput}
								oninput={(e) => handleDraftGapChange((e.target as HTMLInputElement).value)}
								placeholder={m.settings_draft_gap_placeholder()}
								class={draftGapError ? 'border-destructive' : ''}
								aria-invalid={Boolean(draftGapError)}
								aria-describedby={draftGapError ? 'draft-gap-error' : undefined}
							/>
							{#if draftGapError}
								<p id="draft-gap-error" class="text-xs text-destructive">{draftGapError}</p>
							{:else}
								<p class="text-xs text-muted-foreground">
									{m.settings_queue_spillover_body({
										minutes: workspaceCtx.settings.draft_gap_minutes
									})}
								</p>
							{/if}
						</div>
					</div>
				</section>

				<section
					id="slot-defaults"
					class:hidden={activeSettingsTab !== 'schedule'}
					class="scroll-mt-24 space-y-4"
				>
					<SectionHeader
						title={m.settings_time_picker_range()}
						description={m.settings_time_picker_range_body()}
						icon={ClockIcon}
						class="mb-4"
					/>
					<div class="space-y-4">
						<div class="grid gap-4 sm:grid-cols-3">
							<div class="space-y-2">
								<label class="text-sm font-medium" for="start-time">{m.settings_start_time()}</label
								>
								<Select.Root
									type="single"
									value={String(workspaceCtx.settings.slot_start_hour)}
									onValueChange={(v) => (workspaceCtx.settings.slot_start_hour = Number(v))}
								>
									<Select.Trigger id="start-time" class="w-full">
										{workspaceCtx.settings.slot_start_hour.toString().padStart(2, '0')}:00
									</Select.Trigger>
									<Select.Content class="max-h-60 overflow-y-auto">
										{#each Array.from({ length: 24 }, (_, i) => i) as hour (hour)}
											<Select.Item value={String(hour)}
												>{hour.toString().padStart(2, '0')}:00</Select.Item
											>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="space-y-2">
								<label class="text-sm font-medium" for="end-time">{m.settings_end_time()}</label>
								<Select.Root
									type="single"
									value={String(workspaceCtx.settings.slot_end_hour)}
									onValueChange={(v) => (workspaceCtx.settings.slot_end_hour = Number(v))}
								>
									<Select.Trigger id="end-time" class="w-full">
										{workspaceCtx.settings.slot_end_hour.toString().padStart(2, '0')}:00
									</Select.Trigger>
									<Select.Content class="max-h-60 overflow-y-auto">
										{#each Array.from({ length: 24 }, (_, i) => i) as hour (hour)}
											<Select.Item value={String(hour)}
												>{hour.toString().padStart(2, '0')}:00</Select.Item
											>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="space-y-2">
								<label class="text-sm font-medium" for="interval">{m.settings_interval()}</label>
								<Input
									id="interval"
									type="text"
									value={intervalInput}
									oninput={(e) => handleIntervalChange((e.target as HTMLInputElement).value)}
									placeholder={m.settings_interval_placeholder()}
									class="h-9 {intervalError ? 'border-destructive' : ''}"
									aria-invalid={Boolean(intervalError)}
									aria-describedby={intervalError ? 'interval-error' : undefined}
								/>
								{#if intervalError}
									<p id="interval-error" class="text-xs text-destructive">{intervalError}</p>
								{:else}
									<p class="text-xs text-muted-foreground">
										{m.settings_current_interval({
											minutes: workspaceCtx.settings.slot_interval_minutes
										})}
									</p>
								{/if}
							</div>
						</div>
					</div>
				</section>

				{#if ['general', 'schedule'].includes(activeSettingsTab)}
					<SettingsFormFooter
						label={m.settings_save_changes()}
						savingLabel={m.settings_save_changes()}
						{saving}
						disabled={Boolean(intervalError || draftGapError)}
						onSave={saveSettings}
					/>
				{/if}
			</div>
		</div>
	{/if}
</PageContainer>

<DestructiveConfirmDialog
	bind:open={destructiveDialogOpen}
	title={destructiveActionTitle()}
	description={destructiveActionDescription()}
	confirmLabel={destructiveActionConfirmLabel()}
	onConfirm={confirmDestructiveAction}
/>
