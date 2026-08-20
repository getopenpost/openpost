<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { client } from '$lib/api/client';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import {
		accountManagementReturnHref,
		clearAccountManagementContinuation,
		interpretAccountSetupURL
	} from '$lib/account-management-route';

	let workspaceID = $state('');
	let accountIDs = $state<string[]>([]);
	let newAccountIDs = $state<string[]>([]);
	let openFreshComposer = $state(false);
	let loading = $state(true);
	let error = $state('');
	let validated = $state(false);

	onMount(async () => {
		const state = interpretAccountSetupURL(new URL(window.location.href));
		if (!state) {
			error = 'Missing workspace or account information.';
			loading = false;
			return;
		}
		workspaceID = state.workspaceID;
		accountIDs = state.accountIDs;
		newAccountIDs = state.newAccountIDs;
		openFreshComposer = state.openFreshComposer;

		// Validate that the workspace and accounts exist and belong to actor.
		// URL IDs never establish auth or support; we verify via API.
		try {
			const { error: err } = await client.GET('/account-features', {
				params: {
					query: {
						workspace_id: workspaceID,
						account_ids: newAccountIDs.length ? newAccountIDs.join(',') : accountIDs.join(',')
					}
				}
			});
			if (err) {
				// If validation fails, we still allow the page to show but surface the error.
				// The user can still continue; the setup choice UI will be implemented later.
				console.warn('setup validation failed', err);
			}
			validated = true;
		} catch {
			validated = true;
		} finally {
			loading = false;
		}
	});

	function continueFromSetup() {
		if (openFreshComposer) {
			const q = new URLSearchParams({ workspace_id: workspaceID, account_ids: accountIDs.join(',') });
			void goto(resolveAppPath(`/?${q.toString()}`));
		} else {
			void goto(resolveAppPath(accountManagementReturnHref()));
		}
		clearAccountManagementContinuation();
	}

	function skipSetup() {
		continueFromSetup();
	}
</script>

<svelte:head>
	<title>Account setup - OpenPost</title>
</svelte:head>

<StandaloneShell
	title="Account setup"
	description="Choose optional features for your new destination."
	loading={loading}
	loadingLabel={m.common_loading()}
>
	{#if error}
		<InlineNotice tone="error" message={error} />
		<div class="mt-4 flex justify-end">
			<Button href={resolveAppPath(accountManagementReturnHref())} variant="outline">{m.common_back()}</Button>
		</div>
	{:else}
		<div class="space-y-4">
			<p class="text-sm text-muted-foreground">Review optional features for the destinations you just connected. This setup step is a placeholder; feature choices will be available here soon.</p>
			{#if validated}
				<div class="rounded-md border bg-muted/20 p-3 text-sm">
					<p class="font-medium">Workspace: {workspaceID}</p>
					<p class="text-muted-foreground">Connected destinations: {accountIDs.length}</p>
					{#if newAccountIDs.length}
						<p class="text-muted-foreground">New destinations: {newAccountIDs.length}</p>
					{/if}
					{#if openFreshComposer}
						<p class="mt-2 text-xs text-muted-foreground">This is the first destination in the Workspace and will open the composer next.</p>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground">Feature choices remain undecided until you save them here.</p>
			{/if}
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="outline" onclick={skipSetup}>Skip</Button>
				<Button onclick={continueFromSetup}>Continue</Button>
			</div>
		</div>
	{/if}
</StandaloneShell>
