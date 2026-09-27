<script lang="ts">
	let {
		image,
		pixelX,
		pixelY,
		clientX,
		clientY,
		color,
		testId
	}: {
		image: { data: Uint8ClampedArray; width: number; height: number };
		pixelX: number;
		pixelY: number;
		clientX: number;
		clientY: number;
		color: string;
		testId?: string;
	} = $props();

	const GRID_SIZE = 5;
	const CELL_SIZE = 24;
	const WIDTH = GRID_SIZE * CELL_SIZE + 4;
	const HEIGHT = WIDTH + 28;
	const GAP = 18;
	const MARGIN = 8;
	let windowWidth = $state(0);
	let windowHeight = $state(0);
	function position(cursor: number, size: number, available: number): number {
		const preferred =
			cursor + GAP + size <= available - MARGIN ? cursor + GAP : cursor - GAP - size;
		return Math.max(MARGIN, Math.min(available - size - MARGIN, preferred));
	}
	function pixelColor(index: number): string {
		const x = Math.floor(pixelX) + (index % GRID_SIZE) - Math.floor(GRID_SIZE / 2);
		const y = Math.floor(pixelY) + Math.floor(index / GRID_SIZE) - Math.floor(GRID_SIZE / 2);
		if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 'transparent';
		const offset = (y * image.width + x) * 4;
		return `rgba(${image.data[offset]}, ${image.data[offset + 1]}, ${image.data[offset + 2]}, ${(image.data[offset + 3] ?? 0) / 255})`;
	}
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<div
	class="pointer-events-none fixed z-50 overflow-hidden rounded-xl border-2 border-white bg-popover text-popover-foreground shadow-xl"
	style:left={`${position(clientX, WIDTH, windowWidth)}px`}
	style:top={`${position(clientY, HEIGHT, windowHeight)}px`}
	style:width={`${WIDTH}px`}
	data-testid={testId}
	aria-hidden="true"
>
	<div
		class="pixel-grid relative grid"
		style:grid-template-columns={`repeat(${GRID_SIZE}, ${CELL_SIZE}px)`}
	>
		{#each Array.from({ length: GRID_SIZE * GRID_SIZE }) as _, index (index)}
			<span
				class="pixel"
				style:width={`${CELL_SIZE}px`}
				style:height={`${CELL_SIZE}px`}
				style:background-color={pixelColor(index)}
			></span>
		{/each}
		<span
			class="crosshair absolute"
			style:left={`${CELL_SIZE * 2}px`}
			style:top={`${CELL_SIZE * 2}px`}
			style:width={`${CELL_SIZE}px`}
			style:height={`${CELL_SIZE}px`}
		></span>
	</div>
	<div class="flex h-7 items-center justify-center gap-1.5 font-mono text-xs">
		<span class="size-3 rounded-sm border border-current" style:background-color={color}></span>
		<span>{color.toUpperCase()}</span>
	</div>
</div>

<style>
	.pixel-grid {
		background: repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 / 12px 12px;
	}
	.pixel {
		box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.2);
	}
	.crosshair {
		border: 2px solid white;
		box-shadow:
			0 0 0 1px black,
			inset 0 0 0 1px black;
	}
	.crosshair::before,
	.crosshair::after {
		content: '';
		position: absolute;
		background: white;
		box-shadow: 0 0 0 1px black;
	}
	.crosshair::before {
		left: 50%;
		top: 5px;
		bottom: 5px;
		width: 1px;
	}
	.crosshair::after {
		top: 50%;
		left: 5px;
		right: 5px;
		height: 1px;
	}
</style>
