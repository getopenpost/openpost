<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		accountManagementReturnHref,
		accountSetupHref,
		clearAccountManagementContinuation
	} from '$lib/account-management-route';

	let code = $state('');
	let serverName = $state('');
	let instanceURL = $state('');
	let workspaceId = $state('');
	let loading = $state(false);
	let error = $state('');
	let pageLoading = $state(true);
	let cancelHref = $state('/settings?tab=accounts');

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const storedWorkspace = localStorage.getItem('oauth_workspace_id');
		const storedServer = localStorage.getItem('oauth_mastodon_server');
		const storedInstanceURL = localStorage.getItem('oauth_mastodon_instance_url');
		cancelHref = accountManagementReturnHref();

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
			const { data, error: err } = await client.POST('/accounts/mastodon/exchange', {
				body: {
					workspace_id: workspaceId,
					server_name: serverName,
					instance_url: instanceURL,
					code: code.trim()
				}
			});
			if (err) throw new Error(err.detail || m.accounts_mastodon_callback_exchange_failed());
			if (!data?.workspace_id || !data.account_id) {
				throw new Error(m.accounts_mastodon_callback_exchange_failed());
			}
			if (data.feature_setup_required && data.new_account_ids?.length) {
				await goto(
					resolveAppPath(
						accountSetupHref({
							workspaceID: data.workspace_id,
							accountIDs: data.account_ids ?? [data.account_id],
							newAccountIDs: data.new_account_ids ?? [],
							openFreshComposer: data.open_fresh_composer
						})
					)
				);
				return;
			}
			pageLoading = true;
			if (!data.open_fresh_composer) {
				await goto(resolveAppPath(accountManagementReturnHref()));
				clearAccountManagementContinuation();
				return;
			}
			const query = new URLSearchParams({
				workspace_id: data.workspace_id,
				account_ids: (data.account_ids ?? [data.account_id]).join(',')
			});
			await goto(resolveAppPath(`/?${query.toString()}`));
			clearAccountManagementContinuation();
		} catch (e) {
			await goto(resolveAppPath(accountManagementReturnHref(undefined, 'failed', workspaceId)));
			clearAccountManagementContinuation();
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{m.accounts_mastodon_callback_title()}</title>
</svelte:head>

<StandaloneShell
	title={m.accounts_mastodon_callback_connect()}
	description={m.accounts_mastodon_callback_description()}
	loading={pageLoading}
	loadingLabel={m.common_loading()}
>
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
				<Button href={resolveAppPath(cancelHref)} variant="outline">{m.common_cancel()}</Button>
				<Button type="submit" disabled={loading}>
					{loading
						? m.accounts_mastodon_callback_connecting()
						: m.accounts_mastodon_callback_connect_action()}
				</Button>
			</div>
		</form>
	</div>
</StandaloneShell>
