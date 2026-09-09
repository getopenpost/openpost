<script lang="ts">
	import { onMount } from 'svelte';
	import ProductScreenshot from './ProductScreenshot.svelte';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { demoVideoUrl } from '../_marketing';

	const views = [
		{
			name: 'Compose',
			icon: '/assets/brand/features/compose.svg',
			src: '/assets/screenshots/main-dark.webp',
			alt: 'OpenPost composer with a draft, six social destinations, and scheduling controls',
			caption: 'Turn your next idea into a post.'
		},
		{
			name: 'Image Editor',
			icon: '/assets/brand/features/image-editor.svg',
			src: '/assets/screenshots/image-editor-dark.webp',
			alt: 'OpenPost Image Editor with a tram photo, editable layers, and color controls',
			caption: 'Build an image from editable layers.'
		},
		{
			name: 'Video Editor',
			icon: '/assets/brand/features/video-editor.svg',
			src: '/assets/screenshots/video-editor-dark.webp',
			alt: 'OpenPost Video Editor with a video preview and multitrack timeline',
			caption: 'Cut, caption, and finish your video.'
		},
		{
			name: 'Calendar',
			icon: '/assets/brand/features/calendar.svg',
			src: '/assets/screenshots/calendar-dark.webp',
			alt: 'OpenPost monthly calendar with scheduled publications',
			caption: 'Keep the week in view.'
		},
		{
			name: 'Analytics',
			icon: '/assets/brand/features/analytics.svg',
			src: '/assets/screenshots/analytics-dark.webp',
			alt: 'OpenPost analytics with account growth and publication results',
			caption: 'Check the results from your connected accounts.'
		},
		{
			name: 'Media',
			icon: '/assets/brand/features/image-editor.svg',
			src: '/assets/screenshots/media-dark.webp',
			alt: 'OpenPost media library with saved photos and reusable brand assets',
			caption: 'Keep your photos, clips, and brand assets together.'
		},
		{
			name: 'Accounts',
			icon: '/assets/brand/features/compose.svg',
			src: '/assets/screenshots/accounts-dark.webp',
			alt: 'OpenPost Accounts page with connected social profiles',
			caption: 'Bring your social accounts into one place.'
		}
	];
	let selected = $state(0);
	const SLIDE_DURATION_MS = 5_000;
	let ready = $state(false);
	let paused = $state(false);
	let reducedMotion = $state(false);
	let hovered = $state(false);
	let visible = $state(false);
	let progress = $state(0);
	let container: HTMLDivElement;
	const view = $derived(views[selected]);

	function select(index: number) {
		selected = index;
		progress = 0;
	}

	onMount(() => {
		ready = true;
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const updateMotion = () => {
			reducedMotion = motion.matches;
		};
		updateMotion();
		motion.addEventListener('change', updateMotion);
		const observer = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
		});
		observer.observe(container);
		let lastTick = performance.now();
		const timer = window.setInterval(() => {
			const now = performance.now();
			const elapsed = now - lastTick;
			lastTick = now;
			if (paused || hovered || reducedMotion || !visible || document.hidden) return;
			progress += elapsed / SLIDE_DURATION_MS;
			if (progress >= 1) select((selected + 1) % views.length);
		}, 50);
		return () => {
			clearInterval(timer);
			observer.disconnect();
			motion.removeEventListener('change', updateMotion);
		};
	});
</script>

<div
	class="product-tour"
	role="region"
	aria-label="OpenPost screenshot tour"
	aria-roledescription="carousel"
	bind:this={container}
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
	onfocusin={(event) => {
		if (!(event.target instanceof Element && event.target.closest('.tour-playback'))) paused = true;
	}}
>
	{#if ready}
		<div class="view-picker" role="group" aria-label="Explore OpenPost">
			{#each views as item, index (item.name)}
				<button
					type="button"
					class="focus-ring"
					aria-pressed={selected === index}
					onclick={() => select(index)}
					><img src={item.icon} alt="" width="24" height="24" /><span>{item.name}</span><span
						class="progress-track"
						aria-hidden="true"
						><span
							style:transform={`scaleX(${selected === index ? (paused || reducedMotion ? 1 : progress) : 0})`}
						></span></span
					></button
				>
			{/each}
		</div>
	{/if}
	<div class="preview">
		{#key selected}
			<ProductScreenshot
				src={view.src}
				alt={view.alt}
				label={view.name}
				priority={selected === 0}
			/>
		{/key}
	</div>
	<div class="tour-footer">
		<p aria-live={paused || reducedMotion ? 'polite' : 'off'} aria-atomic="true">{view.caption}</p>
		{#if ready && !reducedMotion}
			<button
				type="button"
				class="tour-playback focus-ring"
				aria-label={paused ? 'Play screenshot tour' : 'Pause screenshot tour'}
				onclick={() => (paused = !paused)}
			>
				{#if paused}<Play size={15} />{:else}<Pause size={15} />{/if}<span
					>{paused ? 'Play tour' : 'Pause tour'}</span
				>
			</button>
		{/if}
		<a href={demoVideoUrl} class="focus-ring" target="_blank" rel="noreferrer"
			><Play size={16} fill="currentColor" /> Watch the product tour <ArrowUpRight size={16} /></a
		>
	</div>
</div>

<style>
	.product-tour {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
	}
	.view-picker {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0;
		padding: 0;
	}
	.view-picker button {
		position: relative;
		flex-direction: column;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 44px;
		padding: 16px 4px;
		border-radius: 0;
		font-size: 13px;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.view-picker button:hover,
	.view-picker button[aria-pressed='true'] {
		background: var(--muted);
		color: var(--foreground);
	}
	.preview {
		aspect-ratio: 3 / 2;
		display: grid;
		background: var(--muted);
	}
	.tour-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 24px;
		padding: 12px 20px;
	}
	.tour-footer p {
		font-size: 14px;
		color: var(--muted-foreground);
	}
	.tour-footer a {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 550;
	}
	.progress-track {
		position: absolute;
		inset: auto 0 0;
		height: 3px;
		background: var(--border);
	}
	.progress-track span {
		display: block;
		height: 100%;
		background: var(--primary);
		transform-origin: left;
	}
	.tour-playback {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		font-size: 12px;
		cursor: pointer;
		border-radius: 5px;
		padding-inline: 8px;
	}
	.tour-footer p {
		flex: 1;
	}
	@media (max-width: 600px) {
		.view-picker {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
		.tour-footer p {
			flex-basis: 100%;
		}
		.view-picker {
			gap: 4px;
			padding: 8px;
		}
		.view-picker button {
			position: relative;
			flex-direction: column;
			padding-inline: 8px;
			font-size: 12px;
		}
		.view-picker img {
			width: 20px;
			height: 20px;
		}
		.tour-footer {
			padding: 12px;
		}
	}
</style>
