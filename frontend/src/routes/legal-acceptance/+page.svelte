<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { client, type AuthConfiguration } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { safeSameOriginRedirect } from '$lib/redirects';

	let acceptedLegal = $state(false);
	let loading = $state(false);
	let configurationLoading = $state(true);
	let error = $state('');
	let authConfiguration = $state<AuthConfiguration | null>(null);

	function completionTarget() {
		const target = safeSameOriginRedirect(page.url);
		return target === '/legal-acceptance' || target.startsWith('/legal-acceptance?') ? '/' : target;
	}

	onMount(async () => {
		const { data, error: responseError } = await client.GET('/auth/config');
		if (responseError || !data) error = responseError?.detail ?? m.auth_config_load_failed();
		else authConfiguration = data;
		configurationLoading = false;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!acceptedLegal) {
			error = m.auth_register_legal_required();
			return;
		}
		loading = true;
		const { data, error: responseError } = await client.POST('/auth/legal-acceptance', {
			body: { accepted_legal: true }
		});
		loading = false;
		if (responseError || !data) {
			error = responseError?.detail ?? m.auth_login_failed();
			return;
		}
		auth.setUser(data);
		await goto(resolve(completionTarget() as '/'));
	}

	async function signOut() {
		await auth.logout();
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
			{#if loading}<LoaderIcon class="size-4 animate-spin" />{/if}
			{loading ? m.auth_legal_loading() : m.auth_legal_submit()}
		</Button>
		<Button type="button" variant="ghost" class="w-full" disabled={loading} onclick={signOut}>
			{m.auth_legal_sign_out()}
		</Button>
	</form>
</StandaloneShell>
