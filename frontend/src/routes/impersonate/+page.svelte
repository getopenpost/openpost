<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages';

	let authState = $derived($auth);
	let loading = $state(true);
	let error = $state('');

	onMount(() => {
		void initializeAndConsume();
	});

	async function initializeAndConsume() {
		if (authState.isLoading) await auth.initialize({ optional: true });
		await consumeImpersonationLink();
	}

	async function consumeImpersonationLink() {
		const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
		const code = params.get('code')?.trim() ?? '';
		window.history.replaceState(null, '', resolve('/impersonate'));

		if (authState.isAuthenticated) {
			error = m.impersonation_private_window_required();
			loading = false;
			return;
		}
		if (!code) {
			error = m.impersonation_link_missing();
			loading = false;
			return;
		}

		const { data, error: apiError } = await client.POST('/auth/impersonation', {
			body: { code }
		});
		if (apiError || !data) {
			error = apiError?.detail || m.impersonation_link_invalid();
			loading = false;
			return;
		}
		window.location.replace(resolve('/'));
	}
</script>

<svelte:head>
	<title>{m.impersonation_page_title()}</title>
</svelte:head>

{#snippet impersonationIcon()}
	<ShieldCheckIcon class="size-6" />
{/snippet}

<StandaloneShell
	title={m.impersonation_heading()}
	description={m.impersonation_description()}
	icon={impersonationIcon}
	{loading}
	loadingLabel={m.impersonation_signing_in()}
>
	{#if error}
		<InlineNotice tone="error" message={error} />
	{/if}
</StandaloneShell>
