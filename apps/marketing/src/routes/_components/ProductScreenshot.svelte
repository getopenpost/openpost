<script lang="ts" module>
	import mediumZoom, { type Zoom } from 'medium-zoom';
	// medium-zoom has no destroy API for its document listeners. Keep one
	// browser-lifetime owner and attach only the currently mounted screenshots.
	let browserZoom: Zoom | undefined;
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';

	let { src, alt, label }: { src: string; alt: string; label: string } = $props();
	let image: HTMLImageElement;
	let link: HTMLAnchorElement;
	let zoom: Zoom | undefined;
	let opening: Promise<Zoom> | undefined;
	let expanded = $state(false);
	let closeButton: HTMLButtonElement | undefined = $state();

	onMount(() => {
		browserZoom ??= mediumZoom([], {
			background: 'var(--background)',
			margin: 16,
			scrollOffset: 24
		});
		const instance = browserZoom;
		zoom = instance.attach(image);
		const onOpen = () => {
			expanded = true;
			void tick().then(() => closeButton?.focus({ preventScroll: true }));
		};
		const onClosed = () => {
			expanded = false;
			link.focus({ preventScroll: true });
		};
		image.addEventListener('medium-zoom:open', onOpen);
		image.addEventListener('medium-zoom:closed', onClosed);
		return () => {
			image.removeEventListener('medium-zoom:open', onOpen);
			image.removeEventListener('medium-zoom:closed', onClosed);
			void close().then(() => instance.detach(image));
		};
	});

	function toggle(event: MouseEvent) {
		// Own the trigger so medium-zoom's document listener cannot also handle
		// image clicks or turn a modified link click into a local zoom.
		event.stopPropagation();
		if (!zoom || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		if (expanded) void close();
		else {
			zoom.update({ margin: window.innerWidth < 640 ? 0 : 16 });
			opening = zoom.open({ target: image });
		}
	}

	async function close() {
		// medium-zoom ignores close while opening; retain an early Escape/click.
		await opening;
		if (zoom?.getZoomedImage() === image) await zoom.close();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (expanded && event.key === 'Escape') void close();
	}}
/>

<a
	bind:this={link}
	href={src}
	class="screenshot-link focus-ring"
	onclick={toggle}
	aria-label={`${expanded ? 'Close' : 'Enlarge'} ${label} screenshot`}
	aria-expanded={expanded}
	onkeydown={(event) => {
		if (expanded && event.key === 'Tab') void close();
	}}
>
	<img bind:this={image} {src} {alt} width="1440" height="900" loading="lazy" />
	<span class="zoom-hint"><ZoomIn size={16} aria-hidden="true" /> Enlarge screenshot</span>
</a>
{#if expanded}
	<button
		bind:this={closeButton}
		type="button"
		class="close-zoom focus-ring"
		onclick={() => void close()}
		aria-label={`Close ${label} screenshot`}
		onkeydown={(event) => {
			if (event.key === 'Tab') {
				event.preventDefault();
				void close();
			}
		}}>Close screenshot <span aria-hidden="true">Esc</span></button
	>
{/if}

<style>
	.screenshot-link {
		display: block;
		border-radius: 9px;
	}
	.screenshot-link img {
		display: block;
		width: 100%;
		border-radius: 9px;
	}
	.zoom-hint {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		font-size: 12px;
	}
	:global(.medium-zoom-overlay) {
		z-index: 80;
	}
	:global(.medium-zoom-image--opened) {
		z-index: 81;
	}
	.close-zoom {
		position: fixed;
		top: 16px;
		right: 16px;
		z-index: 82;
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--background);
		color: var(--foreground);
		font-size: 14px;
	}
	.close-zoom span {
		color: var(--muted-foreground);
		font-size: 12px;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.medium-zoom-overlay),
		:global(.medium-zoom-image) {
			transition-duration: 0.01ms !important;
		}
	}
</style>
