<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import XIcon from '@lucide/svelte/icons/x';

	interface Props {
		id: string;
		value?: string;
		placeholder?: string;
		onChange: (value: string) => void;
	}

	let { id, value = '', placeholder = m.compose_tags_placeholder(), onChange }: Props = $props();
	let draft = $state('');
	const tags = $derived(
		value
			.split(/,|\n/)
			.map((tag) => tag.trim())
			.filter(Boolean)
	);

	function commitDraft() {
		const additions = draft
			.split(/,|\n/)
			.map((tag) => tag.trim())
			.filter(Boolean);
		if (additions.length === 0) {
			draft = '';
			return;
		}
		const seen = tags.map((tag) => tag.toLocaleLowerCase());
		const next = [...tags];
		for (const tag of additions) {
			const normalized = tag.toLocaleLowerCase();
			if (seen.includes(normalized)) continue;
			seen.push(normalized);
			next.push(tag);
		}
		onChange(next.join(', '));
		draft = '';
	}

	function removeTag(index: number) {
		onChange(tags.filter((_, tagIndex) => tagIndex !== index).join(', '));
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitDraft();
			return;
		}
		if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
			removeTag(tags.length - 1);
		}
	}
</script>

<div
	class="mt-1 flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-primary/35 bg-background px-2 py-1.5 shadow-[0_2px_0_color-mix(in_oklch,var(--primary)_42%,black)] transition-[border-color,box-shadow] duration-100 focus-within:border-primary focus-within:shadow-[0_3px_0_color-mix(in_oklch,var(--primary)_55%,black)] focus-within:ring-2 focus-within:ring-primary/20"
>
	{#each tags as tag, index (`${tag}-${index}`)}
		<span
			class="inline-flex min-h-7 items-center gap-1 rounded-lg border border-primary/25 bg-primary/8 px-2 text-xs font-medium shadow-[0_1px_0_color-mix(in_oklch,var(--primary)_40%,black)]"
		>
			<span>{tag}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="-mr-1 size-6 rounded-sm text-muted-foreground hover:text-foreground"
				aria-label={m.compose_remove_tag({ tag })}
				onclick={() => removeTag(index)}
			>
				<XIcon class="size-3" />
			</Button>
		</span>
	{/each}
	<Input
		{id}
		class="h-7 min-w-28 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
		bind:value={draft}
		{placeholder}
		onkeydown={handleKeydown}
		onblur={commitDraft}
	/>
</div>
