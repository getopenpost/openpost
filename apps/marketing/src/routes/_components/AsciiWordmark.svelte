<script lang="ts">
	import { onMount } from 'svelte';
	let canvas: HTMLCanvasElement;
	let ready = $state(false);
	onMount(() => {
		const context = canvas.getContext('2d');
		if (!context) return;
		const mask = document.createElement('canvas');
		const maskContext = mask.getContext('2d', { willReadFrequently: true });
		if (!maskContext) return;
		let cells: { x: number; y: number; glyph: string }[] = [];
		let width = 0;
		let height = 0;
		let step = 0;
		let disposed = false;
		const glyphs = '.:+*#@';
		const motion = matchMedia('(prefers-reduced-motion: reduce)');

		function draw(pointerX = -1000, pointerY = -1000) {
			if (!context) return;
			context.clearRect(0, 0, width, height);
			context.fillStyle = getComputedStyle(canvas).color;
			context.font = `${step * 1.1}px ui-monospace, monospace`;
			context.textBaseline = 'top';
			for (const cell of cells) {
				const nearby =
					!motion.matches && Math.hypot(cell.x - pointerX, cell.y - pointerY) < width * 0.1;
				context.globalAlpha = nearby ? 1 : 0.55;
				context.fillText(nearby ? '*' : cell.glyph, cell.x, cell.y);
			}
			context.globalAlpha = 1;
		}
		function resize() {
			if (disposed || !context || !maskContext) return;
			width = canvas.clientWidth;
			if (!width) return;
			height = canvas.clientHeight;
			const scale = Math.min(devicePixelRatio, 2);
			canvas.width = Math.round(width * scale);
			canvas.height = Math.round(height * scale);
			context.setTransform(scale, 0, 0, scale, 0, 0);
			mask.width = Math.ceil(width);
			mask.height = Math.ceil(height);
			maskContext.font = `600 ${height}px Geist Variable, sans-serif`;
			const fontSize = (height * width) / maskContext.measureText('OpenPost').width;
			maskContext.font = `600 ${fontSize * 0.98}px Geist Variable, sans-serif`;
			maskContext.textBaseline = 'middle';
			maskContext.fillText('OpenPost', 0, height * 0.5);
			const pixels = maskContext.getImageData(0, 0, mask.width, mask.height).data;
			step = width / (width < 500 ? 110 : 170);
			cells = [];
			for (let y = 0, row = 0; y < height - step; y += step, row++) {
				for (let x = 0, col = 0; x < width - step; x += step, col++) {
					const alpha =
						pixels[(Math.floor(y + step / 2) * mask.width + Math.floor(x + step / 2)) * 4 + 3];
					if (alpha > 100) cells.push({ x, y, glyph: glyphs[(col * 7 + row * 3) % glyphs.length] });
				}
			}
			draw();
			ready = true;
		}
		function move(event: PointerEvent) {
			const rect = canvas.getBoundingClientRect();
			draw(event.clientX - rect.left, event.clientY - rect.top);
		}
		const reset = () => draw();
		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(canvas);
		const themeObserver = new MutationObserver(reset);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		canvas.addEventListener('pointermove', move);
		canvas.addEventListener('pointerleave', reset);
		void document.fonts.ready.then(resize);
		return () => {
			disposed = true;
			resizeObserver.disconnect();
			themeObserver.disconnect();
			canvas.removeEventListener('pointermove', move);
			canvas.removeEventListener('pointerleave', reset);
		};
	});
</script>

<div class="ascii-wordmark" aria-hidden="true">
	<span class:hidden={ready}>OpenPost</span><canvas bind:this={canvas} class:ready></canvas>
</div>

<style>
	.ascii-wordmark {
		position: relative;
		height: auto;
		aspect-ratio: 5.5;
		color: var(--marketing-mint-ink);
		overflow: hidden;
	}
	span {
		position: absolute;
		inset: 0;
		font-weight: 600;
		font-size: clamp(50px, 15vw, 200px);
		letter-spacing: -0.04em;
		line-height: 1;
		opacity: 0.6;
		text-align: center;
	}
	span.hidden {
		visibility: hidden;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		opacity: 0;
	}
	canvas.ready {
		opacity: 1;
	}
</style>
