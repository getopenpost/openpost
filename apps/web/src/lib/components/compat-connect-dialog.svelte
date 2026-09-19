<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		provider: 'mastodon' | 'pixelfed';
		instance?: string;
		loading: boolean;
		error: string;
		onSubmit: () => void;
		onCode: () => void;
		onErrorDismiss: () => void;
	}

	let {
		open = $bindable(false),
		provider,
		instance = $bindable(''),
		loading,
		error,
		onSubmit,
		onCode,
		onErrorDismiss
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{provider === 'pixelfed' ? m.accounts_connect_pixelfed() : m.accounts_connect_mastodon()}
			</Dialog.Title>
			<Dialog.Description>
				{provider === 'pixelfed'
					? m.accounts_pixelfed_description()
					: m.accounts_mastodon_description()}
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(e: SubmitEvent) => {
				e.preventDefault();
				onSubmit();
			}}
		>
			<div class="space-y-2">
				<Label for={provider === 'pixelfed' ? 'pixelfed-server' : 'mastodon-server'}>
					{provider === 'pixelfed'
						? m.accounts_pixelfed_server_address()
						: m.accounts_mastodon_server_address()}
				</Label>
				<Input
					id={provider === 'pixelfed' ? 'pixelfed-server' : 'mastodon-server'}
					class="h-11 sm:h-9"
					bind:value={instance}
					placeholder={provider === 'pixelfed' ? 'pixelfed.social' : 'mastodon.social'}
					autocomplete="url"
					autocapitalize="none"
					spellcheck="false"
					required
				/>
			</div>
			{#if error}
				<InlineNotice
					tone="error"
					message={error}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => onErrorDismiss()}
				/>
			{/if}
			<div class="flex flex-wrap justify-end gap-2">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} class="min-h-11 sm:min-h-9" variant="outline" type="button">
							{m.common_cancel()}
						</Button>
					{/snippet}
				</Dialog.Close>
				<Button class="min-h-11 sm:min-h-9" variant="outline" type="button" onclick={onCode}>
					{m.accounts_code()}
				</Button>
				<Button class="min-h-11 sm:min-h-9" type="submit" disabled={loading}>
					{loading ? m.common_connecting() : m.common_connect()}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
