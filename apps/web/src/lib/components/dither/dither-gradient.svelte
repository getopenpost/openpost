<script lang="ts">
	import { DITHER_GRADIENT_MASK } from './paint.js';

	interface Props {
		color?: string;
		opacity?: number;
	}

	let { color = 'var(--action-focal)', opacity = 1 }: Props = $props();
</script>

<span
	aria-hidden="true"
	data-slot="dither-gradient"
	class="pointer-events-none absolute inset-0 rounded-[inherit]"
	style:background-color={color}
	style:opacity
	style:mask-image={DITHER_GRADIENT_MASK}
	style:mask-size="8px 100%"
	style:mask-repeat="repeat-x"
></span>
