<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';

	interface Props {
		value: number;
		currency?: string;
		class?: string;
	}

	let { value, currency = '$', class: className = '' }: Props = $props();
	const amount = Tween.of(() => value, {
		duration: prefersReducedMotion.current ? 0 : 340,
		easing: cubicOut
	});
	const formatted = $derived(
		amount.current.toLocaleString('en-US', {
			minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
			maximumFractionDigits: Number.isInteger(value) ? 0 : 2
		})
	);
</script>

<span class={`animated-price ${className}`} aria-label={`${currency}${value}`}>
	<span aria-hidden="true">{currency}{formatted}</span>
</span>

<style>
	.animated-price {
		display: inline-block;
		min-width: 2.45ch;
		font-variant-numeric: tabular-nums;
	}
</style>
