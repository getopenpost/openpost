<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
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
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import SettingsNavigation from '$lib/components/settings-navigation.svelte';
	import WorkspaceDeleteDialog from '$lib/components/workspace-delete-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import {
		getSettingsDestination,
		normalizeSettingsTab,
		type SettingsTabID
	} from '$lib/settings-navigation';
	import {
		getSettingsInitialLoadPlan,
		provideSettingsInitialLoadBoundary
	} from '$lib/settings-initial-load.svelte';
	import { auth } from '$lib/stores/auth';
	import { ui } from '$lib/stores/ui.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { showToast } from '$lib/toast';

	const settingsPanelLoaders = {
		profile: () => import('$lib/components/settings/ProfileSettingsTab.svelte'),
		notifications: () => import('$lib/components/notification-preferences.svelte'),
		security: () => import('$lib/components/settings/SecuritySettingsTab.svelte'),
		developer: () => import('$lib/components/settings/DeveloperSettingsTab.svelte'),
		general: () => import('$lib/components/settings/WorkspacePreferencesSettings.svelte'),
		brand: () => import('$lib/components/settings/BrandSettingsTab.svelte'),
		appearance: () => import('$lib/components/themes/theme-appearance-settings.svelte'),
		accounts: () => import('$lib/components/account-management.svelte'),
		reposts: () => import('$lib/components/repost-automation-settings.svelte'),
		schedule: () => import('$lib/components/settings/ScheduleSettingsTab.svelte'),
		members: () => import('$lib/components/workspace-team-settings.svelte'),
		plan: () => import('$lib/components/settings/BillingSettingsTab.svelte'),
		sso: () => import('$lib/components/organization-sso-settings.svelte'),
		audit: () => import('$lib/components/organization-audit-settings.svelte'),
		ownership: () => import('$lib/components/organization-ownership-settings.svelte'),
		instance: () => import('$lib/components/settings/InstanceSettingsTab.svelte'),
		configuration: () => import('$lib/components/instance-configuration.svelte'),
		'ai-prompts': () => import('$lib/components/instance-ai-prompts.svelte'),
		users: () => import('$lib/components/instance-admin-users.svelte'),
		'instance-audit': () => import('$lib/components/organization-audit-settings.svelte')
	} satisfies Record<SettingsTabID, () => Promise<object>>;

	type SettingsPanels = {
		[Key in keyof typeof settingsPanelLoaders]?: Awaited<
			ReturnType<(typeof settingsPanelLoaders)[Key]>
		>;
	};
	let panels = $state.raw<SettingsPanels>({});
	let panelFailure = $state<{ tab: SettingsTabID; message: string } | null>(null);
	const pendingPanels = new Set<SettingsTabID>();
	const panelError = $derived(panelFailure?.tab === activeSettingsTab ? panelFailure.message : '');

	$effect(() => {
		const tab = activeSettingsTab;
		if (panels[tab] || pendingPanels.has(tab) || panelError) return;
		pendingPanels.add(tab);
		void settingsPanelLoaders[tab]()
			.then((module) => {
				if (active) panels = { ...panels, [tab]: module };
			})
			.catch(() => {
				if (active) panelFailure = { tab, message: m.settings_panel_load_failed() };
			})
			.finally(() => {
				pendingPanels.delete(tab);
			});
	});

	const authState = $derived($auth);
	let destructiveDialogOpen = $state(false);
	let accountFeedback = $state<AccountManagementFeedback | null>(null);
	let handledAccountURL = '';
	let accountURLRequestSequence = 0;
	let workspaceDeletionRequestSequence = 0;
	let active = true;

	onDestroy(() => {
		active = false;
		accountURLRequestSequence += 1;
		workspaceDeletionRequestSequence += 1;
	});

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
	const workspaceSettingsRequired = $derived(
		activeSettingsTab === 'general' || activeSettingsTab === 'schedule'
	);
	const settingsInitialLoadPlan = $derived(
		getSettingsInitialLoadPlan(activeSettingsTab, {
			userID: authState.user?.id ?? '',
			workspaceID: workspaceCtx.currentWorkspace?.id ?? '',
			organizationID: workspaceCtx.currentWorkspace?.organization_id ?? '',
			preferredOrganizationID: page.url.searchParams.get('organization') ?? '',
			canEditQueue: workspaceCtx.currentWorkspace?.can_edit ?? false
		})
	);
	const settingsInitialLoad = provideSettingsInitialLoadBoundary(() => settingsInitialLoadPlan);
	const workspaceSettingsInitialLoading = $derived(
		workspaceSettingsRequired &&
			!workspaceCtx.settingsError &&
			(!workspaceCtx.currentWorkspace || workspaceCtx.settingsLoading)
	);
	const settingsLoading = $derived(
		!panelError &&
			(!panels[activeSettingsTab] || workspaceSettingsInitialLoading || settingsInitialLoad.loading)
	);

	$effect.pre(() => settingsInitialLoad.activate(settingsInitialLoadPlan));

	async function refreshMembershipBootstrap() {
		const actorID = authState.user?.id ?? '';
		const projection = auth.captureUserProjection(actorID);
		if (!projection) return;
		const bootstrap = await workspaceCtx.loadWorkspaces();
		if (authState.user?.id === actorID) auth.projectBootstrap(bootstrap, projection);
	}

	$effect(() => {
		const url = page.url;
		const href = `${url.pathname}${url.search}${url.hash}`;
		const actorID = authState.user?.id ?? '';
		if (activeSettingsTab !== 'accounts' || !actorID) {
			accountURLRequestSequence += 1;
			handledAccountURL = '';
			return;
		}
		const handledKey = `${actorID}:${href}`;
		if (handledKey === handledAccountURL) return;
		const requestSequence = ++accountURLRequestSequence;
		handledAccountURL = handledKey;
		void initializeAccountsURL(new URL(url), actorID, requestSequence);
	});

	async function initializeAccountsURL(url: URL, actorID: string, requestSequence: number) {
		const interpreted = interpretAccountManagementURL(url);
		const cleanHref = interpreted.cleanHref;
		const isCurrentRequest = () =>
			active &&
			requestSequence === accountURLRequestSequence &&
			authState.user?.id === actorID &&
			activeSettingsTab === 'accounts' &&
			`${page.url.pathname}${page.url.search}${page.url.hash}` === cleanHref;
		accountFeedback = presentAccountManagementFeedback(interpreted.feedback);
		if (interpreted.cleanHref !== `${url.pathname}${url.search}${url.hash}`) {
			handledAccountURL = `${actorID}:${interpreted.cleanHref}`;
			replaceState(resolveAppPath(interpreted.cleanHref), {});
		}
		if (!isCurrentRequest()) return;
		try {
			if (
				interpreted.workspaceID &&
				workspaceCtx.currentWorkspace?.id !== interpreted.workspaceID
			) {
				await workspaceCtx.initialize(interpreted.workspaceID, {
					selectionIsCurrent: isCurrentRequest
				});
			}
		} catch (error) {
			if (isCurrentRequest()) console.error('Failed to restore OAuth workspace:', error);
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

	async function deleteCurrentWorkspace(
		workspaceID: string,
		confirmation: {
			confirmName: string;
			currentPassword: string;
			reauthGrant?: string;
		}
	) {
		const actorID = get(auth).user?.id ?? '';
		if (!actorID) return false;
		const requestSequence = ++workspaceDeletionRequestSequence;
		const isCurrentRequest = () =>
			active &&
			requestSequence === workspaceDeletionRequestSequence &&
			get(auth).user?.id === actorID;
		const projected = await workspaceCtx.deleteWorkspace(workspaceID, confirmation);
		if (!projected || !isCurrentRequest()) return false;
		showToast(m.workspace_delete_success());
		if (!isCurrentRequest()) return false;
		await goto(resolve('/'));
		return isCurrentRequest();
	}
</script>

<svelte:head>
	<title>{m.settings_page_title()}</title>
</svelte:head>

<PageContainer
	title={activeSettingsTitle}
	description={activeSettingsDescription}
	themeIconRole="settings"
	loading={settingsLoading}
	loadingMessage={workspaceSettingsInitialLoading
		? m.settings_loading_workspace()
		: m.common_loading()}
	loadingLayout="settings"
	loadingVariant={settingsLoadingVariant}
	loadingItems={8}
	mountWhileLoading
>
	<div class="min-w-0 space-y-8">
		<SettingsNavigation
			active={activeSettingsTab}
			showInstance={Boolean(authState.user?.is_admin)}
		/>
		{#if panelError}
			<InlineNotice tone="error" message={panelError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => window.location.reload()}
						>{m.common_refresh()}</Button
					>
				{/snippet}
			</InlineNotice>
		{:else if workspaceSettingsRequired && workspaceCtx.settingsError && activeSettingsTab !== 'audit'}
			<InlineNotice tone="error" message={m.settings_workspace_load_failed()}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void workspaceCtx.loadSettings()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else}
			<div class="min-w-0 space-y-8">
				{#if workspaceSettingsRequired && workspaceCtx.settingsBackgroundError}
					<InlineNotice tone="warning" message={m.settings_workspace_load_failed()}>
						{#snippet actions()}
							<Button variant="outline" size="sm" onclick={() => void workspaceCtx.loadSettings()}>
								{m.common_retry()}
							</Button>
						{/snippet}
					</InlineNotice>
				{/if}

				<div class="max-w-5xl min-w-0 space-y-6">
					{#if activeSettingsTab === 'profile'}
						{#if panels['profile']}
							{@const ProfileSettingsTab = panels['profile'].default}
							<ProfileSettingsTab />
						{/if}
					{:else if activeSettingsTab === 'notifications'}
						{#if panels['notifications']}
							{@const NotificationPreferences = panels['notifications'].default}
							<NotificationPreferences
								workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
								workspaceName={workspaceCtx.currentWorkspace?.name ?? ''}
								canEditQueue={workspaceCtx.currentWorkspace?.can_edit ?? false}
							/>
						{/if}
					{:else if activeSettingsTab === 'security'}
						{#if panels['security']}
							{@const SecuritySettingsTab = panels['security'].default}
							<SecuritySettingsTab />
						{/if}
					{:else if activeSettingsTab === 'developer'}
						{#if panels['developer']}
							{@const DeveloperSettingsTab = panels['developer'].default}
							<DeveloperSettingsTab />
						{/if}
					{:else if activeSettingsTab === 'general'}
						{#if panels['general']}
							{@const WorkspacePreferencesSettings = panels['general'].default}
							<WorkspacePreferencesSettings onDelete={() => (destructiveDialogOpen = true)} />
						{/if}
					{:else if activeSettingsTab === 'brand'}
						{#if panels['brand']}
							{@const BrandSettingsTab = panels['brand'].default}
							<BrandSettingsTab workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} active />
						{/if}
					{:else if activeSettingsTab === 'appearance'}
						{#if panels['appearance']}
							{@const ThemeAppearanceSettings = panels['appearance'].default}
							<ThemeAppearanceSettings />
						{/if}
					{:else if activeSettingsTab === 'accounts'}
						{#if panels['accounts']}
							{@const AccountManagement = panels['accounts'].default}
							<AccountManagement
								workspace={workspaceCtx.currentWorkspace}
								workspaces={workspaceCtx.workspaces}
								links={accountLinks}
								feedback={accountFeedback}
								onFeedbackDismiss={() => (accountFeedback = null)}
								onContinue={continueAccountConnection}
								onAccountsChanged={() => ui.refreshWorkspaceSetup()}
							/>
						{/if}
					{:else if activeSettingsTab === 'reposts'}
						{#if panels['reposts']}
							{@const RepostAutomationSettings = panels['reposts'].default}
							<RepostAutomationSettings workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} />
						{/if}
					{:else if activeSettingsTab === 'schedule'}
						{#if panels['schedule']}
							{@const ScheduleSettingsTab = panels['schedule'].default}
							<ScheduleSettingsTab />
						{/if}
					{:else if activeSettingsTab === 'members'}
						{#if panels['members']}
							{@const WorkspaceTeamSettings = panels['members'].default}
							<WorkspaceTeamSettings
								workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
								organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
								currentUserID={authState.user?.id ?? ''}
								active
								onMembershipChanged={refreshMembershipBootstrap}
							/>
						{/if}
					{:else if activeSettingsTab === 'plan'}
						{#if panels['plan']}
							{@const BillingSettingsTab = panels['plan'].default}
							<BillingSettingsTab />
						{/if}
					{:else if activeSettingsTab === 'sso'}
						{#if panels['sso']}
							{@const OrganizationSSOSettings = panels['sso'].default}
							<OrganizationSSOSettings
								organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
								active
							/>
						{/if}
					{:else if activeSettingsTab === 'audit'}
						{#if panels['audit']}
							{@const OrganizationAuditSettings = panels['audit'].default}
							<OrganizationAuditSettings
								organizationID={workspaceCtx.currentWorkspace?.organization_id ?? ''}
								active
							/>
						{/if}
					{:else if activeSettingsTab === 'ownership'}
						{#if panels['ownership']}
							{@const OrganizationOwnershipSettings = panels['ownership'].default}
							<OrganizationOwnershipSettings
								preferredOrganizationID={page.url.searchParams.get('organization') ?? ''}
								currentUserID={authState.user?.id ?? ''}
								active
								onDeleted={() => goto(resolve('/'))}
							/>
						{/if}
					{:else if authState.user?.is_admin && activeSettingsTab === 'instance'}
						{#if panels['instance']}
							{@const InstanceSettingsTab = panels['instance'].default}
							<InstanceSettingsTab userID={authState.user?.id ?? ''} active />
						{/if}
					{:else if authState.user?.is_admin && activeSettingsTab === 'configuration'}
						{#if panels['configuration']}
							{@const InstanceConfiguration = panels['configuration'].default}
							<InstanceConfiguration active />
						{/if}
					{:else if authState.user?.is_admin && activeSettingsTab === 'ai-prompts'}
						{#if panels['ai-prompts']}
							{@const InstanceAIPrompts = panels['ai-prompts'].default}
							<InstanceAIPrompts active />
						{/if}
					{:else if authState.user?.is_admin && activeSettingsTab === 'users'}
						{#if panels['users']}
							{@const InstanceAdminUsers = panels['users'].default}
							<InstanceAdminUsers />
						{/if}
					{:else if authState.user?.is_admin && activeSettingsTab === 'instance-audit'}
						{#if panels['instance-audit']}
							{@const OrganizationAuditSettings = panels['instance-audit'].default}
							<OrganizationAuditSettings organizationID="" active instanceWide />
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</PageContainer>

<WorkspaceDeleteDialog
	bind:open={destructiveDialogOpen}
	workspaceID={workspaceCtx.currentWorkspace?.id ?? ''}
	workspaceName={workspaceCtx.currentWorkspace?.name ?? ''}
	hasPassword={Boolean(authState.user?.password_usable)}
	onConfirm={deleteCurrentWorkspace}
/>
