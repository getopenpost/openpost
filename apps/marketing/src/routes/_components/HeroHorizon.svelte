<script lang="ts">
	import { onMount } from 'svelte';
	import { DITHER_CELL_SIZE, ditherThreshold } from '@openpost/dither/paint';

	/** Distance in CSS pixels from the top of the field to the resting horizon. */
	let { horizon = 220 }: { horizon?: number } = $props();

	let canvas: HTMLCanvasElement;
	const FRAME_MS = 1000 / 20;
	const RISE = 48;
	const FALL = 40;
	// Subtracting a floor lets the glow reach zero well before the canvas edge.
	const FLOOR = 0.14;

	onMount(() => {
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) return;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		let columns = 0;
		let rows = 0;
		let image: ImageData | null = null;
		let ink: [number, number, number] = [0, 0, 0];
		let visible = false;
		let frame = 0;
		let lastFrame = 0;
		let start = performance.now();

		const resolveInk = () => {
			// The canvas parses any CSS color the theme uses, including oklch.
			const color = getComputedStyle(canvas).getPropertyValue('--marketing-soft-ink').trim();
			const probe = document.createElement('canvas').getContext('2d');
			if (!probe || !color) return;
			probe.fillStyle = color;
			probe.fillRect(0, 0, 1, 1);
			const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
			ink = [r!, g!, b!];
		};

		/** Glow density for one cell, in cell units, before the Bayer threshold. */
		const density = (y: number, line: number, shimmer: number) => {
			const distance = y - line;
			const reach = (distance < 0 ? RISE : FALL) / DITHER_CELL_SIZE;
			return Math.exp(-Math.abs(distance) / reach) * shimmer - FLOOR;
		};

		const paintColumn = (data: Uint8ClampedArray, x: number, seconds: number) => {
			const px = x * DITHER_CELL_SIZE;
			// Slow waves keep the horizon alive without reading as motion behind the copy.
			const wave =
				12 * Math.sin(px * 0.0052 + seconds * 0.35) +
				7 * Math.sin(px * 0.0131 - seconds * 0.22) +
				3 * Math.sin(px * 0.031 + seconds * 0.6);
			const line = (horizon + wave) / DITHER_CELL_SIZE;
			const shimmer = 0.82 + 0.18 * Math.sin(px * 0.021 - seconds * 0.5);
			for (let y = 0; y < rows; y++) {
				const value = density(y, line, shimmer);
				const offset = (y * columns + x) * 4;
				const lit = value > ditherThreshold(x, y);
				data[offset] = ink[0];
				data[offset + 1] = ink[1];
				data[offset + 2] = ink[2];
				data[offset + 3] = lit ? Math.round(255 * Math.min(1, 0.3 + value * 0.75)) : 0;
			}
		};

		const paint = (time: number) => {
			if (!image) return;
			const seconds = reduced.matches ? 0 : (time - start) / 1000;
			for (let x = 0; x < columns; x++) paintColumn(image.data, x, seconds);
			context.putImageData(image, 0, 0);
		};

		const loop = (time: number) => {
			frame = 0;
			if (!visible || document.hidden || reduced.matches) return;
			if (time - lastFrame >= FRAME_MS) {
				lastFrame = time;
				paint(time);
			}
			frame = requestAnimationFrame(loop);
		};

		const schedule = () => {
			if (reduced.matches) {
				cancelAnimationFrame(frame);
				frame = 0;
				paint(start);
			} else if (!frame && visible && !document.hidden) {
				frame = requestAnimationFrame(loop);
			}
		};

		const resize = () => {
			const box = canvas.getBoundingClientRect();
			columns = Math.max(1, Math.ceil(box.width / DITHER_CELL_SIZE));
			rows = Math.max(1, Math.ceil(box.height / DITHER_CELL_SIZE));
			canvas.width = columns;
			canvas.height = rows;
			image = context.createImageData(columns, rows);
			paint(performance.now());
		};

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(canvas);
		const visibility = new IntersectionObserver(([entry]) => {
			visible = entry?.isIntersecting ?? false;
			schedule();
		});
		visibility.observe(canvas);
		// mode-watcher switches schemes through the root class.
		const theme = new MutationObserver(() => {
			resolveInk();
			paint(performance.now());
		});
		theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('visibilitychange', schedule);
		reduced.addEventListener('change', schedule);
		resolveInk();
		resize();
		start = performance.now();

		return () => {
			cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			visibility.disconnect();
			theme.disconnect();
			document.removeEventListener('visibilitychange', schedule);
			reduced.removeEventListener('change', schedule);
		};
	});
</script>

<canvas
	bind:this={canvas}
	class="hero-horizon"
	style:--horizon-offset={`${horizon}px`}
	aria-hidden="true"
></canvas>

<style>
	.hero-horizon {
		position: absolute;
		z-index: -1;
		top: calc(var(--horizon-offset, 220px) * -1);
		left: 50%;
		width: 100vw;
		height: calc(var(--horizon-offset, 220px) + 300px);
		transform: translateX(-50%);
		image-rendering: pixelated;
		pointer-events: none;
	}
	@media (forced-colors: active) {
		.hero-horizon {
			display: none;
		}
	}
</style>
