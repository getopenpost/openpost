<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface FediverseChannel {
		id: string;
		display_name?: string | null;
	}

	interface Props {
		open?: boolean;
		provider: 'peertube' | 'lemmy' | 'piefed';
		instance?: string;
		username?: string;
		password?: string;
		channel?: string;
		loading: boolean;
		error: string;
		channels: FediverseChannel[];
		connectionID: string;
		onSubmit: () => void;
		onChannel: (channelID: string) => void;
		onErrorDismiss: () => void;
	}

	let {
		open = $bindable(false),
		provider,
		instance = $bindable(''),
		username = $bindable(''),
		password = $bindable(''),
		channel = $bindable(''),
		loading,
		error,
		channels,
		connectionID,
		onSubmit,
		onChannel,
		onErrorDismiss
	}: Props = $props();

	const isPeertube = $derived(provider === 'peertube');
	const title = $derived(
		isPeertube
			? m.accounts_connect_peertube()
			: provider === 'lemmy'
				? m.accounts_connect_lemmy()
				: m.accounts_connect_piefed()
	);
	const description = $derived(
		isPeertube
			? m.accounts_provider_peertube()
			: provider === 'lemmy'
				? m.accounts_provider_lemmy()
				: m.accounts_provider_piefed()
	);
	const serverLabel = $derived(m.accounts_instance_url());
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{title}
			</Dialog.Title>
			<Dialog.Description>
				{description}
			</Dialog.Description>
		</Dialog.Header>
		{#if connectionID && channels.length > 0}
			<div class="space-y-4">
				<p class="text-sm text-muted-foreground">
					{m.accounts_fediverse_channel_description()}
				</p>
				<div class="space-y-2" role="listbox" aria-label={m.accounts_fediverse_select_channel()}>
					{#each channels as item (item.id)}
						<Button
							variant="outline"
							class="min-h-11 w-full justify-start sm:min-h-9"
							disabled={loading}
							onclick={() => onChannel(item.id)}
						>
							{item.display_name}
						</Button>
					{/each}
				</div>
				{#if error}
					<InlineNotice
						tone="error"
						message={error}
						dismissLabel={m.common_dismiss()}
						onDismiss={() => onErrorDismiss()}
					/>
				{/if}
			</div>
		{:else}
			<form
				class="space-y-4"
				onsubmit={(e) => {
					e.preventDefault();
					onSubmit();
				}}
			>
				<div class="space-y-2">
					<Label for="fediverse-instance">{serverLabel}</Label>
					<Input
						type="text"
						id="fediverse-instance"
						bind:value={instance}
						placeholder="https://tube.example"
						autocomplete="url"
						autocapitalize="none"
						spellcheck="false"
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="fediverse-username">{m.accounts_fediverse_username()}</Label>
					<Input
						type="text"
						id="fediverse-username"
						bind:value={username}
						autocomplete="username"
						autocapitalize="none"
						spellcheck="false"
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="fediverse-password">{m.accounts_fediverse_password()}</Label>
					<Input
						type="password"
						id="fediverse-password"
						bind:value={password}
						autocomplete="current-password"
						required
					/>
				</div>
				{#if isPeertube}
					<div class="space-y-2">
						<Label for="fediverse-channel">{m.accounts_fediverse_channel()}</Label>
						<Input
							type="text"
							id="fediverse-channel"
							bind:value={channel}
							autocapitalize="none"
							spellcheck="false"
						/>
					</div>
				{/if}
				{#if error}
					<InlineNotice
						tone="error"
						message={error}
						dismissLabel={m.common_dismiss()}
						onDismiss={() => onErrorDismiss()}
					/>
				{/if}
				<div class="flex justify-end gap-2">
					<Dialog.Close>
						{#snippet child({ props })}
							<Button {...props} variant="outline" type="button">{m.common_cancel()}</Button>
						{/snippet}
					</Dialog.Close>
					<Button type="submit" disabled={loading}>
						{loading ? m.common_connecting() : m.common_connect()}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
