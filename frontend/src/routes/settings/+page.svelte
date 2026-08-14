<script lang="ts">
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import PageContainer from '$lib/components/page-container.svelte';
	import SettingsNavigation from '$lib/components/settings-navigation.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import NotificationPreferences from '$lib/components/notification-preferences.svelte';
	import OrganizationSSOSettings from '$lib/components/organization-sso-settings.svelte';
	import OrganizationAuditSettings from '$lib/components/organization-audit-settings.svelte';
	import WorkspaceTeamSettings from '$lib/components/workspace-team-settings.svelte';
	import InstanceConfiguration from '$lib/components/instance-configuration.svelte';
	import InstanceAdminUsers from '$lib/components/instance-admin-users.svelte';
	import AccountManagement from '$lib/components/account-management.svelte';
	import type {
		AccountManagementContinuation,
		AccountManagementFeedback
	} from '$lib/account-management';
	import {
		interpretAccountManagementURL,
		presentAccountManagementFeedback,
		rememberAccountManagementContinuation
	} from '$lib/account-management-route';
	import { ui } from '$lib/stores/ui.svelte';
	import RepostAutomationSettings from '$lib/components/repost-automation-settings.svelte';
	import BrandSettingsTab from '$lib/components/settings/BrandSettingsTab.svelte';
	import InstanceSettingsTab from '$lib/components/settings/InstanceSettingsTab.svelte';
	import WorkspacePreferencesSettings from '$lib/components/settings/WorkspacePreferencesSettings.svelte';
	import ProfileSettingsTab from '$lib/components/settings/ProfileSettingsTab.svelte';
	import BillingSettingsTab from '$lib/components/settings/BillingSettingsTab.svelte';
	import ScheduleSettingsTab from '$lib/components/settings/ScheduleSettingsTab.svelte';
	import DeveloperSettingsTab from '$lib/components/settings/DeveloperSettingsTab.svelte';
	import SecuritySettingsTab from '$lib/components/settings/SecuritySettingsTab.svelte';
	import type { SettingsTabID } from '$lib/settings-navigation';
	import { showToast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	const authState = $derived($auth);
	let destructiveDialogOpen = $state(false);
	let accountFeedback = $state<AccountManagementFeedback | null>(null);
	let handledAccountURL = '';

	const accountLinks = {
		createPublicationHref: '/',
		createWorkspaceHref: '/',
		billingHref: '/settings?tab=plan',
		mastodonCallbackHref: '/accounts/mastodon/callback'
	};

	const settingsTabs = $derived<SettingsTabID[]>([
		'profile',
		'notifications',
		'security',
		'developer',
		'general',
		'brand',
		'accounts',
		'reposts',
		'schedule',
		'members',
		'sso',
		'audit',
		'plan',
		...(authState.user?.is_admin ? (['instance', 'configuration', 'users'] as const) : [])
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
		if (
			['members', 'sso', 'audit', 'plan', 'security', 'notifications'].includes(activeSettingsTab)
		) {
			return 'cards' as const;
		}
		if (
			[
				'developer',
				'schedule',
				'accounts',
				'reposts',
				'instance',
				'configuration',
				'users'
			].includes(activeSettingsTab)
		) {
			return 'list' as const;
		}
		return 'form' as const;
	});

	const activeSettingsTitle = $derived.by(() => {
		if (activeSettingsTab === 'profile') return m.settings_profile();
		if (activeSettingsTab === 'notifications') return m.notifications_settings();
		if (activeSettingsTab === 'security') return m.settings_security();
		if (activeSettingsTab === 'developer') return m.settings_developer();
		if (activeSettingsTab === 'instance') return m.settings_instance();
		if (activeSettingsTab === 'configuration') return m.settings_configuration();
		if (activeSettingsTab === 'users') return m.settings_instance_users();
		if (activeSettingsTab === 'members') return m.settings_team_members();
		if (activeSettingsTab === 'sso') return m.settings_sso();
		if (activeSettingsTab === 'audit') return m.settings_audit_title();
		if (activeSettingsTab === 'plan') return m.settings_plan();
		if (activeSettingsTab === 'schedule') return m.settings_schedule();
		if (activeSettingsTab === 'brand') return m.media_brand();
		if (activeSettingsTab === 'accounts') return m.accounts_heading();
		if (activeSettingsTab === 'reposts') return m.settings_reposts();
		return m.settings_general();
	});

	const activeSettingsDescription = $derived.by(() => {
		if (activeSettingsTab === 'profile') return m.settings_profile_description();
		if (activeSettingsTab === 'notifications') return m.notifications_settings_description();
		if (activeSettingsTab === 'security') return m.settings_account_security_body();
		if (activeSettingsTab === 'developer') return m.settings_developer_description();
		if (activeSettingsTab === 'instance') return m.settings_instance_description();
		if (activeSettingsTab === 'configuration') return m.settings_configuration_description();
		if (activeSettingsTab === 'users') return m.settings_instance_users_page_description();
		if (activeSettingsTab === 'members') return m.settings_members_description();
		if (activeSettingsTab === 'sso') return m.settings_sso_description();
		if (activeSettingsTab === 'audit') return m.settings_audit_description();
		if (activeSettingsTab === 'plan') return m.settings_plan_description();
		if (activeSettingsTab === 'schedule') return m.settings_schedule_description();
		if (activeSettingsTab === 'brand') return m.media_brand_description();
		if (activeSettingsTab === 'accounts') return m.accounts_description();
		if (activeSettingsTab === 'reposts') return m.settings_reposts_description();
		return m.settings_general_description({
			workspace: workspaceCtx.currentWorkspace?.name || m.settings_workspace()
		});
	});

	function isSettingsTab(value: string): value is SettingsTabID {
		return settingsTabs.includes(value as SettingsTabID);
	}

	function normalizeSettingsTab(value: string | null): SettingsTabID {
		if (value === 'billing' || value === 'organization') return 'plan';
		if (value === 'team') return 'members';
		if (value === 'tokens' || value === 'account') {
			return value === 'tokens' ? 'developer' : 'profile';
		}
		if (value === 'workspace' || value === 'media') return 'general';
		if (value === 'social-accounts' || value === 'accounts') return 'accounts';
		return value && isSettingsTab(value) ? value : 'general';
	}

	$effect(() => {
		const url = page.url;
		const href = `${url.pathname}${url.search}${url.hash}`;
		if (activeSettingsTab !== 'accounts' || href === handledAccountURL) return;
		handledAccountURL = href;
		void initializeAccountsURL(new URL(url));
	});

	async function initializeAccountsURL(url: URL) {
		const interpreted = interpretAccountManagementURL(url);
		accountFeedback = presentAccountManagementFeedback(interpreted.feedback);
		if (interpreted.cleanHref !== `${url.pathname}${url.search}${url.hash}`) {
			handledAccountURL = interpreted.cleanHref;
			replaceState(resolve(interpreted.cleanHref as '/'), {});
		}
		try {
			if (
				interpreted.workspaceID &&
				workspaceCtx.currentWorkspace?.id !== interpreted.workspaceID
			) {
				await workspaceCtx.initialize(interpreted.workspaceID);
			}
		} catch (error) {
			console.error('Failed to restore OAuth workspace:', error);
		}
	}

	function continueAccountConnection(continuation: AccountManagementContinuation) {
		rememberAccountManagementContinuation(continuation, 'settings');
		if (continuation.kind === 'external-oauth') {
			window.location.assign(continuation.url);
			return;
		}
		void goto(resolve(continuation.href as '/'));
	}

	async function deleteCurrentWorkspace() {
		const workspace = workspaceCtx.currentWorkspace;
		if (!workspace) return;
		try {
			await workspaceCtx.deleteWorkspace(workspace.id);
			showToast(m.workspace_delete_success());
			await goto(resolve('/'));
		} catch (error) {
			showToast(m.workspace_delete_failed(), 'error');
			console.error('Failed to delete workspace:', error);
		}
	}
</script>

<svelte:head>
	<title>{m.settings_page_title()}</title>
</svelte:head>

<PageContainer
	title={activeSettingsTitle}
	description={activeSettingsDescription}
	icon={SettingsIcon}
	loading={activeSettingsTab !== 'audit' &&
		(!workspaceCtx.currentWorkspace || workspaceCtx.settingsLoading)}
	loadingMessage={m.settings_loading_workspace()}
	loadingLayout="settings"
	loadingVariant={settingsLoadingVariant}
	loadingItems={8}
>
	{#if workspaceCtx.settingsError && activeSettingsTab !== 'audit'}
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
					{#if activeSettingsTab === 'profile'}
						<ProfileSettingsTab />
					{/if}
				</section>

				<section
					id="notifications"
					class:hidden={activeSettingsTab !== 'notifications'}
					class="scroll-mt-24"
				>
					{#if activeSettingsTab === 'notifications'}
						<NotificationPreferences />
					{/if}
				</section>

				<section id="accounts" class:hidden={activeSettingsTab !== 'accounts'} class="scroll-mt-24">
					{#if activeSettingsTab === 'accounts'}
						<AccountManagement
							mode="settings"
							workspace={workspaceCtx.currentWorkspace}
							workspaces={workspaceCtx.workspaces}
							links={accountLinks}
							feedback={accountFeedback}
							onFeedbackDismiss={() => (accountFeedback = null)}
							onContinue={continueAccountConnection}
							onAccountsChanged={() => ui.refreshWorkspaceSetup()}
						/>
					{/if}
				</section>

				<section id="reposts" class:hidden={activeSettingsTab !== 'reposts'} class="scroll-mt-24">
					{#if activeSettingsTab === 'reposts'}
						<RepostAutomationSettings workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} />
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
						class="scroll-mt-24"
					>
						{#if activeSettingsTab === 'instance'}
							<InstanceSettingsTab userID={authState.user?.id ?? ''} active />
						{/if}
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

				{#if activeSettingsTab === 'general'}
					<WorkspacePreferencesSettings onDelete={() => (destructiveDialogOpen = true)} />
				{/if}

				<section id="team" class:hidden={activeSettingsTab !== 'members'} class="scroll-mt-24">
					<WorkspaceTeamSettings
						workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
						currentUserID={authState.user?.id ?? ''}
						active={activeSettingsTab === 'members'}
						onMembershipChanged={() => workspaceCtx.loadWorkspaces()}
					/>
				</section>

				<section id="sso" class:hidden={activeSettingsTab !== 'sso'} class="scroll-mt-24">
					<OrganizationSSOSettings
						organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
						active={activeSettingsTab === 'sso'}
					/>
				</section>

				<section id="audit" class:hidden={activeSettingsTab !== 'audit'} class="scroll-mt-24">
					<OrganizationAuditSettings
						organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
						active={activeSettingsTab === 'audit'}
					/>
				</section>

				<section id="billing" class:hidden={activeSettingsTab !== 'plan'} class="scroll-mt-24">
					{#if activeSettingsTab === 'plan'}
						<BillingSettingsTab />
					{/if}
				</section>

				<section id="security" class:hidden={activeSettingsTab !== 'security'} class="scroll-mt-24">
					{#if activeSettingsTab === 'security'}
						<SecuritySettingsTab />
					{/if}
				</section>

				<section id="tokens" class:hidden={activeSettingsTab !== 'developer'} class="scroll-mt-24">
					{#if activeSettingsTab === 'developer'}
						<DeveloperSettingsTab />
					{/if}
				</section>

				<section id="brand" class:hidden={activeSettingsTab !== 'brand'} class="scroll-mt-24">
					{#if activeSettingsTab === 'brand'}
						<BrandSettingsTab workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} active />
					{/if}
				</section>

				<section id="schedule" class:hidden={activeSettingsTab !== 'schedule'} class="scroll-mt-24">
					{#if activeSettingsTab === 'schedule'}
						<ScheduleSettingsTab />
					{/if}
				</section>
			</div>
		</div>
	{/if}
</PageContainer>

<DestructiveConfirmDialog
	bind:open={destructiveDialogOpen}
	title={m.workspace_delete_title()}
	description={m.workspace_delete_description()}
	confirmLabel={m.workspace_delete_confirm()}
	onConfirm={deleteCurrentWorkspace}
/>
