<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		handle?: string;
		appPassword?: string;
		loading: boolean;
		error: string;
		onSubmit: () => void;
		onErrorDismiss: () => void;
	}

	let {
		open = $bindable(false),
		handle = $bindable(''),
		appPassword = $bindable(''),
		loading,
		error,
		onSubmit,
		onErrorDismiss
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_connect_bluesky()}</Dialog.Title>
			<Dialog.Description>
				{m.accounts_bluesky_description()}
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
		>
			<div class="space-y-2">
				<Label for="bluesky-handle">{m.accounts_handle()}</Label>
				<Input
					type="text"
					id="bluesky-handle"
					bind:value={handle}
					placeholder="user.bsky.social"
					required
				/>
			</div>
			<div class="space-y-2">
				<Label for="bluesky-password">{m.accounts_app_password()}</Label>
				<Input
					type="password"
					id="bluesky-password"
					bind:value={appPassword}
					placeholder="xxxx-xxxx-xxxx-xxxx"
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
	</Dialog.Content>
</Dialog.Root>
