<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import {
		getWaveform,
		subscribeWaveform,
		type WaveformData
	} from '$lib/video-editor/media/waveform-client';
	import {
		sampleSourceWaveform,
		sourceWaveformDetailWindow,
		sourceWaveformSeekTime
	} from '$lib/video-editor/preview/source-audio-waveform';

	let {
		media,
		durationSeconds,
		currentTimeSeconds,
		onseek
	}: {
		media: MediaMetadata;
		durationSeconds: number;
		currentTimeSeconds: number;
		onseek: (timeSeconds: number) => void;
	} = $props();

	let root = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let height = $state(0);
	let waveform = $state<WaveformData | null>(null);
	let failed = $state(false);
	const overviewHeight = 34;
	const detailWindow = $derived(sourceWaveformDetailWindow(durationSeconds, currentTimeSeconds));

	$effect(() => {
		const id = media.id;
		failed = false;
		waveform = null;
		const unsubscribe = subscribeWaveform(id, (next) => (waveform = next));
		void getWaveform(media)
			.then((next) => (waveform = next))
			.catch(() => (failed = true));
		return unsubscribe;
	});

	$effect(() => {
		if (!root) return;
		const measure = () => {
			const nextWidth = Math.max(1, Math.round(root?.clientWidth ?? 1));
			const nextHeight = Math.max(1, Math.round(root?.clientHeight ?? 1));
			if (nextWidth !== width) width = nextWidth;
			if (nextHeight !== height) height = nextHeight;
		};
		measure();
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		});
		observer.observe(root);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	});

	$effect(() => {
		if (!canvas || !waveform || width <= 0 || height <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(width * dpr));
		canvas.height = Math.max(1, Math.round(height * dpr));
		if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
		if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, width, height);
		context.fillStyle = '#121316';
		context.fillRect(0, 0, width, height);
		context.fillStyle = '#202127';
		context.fillRect(0, 0, width, overviewHeight);

		const inset = 8;
		const sampleWidth = Math.max(1, width - inset * 2);
		const overview = sampleSourceWaveform(waveform, 0, durationSeconds, sampleWidth);
		const detail = sampleSourceWaveform(
			waveform,
			detailWindow.start,
			detailWindow.end,
			sampleWidth
		);
		const draw = (values: Float32Array, y: number, regionHeight: number, color: string) => {
			const center = y + regionHeight / 2;
			const maxHeight = Math.max(1, regionHeight / 2 - 5);
			context.fillStyle = color;
			for (let x = 0; x < values.length; x += 1) {
				const bar = Math.max(1, Math.round((values[x] ?? 0) * maxHeight));
				context.fillRect(inset + x, Math.round(center - bar), 1, bar * 2);
			}
		};
		draw(overview, 0, overviewHeight, 'rgba(180,182,186,0.82)');
		const detailY = overviewHeight + 8;
		draw(detail, detailY, Math.max(1, height - detailY - 8), 'rgba(205,206,208,0.94)');

		const windowLeft = inset + (detailWindow.start / durationSeconds) * sampleWidth;
		const windowWidth = Math.max(
			1,
			((detailWindow.end - detailWindow.start) / durationSeconds) * sampleWidth
		);
		context.fillStyle = 'rgba(255,255,255,0.1)';
		context.fillRect(windowLeft, 1, windowWidth, overviewHeight - 2);
		context.strokeStyle = 'rgba(238,238,238,0.72)';
		context.strokeRect(windowLeft + 0.5, 1.5, windowWidth, overviewHeight - 3);

		const safeTime = Math.max(0, Math.min(durationSeconds, currentTimeSeconds));
		const overviewX = inset + (safeTime / durationSeconds) * sampleWidth;
		const detailProgress =
			detailWindow.end - detailWindow.start > 0
				? (safeTime - detailWindow.start) / (detailWindow.end - detailWindow.start)
				: 0;
		const detailX = inset + Math.max(0, Math.min(1, detailProgress)) * sampleWidth;
		context.strokeStyle = 'rgba(239,68,68,0.98)';
		for (const [x, y, lineHeight] of [
			[overviewX, 0, overviewHeight],
			[detailX, detailY, height - detailY]
		] as const) {
			context.beginPath();
			context.moveTo(Math.round(x) + 0.5, y);
			context.lineTo(Math.round(x) + 0.5, y + lineHeight);
			context.stroke();
		}
	});

	function seekFromPointer(event: PointerEvent): void {
		if (!root) return;
		const time = sourceWaveformSeekTime({
			clientX: event.clientX,
			clientY: event.clientY,
			rect: root.getBoundingClientRect(),
			durationSeconds,
			detailStartSeconds: detailWindow.start,
			detailEndSeconds: detailWindow.end,
			overviewHeight
		});
		onseek(time);
	}

	function pointerDown(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLDivElement)) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		seekFromPointer(event);
	}

	function pointerMove(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLDivElement)) return;
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		event.preventDefault();
		seekFromPointer(event);
	}

	function keydown(event: KeyboardEvent): void {
		const step = event.shiftKey ? 5 : 1;
		if (event.key === 'ArrowLeft') onseek(Math.max(0, currentTimeSeconds - step));
		else if (event.key === 'ArrowRight')
			onseek(Math.min(durationSeconds, currentTimeSeconds + step));
		else if (event.key === 'Home') onseek(0);
		else if (event.key === 'End') onseek(durationSeconds);
		else return;
		event.preventDefault();
	}

	onDestroy(() => {
		waveform = null;
	});
</script>

<div
	bind:this={root}
	class="focus-visible:outline-inset relative h-full w-full cursor-crosshair touch-none overflow-hidden bg-[#121316] select-none focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
	data-testid="source-audio-waveform"
	role="slider"
	tabindex="0"
	aria-label={m.video_editor_source_audio_waveform()}
	aria-valuemin="0"
	aria-valuemax={durationSeconds}
	aria-valuenow={Math.max(0, Math.min(durationSeconds, currentTimeSeconds))}
	onpointerdown={pointerDown}
	onpointermove={pointerMove}
	onkeydown={keydown}
>
	{#if waveform}
		<canvas bind:this={canvas} class="block"></canvas>
	{:else if failed}
		<div class="absolute inset-x-4 top-1/2 h-px bg-white/20" aria-hidden="true"></div>
	{:else}
		<div
			class="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)] motion-reduce:animate-none"
			aria-hidden="true"
		></div>
	{/if}
</div>
