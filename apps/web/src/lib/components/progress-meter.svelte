<script lang="ts">
	import { cn } from '$lib/utils';
	let {
		fraction,
		label,
		phase,
		class: className,
		fillClass
	}: {
		fraction: number | null;
		label: string;
		phase?: string;
		class?: string;
		fillClass?: string;
	} = $props();
	const value = $derived(
		fraction !== null && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null
	);
</script>

<div
	class={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
	role="progressbar"
	aria-label={label}
	aria-valuemin="0"
	aria-valuemax="100"
	aria-valuenow={value === null ? undefined : Math.round(value * 100)}
>
	{#key phase}
		<div
			class={cn('progress-fill h-full rounded-full bg-primary', fillClass)}
			class:indeterminate={value === null}
			style:width={value === null ? '35%' : `${value * 100}%`}
		></div>
	{/key}
</div>

<style>
	.progress-fill {
		transition: width var(--theme-duration-slow, 240ms) cubic-bezier(0.16, 1, 0.3, 1);
	}
	.indeterminate {
		animation: progress-sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	@keyframes progress-sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(386%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.progress-fill {
			transition: none;
		}
		.indeterminate {
			animation: none;
		}
	}
</style>
