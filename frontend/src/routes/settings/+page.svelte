<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type {
		AccountManagementContinuation,
		AccountManagementFeedback
	} from '$lib/account-management';
	import {
		interpretAccountManagementURL,
		presentAccountManagementFeedback,
		rememberAccountManagementContinuation
	} from '$lib/account-management-route';
	import { resolveAppPath } from '$lib/app-path';
	import AccountManagement from '$lib/components/account-management.svelte';
	import InstanceAdminUsers from '$lib/components/instance-admin-users.svelte';
	import InstanceConfiguration from '$lib/components/instance-configuration.svelte';
	import InstanceAIPrompts from '$lib/components/instance-ai-prompts.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import NotificationPreferences from '$lib/components/notification-preferences.svelte';
	import OrganizationAuditSettings from '$lib/components/organization-audit-settings.svelte';
	import OrganizationOwnershipSettings from '$lib/components/organization-ownership-settings.svelte';
	import OrganizationSSOSettings from '$lib/components/organization-sso-settings.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import RepostAutomationSettings from '$lib/components/repost-automation-settings.svelte';
	import SettingsNavigation from '$lib/components/settings-navigation.svelte';
	import BillingSettingsTab from '$lib/components/settings/BillingSettingsTab.svelte';
	import BrandSettingsTab from '$lib/components/settings/BrandSettingsTab.svelte';
	import DeveloperSettingsTab from '$lib/components/settings/DeveloperSettingsTab.svelte';
	import InstanceSettingsTab from '$lib/components/settings/InstanceSettingsTab.svelte';
	import ProfileSettingsTab from '$lib/components/settings/ProfileSettingsTab.svelte';
	import ScheduleSettingsTab from '$lib/components/settings/ScheduleSettingsTab.svelte';
	import SecuritySettingsTab from '$lib/components/settings/SecuritySettingsTab.svelte';
	import WorkspacePreferencesSettings from '$lib/components/settings/WorkspacePreferencesSettings.svelte';
	import WorkspaceDeleteDialog from '$lib/components/workspace-delete-dialog.svelte';
	import WorkspaceTeamSettings from '$lib/components/workspace-team-settings.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { getSettingsDestination, normalizeSettingsTab } from '$lib/settings-navigation';
	import { auth } from '$lib/stores/auth';
	import { ui } from '$lib/stores/ui.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { showToast } from '$lib/toast';
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

	const activeSettingsTab = $derived(
		normalizeSettingsTab(
			page.url.searchParams.get('tab') || page.url.hash.replace(/^#/, '') || null,
			Boolean(authState.user?.is_admin)
		)
	);
	const activeSettingsDestination = $derived(
		getSettingsDestination(activeSettingsTab, {
			workspaceName: workspaceCtx.currentWorkspace?.name
		})
	);
	const settingsLoadingVariant = $derived(activeSettingsDestination.loadingVariant);
	const activeSettingsTitle = $derived(activeSettingsDestination.title);
	const activeSettingsDescription = $derived(activeSettingsDestination.description);
	const workspaceSettingsRequired = $derived(activeSettingsDestination.group === 'workspace');

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
			replaceState(resolveAppPath(interpreted.cleanHref), {});
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
		rememberAccountManagementContinuation(continuation);
		if (continuation.kind === 'external-oauth') {
			window.location.assign(continuation.url);
			return;
		}
		void goto(resolveAppPath(continuation.href));
	}

	async function deleteCurrentWorkspace(confirmation: {
		confirmName: string;
		currentPassword: string;
		reauthGrant?: string;
	}) {
		const workspace = workspaceCtx.currentWorkspace;
		if (!workspace) return;
		await workspaceCtx.deleteWorkspace(workspace.id, confirmation);
		showToast(m.workspace_delete_success());
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>{m.settings_page_title()}</title>
</svelte:head>

<PageContainer
	title={activeSettingsTitle}
	description={activeSettingsDescription}
	icon={SettingsIcon}
	loading={workspaceSettingsRequired &&
		activeSettingsTab !== 'audit' &&
		(!workspaceCtx.currentWorkspace || workspaceCtx.settingsLoading)}
	loadingMessage={m.settings_loading_workspace()}
	loadingLayout="settings"
	loadingVariant={settingsLoadingVariant}
	loadingItems={8}
>
	{#if workspaceSettingsRequired && workspaceCtx.settingsError && activeSettingsTab !== 'audit'}
		<InlineNotice tone="error" message={m.settings_workspace_load_failed()}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => void workspaceCtx.loadSettings()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else}
		<div class="min-w-0 space-y-8">
			<SettingsNavigation
				active={activeSettingsTab}
				showInstance={Boolean(authState.user?.is_admin)}
			/>

			<div class="max-w-5xl min-w-0 space-y-6">
				{#if activeSettingsTab === 'profile'}
					<ProfileSettingsTab />
				{:else if activeSettingsTab === 'notifications'}
					<NotificationPreferences
						workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
						workspaceName={workspaceCtx.currentWorkspace?.name ?? ''}
					/>
				{:else if activeSettingsTab === 'security'}
					<SecuritySettingsTab />
				{:else if activeSettingsTab === 'developer'}
					<DeveloperSettingsTab />
				{:else if activeSettingsTab === 'general'}
					<WorkspacePreferencesSettings onDelete={() => (destructiveDialogOpen = true)} />
				{:else if activeSettingsTab === 'brand'}
					<BrandSettingsTab workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} active />
				{:else if activeSettingsTab === 'accounts'}
					<AccountManagement
						workspace={workspaceCtx.currentWorkspace}
						workspaces={workspaceCtx.workspaces}
						links={accountLinks}
						feedback={accountFeedback}
						onFeedbackDismiss={() => (accountFeedback = null)}
						onContinue={continueAccountConnection}
						onAccountsChanged={() => ui.refreshWorkspaceSetup()}
					/>
				{:else if activeSettingsTab === 'reposts'}
					<RepostAutomationSettings workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} />
				{:else if activeSettingsTab === 'schedule'}
					<ScheduleSettingsTab />
				{:else if activeSettingsTab === 'members'}
					<WorkspaceTeamSettings
						workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
						currentUserID={authState.user?.id ?? ''}
						active
						onMembershipChanged={() => workspaceCtx.loadWorkspaces()}
					/>
				{:else if activeSettingsTab === 'plan'}
					<BillingSettingsTab />
				{:else if activeSettingsTab === 'sso'}
					<OrganizationSSOSettings
						organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
						active
					/>
				{:else if activeSettingsTab === 'audit'}
					<OrganizationAuditSettings
						organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
						active
					/>
				{:else if activeSettingsTab === 'ownership'}
					<OrganizationOwnershipSettings
						preferredOrganizationID={page.url.searchParams.get('organization') ?? ''}
						currentUserID={authState.user?.id ?? ''}
						active
						onDeleted={() => goto(resolve('/'))}
					/>
				{:else if authState.user?.is_admin && activeSettingsTab === 'instance'}
					<InstanceSettingsTab userID={authState.user?.id ?? ''} active />
				{:else if authState.user?.is_admin && activeSettingsTab === 'configuration'}
					<InstanceConfiguration active />
				{:else if authState.user?.is_admin && activeSettingsTab === 'ai-prompts'}
					<InstanceAIPrompts active />
				{:else if authState.user?.is_admin && activeSettingsTab === 'users'}
					<InstanceAdminUsers />
				{:else if authState.user?.is_admin && activeSettingsTab === 'instance-audit'}
					<OrganizationAuditSettings organizationID="" active instanceWide />
				{/if}
			</div>
		</div>
	{/if}
</PageContainer>

<WorkspaceDeleteDialog
	bind:open={destructiveDialogOpen}
	workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
	workspaceName={workspaceCtx.currentWorkspace?.name ?? ''}
	hasPassword={Boolean(authState.user?.password_usable)}
	onConfirm={deleteCurrentWorkspace}
/>
