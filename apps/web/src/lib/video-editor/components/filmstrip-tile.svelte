<!-- ImageBitmap fast path with img fallback for browsers that cannot decode it. -->
<script lang="ts">
	let { bitmap, url, style }: { bitmap?: ImageBitmap; url: string | null; style: string } =
		$props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	let detachedBitmap = $state<ImageBitmap | null>(null);
	let drawableBitmap = $derived(
		bitmap && bitmap !== detachedBitmap && bitmap.width > 0 && bitmap.height > 0 ? bitmap : null
	);
	$effect(() => {
		if (!canvas || !drawableBitmap) return;
		canvas.width = drawableBitmap.width;
		canvas.height = drawableBitmap.height;
		try {
			canvas.getContext('2d')?.drawImage(drawableBitmap, 0, 0);
		} catch (error) {
			if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
			detachedBitmap = drawableBitmap;
		}
	});
</script>

{#if drawableBitmap}
	<canvas
		bind:this={canvas}
		class="absolute top-0 h-full rounded-sm opacity-90"
		{style}
		data-filmstrip-tile
	></canvas>
{:else}
	<img
		src={url ?? ''}
		alt=""
		class="absolute top-0 h-full rounded-sm object-cover opacity-90"
		{style}
		data-filmstrip-tile
	/>
{/if}
