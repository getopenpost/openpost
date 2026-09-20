<script lang="ts">
	import { ditherSurface, type DitherDirection } from '@openpost/dither';

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
		use:ditherSurface={{ direction }}
		style:mask-image="var(--dither-mask)"
		style:mask-size="var(--dither-mask-size)"
		style:mask-repeat={horizontal ? 'repeat-y' : 'repeat-x'}
	></span>
</span>
