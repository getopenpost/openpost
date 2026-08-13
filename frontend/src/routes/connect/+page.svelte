<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { instanceStore } from '$lib/stores/instance.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';

	const instance = instanceStore();

	let serverUrl = $state('');
	let error = $state('');
	let isConnecting = $state(false);

	function handleSubmit(e: Event) {
		e.preventDefault();
		connect();
	}

	async function connect() {
		if (!serverUrl.trim()) {
			error = m.connect_missing_url();
			return;
		}

		error = '';
		isConnecting = true;

		const result = await instance.setInstanceUrl(serverUrl);

		if (result.success) {
			goto(resolve('/login'));
		} else {
			error = result.error || m.connect_failed();
		}

		isConnecting = false;
	}
</script>

<svelte:head>
	<title>{m.connect_title()}</title>
</svelte:head>

<StandaloneShell title={m.connect_heading()} description={m.connect_description()}>
	{#if error}
		<InlineNotice tone="error" message={error} class="mb-4" />
	{/if}

	<form onsubmit={handleSubmit} class="space-y-4">
		<div class="space-y-2">
			<Label for="server-url">{m.connect_server_url()}</Label>
			<Input
				type="url"
				id="server-url"
				bind:value={serverUrl}
				required
				placeholder={m.connect_server_url_placeholder()}
				disabled={isConnecting}
			/>
			<p class="text-sm text-muted-foreground">
				{m.connect_server_url_hint()}
			</p>
		</div>

		<Button type="submit" disabled={isConnecting} class="w-full gap-2">
			{#if isConnecting}
				<LoaderIcon class="size-4 animate-spin" />
				{m.connect_loading()}
			{:else}
				{m.connect_submit()}
			{/if}
		</Button>
	</form>
</StandaloneShell>
