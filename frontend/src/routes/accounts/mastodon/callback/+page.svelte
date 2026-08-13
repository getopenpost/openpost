<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import { m } from '$lib/paraglide/messages';

	let code = $state('');
	let serverName = $state('');
	let instanceURL = $state('');
	let workspaceId = $state('');
	let loading = $state(false);
	let error = $state('');
	let success = $state(false);
	let pageLoading = $state(true);

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const storedWorkspace = localStorage.getItem('oauth_workspace_id');
		const storedServer = localStorage.getItem('oauth_mastodon_server');
		const storedInstanceURL = localStorage.getItem('oauth_mastodon_instance_url');

		if (storedWorkspace) workspaceId = storedWorkspace;
		if (storedServer) serverName = storedServer;
		if (storedInstanceURL) instanceURL = storedInstanceURL;

		const codeFromUrl = params.get('code');
		if (codeFromUrl) {
			code = codeFromUrl;
		}
		pageLoading = false;
	});

	async function submitCode() {
		if (!code.trim()) {
			error = m.accounts_mastodon_callback_code_required();
			return;
		}
		if (!workspaceId) {
			error = m.accounts_mastodon_callback_workspace_missing();
			return;
		}
		if (!serverName && !instanceURL) {
			error = m.accounts_mastodon_callback_instance_missing();
			return;
		}

		loading = true;
		error = '';

		try {
			const { error: err } = await client.POST('/accounts/mastodon/exchange', {
				body: {
					workspace_id: workspaceId,
					server_name: serverName,
					instance_url: instanceURL,
					code: code.trim()
				}
			});
			if (err) throw new Error(err.detail || m.accounts_mastodon_callback_exchange_failed());
			localStorage.removeItem('oauth_workspace_id');
			localStorage.removeItem('oauth_mastodon_server');
			localStorage.removeItem('oauth_mastodon_instance_url');
			success = true;
			setTimeout(() => goto(resolve('/accounts/callback?status=success&platform=mastodon')), 500);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{m.accounts_mastodon_callback_title()}</title>
</svelte:head>

<StandaloneShell
	title={success
		? m.accounts_mastodon_callback_connected()
		: m.accounts_mastodon_callback_connect()}
	description={success
		? m.accounts_mastodon_callback_preparing()
		: m.accounts_mastodon_callback_description()}
	loading={pageLoading}
	loadingLabel={m.common_loading()}
>
	{#if success}
		<div class="space-y-3 text-center" role="status" aria-live="polite">
			<CheckCircleIcon class="mx-auto size-10 text-emerald-600" />
			<p class="text-sm text-muted-foreground">{m.accounts_mastodon_callback_preparing()}</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#if serverName || instanceURL}
				<p class="text-sm text-muted-foreground">
					{m.accounts_mastodon_callback_server({ server: serverName || instanceURL })}
				</p>
			{/if}

			<form
				class="space-y-4"
				onsubmit={(event: SubmitEvent) => {
					event.preventDefault();
					void submitCode();
				}}
			>
				<div class="space-y-2">
					<Label for="code">{m.accounts_mastodon_callback_code()}</Label>
					<Input
						type="text"
						id="code"
						bind:value={code}
						placeholder={m.accounts_mastodon_callback_code_placeholder()}
						class="font-mono"
						required
					/>
				</div>

				{#if error}
					<InlineNotice tone="error" message={error} />
				{/if}

				<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button href={resolve('/settings?tab=accounts')} variant="outline"
						>{m.common_cancel()}</Button
					>
					<Button type="submit" disabled={loading}>
						{loading
							? m.accounts_mastodon_callback_connecting()
							: m.accounts_mastodon_callback_connect_action()}
					</Button>
				</div>
			</form>
		</div>
	{/if}
</StandaloneShell>
