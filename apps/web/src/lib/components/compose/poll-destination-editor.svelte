<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import PollContentFields from './poll-content-fields.svelte';
	import {
		supportsNativePoll,
		hasPollContent,
		resolvePollPreview,
		type SharedPoll,
		type PollContent,
		type PollDestination,
		type PollMode
	} from './polls';

	let {
		value,
		destination,
		onChange,
		onCustomizeText,
		onLegacySettings
	}: {
		value: SharedPoll;
		destination: PollDestination;
		onChange: (value: SharedPoll) => void;
		onCustomizeText: () => void;
		onLegacySettings: () => void;
	} = $props();
	const uid = $props.id();
	const choice = $derived(value.destinations[destination.id]);
	const native = $derived(supportsNativePoll(destination.fields));
	const sharedContent = $derived.by(() => {
		const { destinations: _destinations, ...content } = value;
		return content;
	});
	const content = $derived(choice?.mode === 'custom' && choice.poll ? choice.poll : sharedContent);
	const choices = $derived([
		{ value: 'native', label: m.compose_poll_native() },
		{ value: 'custom', label: m.compose_poll_custom() },
		{ value: 'text', label: m.compose_poll_text() },
		{ value: 'omit', label: m.compose_poll_omit() }
	]);
	let open = $state(false);
	let draft = $state<PollContent>();
	const canSave = $derived(hasPollContent(draft));
	function setMode(mode: PollMode) {
		onChange({
			...value,
			destinations: {
				...value.destinations,
				[destination.id]: {
					mode,
					poll: mode === 'custom' ? structuredClone($state.snapshot(content)) : undefined
				}
			}
		});
	}
	function updateContent(poll: PollContent) {
		onChange({
			...value,
			destinations: { ...value.destinations, [destination.id]: { mode: 'custom', poll } }
		});
	}
	function customize() {
		draft = structuredClone($state.snapshot(content));
		open = true;
	}
</script>

<div class="grid min-w-0 gap-3 border-t pt-3" data-testid="poll-destination-editor">
	{#if !choice}
		<InlineNotice
			message={native ? m.compose_poll_decision() : m.compose_poll_account_unsupported()}
			class="items-start"
		/>
		<div class="flex flex-wrap gap-2">
			{#if native}<Button variant="outline" size="sm" onclick={() => setMode('native')}
					>{m.compose_poll_native()}</Button
				>{/if}
			<Button variant="outline" size="sm" onclick={() => setMode('omit')}
				>{m.compose_poll_omit()}</Button
			>
			<Button variant="ghost" size="sm" onclick={() => setMode('text')}
				>{m.compose_poll_text()}</Button
			>
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<label for={uid} class="text-sm font-medium">{m.compose_poll_account_version()}</label>
			<Select.Root
				value={choice.mode}
				onValueChange={(mode: string) => {
					if (choices.some((item) => item.value === mode)) setMode(mode as PollMode);
				}}
			>
				<Select.Trigger
					id={uid}
					class="w-full sm:w-48"
					aria-label={m.compose_poll_account_version()}
					>{choice.mode === 'legacy'
						? m.compose_poll_custom()
						: choices.find((item) => item.value === choice.mode)?.label}</Select.Trigger
				>
				<Select.Content
					>{#each choices as item (item.value)}<Select.Item
							value={item.value}
							disabled={(item.value === 'native' || item.value === 'custom') && !native}
							>{item.label}</Select.Item
						>{/each}</Select.Content
				>
			</Select.Root>
		</div>
		{#if choice.mode === 'native' || choice.mode === 'custom'}
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" onclick={customize}>{m.compose_poll_customize()}</Button
				>
				{#if choice.mode === 'custom'}<Button
						variant="ghost"
						size="sm"
						onclick={() => setMode('native')}>{m.compose_poll_use_shared()}</Button
					>{/if}
			</div>
			{#each [{ key: 'poll_multiple', label: m.compose_poll_multiple(), checked: content.multiple ?? false, update: (multiple: boolean) => updateContent( { ...content, multiple } ) }, { key: 'poll_hide_totals', label: m.compose_poll_hide_totals(), checked: content.hide_totals ?? false, update: (hide_totals: boolean) => updateContent( { ...content, hide_totals } ) }] as field (field.key)}
				{@const supported = destination.fields.some(
					(definition) => definition.key === field.key && !definition.unavailable_reason
				)}
				{#if supported || field.checked || (field.key === 'poll_multiple' ? sharedContent.multiple : sharedContent.hide_totals)}
					<label class="flex min-h-11 items-center gap-2 text-sm"
						><Checkbox
							checked={field.checked}
							disabled={!supported && !field.checked}
							onCheckedChange={field.update}
						/>{field.label}</label
					>
				{/if}
			{/each}
		{:else if choice.mode === 'legacy'}
			<Button variant="outline" size="sm" class="w-fit" onclick={onLegacySettings}
				>{m.compose_poll_customize()}</Button
			>
		{:else if choice.mode === 'text'}
			<InlineNotice message={m.compose_poll_text_notice()} />
			<details>
				<summary class="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground"
					>{m.compose_poll_text_preview()}</summary
				>
				<p class="text-sm break-words whitespace-pre-wrap">
					{resolvePollPreview(value, destination.id, destination.fields, destination.body, {}).body}
				</p>
			</details>
		{/if}
		{#if choice.mode === 'text' || choice.mode === 'omit'}<Button
				variant="ghost"
				size="sm"
				class="w-fit"
				onclick={onCustomizeText}>{m.compose_poll_customize_text()}</Button
			>{/if}
	{/if}
	{#if choice && destination.error}<InlineNotice tone="error" message={destination.error} />{/if}
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" aria-describedby={undefined}>
		<Dialog.Header
			><Dialog.Title>{m.compose_poll_customize()}</Dialog.Title>
			<p class="text-sm text-muted-foreground">{destination.label}</p></Dialog.Header
		>
		{#if draft}<PollContentFields
				value={draft}
				fields={destination.fields}
				onChange={(content) => (draft = content)}
			/>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button
				disabled={!canSave}
				onclick={() => {
					if (draft) updateContent(draft);
					open = false;
				}}>{m.common_save()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
