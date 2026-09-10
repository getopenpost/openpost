<script lang="ts">
	interface Props {
		x: number;
		y: number;
		width: number;
		height: number;
		fill: string;
	}

	let { x, y, width, height, fill }: Props = $props();
</script>

<rect data-chart-fill {x} {y} {width} {height} {fill} rx="2" />
<!-- Keep the value boundary solid when the theme textures the fill. -->
<rect
	data-chart-outline
	{x}
	{y}
	{width}
	{height}
	rx="2"
	fill="none"
	stroke={fill}
	stroke-opacity="0.72"
	stroke-width="0.75"
	vector-effect="non-scaling-stroke"
	class="pointer-events-none"
/>
