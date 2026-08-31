<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		getTransitionPreviewFrames,
		getTransitionPreviewPoster,
		renderTransitionPreviewFrame,
		TRANSITION_PREVIEW_HEIGHT,
		TRANSITION_PREVIEW_WIDTH,
		transitionPosterProgress,
		type PreviewDirection,
		type TransitionPreviewFrames
	} from '$lib/video-editor/transitions/preview/transition-preview-engine';

	let {
		presentationId,
		direction,
		viewport,
		active = false
	}: {
		presentationId: string;
		direction?: PreviewDirection;
		viewport?: HTMLElement | null;
		active?: boolean;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let frames = $state<TransitionPreviewFrames | null>(null);
	let poster = $state<HTMLCanvasElement | OffscreenCanvas | null>(null);
	let visible = $state(false);
	let rendered = $state(false);
	let observer: IntersectionObserver | null = null;
	let controller: AbortController | null = null;
	let animationFrame = 0;
	let destroyed = false;

	function drawSource(source: HTMLCanvasElement | OffscreenCanvas | null): void {
		if (!canvas || !source || destroyed) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(source, 0, 0, canvas.width, canvas.height);
		rendered = true;
	}

	async function loadPoster(): Promise<void> {
		controller?.abort();
		controller = new AbortController();
		const signal = controller.signal;
		const [loadedFrames, loadedPoster] = await Promise.all([
			getTransitionPreviewFrames(),
			getTransitionPreviewPoster(presentationId, direction, signal)
		]);
		if (destroyed || !visible || signal.aborted) return;
		frames = loadedFrames;
		poster = loadedPoster;
		drawSource(poster);
	}

	function stopAnimation(): void {
		if (animationFrame) cancelAnimationFrame(animationFrame);
		animationFrame = 0;
	}

	$effect(() => {
		const target = canvas;
		const root = viewport;
		observer?.disconnect();
		if (!target) return;
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			void loadPoster();
			return;
		}
		if (!root) return;
		observer = new IntersectionObserver(
			(entries) => {
				const nextVisible = entries.some((entry) => entry.isIntersecting);
				if (nextVisible && !visible) {
					visible = true;
					void loadPoster();
				} else if (!nextVisible) {
					visible = false;
					controller?.abort();
					stopAnimation();
				}
			},
			{ root, rootMargin: '80px 0px' }
		);
		observer.observe(target);
		return () => observer?.disconnect();
	});

	$effect(() => {
		stopAnimation();
		if (!active || !visible || !frames) {
			if (visible) drawSource(poster);
			return;
		}
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			drawSource(poster);
			return;
		}
		let startedAt = 0;
		let lastDrawAt = 0;
		const tick = (now: number) => {
			if (!startedAt) startedAt = now;
			if (now - lastDrawAt >= 1000 / 30) {
				const phase = ((now - startedAt) % 2200) / 1100;
				drawSource(
					renderTransitionPreviewFrame(
						frames,
						presentationId,
						direction,
						phase <= 1 ? phase : 2 - phase
					)
				);
				lastDrawAt = now;
			}
			animationFrame = requestAnimationFrame(tick);
		};
		animationFrame = requestAnimationFrame(tick);
		return () => drawSource(poster);
	});

	onDestroy(() => {
		destroyed = true;
		controller?.abort();
		observer?.disconnect();
		stopAnimation();
	});
</script>

<canvas
	bind:this={canvas}
	width={TRANSITION_PREVIEW_WIDTH}
	height={TRANSITION_PREVIEW_HEIGHT}
	class="aspect-video w-full rounded bg-black/40"
	aria-hidden="true"
	draggable="false"
	data-rendered={rendered}
	data-poster-progress={transitionPosterProgress(presentationId)}
></canvas>
