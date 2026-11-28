<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { TEMPLATE_WIDTH } from './document';
	import type { ScreenshotPreviewImage } from './api';

	let {
		image,
		alt = '',
		onselect,
		label = () => m.common_edit(),
		pending = false
	}: {
		image: ScreenshotPreviewImage;
		alt?: string;
		onselect?: (id: string) => void;
		/** Accessible name for a selectable region, usually its content. */
		label?: (id: string) => string;
		pending?: boolean;
	} = $props();
	const height = $derived(image.height / image.scale);
</script>

<!-- Dim only when a render takes noticeably long, so typing never flickers. -->
<div
	class="relative shrink-0 overflow-hidden ring-1 ring-border transition-opacity duration-150"
	class:opacity-70={pending}
	class:delay-300={pending}
	style:width="{TEMPLATE_WIDTH}px"
	style:height="{height}px"
	aria-busy={pending}
	data-template-preview
>
	<img src={image.url} {alt} width={TEMPLATE_WIDTH} {height} class="block size-full select-none" />
	{#if onselect}
		{#each image.regions as region (region.id)}
			<button
				type="button"
				class="absolute rounded-sm bg-transparent hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
				style:left="{region.x}px"
				style:top="{region.y}px"
				style:width="{region.width}px"
				style:height="{region.height}px"
				aria-label={label(region.id)}
				onclick={() => onselect(region.id)}
			></button>
		{/each}
	{/if}
</div>
