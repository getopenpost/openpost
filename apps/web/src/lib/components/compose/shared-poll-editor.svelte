<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import PollContentFields from './poll-content-fields.svelte';
	import PollDestinationEditor from './poll-destination-editor.svelte';
	import {
		supportsNativePoll,
		hasPollContent,
		pollDurationField,
		pollDurationLabel,
		type SharedPoll,
		type PollDestination
	} from './polls';

	let {
		value,
		destinations,
		body,
		activeDestinationId,
		open,
		onOpenChange,
		onChange,
		onOpenDestination,
		onCustomizeText,
		onLegacySettings
	}: {
		value?: SharedPoll;
		destinations: PollDestination[];
		body: string;
		activeDestinationId: string | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onChange: (value: SharedPoll | undefined) => void;
		onOpenDestination: (id: string) => void;
		onCustomizeText: (id: string) => void;
		onLegacySettings: (id: string) => void;
	} = $props();
	let draft = $state<SharedPoll>();
	const activeDestination = $derived(
		destinations.find((destination) => destination.id === activeDestinationId)
	);
	const unresolved = $derived(
		destinations.filter((destination) => !value?.destinations[destination.id])
	);
	const unsupported = $derived(
		destinations.filter((destination) => !supportsNativePoll(destination.fields))
	);
	const content = $derived(
		activeDestination && value?.destinations[activeDestination.id]?.mode === 'custom'
			? (value.destinations[activeDestination.id].poll ?? value)
			: value
	);
	const mode = $derived(activeDestination && value?.destinations[activeDestination.id]?.mode);
	const summary = $derived.by(() => {
		if (!content) return '';
		if (mode === 'text') return m.compose_poll_text();
		if (mode === 'omit') return m.compose_poll_omit();
		if (mode === 'legacy') return m.compose_poll_custom();
		if (activeDestination && !mode) return m.compose_poll_choose();
		if (activeDestination && !pollDurationField(activeDestination.fields))
			return m.compose_poll_native();
		return m.compose_poll_summary({
			count: content.options.length,
			duration: pollDurationLabel(content.duration_seconds)
		});
	});
	const canSave = $derived(hasPollContent(draft));
	$effect(() => {
		if (!open) return;
		draft = untrack(() =>
			value
				? structuredClone($state.snapshot(value))
				: {
						question: '',
						options: [
							{ id: crypto.randomUUID(), text: '' },
							{ id: crypto.randomUUID(), text: '' }
						],
						duration_seconds: 86400,
						destinations: Object.fromEntries(
							destinations
								.filter((destination) => supportsNativePoll(destination.fields))
								.map((destination) => [destination.id, { mode: 'native' as const }])
						)
					}
		);
	});
</script>

{#if value && content}
	<section
		class="my-3 min-w-0 rounded-lg border p-3"
		aria-label={m.compose_poll_title()}
		data-testid="shared-poll-editor"
	>
		<div class="flex min-w-0 items-start gap-3">
			<ThemeIcon role="poll" class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<h3 class="text-sm font-semibold">{m.compose_poll_title()}</h3>
					<span class="text-xs text-muted-foreground">{summary}</span>
				</div>
			</div>
			{#if !activeDestinationId}
				<div class="flex shrink-0 items-center gap-1">
					<Button variant="ghost" size="sm" onclick={() => onOpenChange(true)}
						>{m.compose_poll_edit()}</Button
					>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={m.compose_remove_poll()}
						onclick={() => onChange(undefined)}><ThemeIcon role="close" class="size-4" /></Button
					>
				</div>
			{/if}
		</div>
		<p class="mt-1 pl-8 text-sm break-words">{content.question}</p>
		<p class="mt-1 line-clamp-2 pl-8 text-xs break-words text-muted-foreground">
			{content.options.map((option) => option.text).join(' · ')}
		</p>
		{#if activeDestination}
			<div class="mt-3">
				<PollDestinationEditor
					{value}
					destination={activeDestination}
					{onChange}
					onCustomizeText={() => onCustomizeText(activeDestination.id)}
					onLegacySettings={() => onLegacySettings(activeDestination.id)}
				/>
			</div>
		{:else}
			{#if unresolved.length}
				<div class="mt-3">
					<InlineNotice class="items-start">
						<p>{m.compose_poll_review_accounts()}</p>
						<div class="mt-1 flex flex-wrap gap-1">
							{#each unresolved as destination (destination.id)}<Button
									variant="ghost"
									size="sm"
									class="max-w-full justify-start whitespace-normal text-current hover:text-current"
									onclick={() => onOpenDestination(destination.id)}
									>{destination.label}<ThemeIcon
										role="chevron-right"
										class="size-3 shrink-0"
									/></Button
								>{/each}
						</div>
					</InlineNotice>
				</div>
			{/if}
		{/if}
	</section>
{/if}

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="sm:max-w-md" aria-describedby={undefined}>
		<Dialog.Header
			><Dialog.Title>{value ? m.compose_poll_edit() : m.compose_add_poll()}</Dialog.Title
			></Dialog.Header
		>
		{#if draft}<PollContentFields
				{body}
				value={draft}
				onChange={(content) => (draft = { ...draft!, ...content })}
			/>{/if}
		{#if !value && unsupported.length}<InlineNotice
				message={m.compose_poll_unsupported_accounts({
					accounts: unsupported.map((destination) => destination.label).join(', ')
				})}
			/>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => onOpenChange(false)}>{m.common_cancel()}</Button>
			<Button
				disabled={!canSave}
				onclick={() => {
					onChange(draft);
					onOpenChange(false);
				}}>{value ? m.common_save() : m.compose_add_poll()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
