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
	import WorkspaceDeleteDialog from '$lib/components/workspace-delete-dialog.svelte';
	import OrganizationDeleteDialog from '$lib/components/organization-delete-dialog.svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import NotificationPreferences from '$lib/components/notification-preferences.svelte';
	import OrganizationSSOSettings from '$lib/components/organization-sso-settings.svelte';
	import OrganizationAuditSettings from '$lib/components/organization-audit-settings.svelte';
	import OrganizationOwnershipSettings from '$lib/components/organization-ownership-settings.svelte';
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
	import { getSettingsDestination, normalizeSettingsTab } from '$lib/settings-navigation';
	import { showToast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	const authState = $derived($auth);
	let destructiveDialogOpen = $state(false);
	let organizationDeleteDialogOpen = $state(false);
	let currentOrganization = $state<components['schemas']['OrganizationResponse'] | null>(null);
	let organizationRequestSequence = 0;
	let accountFeedback = $state<AccountManagementFeedback | null>(null);
	let handledAccountURL = '';

	const accountLinks = {
		createPublicationHref: '/',
		createWorkspaceHref: '/',
		billingHref: '/settings?tab=plan',
		mastodonCallbackHref: '/accounts/mastodon/callback'
	};

	async function loadCurrentOrganization(organizationID: string) {
		const sequence = ++organizationRequestSequence;
		const { data } = await client.GET('/organizations');
		if (sequence !== organizationRequestSequence) return;
		currentOrganization = data?.find((organization) => organization.id === organizationID) ?? null;
	}

	$effect(() => {
		const organizationID = workspaceCtx.currentWorkspace?.organization_id ?? '';
		currentOrganization = null;
		if (organizationID) void loadCurrentOrganization(organizationID);
	});

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

	async function deleteCurrentOrganization(confirmation: {
		confirmName: string;
		currentPassword: string;
		reauthGrant?: string;
	}) {
		const organizationID = workspaceCtx.currentWorkspace?.organization_id;
		if (!organizationID) return;
		await workspaceCtx.deleteOrganization(organizationID, confirmation);
		showToast(m.organization_delete_success());
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
						<NotificationPreferences
							workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
							workspaceName={workspaceCtx.currentWorkspace?.name ?? ''}
						/>
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
						id="instance-audit"
						class:hidden={activeSettingsTab !== 'instance-audit'}
						class="scroll-mt-24"
					>
						{#if activeSettingsTab === 'instance-audit'}
							<OrganizationAuditSettings organizationID="" active instanceWide />
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
					<WorkspacePreferencesSettings
						onDelete={() => (destructiveDialogOpen = true)}
						organizationOwner={currentOrganization?.role === 'owner'}
						onDeleteOrganization={() => (organizationDeleteDialogOpen = true)}
					/>
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

				<section
					id="ownership"
					class:hidden={activeSettingsTab !== 'ownership'}
					class="scroll-mt-24"
				>
					{#if activeSettingsTab === 'ownership'}
						<OrganizationOwnershipSettings
							preferredOrganizationID={page.url.searchParams.get('organization') ?? ''}
							currentUserID={authState.user?.id ?? ''}
							active
						/>
					{/if}
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

<WorkspaceDeleteDialog
	bind:open={destructiveDialogOpen}
	workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
	workspaceName={workspaceCtx.currentWorkspace?.name ?? ''}
	hasPassword={Boolean(authState.user?.password_usable)}
	onConfirm={deleteCurrentWorkspace}
/>

<OrganizationDeleteDialog
	bind:open={organizationDeleteDialogOpen}
	organizationID={currentOrganization?.id ?? workspaceCtx.currentWorkspace?.organization_id ?? ''}
	organizationName={currentOrganization?.name ??
		workspaceCtx.currentWorkspace?.organization_name ??
		''}
	hasPassword={Boolean(authState.user?.password_usable)}
	onConfirm={deleteCurrentOrganization}
/>
