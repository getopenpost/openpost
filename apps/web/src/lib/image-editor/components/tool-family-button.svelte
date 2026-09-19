<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { m } from '$lib/paraglide/messages';

	let {
		label,
		active,
		disabled = false,
		onclick,
		icon,
		menu
	}: {
		label: string;
		active: boolean;
		disabled?: boolean;
		onclick: () => void;
		icon: Snippet;
		menu: Snippet;
	} = $props();

	let open = $state(false);

	function openVariants(event: Event): void {
		event.preventDefault();
		if (!disabled) open = true;
	}

	function handleClick(event: MouseEvent): void {
		event.preventDefault();
		if (disabled) return;
		if (active) {
			open = true;
			return;
		}
		onclick();
		open = false;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
		openVariants(event);
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant={active ? 'secondary' : 'ghost'}
				size="icon-sm"
				class="relative size-8 shrink-0 px-0 [@media(pointer:coarse)]:size-11"
				data-testid="image-editor-tool-family"
				aria-label={label}
				aria-pressed={active}
				aria-haspopup="menu"
				aria-expanded={open}
				title={`${label} · ${m.image_editor_more_actions()}`}
				{disabled}
				onclick={handleClick}
				onkeydown={handleKeydown}
				oncontextmenu={openVariants}
			>
				{@render icon()}
				<span
					aria-hidden="true"
					class="pointer-events-none absolute right-0.5 bottom-0.5 size-0 border-t-[4px] border-l-[4px] border-t-transparent border-l-muted-foreground/70"
				></span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="right" align="start" class="min-w-44">
		{@render menu()}
	</DropdownMenu.Content>
</DropdownMenu.Root>
