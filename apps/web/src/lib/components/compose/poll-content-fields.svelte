<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { PollDestination } from './polls';
	import * as Select from '$lib/components/ui/select';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import {
		POLL_DURATION_ENUMS,
		pollDurationField,
		pollDurationLabel,
		type PollContent
	} from './polls';
	let {
		value,
		onChange,
		body = '',
		fields,
		questionSource = 'poll'
	}: {
		value: PollContent;
		onChange: (value: PollContent) => void;
		body?: string;
		fields?: PollDestination['fields'];
		questionSource?: 'poll' | 'caption';
	} = $props();
	const uid = $props.id();
	const optionConstraints = $derived(
		fields?.find((field) => field.key === 'poll_options')?.constraints
	);
	const questionLimit = $derived(
		fields?.find((field) => field.key === 'poll_question' && !field.unavailable_reason)?.constraints
			?.max_length
	);
	const durationField = $derived(fields && pollDurationField(fields));
	const durations = $derived(
		[300, 3600, 86400, 259200, 604800, 1209600]
			.filter((seconds) => {
				if (!durationField) return true;
				if (durationField.key === 'poll_duration')
					return durationField.options?.includes(POLL_DURATION_ENUMS.get(seconds) ?? '') ?? false;
				const amount = durationField.key === 'poll_duration_minutes' ? seconds / 60 : seconds;
				return (
					amount >= (durationField.constraints?.minimum ?? 0) &&
					amount <= (durationField.constraints?.maximum ?? Infinity)
				);
			})
			.map((value) => ({
				value,
				label: pollDurationLabel(value)
			}))
	);
	function updateOption(id: string, text: string) {
		onChange({
			...value,
			options: value.options.map((option) => (option.id === id ? { ...option, text } : option))
		});
	}
</script>

<div class="grid min-w-0 gap-3">
	{#if questionSource === 'poll'}
		<div class="grid gap-1.5">
			<label for="{uid}-question" class="text-sm font-medium">{m.compose_poll_question()}</label>
			<Input
				id="{uid}-question"
				maxlength={questionLimit}
				value={value.question}
				oninput={(event) => onChange({ ...value, question: event.currentTarget.value })}
			/>
			{#if body.trim() && !value.question}<Button
					variant="ghost"
					size="sm"
					class="w-fit text-xs"
					onclick={() => onChange({ ...value, question: body })}>{m.compose_poll_use_body()}</Button
				>{/if}
		</div>
	{/if}
	<fieldset class="grid gap-2">
		<legend class="mb-2 text-sm font-medium">{m.compose_poll_options()}</legend>
		{#each value.options as option, index (option.id)}
			<div class="flex min-w-0 items-center gap-2">
				<label class="sr-only" for="{uid}-{option.id}"
					>{m.compose_poll_option({ number: index + 1 })}</label
				>
				<Input
					id="{uid}-{option.id}"
					maxlength={optionConstraints?.max_length}
					value={option.text}
					placeholder={m.compose_poll_option({ number: index + 1 })}
					oninput={(event) => updateOption(option.id, event.currentTarget.value)}
				/>
				{#if value.options.length > (optionConstraints?.min_items ?? 2)}<Button
						variant="ghost"
						size="icon"
						class="shrink-0"
						aria-label={m.compose_poll_remove_option({ number: index + 1 })}
						onclick={() =>
							onChange({
								...value,
								options: value.options.filter((item) => item.id !== option.id)
							})}><ThemeIcon role="remove" class="size-4" /></Button
					>{/if}
			</div>
		{/each}
		<Button
			variant="outline"
			size="sm"
			class="w-fit"
			disabled={optionConstraints?.max_items !== undefined &&
				value.options.length >= optionConstraints.max_items}
			onclick={() =>
				onChange({ ...value, options: [...value.options, { id: crypto.randomUUID(), text: '' }] })}
			><ThemeIcon role="add" class="size-4" />{m.compose_poll_add_option()}</Button
		>
	</fieldset>
	{#if !fields || durationField}
		<div class="grid gap-1.5">
			<label for="{uid}-duration" class="text-sm font-medium">{m.compose_poll_duration()}</label>
			<Select.Root
				value={String(value.duration_seconds)}
				onValueChange={(next: string) => onChange({ ...value, duration_seconds: Number(next) })}
			>
				<Select.Trigger id="{uid}-duration" class="w-full sm:w-48"
					>{durations.find((item) => item.value === value.duration_seconds)?.label ??
						pollDurationLabel(value.duration_seconds)}</Select.Trigger
				>
				<Select.Content
					>{#each durations as duration (duration.value)}<Select.Item value={String(duration.value)}
							>{duration.label}</Select.Item
						>{/each}</Select.Content
				>
			</Select.Root>
		</div>
	{/if}
</div>
