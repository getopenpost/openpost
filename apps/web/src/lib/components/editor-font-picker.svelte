<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { openPostDesignFonts } from '$lib/design-fonts';
	import type { EditorBrandFont } from '$lib/editor-fonts';
	import {
		type EditorFontSelection,
		useEditorFontCatalog
	} from '$lib/components/editor-font-context';

	let {
		value,
		disabled = false,
		brandFonts = [],
		onChange
	}: {
		value: string;
		disabled?: boolean;
		brandFonts?: EditorBrandFont[];
		onChange: (font: EditorFontSelection) => void;
	} = $props();

	let search = $state('');
	let open = $state(false);
	let pending = $state(false);
	const editorFontCatalog = useEditorFontCatalog();
	const availableBrandFonts = $derived(
		brandFonts.length > 0 ? brandFonts : (editorFontCatalog?.brandFonts ?? [])
	);
	const normalizedSearch = $derived(search.trim().toLowerCase());
	const filteredBrandFonts = $derived(
		availableBrandFonts.filter((font) => font.family.toLowerCase().includes(normalizedSearch))
	);
	const filteredDesignFonts = $derived(
		openPostDesignFonts.filter((font) => font.label.toLowerCase().includes(normalizedSearch))
	);
	const selectedBrandFont = $derived(
		availableBrandFonts.find(
			(font) =>
				value === font.family ||
				value === (font.css_family || font.family) ||
				value === font.selection_family
		)
	);
	const selectedDesignFont = $derived(
		openPostDesignFonts.find((font) => font.family === value || font.label === value)
	);
	const selectedFamily = $derived(
		selectedBrandFont?.css_family ||
			selectedBrandFont?.family ||
			selectedDesignFont?.family ||
			value
	);
	const selectedLabel = $derived(selectedBrandFont?.family || selectedDesignFont?.label || value);
	function brandFontIsSelected(font: EditorBrandFont): boolean {
		return (
			value === font.family ||
			value === (font.css_family || font.family) ||
			value === font.selection_family
		);
	}

	async function choose(font: EditorFontSelection): Promise<void> {
		if (pending) return;
		pending = true;
		try {
			const prepared = editorFontCatalog?.prepareSelection
				? await editorFontCatalog.prepareSelection(font)
				: font;
			if (!prepared) return;
			onChange(prepared);
			open = false;
		} finally {
			pending = false;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-background px-2 text-left text-xs hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11"
				disabled={disabled || pending}
				aria-busy={pending}
				aria-label={m.image_editor_font_family()}
				data-editor-font-picker
			>
				<span class="truncate" style:font-family={selectedFamily}>{selectedLabel}</span>
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-72 p-2">
		<div class="relative mb-2">
			<ThemeIcon
				role="search"
				class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value={search}
				class="h-8 pl-7 text-xs [@media(pointer:coarse)]:h-11"
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
						disabled={pending}
						class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [@media(pointer:coarse)]:min-h-11"
						aria-pressed={brandFontIsSelected(font)}
						onclick={() =>
							choose({
								family: font.selection_family || font.css_family || font.family,
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
						{#if brandFontIsSelected(font)}
							<ThemeIcon role="check" class="size-4 shrink-0" />
						{/if}
					</button>
				{/each}
			{/if}
			{#if filteredDesignFonts.length > 0}
				<p class="px-2 py-1 text-xs font-medium text-muted-foreground">
					{m.image_editor_fonts()}
				</p>
				{#each filteredDesignFonts as font (font.family)}
					<button
						type="button"
						disabled={pending}
						class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [@media(pointer:coarse)]:min-h-11"
						onclick={() => choose({ family: font.family })}
					>
						<span class="min-w-0 flex-1 truncate text-sm" style:font-family={font.family}>
							{font.label}
						</span>
						{#if value === font.family || value === font.label}
							<ThemeIcon role="check" class="size-4 shrink-0" />
						{/if}
					</button>
				{/each}
			{/if}
			{#if filteredBrandFonts.length === 0 && filteredDesignFonts.length === 0}
				<p class="px-2 py-5 text-center text-xs text-muted-foreground">
					{m.image_editor_no_fonts_found()}
				</p>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
