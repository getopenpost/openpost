<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { ImageEditorBrandFont } from '../types';
	import { m } from '$lib/paraglide/messages';
	import { openPostDesignFonts } from '$lib/design-fonts';

	let {
		value,
		disabled = false,
		brandFonts = [],
		onChange
	}: {
		value: string;
		disabled?: boolean;
		brandFonts?: ImageEditorBrandFont[];
		onChange: (font: {
			family: string;
			assetID?: string;
			weight?: number;
			style?: 'normal' | 'italic';
		}) => void;
	} = $props();

	let search = $state('');
	let open = $state(false);
	let filteredBrandFonts = $derived(
		brandFonts.filter((font) => font.family.toLowerCase().includes(search.trim().toLowerCase()))
	);
	let filteredSystemFonts = $derived(
		openPostDesignFonts.filter((font) =>
			font.label.toLowerCase().includes(search.trim().toLowerCase())
		)
	);
	const selectedBrandFont = $derived(
		brandFonts.find((font) => value === font.family || value === (font.css_family || font.family))
	);
	const selectedDesignFont = $derived(openPostDesignFonts.find((font) => font.family === value));
	const selectedFamily = $derived(
		selectedBrandFont?.css_family || selectedBrandFont?.family || value
	);
	const selectedLabel = $derived(selectedBrandFont?.family || selectedDesignFont?.label || value);

	function choose(font: {
		family: string;
		assetID?: string;
		weight?: number;
		style?: 'normal' | 'italic';
	}): void {
		onChange(font);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-background px-2 text-left text-xs hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				{disabled}
				aria-label={m.image_editor_font_family()}
			>
				<span class="truncate" style:font-family={selectedFamily}>{selectedLabel}</span>
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-72 p-2">
		<div class="relative mb-2">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value={search}
				class="h-8 pl-7 text-xs"
				placeholder={m.image_editor_search_fonts()}
				aria-label={m.image_editor_search_fonts()}
			/>
		</div>
		<div class="max-h-64 overflow-y-auto">
			{#if filteredBrandFonts.length > 0}
				<p class="px-2 py-1 text-xs font-medium text-muted-foreground">
					{m.image_editor_brand_fonts()}
				</p>
				{#each filteredBrandFonts as font (font.id)}
					<button
						type="button"
						class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
						onclick={() =>
							choose({
								family: font.css_family || font.family,
								assetID: font.media_id,
								weight: font.weight,
								style: font.style
							})}
					>
						<span
							class="min-w-0 flex-1 truncate text-sm"
							style:font-family={font.css_family || font.family}
							style:font-weight={font.weight}
							style:font-style={font.style}
						>
							{font.family}
						</span>
						{#if value === (font.css_family || font.family)}
							<CheckIcon class="size-4 shrink-0" />
						{/if}
					</button>
				{/each}
			{/if}
			{#if filteredSystemFonts.length > 0}
				<p class="px-2 py-1 text-xs font-medium text-muted-foreground">
					{m.image_editor_fonts()}
				</p>
				{#each filteredSystemFonts as font (font.family)}
					<button
						type="button"
						class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
						onclick={() => choose({ family: font.family })}
					>
						<span class="min-w-0 flex-1 truncate text-sm" style:font-family={font.family}>
							{font.label}
						</span>
						<span class="shrink-0 text-[10px] text-muted-foreground">{font.category}</span>
						{#if value === font.family}<CheckIcon class="size-4 shrink-0" />{/if}
					</button>
				{/each}
			{/if}
			{#if filteredBrandFonts.length === 0 && filteredSystemFonts.length === 0}
				<p class="px-2 py-5 text-center text-xs text-muted-foreground">
					{m.image_editor_no_fonts_found()}
				</p>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
