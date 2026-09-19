<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { ProviderInfo } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		provider: ProviderInfo | null;
		title: string;
		description?: string | null;
		onConfirm: () => void;
	}

	let { open = $bindable(false), provider, title, description, onConfirm }: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{m.accounts_oauth_confirm_title({
					platform: provider ? title : m.accounts_callback_social_account()
				})}
			</Dialog.Title>
			<Dialog.Description>{m.accounts_oauth_confirm_description()}</Dialog.Description>
		</Dialog.Header>
		{#if provider}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
		<ol class="space-y-3 text-sm">
			<li class="flex gap-3">
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
					>1</span
				>
				<span>{m.accounts_oauth_step_redirect()}</span>
			</li>
			<li class="flex gap-3">
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
					>2</span
				>
				<span>{m.accounts_oauth_step_approve()}</span>
			</li>
			<li class="flex gap-3">
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
					>3</span
				>
				<span>{m.accounts_oauth_step_return()}</span>
			</li>
		</ol>
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline">{m.common_cancel()}</Button>
				{/snippet}
			</Dialog.Close>
			<Button onclick={onConfirm}>
				{m.accounts_oauth_continue({
					platform: provider ? title : m.accounts_callback_social_account()
				})}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
