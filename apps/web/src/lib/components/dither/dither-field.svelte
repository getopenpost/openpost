<script module lang="ts">
	import { ditherThreshold } from './paint.js';

	const WIDTH = 240;
	const HEIGHT = 80;
	const CELL = 2;

	// Two crossing signal bands. One path is shared by every instance, with no render loop.
	const pixels: string[] = [];
	for (let y = 0; y < HEIGHT; y += CELL) {
		for (let x = 0; x < WIDTH; x += CELL) {
			const first = 40 + Math.sin(x / 45) * 22;
			const second = 40 + Math.cos(x / 60 + 1) * 24;
			const distance = Math.min(Math.abs(y - first), Math.abs(y - second));
			const edge = Math.min(x / 24, (WIDTH - x) / 24, 1);
			const density = Math.max(0, 1 - distance / 18) * edge;
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
