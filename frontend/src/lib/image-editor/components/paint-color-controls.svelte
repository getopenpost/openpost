<script lang="ts">
	import { ThemeIcon } from '$lib/themes/icons';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import type { ImageEditorBrandColor } from '../types';

	let {
		primary,
		secondary = '',
		gradient = false,
		brandColors = [],
		recentColors = [],
		onPrimaryChange,
		onSecondaryChange = () => undefined,
		onCommit
	}: {
		primary: string;
		secondary?: string;
		gradient?: boolean;
		brandColors?: ImageEditorBrandColor[];
		recentColors?: string[];
		onPrimaryChange: (value: string) => void;
		onSecondaryChange?: (value: string) => void;
		onCommit: (value: string) => void;
	} = $props();
</script>

<div class="flex min-w-0 flex-wrap items-center gap-1" data-testid="image-editor-paint-colors">
	<div class="w-24 min-w-0 flex-1 sm:w-32 sm:flex-none">
		<ImageEditorColorPicker
			label={gradient ? m.image_editor_gradient_start_color() : m.image_editor_foreground_color()}
			value={primary}
			{brandColors}
			{recentColors}
			onChange={onPrimaryChange}
			{onCommit}
		/>
	</div>
	{#if gradient}
		<Button
			variant="ghost"
			size="icon-xs"
			class="shrink-0 text-[var(--editor-text)] hover:text-[var(--editor-text)]"
			aria-label={m.image_editor_swap_gradient_colors()}
			title={m.image_editor_swap_gradient_colors()}
			onclick={() => {
				onPrimaryChange(secondary);
				onSecondaryChange(primary);
			}}
		>
			<ThemeIcon role="swap" />
		</Button>
		<div class="w-24 min-w-0 flex-1 sm:w-32 sm:flex-none">
			<ImageEditorColorPicker
				label={m.image_editor_gradient_end_color()}
				value={secondary}
				{brandColors}
				{recentColors}
				onChange={onSecondaryChange}
				{onCommit}
			/>
		</div>
	{/if}
</div>
