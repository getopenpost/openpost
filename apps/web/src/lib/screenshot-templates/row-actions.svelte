<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let {
		index,
		count,
		maximum,
		onmove,
		onduplicate,
		onremove
	}: {
		index: number;
		count: number;
		maximum: number;
		onmove?: (direction: -1 | 1) => void;
		onduplicate: () => void;
		onremove: () => void;
	} = $props();
</script>

<div class="flex items-center gap-0.5">
	{#if onmove}
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={index === 0}
			onclick={() => onmove?.(-1)}
			aria-label={m.templates_move_up()}><ThemeIcon role="arrow-up" class="size-3.5" /></Button
		>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={index === count - 1}
			onclick={() => onmove?.(1)}
			aria-label={m.templates_move_down()}><ThemeIcon role="arrow-down" class="size-3.5" /></Button
		>
	{/if}
	<Button
		variant="ghost"
		size="icon-sm"
		disabled={count >= maximum}
		onclick={onduplicate}
		aria-label={m.templates_duplicate()}><ThemeIcon role="copy" class="size-3.5" /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		disabled={count <= 1}
		onclick={onremove}
		aria-label={m.common_delete()}><ThemeIcon role="delete" class="size-3.5" /></Button
	>
</div>
