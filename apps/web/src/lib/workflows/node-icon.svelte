<script lang="ts">
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';
	import type { NodeCategory } from './catalog';
	let {
		icon,
		category,
		size = 'md'
	}: { icon: ThemeIconRole; category: NodeCategory; size?: 'sm' | 'md' | 'lg' } = $props();
	const colors = {
		triggers: 'var(--chart-1)',
		content: 'var(--chart-2)',
		ai: 'var(--chart-3)',
		flow: 'var(--chart-4)',
		data: 'var(--chart-5)',
		tools: 'var(--chart-1)'
	};
</script>

<span
	class="node-icon flex shrink-0 items-center justify-center rounded-lg border {size === 'lg'
		? 'size-10'
		: size === 'sm'
			? 'size-8'
			: 'size-9'}"
	style:--node-color={colors[category]}
>
	<ThemeIcon role={icon} class={size === 'sm' ? 'size-4' : 'size-5'} />
</span>

<style>
	.node-icon {
		background: color-mix(in oklab, var(--node-color) 18%, var(--card));
		border-color: color-mix(in oklab, var(--node-color) 45%, var(--card));
		color: color-mix(in oklab, var(--foreground) 85%, var(--node-color));
	}
</style>
