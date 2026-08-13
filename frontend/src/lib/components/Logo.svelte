<script lang="ts">
	interface Props {
		class?: string;
		width?: number;
		height?: number;
		showText?: boolean;
		decorative?: boolean;
	}

	let {
		class: className = '',
		width = 100,
		height = 28,
		showText = false,
		decorative = false
	}: Props = $props();
	const size = $derived(Math.min(width, height));
</script>

<div class="flex items-center gap-2 {className}">
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 128 128"
		width={size}
		height={size}
		role={decorative || showText ? undefined : 'img'}
		aria-label={decorative || showText ? undefined : 'OpenPost'}
		aria-hidden={decorative || showText ? 'true' : undefined}
		class="h-auto max-w-full shrink-0"
	>
		<g fill="#B74C05">
			<path d="M24 4h36v28L32 60H4V24A20 20 0 0 1 24 4Z" />
			<path d="M68 4h36a20 20 0 0 1 20 20v36H96L68 32Z" />
			<path d="M4 68h28l28 28v28H24a20 20 0 0 1-20-20Z" />
			<path d="m68 96 28-28h28v36a20 20 0 0 1-20 20H68Z" />
		</g>
	</svg>
	{#if showText}
		<span
			class="font-brand leading-none font-semibold tracking-[-0.02em] whitespace-nowrap text-sidebar-foreground"
			>OpenPost</span
		>
	{/if}
</div>
