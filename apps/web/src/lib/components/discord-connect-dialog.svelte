<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		webhookUrl?: string;
		botConfigured: boolean;
		loading: boolean;
		error: string;
		onSubmit: () => void;
		onConnectBot: () => void;
		onErrorDismiss: () => void;
	}

	let {
		open = $bindable(false),
		webhookUrl = $bindable(''),
		botConfigured,
		loading,
		error,
		onSubmit,
		onConnectBot,
		onErrorDismiss
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_connect_discord()}</Dialog.Title>
			<Dialog.Description>{m.accounts_discord_description()}</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				void onSubmit();
			}}
		>
			{#if botConfigured}
				<div class="space-y-3 rounded-md border bg-muted/20 p-4">
					<div class="space-y-1">
						<p class="font-medium">{m.accounts_connect_discord_bot()}</p>
						<p class="text-sm text-muted-foreground">
							{m.accounts_discord_bot_description()}
						</p>
					</div>
					<Button class="min-h-11 w-full sm:min-h-9" type="button" onclick={onConnectBot}>
						{m.accounts_connect_discord_bot()}
					</Button>
				</div>
				<p class="text-sm font-medium text-muted-foreground">
					{m.accounts_discord_webhook_alternative()}
				</p>
			{/if}
			<div class="space-y-2">
				<Label for="discord-webhook-url">{m.accounts_discord_webhook_url()}</Label>
				<Input
					id="discord-webhook-url"
					type="password"
					bind:value={webhookUrl}
					placeholder="https://discord.com/api/webhooks/…"
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					required
				/>
				<p class="text-sm text-muted-foreground">
					{m.accounts_discord_url_help()}
				</p>
			</div>
			{#if error}
				<InlineNotice
					tone="error"
					message={error}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => onErrorDismiss()}
				/>
			{/if}
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" type="button">{m.common_cancel()}</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={loading}>
					{loading ? m.accounts_discord_verifying() : m.common_connect()}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
