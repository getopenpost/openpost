<script lang="ts">
	import { DITHER_GRADIENT_MASKS, type DitherDirection } from './paint.js';

	interface Props {
		color?: string;
		baseColor?: string;
		direction?: DitherDirection;
		opacity?: number;
	}

	let {
		color = 'var(--action-focal)',
		baseColor = 'transparent',
		direction = 'down',
		opacity = 1
	}: Props = $props();
	const horizontal = $derived(direction === 'left' || direction === 'right');
</script>

<span
	aria-hidden="true"
	data-slot="dither-gradient"
	class="pointer-events-none absolute inset-0 rounded-[inherit]"
	style:background-color={baseColor}
	style:opacity
>
	<span
		class="absolute inset-0 rounded-[inherit]"
		style:background-color={color}
		style:mask-image={DITHER_GRADIENT_MASKS[direction]}
		style:mask-size={horizontal ? '100% 8px' : '8px 100%'}
		style:mask-repeat={horizontal ? 'repeat-y' : 'repeat-x'}
	></span>
</span>
