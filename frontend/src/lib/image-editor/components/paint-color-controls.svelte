<script lang="ts">
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
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

<div class="flex items-center gap-1" data-testid="image-editor-paint-colors">
	<div class="w-32">
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
			class="shrink-0 text-neutral-100 hover:text-foreground"
			aria-label={m.image_editor_swap_gradient_colors()}
			title={m.image_editor_swap_gradient_colors()}
			onclick={() => {
				onPrimaryChange(secondary);
				onSecondaryChange(primary);
			}}
		>
			<ArrowLeftRightIcon />
		</Button>
		<div class="w-32">
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
