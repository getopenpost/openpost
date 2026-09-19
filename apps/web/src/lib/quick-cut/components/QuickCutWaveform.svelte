<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { WaveformData } from '$lib/video-editor/media/waveform-client';
	import type { QuickCutSource } from '../types';
	import {
		getQuickCutWaveform,
		sampleWaveformColumns,
		subscribeQuickCutWaveform
	} from '../waveform';

	let {
		source,
		viewStartSeconds,
		viewEndSeconds
	}: { source: QuickCutSource; viewStartSeconds: number; viewEndSeconds: number } = $props();
	let root = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let waveform = $state<WaveformData | null>(null);
	let width = $state(0);
	let height = $state(0);
	let failed = $state(false);
	let waveformColor = $state('#808080');
	$effect(() => {
		if (!root) return;
		const updateColor = () => {
			if (root) waveformColor = getComputedStyle(root).color;
		};
		updateColor();
		document.addEventListener('openpost:themechange', updateColor);
		const observer = new MutationObserver(updateColor);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'style']
		});
		return () => {
			observer.disconnect();
			document.removeEventListener('openpost:themechange', updateColor);
		};
	});

	const hasAudio = $derived(
		source.audioStreams.length > 0 && source.selectedAudioTrackIndices?.length !== 0
	);

	$effect(() => {
		if (!hasAudio || (!source.file && !source.handle)) {
			waveform = null;
			failed = false;
			return;
		}
		failed = false;
		waveform = null;
		const unsubscribe = subscribeQuickCutWaveform(source, (next) => (waveform = next));
		void getQuickCutWaveform(source)
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
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, width, height);
		const columns = sampleWaveformColumns(waveform, width, viewStartSeconds, viewEndSeconds);
		const center = height / 2;
		const maximumHeight = Math.max(1, center - 5);
		context.fillStyle = waveformColor;
		for (let x = 0; x < columns.length; x += 1) {
			const bar = Math.max(1, Math.round((columns[x] ?? 0) * maximumHeight));
			context.fillRect(x, Math.round(center - bar), 1, bar * 2);
		}
	});

	onDestroy(() => {
		waveform = null;
	});
</script>

<div
	bind:this={root}
	class="pointer-events-none absolute inset-0 text-muted-foreground"
	aria-hidden="true"
>
	{#if waveform}
		<canvas bind:this={canvas} class="block"></canvas>
	{:else if hasAudio && !failed && (source.file || source.handle)}
		<div
			class="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--muted-foreground)_10%,transparent),transparent)] motion-reduce:animate-none"
		></div>
	{/if}
</div>
