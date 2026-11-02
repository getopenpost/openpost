<script module lang="ts">
	import { ditherThreshold } from '@openpost/dither';

	const WIDTH = 240;
	const HEIGHT = 80;
	const CELL = 2;

	// A soft halo behind the symbol. One path is shared by every instance, with no render loop.
	const pixels: string[] = [];
	for (let y = 0; y < HEIGHT; y += CELL) {
		for (let x = 0; x < WIDTH; x += CELL) {
			const distance = Math.hypot((x - WIDTH / 2) / (WIDTH / 2), (y - HEIGHT / 2) / (HEIGHT / 2));
			const density = Math.max(0, 1 - distance) * 0.9;
			if (density > ditherThreshold(x / CELL, y / CELL)) {
				pixels.push(`M${x} ${y}h${CELL}v${CELL}h-${CELL}z`);
			}
		}
	}
	const path = pixels.join('');
</script>

<svg
	data-slot="dither-field"
	viewBox="0 0 240 80"
	fill="currentColor"
	shape-rendering="crispEdges"
	aria-hidden="true"
	focusable="false"
>
	<path d={path} />
</svg>
