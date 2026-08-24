<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	interface Props {
		id: string;
		label: string;
		description?: string;
		value: string[];
		placeholder?: string;
		addLabel: string;
		removeLabel: string;
		maxItems?: number;
		maxLength?: number;
		disabled?: boolean;
		onChange: (value: string[]) => void;
	}

	let {
		id,
		label,
		description = '',
		value,
		placeholder = '',
		addLabel,
		removeLabel,
		maxItems = 40,
		maxLength = 200,
		disabled = false,
		onChange
	}: Props = $props();

	let draft = $state('');
	const descriptionId = $derived(description ? `${id}-description` : undefined);
	const full = $derived(value.length >= maxItems);

	function additions(): string[] {
		return draft
			.split(/,|\n/)
			.map((item) => item.trim())
			.filter(Boolean);
	}

	function commit(): void {
		const candidates = additions();
		if (candidates.length === 0) {
			draft = '';
			return;
		}
		const next = [...value];
		const seen = new Set(next.map((item) => item.toLocaleLowerCase()));
		for (const candidate of candidates) {
			const key = candidate.toLocaleLowerCase();
			if (seen.has(key) || next.length >= maxItems) continue;
			seen.add(key);
			next.push(candidate);
		}
		draft = '';
		onChange(next);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commit();
			return;
		}
		if (event.key === 'Backspace' && !draft && value.length > 0) {
			onChange(value.slice(0, -1));
		}
	}
</script>

<div class="space-y-2">
	<Label for={id}>{label}</Label>
	{#if description}
		<p id={descriptionId} class="text-xs leading-5 text-muted-foreground">{description}</p>
	{/if}
	{#if value.length > 0}
		<ul class="flex flex-wrap gap-1.5" aria-label={label}>
			{#each value as item, index (`${item}:${index}`)}
				<li
					class="inline-flex min-h-8 items-center gap-1 rounded-md border bg-muted/35 pl-2.5 text-xs"
				>
					<span>{item}</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="size-8 text-muted-foreground hover:text-foreground"
						{disabled}
						onclick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
						aria-label={`${removeLabel}: ${item}`}
					>
						<XIcon class="size-3.5" />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="flex min-w-0 gap-2">
		<Input
			{id}
			class="h-11 min-w-0 flex-1 md:h-9"
			bind:value={draft}
			{placeholder}
			maxlength={maxLength}
			disabled={disabled || full}
			aria-describedby={descriptionId}
			onkeydown={handleKeydown}
			onblur={commit}
		/>
		<Button
			type="button"
			variant="outline"
			size="sm"
			class="h-11 md:h-9"
			disabled={disabled || full || additions().length === 0}
			onclick={commit}
		>
			<PlusIcon class="size-3.5" />
			{addLabel}
		</Button>
	</div>
</div>
