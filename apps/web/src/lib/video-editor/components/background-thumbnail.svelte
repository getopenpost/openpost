<script lang="ts">
	import type { ProceduralBackground } from '../project/types';
	import { renderBackgroundCpu } from '../backgrounds/render';
	import { ShaderBackgroundRenderer } from '../backgrounds/shader-renderer';

	let { background, onfailure }: { background: ProceduralBackground; onfailure?: () => void } =
		$props();
	let canvas: HTMLCanvasElement;

	$effect(() => {
		const context = canvas?.getContext('2d');
		if (!context) return;
		if (background.kind !== 'shader') {
			renderBackgroundCpu(context, background, 160, 90);
			return;
		}
		let renderer: ShaderBackgroundRenderer | undefined;
		try {
			renderer = new ShaderBackgroundRenderer();
			context.drawImage(renderer.render(background, 160, 90, 0), 0, 0);
		} catch {
			onfailure?.();
		} finally {
			renderer?.dispose();
		}
	});
</script>

<canvas
	bind:this={canvas}
	width="160"
	height="90"
	class="aspect-video w-full rounded-sm object-cover max-md:h-12"
	aria-hidden="true"
></canvas>
