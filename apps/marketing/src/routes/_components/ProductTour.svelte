<script lang="ts">
	import { onMount } from 'svelte';
	import ProductScreenshot from './ProductScreenshot.svelte';
	import Play from '@lucide/svelte/icons/play';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { demoVideoUrl } from '../_marketing';

	const views = [
		{
			name: 'Compose',
			icon: '/assets/brand/features/compose.svg',
			src: '/assets/screenshots/main-dark.webp',
			alt: 'OpenPost composer with a draft, six social destinations, and scheduling controls',
			caption: 'Write once. Review each destination.'
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
		}
	];
	let selected = $state(0);
	let ready = $state(false);
	const view = $derived(views[selected]);
	onMount(() => {
		ready = true;
	});
</script>

<div class="product-tour">
	{#if ready}
		<div class="view-picker" role="group" aria-label="Explore OpenPost">
			{#each views as item, index (item.name)}
				<button
					type="button"
					class="focus-ring"
					aria-pressed={selected === index}
					onclick={() => (selected = index)}
					><img src={item.icon} alt="" width="24" height="24" />{item.name}</button
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
		<p aria-live="polite" aria-atomic="true">{view.caption}</p>
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
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		padding: 12px;
	}
	.view-picker button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 44px;
		padding: 8px 12px;
		border-radius: 8px;
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
	@media (max-width: 600px) {
		.view-picker {
			gap: 4px;
			padding: 8px;
		}
		.view-picker button {
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
