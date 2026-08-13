<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
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
	import { m } from '$lib/paraglide/messages';

	let loading = $state(true);
	let feedback = $state<AccountManagementFeedback | null>(null);
	let authState = $derived($auth);

	const links = {
		createPublicationHref: '/',
		createWorkspaceHref: '/',
		billingHref: '/settings?tab=plan',
		mastodonCallbackHref: '/accounts/mastodon/callback'
	};

	onMount(() => {
		const unsubscribe = auth.subscribe(async (state) => {
			if (state.isLoading) return;
			if (!state.isAuthenticated) {
				const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
				await goto(resolve(`/login?redirect=${encodeURIComponent(redirect)}`));
				return;
			}

			try {
				await initializeRoute(new URL(window.location.href));
			} finally {
				loading = false;
			}
		});
		return unsubscribe;
	});

	async function initializeRoute(url: URL) {
		const interpreted = interpretAccountManagementURL(url);
		feedback = presentAccountManagementFeedback(interpreted.feedback);
		if (interpreted.cleanHref !== `${url.pathname}${url.search}${url.hash}`) {
			replaceState(resolve(interpreted.cleanHref as '/'), {});
		}
		try {
			if (
				interpreted.workspaceID &&
				workspaceCtx.currentWorkspace?.id !== interpreted.workspaceID
			) {
				await workspaceCtx.initialize(interpreted.workspaceID);
			} else if (workspaceCtx.workspaces.length === 0) {
				await workspaceCtx.initialize();
			}
		} catch (error) {
			console.error('Failed to restore OAuth workspace:', error);
		}
	}

	function continueConnection(continuation: AccountManagementContinuation) {
		rememberAccountManagementContinuation(continuation, 'direct');
		if (continuation.kind === 'external-oauth') {
			window.location.assign(continuation.url);
			return;
		}
		void goto(resolve(continuation.href as '/'));
	}
</script>

<svelte:head>
	<title>{m.accounts_heading()} - OpenPost</title>
</svelte:head>

<AccountManagement
	mode="direct"
	workspace={workspaceCtx.currentWorkspace}
	workspaces={workspaceCtx.workspaces}
	{links}
	{loading}
	showInstanceSettings={Boolean(authState.user?.is_admin)}
	{feedback}
	onFeedbackDismiss={() => (feedback = null)}
	onContinue={continueConnection}
	onAccountsChanged={() => ui.refreshWorkspaceSetup()}
/>
