<script lang="ts">
	import { goto } from '$app/navigation';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { createQuery } from '@tanstack/svelte-query';
	import { authConfigurationQueryOptions } from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';

	let acceptedLegal = $state(false);
	let loading = $state(false);
	let error = $state('');
	let submissionSequence = 0;
	const authConfigurationQuery = createQuery(() => authConfigurationQueryOptions(authQueryAPI));
	const authConfiguration = $derived(authConfigurationQuery.data ?? null);
	const configurationLoading = $derived(authConfigurationQuery.isPending);

	onDestroy(() => {
		submissionSequence += 1;
	});

	function completionTarget() {
		const target = safeSameOriginRedirect(page.url);
		return target === '/legal-acceptance' || target.startsWith('/legal-acceptance?') ? '/' : target;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!acceptedLegal) {
			error = m.auth_register_legal_required();
			return;
		}
		const identity = auth.captureIdentity();
		if (!identity) return;
		const requestSequence = ++submissionSequence;
		const isCurrentRequest = () =>
			requestSequence === submissionSequence && auth.isIdentityCurrent(identity);
		loading = true;
		const { data, error: responseError } = await client.POST('/auth/legal-acceptance', {
			body: { accepted_legal: true }
		});
		if (responseError || !data) {
			if (isCurrentRequest()) {
				loading = false;
				error = responseError?.detail ?? m.auth_login_failed();
			}
			return;
		}
		if (!auth.isIdentityCurrent(identity)) return;
		auth.setUser(data);
		if (!isCurrentRequest()) return;
		loading = false;
		await goto(resolveAppPath(completionTarget()));
	}

	async function signOut() {
		const route = `${window.location.pathname}${window.location.search}`;
		const loggedOut = await auth.logout();
		if (
			!loggedOut ||
			get(auth).user ||
			`${window.location.pathname}${window.location.search}` !== route
		) {
			return;
		}
		await goto(resolve('/login'));
	}
</script>

<svelte:head>
	<title>{m.auth_legal_title()}</title>
</svelte:head>

<StandaloneShell
	title={m.auth_legal_heading()}
	description={m.auth_legal_description()}
	logoHref="/"
>
	{#if error}
		<InlineNotice tone="error" message={error} class="mb-4" />
	{/if}
	{#if authConfigurationQuery.isError}
		<InlineNotice
			tone={authConfiguration ? 'warning' : 'error'}
			message={authConfigurationQuery.error?.message ?? m.auth_config_load_failed()}
			class="mb-4"
		>
			{#snippet actions()}
				<Button
					type="button"
					variant="outline"
					class="mb-4"
					onclick={() => void authConfigurationQuery.refetch()}
				>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{/if}

	<form onsubmit={submit} class="space-y-4">
		<div class="flex items-start gap-3 rounded-md border p-3">
			<Checkbox id="legal-acceptance" bind:checked={acceptedLegal} required />
			<Label for="legal-acceptance" class="block min-w-0 flex-1 text-sm leading-5 font-normal">
				{m.auth_register_legal_prefix()}
				<a
					href={authConfiguration?.terms_url}
					target="_blank"
					rel="noreferrer"
					class="font-medium text-primary underline-offset-4 hover:underline"
					>{m.auth_register_terms()}</a
				>
				{m.auth_register_legal_join()}
				<a
					href={authConfiguration?.privacy_url}
					target="_blank"
					rel="noreferrer"
					class="font-medium text-primary underline-offset-4 hover:underline"
					>{m.auth_register_privacy()}</a
				>.
			</Label>
		</div>

		<Button
			type="submit"
			class="w-full gap-2"
			disabled={loading || configurationLoading || !authConfiguration?.legal_acceptance_required}
		>
			{#if loading}<ProtectedIcon icon="loading" class="size-4 animate-spin" />{/if}
			{loading ? m.auth_legal_loading() : m.auth_legal_submit()}
		</Button>
		<Button type="button" variant="ghost" class="w-full" disabled={loading} onclick={signOut}>
			{m.auth_legal_sign_out()}
		</Button>
	</form>
</StandaloneShell>
