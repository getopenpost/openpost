<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { pollDurationLabel, type PollContent } from './polls';
	let {
		value,
		onChange,
		body = ''
	}: { value: PollContent; onChange: (value: PollContent) => void; body?: string } = $props();
	const uid = $props.id();
	const durations = $derived(
		[300, 3600, 86400, 259200, 604800, 1209600].map((value) => ({
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
	<div class="grid gap-1.5">
		<label for="{uid}-question" class="text-sm font-medium">{m.compose_poll_question()}</label>
		<Input
			id="{uid}-question"
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
	<fieldset class="grid gap-2">
		<legend class="mb-2 text-sm font-medium">{m.compose_poll_options()}</legend>
		{#each value.options as option, index (option.id)}
			<div class="flex min-w-0 items-center gap-2">
				<label class="sr-only" for="{uid}-{option.id}"
					>{m.compose_poll_option({ number: index + 1 })}</label
				>
				<Input
					id="{uid}-{option.id}"
					value={option.text}
					placeholder={m.compose_poll_option({ number: index + 1 })}
					oninput={(event) => updateOption(option.id, event.currentTarget.value)}
				/>
				{#if value.options.length > 2}<Button
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
			onclick={() =>
				onChange({ ...value, options: [...value.options, { id: crypto.randomUUID(), text: '' }] })}
			><ThemeIcon role="add" class="size-4" />{m.compose_poll_add_option()}</Button
		>
	</fieldset>
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
	<details>
		<summary class="flex min-h-11 cursor-pointer items-center text-sm text-muted-foreground"
			>{m.compose_poll_more()}</summary
		>
		<div class="grid gap-3 pb-2">
			<label class="flex min-h-11 items-center gap-2 text-sm"
				><Checkbox
					checked={value.multiple ?? false}
					onCheckedChange={(multiple) => onChange({ ...value, multiple })}
				/>{m.compose_poll_multiple()}</label
			>
			<label class="flex min-h-11 items-center gap-2 text-sm"
				><Checkbox
					checked={value.hide_totals ?? false}
					onCheckedChange={(hide_totals) => onChange({ ...value, hide_totals })}
				/>{m.compose_poll_hide_totals()}</label
			>
			<p class="text-xs text-muted-foreground">{m.compose_poll_option_scope()}</p>
		</div>
	</details>
</div>
