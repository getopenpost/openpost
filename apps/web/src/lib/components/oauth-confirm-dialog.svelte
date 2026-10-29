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
		onConfirm: (connectionMode?: 'oauth' | 'instagram_login') => void;
	}

	let { open = $bindable(false), provider, title, description, onConfirm }: Props = $props();
	let instagram = $derived(provider?.platform === 'instagram');
	let instagramModes = $derived(provider?.configured_connection_modes ?? ['oauth']);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{m.accounts_oauth_confirm_title({
					platform: provider ? title : m.accounts_callback_social_account()
				})}
			</Dialog.Title>
			<Dialog.Description
				>{instagram
					? m.accounts_instagram_choose_method()
					: m.accounts_oauth_confirm_description()}</Dialog.Description
			>
		</Dialog.Header>
		{#if instagram}
			<p class="text-sm text-muted-foreground">{m.accounts_instagram_professional_required()}</p>
			<div class="grid gap-3">
				<Button
					multiline
					class="h-auto min-h-11 w-full px-4 py-3 text-left whitespace-normal"
					disabled={!instagramModes.includes('instagram_login')}
					onclick={() => onConfirm('instagram_login')}
				>
					<span class="min-w-0 flex-1 space-y-1">
						<span class="block font-medium">{m.accounts_instagram_direct()}</span>
						<span class="block text-sm font-normal"
							>{m.accounts_instagram_direct_description()}</span
						>
						{#if !instagramModes.includes('instagram_login')}<span class="block text-xs"
								>{m.accounts_instagram_method_unavailable()}</span
							>{/if}
					</span>
				</Button>
				<Button
					multiline
					variant="outline"
					class="h-auto min-h-11 w-full px-4 py-3 text-left whitespace-normal"
					disabled={!instagramModes.includes('oauth')}
					onclick={() => onConfirm('oauth')}
				>
					<span class="min-w-0 flex-1 space-y-1">
						<span class="block font-medium">{m.accounts_instagram_facebook()}</span>
						<span class="block text-sm font-normal"
							>{m.accounts_instagram_facebook_description()}</span
						>
						{#if !instagramModes.includes('oauth')}<span class="block text-xs"
								>{m.accounts_instagram_method_unavailable()}</span
							>{/if}
					</span>
				</Button>
			</div>
		{:else}
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
		{/if}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline">{m.common_cancel()}</Button>
				{/snippet}
			</Dialog.Close>
			{#if !instagram}
				<Button onclick={() => onConfirm()}>
					{m.accounts_oauth_continue({
						platform: provider ? title : m.accounts_callback_social_account()
					})}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
