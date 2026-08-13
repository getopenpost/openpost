<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
	import { client, type AuthConfiguration } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';

	let email = $state('');
	let error = $state('');
	let loading = $state(false);
	let configurationLoading = $state(true);
	let submitted = $state(false);
	let authConfiguration = $state<AuthConfiguration | null>(null);

	onMount(async () => {
		const { data, error: responseError } = await client.GET('/auth/config');
		if (responseError || !data) error = responseError?.detail ?? m.auth_config_load_failed();
		else authConfiguration = data;
		configurationLoading = false;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;
		const { error: responseError } = await client.POST('/auth/password-reset/request', {
			body: { email }
		});
		loading = false;
		if (responseError) {
			error = responseError.detail ?? m.auth_login_failed();
			return;
		}
		submitted = true;
	}
</script>

<svelte:head>
	<title>{m.auth_forgot_title()}</title>
</svelte:head>

{#if submitted}
	{#snippet successIcon()}
		<CheckCircleIcon class="size-6 text-emerald-600 dark:text-emerald-400" />
	{/snippet}
	<StandaloneShell
		title={m.auth_forgot_success_title()}
		description={m.auth_forgot_success_description()}
		icon={successIcon}
	>
		<a
			href={resolve('/login')}
			class="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			{m.auth_login_submit()}
		</a>
	</StandaloneShell>
{:else}
	<StandaloneShell
		title={m.auth_forgot_heading()}
		description={m.auth_forgot_description()}
		logoHref="/"
	>
		{#if error}
			<InlineNotice tone="error" message={error} class="mb-4" />
		{/if}

		{#if !configurationLoading && authConfiguration && !authConfiguration.password_reset_enabled}
			<InlineNotice tone="warning" class="mb-4">
				<p>{m.auth_forgot_unavailable()}</p>
				{#if authConfiguration.support_email}
					<p class="mt-1">
						<a class="font-medium underline" href={`mailto:${authConfiguration.support_email}`}>
							{m.auth_forgot_contact_support({ email: authConfiguration.support_email })}
						</a>
					</p>
				{/if}
			</InlineNotice>
		{/if}

		<form onsubmit={submit} class="space-y-4">
			<div class="space-y-2">
				<Label for="email">{m.common_email()}</Label>
				<Input
					id="email"
					type="email"
					bind:value={email}
					autocomplete="email"
					placeholder={m.auth_email_placeholder()}
					required
				/>
			</div>
			<Button
				type="submit"
				class="w-full gap-2"
				disabled={loading || configurationLoading || !authConfiguration?.password_reset_enabled}
			>
				{#if loading}<LoaderIcon class="size-4 animate-spin" />{/if}
				{loading ? m.auth_forgot_loading() : m.auth_forgot_submit()}
			</Button>
		</form>

		<p class="mt-6 text-center text-sm">
			<a
				href={resolve('/login')}
				class="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
				>{m.auth_login_submit()}</a
			>
		</p>
	</StandaloneShell>
{/if}
