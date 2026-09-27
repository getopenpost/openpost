<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import PollContentFields from './poll-content-fields.svelte';
	import {
		supportsNativePoll,
		resolvePollPreview,
		type SharedPoll,
		type PollDestination
	} from './polls';
	let {
		value,
		destinations,
		body,
		onChange,
		onExclude,
		onCustomizeText,
		onLegacySettings
	}: {
		value?: SharedPoll;
		destinations: PollDestination[];
		body: string;
		onChange: (value: SharedPoll | undefined) => void;
		onExclude: (id: string) => void;
		onCustomizeText: (id: string) => void;
		onLegacySettings: (id: string) => void;
	} = $props();
	let showUnavailable = $state(false);
	const uid = $props.id();
	const nativeCount = $derived(
		destinations.filter(
			(destination) =>
				supportsNativePoll(destination.fields) &&
				(!value ||
					['native', 'custom', 'legacy'].includes(value.destinations[destination.id]?.mode))
		).length
	);
	const unresolved = $derived(
		destinations.filter((destination) => !value?.destinations[destination.id])
	);
	const choices = $derived([
		{ value: 'native', label: m.compose_poll_native() },
		{ value: 'text', label: m.compose_poll_text() },
		{ value: 'omit', label: m.compose_poll_omit() },
		{ value: 'custom', label: m.compose_poll_custom() }
	]);
	function addPoll() {
		if (!nativeCount) {
			showUnavailable = true;
			return;
		}
		onChange({
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
		});
	}
	function setMode(id: string, mode: string) {
		if (!value || (mode !== 'native' && mode !== 'text' && mode !== 'omit' && mode !== 'custom'))
			return;
		const { destinations: _destinations, ...content } = value;
		onChange({
			...value,
			destinations: {
				...value.destinations,
				[id]: { mode, poll: mode === 'custom' ? JSON.parse(JSON.stringify(content)) : undefined }
			}
		});
	}
</script>

{#if value}
	<section
		class="my-3 min-w-0 border-y py-4"
		aria-label={m.compose_poll_title()}
		data-testid="shared-poll-editor"
	>
		<div class="mb-3 flex items-start justify-between gap-3">
			<div>
				<h3 class="text-sm font-semibold">{m.compose_poll_title()}</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					{m.compose_poll_scope({ count: nativeCount, total: destinations.length })}
				</p>
			</div>
			<Button variant="ghost" size="sm" onclick={() => onChange(undefined)}
				>{m.compose_remove_poll()}</Button
			>
		</div>
		<PollContentFields {body} {value} onChange={(content) => onChange({ ...value!, ...content })} />
		<div class="mt-2 grid gap-2 border-t pt-3">
			<h4 class="text-sm font-medium">{m.compose_poll_destinations()}</h4>
			{#if !nativeCount}<p class="text-sm text-muted-foreground">
					{m.compose_poll_no_native_existing()}
				</p>{/if}
			{#if unresolved.length}<p class="text-sm text-amber-700 dark:text-amber-300" role="status">
					{m.compose_poll_decision()}
				</p>{/if}
			{#each destinations as destination (destination.id)}
				{@const choice = value.destinations[destination.id]}
				<div class="grid min-w-0 gap-2 border-b py-2 last:border-0">
					<div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
						<label for="{uid}-{destination.id}" class="min-w-0 text-sm break-words"
							>{destination.label}</label
						>
						<Select.Root
							value={choice?.mode ?? ''}
							onValueChange={(mode: string) => setMode(destination.id, mode)}
						>
							<Select.Trigger
								id="{uid}-{destination.id}"
								class="w-full sm:w-48"
								aria-label={destination.label}
								>{choice?.mode === 'legacy'
									? m.compose_poll_custom()
									: (choices.find((item) => item.value === choice?.mode)?.label ??
										m.compose_poll_choose())}</Select.Trigger
							>
							<Select.Content
								>{#each choices as item (item.value)}<Select.Item
										value={item.value}
										disabled={(item.value === 'native' || item.value === 'custom') &&
											!supportsNativePoll(destination.fields)}>{item.label}</Select.Item
									>{/each}</Select.Content
							>
						</Select.Root>
					</div>
					{#if choice?.mode === 'custom' && choice.poll}<PollContentFields
							value={choice.poll}
							onChange={(poll) =>
								onChange({
									...value!,
									destinations: {
										...value!.destinations,
										[destination.id]: { mode: 'custom', poll }
									}
								})}
						/>{/if}
					{#if choice?.mode === 'text'}<details>
							<summary class="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground"
								>{m.compose_poll_text_preview()}</summary
							>
							<p class="text-sm break-words whitespace-pre-wrap">
								{resolvePollPreview(value, destination.id, destination.fields, destination.body, {})
									.body}
							</p>
						</details>{/if}
					{#if choice && destination.error}<p class="text-xs text-destructive" role="status">
							{destination.error}
						</p>{/if}
					<div class="flex flex-wrap gap-2">
						{#if choice?.mode === 'legacy'}<Button
								variant="ghost"
								size="sm"
								onclick={() => onLegacySettings(destination.id)}>{m.compose_poll_custom()}</Button
							>{/if}
						{#if choice?.mode === 'omit' || choice?.mode === 'text'}<Button
								variant="ghost"
								size="sm"
								onclick={() => onCustomizeText(destination.id)}
								>{m.compose_poll_customize_text()}</Button
							>{/if}
						<Button variant="ghost" size="sm" onclick={() => onExclude(destination.id)}
							>{m.compose_poll_remove_destination()}</Button
						>
					</div>
				</div>
			{/each}
			{#if unresolved.length > 1}<Button
					variant="outline"
					size="sm"
					class="w-fit"
					onclick={() =>
						onChange({
							...value!,
							destinations: {
								...value!.destinations,
								...Object.fromEntries(
									unresolved.map((destination) => [destination.id, { mode: 'text' as const }])
								)
							}
						})}>{m.compose_poll_apply_text()}</Button
				>{/if}
			{#if destinations.some((destination) => supportsNativePoll(destination.fields) && !destination.fields.some( (field) => ['poll_duration', 'poll_duration_minutes', 'poll_expires_in_seconds'].includes(field.key) ))}<p
					class="text-xs text-muted-foreground"
				>
					{m.compose_poll_fixed()}
				</p>{/if}
		</div>
	</section>
{:else}
	<Button variant="ghost" size="sm" class="my-1" onclick={addPoll}
		><ThemeIcon role="add" class="size-4" />{m.compose_add_poll()}</Button
	>
	{#if showUnavailable}<p class="mb-3 text-sm text-muted-foreground" role="status">
			{m.compose_poll_no_native()}
		</p>{/if}
{/if}
