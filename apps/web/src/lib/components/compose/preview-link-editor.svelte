<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { PreviewCard } from '@openpost/social-preview';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { m } from '$lib/paraglide/messages';
	import type { PollDestination } from './polls';
	import type { ComposerSettings } from './modes';
	import { type LinkChoice } from './links';
	let {
		card,
		provider,
		fields,
		values,
		choice,
		postURL,
		display,
		disabled = false,
		onSave
	}: {
		card: PreviewCard;
		provider: string;
		fields: PollDestination['fields'];
		values: ComposerSettings;
		choice: LinkChoice;
		postURL: string;
		display?: Snippet;
		disabled?: boolean;
		onSave: (choice: LinkChoice, settings: ComposerSettings) => void;
	} = $props();
	const uid = $props.id();
	const titleKey = $derived(provider === 'linkedin' ? 'article_title' : 'link_title');
	const descriptionKey = $derived(
		provider === 'linkedin' ? 'article_description' : 'link_description'
	);
	const titleField = $derived(
		fields.find((field) => field.key === titleKey && !field.unavailable_reason)
	);
	const descriptionField = $derived(
		fields.find((field) => field.key === descriptionKey && !field.unavailable_reason)
	);
	const editable = $derived(
		Boolean(titleField || descriptionField || provider === 'threads' || provider === 'facebook')
	);
	let editing = $state(false);
	let editButton = $state<HTMLButtonElement | null>(null);
	let usePostURL = $state(true);
	let url = $state('');
	let title = $state('');
	let description = $state('');
	const validURL = $derived.by(() => {
		if (usePostURL) return true;
		try {
			const parsed = new URL(url);
			return ['http:', 'https:'].includes(parsed.protocol);
		} catch {
			return false;
		}
	});
	function edit() {
		usePostURL = choice.mode === 'post';
		url =
			choice.mode === 'custom'
				? (choice.url ?? '')
				: String(values.link_url || values.url || postURL);
		title = String(values[titleKey] ?? '');
		description = String(values[descriptionKey] ?? '');
		editing = true;
		void tick().then(() =>
			document.getElementById(`${uid}-${usePostURL ? 'title' : 'url'}`)?.focus()
		);
	}
	function save() {
		const next: ComposerSettings = {};
		if (titleField) next[titleKey] = title;
		if (descriptionField) next[descriptionKey] = description;
		onSave(usePostURL ? { mode: 'post' } : { mode: 'custom', url: url.trim() }, next);
		editing = false;
		void tick().then(() => editButton?.focus());
	}
</script>

{#if editing}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape cancels edits from focused fields in this group.) -->
	<div
		class="grid gap-3"
		data-testid="preview-link-editor"
		role="group"
		aria-label={m.publishing_setting_link_title()}
		onkeydown={(event) => {
			if (event.key === 'Escape' && !event.defaultPrevented) {
				event.stopPropagation();
				editing = false;
				void tick().then(() => editButton?.focus());
			}
		}}
	>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><Checkbox bind:checked={usePostURL} />{m.compose_link_use_post_url()}</label
		>
		{#if !usePostURL}<div class="grid gap-1">
				<label for="{uid}-url" class="text-sm font-medium">{m.compose_link_url()}</label><Input
					id="{uid}-url"
					type="url"
					bind:value={url}
					aria-invalid={!validURL}
				/>
			</div>{/if}
		{#if titleField}<div class="grid gap-1">
				<label for="{uid}-title" class="text-sm font-medium"
					>{m.publishing_setting_link_title()}</label
				><Input
					id="{uid}-title"
					bind:value={title}
					maxlength={titleField.constraints?.max_length}
					placeholder={card.title}
				/>
			</div>{/if}
		{#if descriptionField}<div class="grid gap-1">
				<label for="{uid}-description" class="text-sm font-medium"
					>{m.publishing_setting_link_description()}</label
				><Textarea
					id="{uid}-description"
					bind:value={description}
					rows={2}
					maxlength={descriptionField.constraints?.max_length}
				/>
			</div>{/if}
		<div class="flex flex-wrap justify-end gap-2">
			<Button
				variant="ghost"
				size="sm"
				onclick={() => {
					title = '';
					description = '';
					usePostURL = true;
				}}>{m.compose_preview_reset()}</Button
			><Button
				variant="outline"
				size="sm"
				onclick={() => {
					editing = false;
					void tick().then(() => editButton?.focus());
				}}>{m.common_cancel()}</Button
			><Button size="sm" disabled={disabled || !validURL} onclick={save}>{m.common_save()}</Button>
		</div>
	</div>
{:else}
	<div class="flex min-w-0 items-start justify-between gap-2">
		<div class="grid min-w-0 gap-1">
			{#if display}{@render display()}{:else}<span class="text-xs opacity-75">{card.domain}</span>
				<p class="font-semibold break-words">{card.title}</p>{/if}
		</div>
		{#if editable}<Button
				variant="ghost"
				size="sm"
				class="shrink-0"
				bind:ref={editButton}
				{disabled}
				onclick={edit}>{m.common_edit()}</Button
			>{/if}
	</div>
{/if}
