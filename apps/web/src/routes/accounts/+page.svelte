<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import { onDestroy } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveAppPath } from '$lib/app-path';
	import type {
		AccountManagementContinuation,
		AccountManagementFeedback
	} from '$lib/account-management';
	import {
		interpretAccountManagementURL,
		presentAccountManagementFeedback,
		rememberAccountManagementContinuation
	} from '$lib/account-management-route';
	import AccountManagement from '$lib/components/account-management.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import {
		getSettingsInitialLoadPlan,
		provideSettingsInitialLoadBoundary
	} from '$lib/settings-initial-load.svelte';
	import { auth } from '$lib/stores/auth';
	import { ui } from '$lib/stores/ui.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';

	const authState = $derived($auth);

	let accountFeedback = $state<AccountManagementFeedback | null>(null);
	let handledAccountURL = '';
	let accountURLRequestSequence = 0;
	let active = true;

	const accountLinks = {
		createPublicationHref: '/',
		createWorkspaceHref: '/',
		billingHref: '/settings?tab=plan',
		mastodonCallbackHref: '/accounts/mastodon/callback',
		pixelfedCallbackHref: '/accounts/pixelfed/callback'
	};

	const settingsInitialLoadPlan = $derived(
		getSettingsInitialLoadPlan('accounts', {
			userID: authState.user?.id ?? '',
			workspaceID: workspaceCtx.currentWorkspace?.id ?? '',
			organizationID: workspaceCtx.currentWorkspace?.organization_id ?? '',
			preferredOrganizationID: page.url.searchParams.get('organization') ?? '',
			canEditQueue: workspaceCtx.currentWorkspace?.can_edit ?? false
		})
	);
	const settingsInitialLoad = provideSettingsInitialLoadBoundary(() => settingsInitialLoadPlan);
	const accountsLoading = $derived(settingsInitialLoad.loading);

	$effect.pre(() => settingsInitialLoad.activate(settingsInitialLoadPlan));

	onDestroy(() => {
		active = false;
		accountURLRequestSequence += 1;
	});

	// OAuth callbacks and deep links carry connection state in the URL. Read it
	// once per href, present its feedback, and clean the address bar.
	$effect(() => {
		const url = page.url;
		const href = `${url.pathname}${url.search}${url.hash}`;
		const actorID = authState.user?.id ?? '';
		if (!actorID) {
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
		const requestedWorkspaceID =
			interpreted.workspaceID ||
			(url.searchParams.has('account_id') ? (url.searchParams.get('workspace_id') ?? '') : '');
		const cleanHref = interpreted.cleanHref;
		const isCurrentRequest = () =>
			active &&
			requestSequence === accountURLRequestSequence &&
			authState.user?.id === actorID &&
			`${page.url.pathname}${page.url.search}${page.url.hash}` === cleanHref;
		accountFeedback = presentAccountManagementFeedback(interpreted.feedback);
		if (interpreted.cleanHref !== `${url.pathname}${url.search}${url.hash}`) {
			handledAccountURL = `${actorID}:${interpreted.cleanHref}`;
			replaceState(resolveAppPath(interpreted.cleanHref), {});
		}
		if (!isCurrentRequest()) return;
		try {
			if (requestedWorkspaceID && workspaceCtx.currentWorkspace?.id !== requestedWorkspaceID) {
				await workspaceCtx.initialize(requestedWorkspaceID, {
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
</script>

<svelte:head>
	<title>{appBranding.title(m.accounts_heading())}</title>
</svelte:head>

<PageContainer
	title={m.accounts_heading()}
	themeIconRole="users"
	loading={accountsLoading}
	loadingMessage={m.common_loading()}
	loadingLayout="sections"
	mountWhileLoading
>
	<AccountManagement
		accountId={page.url.searchParams.get('account_id') ?? ''}
		workspace={workspaceCtx.currentWorkspace}
		workspaces={workspaceCtx.workspaces}
		links={accountLinks}
		feedback={accountFeedback}
		onFeedbackDismiss={() => (accountFeedback = null)}
		onContinue={continueAccountConnection}
		onAccountsChanged={() => ui.refreshWorkspaceSetup()}
	/>
</PageContainer>
