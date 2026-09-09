<script lang="ts">
	import { navigating } from '$app/state';
	import { BProgress } from '@bprogress/core';
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { createDelayedVisibility } from '$lib/query/presentation.svelte';

	let host: HTMLDivElement;
	const pending = createDelayedVisibility(() => Boolean(navigating.to) && !navigating.willUnload);

	$effect(() => {
		if (!pending.current) {
			BProgress.done();
			return;
		}
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		// A previous completion animation must not remove the next navigation's bar.
		BProgress.remove();
		BProgress.configure({
			parent: host,
			template: '<div class="bar"></div>',
			showSpinner: false,
			positionUsing: 'translate3d',
			trickle: !reducedMotion,
			speed: reducedMotion ? 0 : 200
		});
		BProgress.start();
	});

	onDestroy(() => {
		BProgress.done();
		BProgress.remove();
	});
</script>

<div bind:this={host} class="navigation-progress" aria-hidden="true"></div>
{#if pending.current}
	<span class="sr-only" role="status">{m.common_loading()}</span>
{/if}

<style>
	.navigation-progress {
		position: fixed;
		inset: 0 0 auto;
		z-index: 100;
		height: 2px;
		pointer-events: none;
		overflow: hidden;
	}
	.navigation-progress :global(.bar) {
		width: 100%;
		height: 2px;
		background: var(--primary);
	}
	@media (prefers-reduced-motion: reduce) {
		.navigation-progress :global(.bprogress),
		.navigation-progress :global(.bar) {
			transition: none !important;
		}
		.navigation-progress :global(.bar) {
			transform: none !important;
			width: 40%;
		}
	}
</style>
