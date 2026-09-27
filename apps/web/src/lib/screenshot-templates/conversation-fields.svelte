<script lang="ts">
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import ReorderList from '$lib/components/reorder-list.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import TextField from './text-field.svelte';
	import ImageField from './image-field.svelte';
	import RowActions from './row-actions.svelte';
	import { pasteConversation, type Conversation } from './document';
	let {
		value,
		workspaceId,
		onchange
	}: {
		workspaceId: string;
		value: Conversation;
		onchange: (value: Conversation, key?: string) => void;
	} = $props();
	const prefix = $props.id();
	let paste = $state('');
	let pasteError = $state('');
	const people = $derived(value.people ?? []);
	const messages = $derived(value.messages ?? []);
	const reorderMessages = $derived(messages.map((message) => ({ ...message, key: message.id })));
	function patch(update: Partial<Conversation>, key?: string) {
		onchange({ ...value, ...update }, key);
	}
	function addMessage() {
		patch({
			messages: [...messages, { id: crypto.randomUUID(), sender_id: value.self_id, text: '' }]
		});
	}
	function importMessages() {
		try {
			onchange(pasteConversation(paste, value));
			paste = '';
			pasteError = '';
		} catch (error) {
			pasteError = error instanceof Error ? error.message : m.templates_paste_invalid();
		}
	}
</script>

<div class="space-y-5">
	<TextField
		label={m.templates_contact()}
		value={value.name}
		oninput={(name) => patch({ name }, 'contact')}
	/>
	<details class="group border-b pb-4">
		<summary
			class="cursor-pointer text-sm font-medium focus-visible:outline-ring [@media(pointer:coarse)]:py-3"
			>{m.templates_conversation_settings()}</summary
		>
		<div class="mt-4 space-y-4">
			<div class="flex items-center justify-between">
				<Label for="{prefix}-header">{m.templates_show_header()}</Label><Checkbox
					id="{prefix}-header"
					checked={value.show_header}
					onCheckedChange={(show_header) => patch({ show_header })}
				/>
			</div>
			<TextField
				label={m.templates_timestamp()}
				value={value.timestamp}
				oninput={(timestamp) => patch({ timestamp }, 'timestamp')}
			/>
			<TextField
				label={m.templates_read_receipt()}
				value={value.read_receipt}
				oninput={(read_receipt) => patch({ read_receipt }, 'read-receipt')}
			/>
			<p class="text-xs text-muted-foreground">{m.templates_read_receipt_help()}</p>
			{#each people as person (person.id)}<div class="space-y-2">
					<div class="flex items-end gap-2">
						<div class="min-w-0 flex-1">
							<TextField
								label={person.id === value.self_id ? m.templates_you() : m.templates_participant()}
								value={person.name}
								oninput={(name) =>
									patch(
										{ people: people.map((p) => (p.id === person.id ? { ...p, name } : p)) },
										person.id
									)}
							/>
						</div>
						<Button
							variant="ghost"
							size="icon"
							disabled={person.id === value.self_id ||
								people.length <= 2 ||
								messages.some((message) => message.sender_id === person.id)}
							onclick={() => patch({ people: people.filter((p) => p.id !== person.id) })}
							aria-label={m.common_delete()}><ThemeIcon role="delete" class="size-4" /></Button
						>
					</div>
					<ImageField
						{workspaceId}
						mediaId={person.avatar_media_id}
						avatar
						label={m.templates_person_photo({
							name:
								person.id === value.self_id
									? m.templates_you()
									: person.name || m.templates_participant()
						})}
						onchange={(avatar_media_id) =>
							patch({
								people: people.map((p) => (p.id === person.id ? { ...p, avatar_media_id } : p))
							})}
					/>
				</div>{/each}
			<p class="text-xs text-muted-foreground">{m.templates_remove_person_help()}</p>
			<Button
				variant="outline"
				size="sm"
				disabled={people.length >= 12}
				onclick={() =>
					patch({
						people: [...people, { id: crypto.randomUUID(), name: m.templates_participant() }]
					})}><ThemeIcon role="add" class="size-4" />{m.templates_add_person()}</Button
			>
		</div>
	</details>
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium">{m.templates_messages()}</h2>
			<span class="text-xs text-muted-foreground">{messages.length}/80</span>
		</div>
		<ReorderList
			items={reorderMessages}
			scope={prefix}
			label={m.templates_messages()}
			onReorder={(items) => patch({ messages: items.map(({ key: _key, ...message }) => message) })}
			>{#snippet item(message, index, handle)}<div
					id="field-{message.id}"
					class="mb-3 space-y-2 rounded-md border bg-card p-3"
				>
					<div class="flex items-center justify-between gap-1">
						<button
							{...handle}
							type="button"
							class={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
							aria-label={`${m.video_editor_composition_timeline_reorder()} ${m.templates_message_number({ number: index + 1 })}`}
							><ThemeIcon role="drag" class="size-3.5" /></button
						>
						<AppSelect
							ariaLabel={m.templates_sender()}
							value={message.sender_id}
							options={people.map((person) => ({
								value: person.id,
								label: person.name || m.templates_participant()
							}))}
							class="h-8 min-w-0 flex-1"
							onValueChange={(sender_id) =>
								patch({
									messages: messages.map((msg) =>
										msg.id === message.id ? { ...msg, sender_id } : msg
									)
								})}
						/><RowActions
							{index}
							count={messages.length}
							maximum={80}
							onduplicate={() =>
								patch({
									messages: [
										...messages.slice(0, index + 1),
										{ ...messages[index], id: crypto.randomUUID() },
										...messages.slice(index + 1)
									]
								})}
							onremove={() => patch({ messages: messages.filter((msg) => msg.id !== message.id) })}
						/>
					</div>
					<Textarea
						aria-label={m.templates_message_number({ number: index + 1 })}
						value={message.text}
						rows={3}
						maxlength={2000}
						oninput={(event) =>
							patch(
								{
									messages: messages.map((msg) =>
										msg.id === message.id ? { ...msg, text: event.currentTarget.value } : msg
									)
								},
								message.id
							)}
					/>
					<ImageField
						{workspaceId}
						mediaId={message.image_media_id}
						label={m.templates_message_photo({ number: index + 1 })}
						onchange={(image_media_id) =>
							patch({
								messages: messages.map((msg) =>
									msg.id === message.id ? { ...msg, image_media_id } : msg
								)
							})}
					/>
				</div>{/snippet}</ReorderList
		>
		<Button variant="outline" class="w-full" disabled={messages.length >= 80} onclick={addMessage}
			><ThemeIcon role="add" class="size-4" />{m.templates_add_message()}</Button
		>
	</div>
	<details>
		<summary
			class="cursor-pointer text-sm font-medium focus-visible:outline-ring [@media(pointer:coarse)]:py-3"
			>{m.templates_paste()}</summary
		>
		<div class="mt-3 space-y-3">
			<Label for="{prefix}-paste">{m.templates_paste_help()}</Label><Textarea
				id="{prefix}-paste"
				bind:value={paste}
				rows={5}
				maxlength={160000}
				placeholder="Me: Hey!&#10;Alex: Hello"
			/>
			{#if pasteError}<InlineNotice tone="error" message={pasteError} />{/if}
			<Button variant="outline" disabled={!paste.trim()} onclick={importMessages}
				>{m.templates_replace_messages()}</Button
			>
		</div>
	</details>
</div>
