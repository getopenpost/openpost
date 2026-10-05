<script lang="ts">
	import { onDestroy, tick, type Snippet } from 'svelte';
	import type { PreviewPoll } from '@openpost/social-preview';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import PollContentFields from './poll-content-fields.svelte';
	import {
		hasPollContent,
		POLL_DURATION_ENUMS,
		supportsNativePoll,
		type SharedPoll,
		type PollContent,
		type PollDestination
	} from './polls';
	import type { ComposerSettings } from './modes';
	let {
		value,
		preview,
		destination,
		settings,
		display,
		onChange,
		onLegacyChange,
		onCustomizeText,
		disabled = false,
		onEditingChange = () => {}
	}: {
		value?: SharedPoll;
		preview?: PreviewPoll;
		destination: PollDestination;
		settings: ComposerSettings;
		display?: Snippet;
		disabled?: boolean;
		onChange: (value: SharedPoll) => void;
		onLegacyChange: (settings: ComposerSettings) => void;
		onCustomizeText: () => void;
		onEditingChange?: (editing: boolean) => void;
	} = $props();
	const uid = $props.id();
	const choice = $derived(value?.destinations[destination.id]);
	const mode = $derived(choice?.mode ?? (value ? '' : 'legacy'));
	const native = $derived(supportsNativePoll(destination.fields));
	const choices = $derived([
		{ value: 'native', label: m.compose_poll_native() },
		{ value: 'text', label: m.compose_poll_text() },
		{ value: 'omit', label: m.compose_poll_omit() }
	]);
	let editing = $state(false);
	let childPopupOpen = false;
	let editButton = $state<HTMLButtonElement | null>(null);
	let form = $state<HTMLElement | null>(null);
	let draft = $state<PollContent>();
	let clearableFlags = $state<Array<'multiple' | 'hide_totals'>>([]);
	const legacy = $derived(mode === 'legacy');
	const canSave = $derived(
		draft &&
			(legacy
				? draft.options.length >= 2 && draft.options.every((item) => item.text.trim())
				: hasPollContent(draft))
	);
	function toggle(next: boolean) {
		editing = next;
		onEditingChange(next);
		void tick().then(() => {
			if (next) form?.querySelector<HTMLInputElement>('input')?.focus();
			else editButton?.focus();
		});
	}
	function edit() {
		if (value && !legacy) {
			const { destinations: _destinations, ...shared } = value;
			draft = structuredClone(
				$state.snapshot(choice?.mode === 'custom' && choice.poll ? choice.poll : shared)
			);
		} else {
			const enumDuration =
				settings.poll_duration === 'ONE_WEEK'
					? 604800
					: settings.poll_duration === 'TWO_WEEKS'
						? 1209600
						: [...POLL_DURATION_ENUMS].find(([, name]) => name === settings.poll_duration)?.[0];
			draft = {
				question: String(settings.poll_question ?? destination.body),
				options: (preview?.options ?? []).map((text) => ({ id: crypto.randomUUID(), text })),
				duration_seconds: Number(
					settings.poll_expires_in_seconds ??
						(settings.poll_duration_minutes
							? Number(settings.poll_duration_minutes) * 60
							: (enumDuration ?? 86400))
				),
				multiple: Boolean(settings.poll_multiple),
				hide_totals: Boolean(settings.poll_hide_totals)
			};
		}
		clearableFlags = (['multiple', 'hide_totals'] as const).filter((field) => draft?.[field]);
		toggle(true);
	}
	function setMode(next: string) {
		if (!value || (next !== 'native' && next !== 'text' && next !== 'omit')) return;
		onChange({
			...value,
			destinations: { ...value.destinations, [destination.id]: { mode: next } }
		});
	}
	function save() {
		if (!draft) return;
		if (legacy) {
			const next: ComposerSettings = {
				poll_options: draft.options.map((option) => option.text).join('\n')
			};
			for (const field of destination.fields) {
				if (field.key === 'poll_question') next.poll_question = draft.question;
				if (field.key === 'poll_duration_minutes')
					next.poll_duration_minutes = draft.duration_seconds / 60;
				if (field.key === 'poll_expires_in_seconds')
					next.poll_expires_in_seconds = draft.duration_seconds;
				if (field.key === 'poll_duration')
					next.poll_duration = POLL_DURATION_ENUMS.get(draft.duration_seconds) ?? '';
				if (field.key === 'poll_multiple') next.poll_multiple = Boolean(draft.multiple);
				if (field.key === 'poll_hide_totals') next.poll_hide_totals = Boolean(draft.hide_totals);
			}
			onLegacyChange(next);
		} else if (value)
			onChange({
				...value,
				destinations: { ...value.destinations, [destination.id]: { mode: 'custom', poll: draft } }
			});
		toggle(false);
	}
	onDestroy(() => {
		if (editing) onEditingChange(false);
	});
</script>

{#if editing && draft}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape cancels edits from focused fields in this group.) -->
	<div
		class="grid gap-3"
		data-testid="preview-poll-editor"
		role="group"
		aria-label={m.compose_poll_title()}
		bind:this={form}
		onkeydowncapture={(event) => {
			childPopupOpen =
				event.target instanceof Element && Boolean(event.target.closest('[aria-expanded="true"]'));
		}}
		onkeydown={(event) => {
			if (event.key === 'Escape' && !event.defaultPrevented && !childPopupOpen) {
				event.stopPropagation();
				toggle(false);
			}
		}}
	>
		<PollContentFields
			value={draft}
			fields={destination.fields}
			questionSource={legacy && !destination.fields.some((field) => field.key === 'poll_question')
				? 'caption'
				: 'poll'}
			onChange={(next) => (draft = next)}
		/>
		{#each [{ key: 'poll_multiple', label: m.compose_poll_multiple(), field: 'multiple' as const }, { key: 'poll_hide_totals', label: m.compose_poll_hide_totals(), field: 'hide_totals' as const }] as option (option.key)}
			{@const supported = destination.fields.some(
				(field) => field.key === option.key && !field.unavailable_reason
			)}
			{#if supported || clearableFlags.includes(option.field)}<label
					class="flex min-h-11 items-center gap-2 text-sm"
					><Checkbox
						checked={Boolean(draft[option.field])}
						disabled={!supported && !draft[option.field]}
						onCheckedChange={(checked) => {
							if (draft) draft = { ...draft, [option.field]: checked };
						}}
					/>{option.label}</label
				>{/if}
		{/each}
		<div class="flex flex-wrap justify-end gap-2">
			<Button variant="outline" size="sm" onclick={() => toggle(false)}>{m.common_cancel()}</Button
			><Button size="sm" disabled={disabled || !canSave} onclick={save}>{m.common_save()}</Button>
		</div>
	</div>
{:else}
	{#if display}{@render display()}{/if}
	{#if !mode && value}
		<InlineNotice
			message={native ? m.compose_poll_decision() : m.compose_poll_account_unsupported()}
		/>
		<div class="flex flex-wrap gap-2">
			{#if native}<Button variant="outline" size="sm" onclick={() => setMode('native')}
					>{m.compose_poll_native()}</Button
				>{/if}<Button variant="outline" size="sm" onclick={() => setMode('omit')}
				>{m.compose_poll_omit()}</Button
			><Button variant="ghost" size="sm" onclick={() => setMode('text')}
				>{m.compose_poll_text()}</Button
			>
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-2">
			{#if preview}<Button variant="ghost" size="sm" {disabled} bind:ref={editButton} onclick={edit}
					>{m.compose_poll_edit()}</Button
				>{:else}<span class="text-xs text-muted-foreground">{m.compose_poll_title()}</span>{/if}
			{#if value}<Select.Root value={mode} onValueChange={setMode}
					><Select.Trigger
						id={uid}
						class="h-8 w-auto min-w-36"
						aria-label={m.compose_poll_account_version()}
						>{mode === 'custom' || mode === 'legacy'
							? m.compose_poll_custom()
							: choices.find((item) => item.value === mode)?.label}</Select.Trigger
					><Select.Content
						>{#each choices as item (item.value)}<Select.Item
								value={item.value}
								disabled={item.value === 'native' && !native}>{item.label}</Select.Item
							>{/each}</Select.Content
					></Select.Root
				>{/if}
		</div>
		{#if mode === 'text'}<p class="text-xs text-muted-foreground" role="status">
				{m.compose_poll_text_notice()}
			</p>
			<Button variant="ghost" size="sm" class="w-fit" onclick={onCustomizeText}
				>{m.compose_poll_customize_text()}</Button
			>{/if}
	{/if}
	{#if destination.error}<p class="text-xs text-destructive" role="status">
			{destination.error}
		</p>{/if}
{/if}
