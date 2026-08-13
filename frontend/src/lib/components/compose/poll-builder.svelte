<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';

	interface PollConstraints {
		min_items?: number;
		max_items?: number;
		max_length?: number;
	}

	interface Props {
		id: string;
		value?: string;
		constraints?: PollConstraints;
		onChange: (value: string) => void;
	}

	let { id, value = '', constraints = {}, onChange }: Props = $props();

	const minimum = $derived(Math.max(2, constraints.min_items ?? 2));
	const maximum = $derived(Math.max(minimum, constraints.max_items ?? 4));
	const active = $derived(value.length > 0);
	const options = $derived(normalizeOptions(value, minimum));
	const emptyOption = $derived(options.findIndex((option) => option.trim() === ''));

	function updateOption(index: number, nextValue: string) {
		const next = [...options];
		next[index] = nextValue;
		onChange(next.join('\n'));
	}

	function addOption() {
		if (options.length >= maximum) return;
		onChange([...options, ''].join('\n'));
	}

	function removeOption(index: number) {
		if (options.length <= minimum) return;
		onChange(options.filter((_, optionIndex) => optionIndex !== index).join('\n'));
	}

	function normalizeOptions(raw: string, count: number): string[] {
		const next = raw ? raw.split('\n') : [];
		while (next.length < count) next.push('');
		return next.slice(0, maximum);
	}
</script>

{#if active}
	<fieldset class="space-y-2">
		<legend class="sr-only">{m.compose_poll_options()}</legend>
		{#each options as option, index (`${id}-${index}`)}
			<div class="flex items-center gap-2">
				<div class="min-w-0 flex-1">
					<label class="sr-only" for="{id}-option-{index}">
						{m.compose_poll_option({ number: index + 1 })}
					</label>
					<Input
						id="{id}-option-{index}"
						class="h-11"
						value={option}
						maxlength={constraints.max_length}
						placeholder={m.compose_poll_option({ number: index + 1 })}
						aria-invalid={option.trim() === ''}
						oninput={(event) => updateOption(index, event.currentTarget.value)}
					/>
				</div>
				{#if options.length > minimum}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-11 shrink-0 text-muted-foreground hover:text-destructive"
						aria-label={m.compose_poll_remove_option({ number: index + 1 })}
						onclick={() => removeOption(index)}
					>
						<XIcon class="size-4" />
					</Button>
				{/if}
			</div>
		{/each}

		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="h-11 gap-2 sm:h-9"
					disabled={options.length >= maximum}
					onclick={addOption}
				>
					<PlusIcon class="size-4" />
					{m.compose_poll_add_option()}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="h-11 text-muted-foreground hover:text-destructive sm:h-9"
					onclick={() => onChange('')}
				>
					{m.compose_remove_poll()}
				</Button>
			</div>
			<span class="text-xs text-muted-foreground" aria-live="polite">
				{options.length}/{maximum}
			</span>
		</div>

		{#if emptyOption >= 0}
			<p class="text-xs text-destructive" aria-live="polite">
				{m.compose_poll_option_required({ number: emptyOption + 1 })}
			</p>
		{/if}
	</fieldset>
{:else}
	<Button
		{id}
		type="button"
		variant="outline"
		size="sm"
		class="mt-2 h-11 gap-2 sm:h-9"
		onclick={() => onChange(Array(minimum).fill('').join('\n'))}
	>
		<PlusIcon class="size-4" />
		{m.compose_add_poll()}
	</Button>
{/if}
