<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="skeleton"
	{...restProps}
	aria-hidden="true"
	class={cn('skeleton-shimmer relative overflow-hidden rounded-md bg-muted/70', className)}
></div>

<style>
	.skeleton-shimmer::after {
		position: absolute;
		inset: 0;
		content: '';
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in oklch, var(--foreground) 7%, transparent),
			transparent
		);
		transform: translateX(-100%);
		animation: skeleton-shimmer 1.6s cubic-bezier(0.25, 1, 0.5, 1) infinite;
	}

	@keyframes skeleton-shimmer {
		to {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-shimmer::after {
			animation: none;
			opacity: 0.35;
			transform: none;
		}
	}
</style>
