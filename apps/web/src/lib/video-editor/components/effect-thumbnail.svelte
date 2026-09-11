<script lang="ts">
	import { onDestroy } from 'svelte';
	import { effectPosterUrl } from '../effects/preview/catalog-posters';
	import { createPreviewActivity } from '../effects/preview/preview-activity.svelte';
	import type { CssFilterType } from '$lib/video-editor/effects/types';
	import type { EffectTemplate } from '$lib/video-editor/timeline/effect-drop';
	import {
		EFFECT_PREVIEW_HEIGHT,
		EFFECT_PREVIEW_WIDTH,
		getEffectPreviewSample,
		ensureEffectPreviewPipeline,
		getEffectPreviewPoster,
		renderEffectPreviewFrame
	} from '$lib/video-editor/effects/preview/effect-preview-engine';

	let {
		effectId,
		cssEffect,
		cssAmount,
		effects,
		viewport,
		active = false,
		class: className = ''
	}: {
		effectId?: string;
		cssEffect?: CssFilterType;
		cssAmount?: number;
		effects?: readonly EffectTemplate[];
		viewport?: HTMLElement | null;
		active?: boolean;
		class?: string;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	const preview = createPreviewActivity(
		() => active,
		() => canvas
	);
	let sample = $state<HTMLCanvasElement | OffscreenCanvas | null>(null);
	let visible = $state(false);
	let rendered = $state(false);
	let renderMode = $state<'gpu' | 'css' | 'fallback'>('fallback');
	let poster = $state<HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | null>(null);
	let animationFrame = 0;
	let observer: IntersectionObserver | null = null;
	let posterController: AbortController | null = null;
	let destroyed = false;
	const templates = $derived<readonly EffectTemplate[]>(
		effects ??
			(effectId
				? [{ kind: 'gpu', effectId }]
				: cssEffect && cssAmount !== undefined
					? [{ kind: 'css', effectType: cssEffect, amount: cssAmount }]
					: [])
	);
	const usesGpu = $derived(templates.some((effect) => effect.kind === 'gpu'));

	function draw(strength: number, time = 0): void {
		if (destroyed) return;
		if (!canvas || !sample) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, canvas.width, canvas.height);

		const frame = renderEffectPreviewFrame(sample, templates, strength, time);
		context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
		rendered = true;
		renderMode = frame.mode;
	}

	function drawPoster(): void {
		if (!canvas || !poster) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(poster, 0, 0, canvas.width, canvas.height);
		rendered = true;
	}

	async function loadAndDraw(): Promise<void> {
		if (destroyed) return;
		posterController?.abort();
		posterController = new AbortController();
		const signal = posterController.signal;
		const bundledPoster = effectPosterUrl(templates);
		if (bundledPoster) {
			const image = new Image();
			image.src = bundledPoster;
			let fallback: HTMLCanvasElement | OffscreenCanvas | null = null;
			try {
				await image.decode();
			} catch {
				fallback = await getEffectPreviewSample(templates);
			}
			if (destroyed || !visible || signal.aborted) return;
			if (!fallback && image.naturalWidth === 0) return;
			poster = fallback ?? image;
			renderMode = fallback ? 'fallback' : 'gpu';
			drawPoster();
			return;
		}
		const loaded = await getEffectPreviewSample(templates);
		if (destroyed || !visible || !loaded || signal.aborted) return;
		sample = loaded;
		if (!usesGpu) {
			draw(1);
			return;
		}
		const frame = await getEffectPreviewPoster(templates, signal);
		if (destroyed || !visible || !frame || signal.aborted) return;
		poster = frame.canvas;
		renderMode = frame.mode;
		drawPoster();
	}

	function stopAnimation(): void {
		if (animationFrame) cancelAnimationFrame(animationFrame);
		animationFrame = 0;
	}

	$effect(() => {
		const target = canvas;
		const root = viewport;
		observer?.disconnect();
		observer = null;
		if (!target) return;
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			void loadAndDraw();
			return;
		}
		if (!root) return;
		observer = new IntersectionObserver(
			(entries) => {
				const nextVisible = entries.some((entry) => entry.isIntersecting);
				if (nextVisible && !visible) {
					visible = true;
					void loadAndDraw();
				} else if (!nextVisible) {
					visible = false;
					posterController?.abort();
					stopAnimation();
				}
			},
			{ root, rootMargin: '80px 0px' }
		);
		observer.observe(target);
		return () => observer?.disconnect();
	});

	$effect(() => {
		if (!preview.active || sample) return;
		let cancelled = false;
		void (async () => {
			const loaded = await getEffectPreviewSample(templates);
			if (usesGpu) await ensureEffectPreviewPipeline();
			if (!cancelled) sample = loaded;
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		stopAnimation();
		if (!preview.active || !visible || !sample) {
			if (visible) {
				if (poster) drawPoster();
				else if (sample && !usesGpu) draw(1);
			}
			return;
		}
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			draw(1);
			return;
		}
		let startedAt = 0;
		let lastDrawAt = 0;
		const tick = (now: number) => {
			if (!startedAt) startedAt = now;
			if (now - lastDrawAt >= 1000 / 30) {
				const phase = ((now - startedAt) % 2200) / 1100;
				draw(phase <= 1 ? phase : 2 - phase, (now - startedAt) / 1000);
				lastDrawAt = now;
			}
			animationFrame = requestAnimationFrame(tick);
		};
		animationFrame = requestAnimationFrame(tick);
	});

	onDestroy(() => {
		destroyed = true;
		posterController?.abort();
		observer?.disconnect();
		stopAnimation();
	});
</script>

<canvas
	bind:this={canvas}
	width={EFFECT_PREVIEW_WIDTH}
	height={EFFECT_PREVIEW_HEIGHT}
	class={`bg-black/40 ${className}`}
	draggable="false"
	aria-hidden="true"
	data-rendered={rendered}
	data-render-mode={renderMode}
></canvas>
