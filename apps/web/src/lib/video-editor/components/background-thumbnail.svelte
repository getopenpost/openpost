<script lang="ts">
	import type { ProceduralBackground } from '../project/types';
	import { ShaderBackgroundRenderer } from '../backgrounds/shader-renderer';
	import { backgroundPosterUrl } from '../effects/preview/catalog-posters';
	import { createPreviewActivity } from '../effects/preview/preview-activity.svelte';

	let {
		background,
		active = false,
		onfailure
	}: {
		background: ProceduralBackground;
		active?: boolean;
		onfailure?: () => void;
	} = $props();
	let host = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();
	const preview = createPreviewActivity(
		() => active && background.kind === 'shader',
		() => host
	);
	const poster = $derived(backgroundPosterUrl(background));

	$effect(() => {
		const target = canvas;
		const shader = background;
		if (!preview.active || !target || shader.kind !== 'shader') return;
		const context = target.getContext('2d');
		if (!context) return;
		let renderer: ShaderBackgroundRenderer | undefined;
		let frame = 0;
		let startedAt = 0;
		let lastDrawAt = 0;
		const draw = (now: number) => {
			try {
				renderer ??= new ShaderBackgroundRenderer();
				if (!startedAt) startedAt = now;
				if (!lastDrawAt || now - lastDrawAt >= 1000 / 24) {
					context.clearRect(0, 0, 160, 90);
					context.drawImage(renderer.render(shader, 160, 90, (now - startedAt) / 1000), 0, 0);
					lastDrawAt = now;
				}
				frame = requestAnimationFrame(draw);
			} catch {
				renderer?.dispose();
				onfailure?.();
			}
		};
		frame = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(frame);
			renderer?.dispose();
		};
	});
</script>

<span
	bind:this={host}
	class="relative block aspect-video w-full overflow-hidden rounded-sm max-md:h-12"
>
	<img
		src={poster}
		alt=""
		width="320"
		height="180"
		loading="lazy"
		decoding="async"
		draggable="false"
		class="size-full object-cover"
	/>
	{#if preview.active}
		<canvas
			bind:this={canvas}
			width="160"
			height="90"
			class="absolute inset-0 size-full object-cover"
			aria-hidden="true"
		></canvas>
	{/if}
</span>
