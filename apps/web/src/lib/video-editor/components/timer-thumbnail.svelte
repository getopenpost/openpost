<script lang="ts">
	import { renderTextItemRaster } from '../media/text-raster';
	import type { TimerSettings } from '../timers/timer';
	let { timer }: { timer: TimerSettings } = $props();
	let canvas: HTMLCanvasElement;
	$effect(() => {
		const context = canvas?.getContext('2d');
		if (!context) return;
		renderTextItemRaster(
			context,
			{
				id: 'preview',
				trackId: '',
				label: '',
				type: 'text',
				from: 0,
				durationInFrames: 300,
				timer,
				color: '#ffffff',
				fontSize: 50,
				fontWeight: 700,
				textAlign: 'center',
				verticalAlign: 'middle'
			},
			320,
			240,
			{ absoluteFrame: 75, fps: 30 }
		);
	});
</script>

<canvas
	bind:this={canvas}
	width="320"
	height="240"
	aria-hidden="true"
	class="aspect-[4/3] w-full rounded bg-[#171923]"
></canvas>
