<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		username?: string;
		privateKey?: string;
		loading: boolean;
		error: string;
		onSubmit: () => void;
		onErrorDismiss: () => void;
	}

	let {
		open = $bindable(false),
		username = $bindable(''),
		privateKey = $bindable(''),
		loading,
		error,
		onSubmit,
		onErrorDismiss
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_connect_devnull()}</Dialog.Title>
			<Dialog.Description>
				{m.accounts_devnull_description()}
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
				<Label for="devnull-username">{m.accounts_devnull_username()}</Label>
				<Input
					type="text"
					id="devnull-username"
					bind:value={username}
					placeholder="octocat"
					required
					autocomplete="username"
				/>
			</div>
			<div class="space-y-2">
				<Label for="devnull-private-key">{m.accounts_devnull_private_key()}</Label>
				<Textarea
					id="devnull-private-key"
					bind:value={privateKey}
					placeholder={m.accounts_devnull_private_key_placeholder()}
					required
					rows={6}
					spellcheck={false}
					autocomplete="off"
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
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" type="button">{m.common_cancel()}</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={loading}>
					{loading ? m.common_connecting() : m.common_connect()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
