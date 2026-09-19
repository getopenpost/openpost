<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
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

	function openVariants(event: MouseEvent): void {
		event.preventDefault();
		if (!disabled) open = true;
	}
</script>

<div
	class="flex h-8 items-stretch overflow-hidden rounded-md border border-transparent has-focus-visible:border-ring [@media(pointer:coarse)]:h-auto [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:flex-col"
	data-testid="image-editor-tool-family"
	role="group"
	aria-label={label}
	oncontextmenu={openVariants}
>
	<Button
		type="button"
		variant={active ? 'secondary' : 'ghost'}
		size="icon-sm"
		class="h-8 w-7 rounded-r-none px-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:rounded-r-md [@media(pointer:coarse)]:rounded-b-none"
		{onclick}
		aria-label={label}
		aria-pressed={active}
		{disabled}
	>
		{@render icon()}
	</Button>
	<DropdownMenu.Root bind:open>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant={active ? 'secondary' : 'ghost'}
					size="icon-xs"
					class="h-8 w-6 rounded-l-none border-l border-border px-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:rounded-t-none [@media(pointer:coarse)]:rounded-l-md [@media(pointer:coarse)]:border-t [@media(pointer:coarse)]:border-l-0"
					aria-label={`${label}, ${m.image_editor_more_actions()}`}
					{disabled}
				>
					<ThemeIcon role="chevron-down" class="size-3" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content side="right" align="start" class="min-w-44">
			{@render menu()}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
