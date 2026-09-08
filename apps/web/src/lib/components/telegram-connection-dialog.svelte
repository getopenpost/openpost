<script lang="ts">
	import { onDestroy } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { m } from '$lib/paraglide/messages';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';

	let {
		workspaceID,
		onClose,
		onRefresh
	}: {
		workspaceID: string;
		onClose: () => void;
		onRefresh: () => Promise<void>;
	} = $props();
	let chatID = $state('');
	let pending = $state(false);
	let error = $state('');
	let command = $state<components['schemas']['IssueTelegramConnectionCodeResponse'] | null>(null);
	let disposed = false;
	onDestroy(() => {
		disposed = true;
	});

	async function issueCommand() {
		if (pending) return;
		pending = true;
		error = '';
		try {
			const { data, error: failure } = await client.POST('/accounts/telegram/connection-code', {
				body: { workspace_id: workspaceID, expected_chat_id: chatID.trim() }
			});
			if (disposed) return;
			if (failure || !data) {
				error = failure?.detail || m.accounts_connect_failed();
				return;
			}
			command = data;
		} catch {
			if (!disposed) error = m.accounts_connect_failed();
		} finally {
			if (!disposed) pending = false;
		}
	}
</script>

<Dialog.Root
	open
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_telegram_title()}</Dialog.Title>
			<Dialog.Description>{m.accounts_telegram_description()}</Dialog.Description>
		</Dialog.Header>
		{#if command}
			<div class="min-w-0 space-y-4" aria-live="polite">
				<p class="text-sm">
					{m.accounts_telegram_add_bot() + ' '}
					<a
						class="underline"
						href={`https://t.me/${encodeURIComponent(command.bot_username)}`}
						target="_blank"
						rel="noopener noreferrer">@{command.bot_username}</a
					>
				</p>
				<div class="space-y-2">
					<Label for="telegram-command">{m.accounts_telegram_command()}</Label>
					<Input
						id="telegram-command"
						value={command.code}
						readonly
						autocomplete="off"
						spellcheck="false"
						onfocus={(event) => event.currentTarget.select()}
					/>
					<p class="text-sm text-muted-foreground">
						{m.accounts_telegram_send_command()}
					</p>
					<p class="text-sm text-muted-foreground">
						{m.accounts_telegram_expires() + ' '}
						<time datetime={command.expires_at}
							>{new Date(command.expires_at).toLocaleTimeString()}</time
						>
					</p>
				</div>
				<Button
					class="min-h-11 w-full sm:min-h-9"
					onclick={async () => {
						await onRefresh();
						if (!disposed) onClose();
					}}>{m.accounts_telegram_reload()}</Button
				>
			</div>
		{:else}
			<form
				class="space-y-4"
				onsubmit={(event) => {
					event.preventDefault();
					void issueCommand();
				}}
			>
				<div class="space-y-2">
					<Label for="telegram-chat-id">{m.accounts_telegram_chat_id()}</Label>
					<Input
						id="telegram-chat-id"
						aria-describedby="telegram-chat-id-help"
						bind:value={chatID}
						pattern="-?[1-9][0-9]*"
						maxlength={20}
						required
						autocomplete="off"
						spellcheck="false"
						placeholder="-1001234567890"
					/>
					<p id="telegram-chat-id-help" class="text-sm text-muted-foreground">
						{m.accounts_telegram_chat_id_help() + ' '}
						<a
							class="underline"
							href="https://web.telegram.org/a/"
							target="_blank"
							rel="noopener noreferrer">Telegram Web A</a
						>
					</p>
				</div>
				{#if error}<InlineNotice tone="error" message={error} />{/if}
				<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="outline" type="button" onclick={onClose}>{m.common_cancel()}</Button>
					<Button class="min-h-11 sm:min-h-9" type="submit" disabled={pending}
						>{pending ? m.common_loading() : m.accounts_telegram_generate()}</Button
					>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
