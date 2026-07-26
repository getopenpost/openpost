<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	interface Point {
		date: string;
		value: number;
	}

	interface Props {
		points: Point[];
		label: string;
		emptyLabel: string;
		formatValue: (value: number) => string;
	}

	let { points, label, emptyLabel, formatValue }: Props = $props();

	const chart = $derived.by(() => {
		if (points.length < 2) return null;
		const width = 680;
		const height = 240;
		const insetX = 24;
		const insetTop = 20;
		const insetBottom = 34;
		const values = points.map((point) => point.value);
		const minimum = Math.min(...values);
		const maximum = Math.max(...values);
		const span = Math.max(1, maximum - minimum);
		const plotWidth = width - insetX * 2;
		const plotHeight = height - insetTop - insetBottom;
		const coordinates = points.map((point, index) => ({
			...point,
			x: insetX + (index / (points.length - 1)) * plotWidth,
			y: insetTop + ((maximum - point.value) / span) * plotHeight
		}));
		return {
			width,
			height,
			minimum,
			maximum,
			coordinates,
			path: coordinates
				.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
				.join(' ')
		};
	});
</script>

<figure class="min-w-0">
	{#if chart}
		<svg
			class="h-auto w-full overflow-visible text-muted-foreground"
			viewBox={`0 0 ${chart.width} ${chart.height}`}
			role="img"
			aria-label={label}
		>
			{#each [0, 0.5, 1] as ratio (ratio)}
				{@const y = 20 + ratio * 186}
				<line
					x1="24"
					x2="656"
					{y}
					y2={y}
					class="stroke-border"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
			{/each}
			<path
				d={chart.path}
				fill="none"
				class="stroke-primary"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			/>
			{#each chart.coordinates as point, index (`${point.date}-${index}`)}
				<circle
					cx={point.x}
					cy={point.y}
					r={index === chart.coordinates.length - 1 ? 4.5 : 2.5}
					class="fill-background stroke-primary"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				/>
			{/each}
			<text x="24" y="233" class="fill-current text-[11px]">
				{chart.coordinates[0].date}
			</text>
			<text x="656" y="233" text-anchor="end" class="fill-current text-[11px]">
				{chart.coordinates.at(-1)?.date}
			</text>
			<text x="24" y="14" class="fill-current text-[11px]">
				{formatValue(chart.maximum)}
			</text>
			<text x="24" y="201" class="fill-current text-[11px]">
				{formatValue(chart.minimum)}
			</text>
		</svg>

		<table class="sr-only">
			<caption>{label}</caption>
			<thead>
				<tr
					><th scope="col">{m.analytics_table_date()}</th><th scope="col"
						>{m.analytics_table_value()}</th
					></tr
				>
			</thead>
			<tbody>
				{#each points as point (`table-${point.date}`)}
					<tr><td>{point.date}</td><td>{formatValue(point.value)}</td></tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<div
			class="flex min-h-56 items-center justify-center border-y border-dashed text-sm text-muted-foreground"
		>
			{emptyLabel}
		</div>
	{/if}
</figure>
