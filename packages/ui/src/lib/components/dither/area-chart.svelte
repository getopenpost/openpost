<script lang="ts" generics="T">
	import { themeFill } from './dither-context.svelte.js';
	import { cssColor } from '@openpost/dither/engine';
	import type { Bloom, DitherColor, DitherMatrix, FillVariant } from '@openpost/dither/engine';
	import BloomGroup from './bloom-group.svelte';
	import CartesianChart from './cartesian-chart.svelte';
	import {
		chartSummary,
		linearPath,
		monotonePath,
		niceScale,
		quantizeLevel,
		readValue,
		seriesColor,
		toFormatter,
		type Accessor,
		type ChartContext,
		type ChartSeries,
		type NonEmpty,
		type Point,
		type Scale,
		type ValueFormat
	} from './cartesian.js';
	import FillPattern from './fill-pattern.svelte';

	/**
	 * An area chart: each series is a crisp line over a dithered fill, densest
	 * under the line and thinning toward the axis. Ported from dithercn's
	 * `area-chart` (MIT).
	 */
	let {
		data,
		x,
		series,
		stack = 'none',
		height = 240,
		fill: fillProp,
		bloom = 'off',
		colors,
		level = 0.625,
		curve = 'smooth',
		matrix = 'bayer4',
		cell,
		axes = true,
		tooltip = true,
		legend,
		interactive = true,
		animate = false,
		format,
		locale,
		summary: summaryText,
		ariaLabel,
		class: className = ''
	}: {
		data: readonly T[];
		x: Accessor<T, string | number>;
		series: NonEmpty<ChartSeries<T>>;
		/** `none`: overlapping. `stacked`: on top of each other. `percent`: stacked to 100%. */
		stack?: 'none' | 'stacked' | 'percent';
		height?: number;
		fill?: FillVariant;
		bloom?: Bloom;
		colors?: readonly DitherColor[];
		level?: number;
		curve?: 'smooth' | 'linear';
		matrix?: DitherMatrix;
		cell?: number;
		axes?: boolean;
		tooltip?: boolean;
		legend?: boolean;
		interactive?: boolean;
		animate?: boolean;
		format?: ValueFormat;
		locale?: string;
		summary?: string;
		ariaLabel?: string;
		class?: string;
	} = $props();

	const fill = $derived(fillProp ?? themeFill());

	// Share of the plot height each density band reaches below the line, and its
	// coverage relative to `level`. Bayer levels nest, so the union reads as a ramp.
	const DENSITY_BANDS = [
		{ depth: Number.POSITIVE_INFINITY, share: 0.2 },
		{ depth: 0.6, share: 0.35 },
		{ depth: 0.4, share: 0.5 },
		{ depth: 0.25, share: 0.65 },
		{ depth: 0.13, share: 0.8 },
		{ depth: 0.05, share: 1 }
	] as const;
	const PERCENT_SCALE: Scale = { max: 100, min: 0, ticks: [0, 25, 50, 75, 100] };
	const formatPercent = (value: number) => `${Math.round(value)}%`;

	const formatValue = $derived(toFormatter(format, locale));
	const computed = $derived.by(() => {
		const values = series.map((entry) => data.map((datum) => readValue(datum, entry.value)));
		const count = values[0]?.length ?? 0;
		const totals = Array.from({ length: count }, (_, index) =>
			values.reduce((sum, row) => sum + Math.max(0, row[index] ?? 0), 0)
		);
		const running = Array.from({ length: count }, () => 0);
		const edges = values.map((row) =>
			row.map((raw, index) => {
				if (stack === 'none') return { high: raw, low: 0 };
				const value = Math.max(0, raw);
				const scaled = stack === 'percent' ? (value / (totals[index] || 1)) * 100 : value;
				const low = running[index] ?? 0;
				running[index] = low + scaled;
				return { high: low + scaled, low };
			})
		);
		return {
			edges,
			raw: values,
			scale: stack === 'percent' ? PERCENT_SCALE : niceScale(edges.flatMap((row) => row.map((edge) => edge.high)))
		};
	});
	const toPath = $derived(curve === 'smooth' ? monotonePath : linearPath);
	const summary = $derived(
		summaryText ?? chartSummary({ data, kind: stack === 'none' ? 'Area chart' : 'Stacked area chart', series, x })
	);
	const readout = $derived(
		stack !== 'percent'
			? undefined
			: (datum: T) => {
					const index = data.indexOf(datum);
					return series.map((entry, seriesIndex) => {
						const edge = computed.edges[seriesIndex]?.[index];
						const share = edge === undefined ? 0 : edge.high - edge.low;
						return {
							color: seriesColor(entry.color, seriesIndex, colors),
							label: entry.label,
							value: `${formatValue(computed.raw[seriesIndex]?.[index] ?? 0)} · ${formatPercent(share)}`
						};
					});
				}
	);

	const shapesFor = ({ uid, xAt, yAt, colorOf }: ChartContext) => {
		const baseline = yAt(Math.max(computed.scale.min, 0));
		return series.map((entry, seriesIndex) => {
			const row = computed.edges[seriesIndex] ?? [];
			const top: Point[] = row.map((edge, index) => ({ x: xAt(index), y: yAt(edge.high) }));
			const line = toPath(top);
			const first = top[0];
			const last = top.at(-1);
			let area = '';
			if (first !== undefined && last !== undefined) {
				area =
					stack === 'none'
						? `${line}L${last.x} ${baseline}L${first.x} ${baseline}Z`
						: `${line}${toPath(
								row.map((edge, index) => ({ x: xAt(index), y: yAt(edge.low) })).reverse()
							).replace(/^M/u, 'L')}Z`;
			}
			return { area, color: colorOf(seriesIndex), id: `${uid}-area-${seriesIndex}`, key: entry.label, line, seriesIndex };
		});
	};
</script>

{#snippet swatch(_: number, color: DitherColor)}
	<svg aria-hidden="true" width="10" height="10" style="flex-shrink:0">
		<rect y="3" width="10" height="7" fill={cssColor(color)} opacity="0.4" />
		<rect width="10" height="2" fill={cssColor(color)} />
	</svg>
{/snippet}

{#snippet marks(context: ChartContext)}
	{@const shapes = shapesFor(context)}
	{@const plotHeight = context.plot.bottom - context.plot.top}
	<BloomGroup {bloom}>
		{#each shapes as shape (shape.key)}
			<path d={shape.area} fill={cssColor(shape.color)} opacity={context.opacityOf(shape.seriesIndex)} />
		{/each}
	</BloomGroup>
	{#each shapes as shape (shape.key)}
		<g>
			{#if stack === 'none' && shape.seriesIndex > 0}
				<!-- Knock out the fills behind, so each area shows one texture. -->
				<path d={shape.area} fill="var(--dither-paper)" />
			{/if}
			<g opacity={context.opacityOf(shape.seriesIndex)} class="series">
				{#if fill === 'gradient'}
					<defs>
						{#each DENSITY_BANDS as band, bandIndex (band.depth)}
							<FillPattern
								id="{shape.id}-p{bandIndex}"
								level={quantizeLevel(level * band.share * context.reveal)}
								{matrix}
								cell={context.cell}
								color={shape.color}
							/>
							{#if Number.isFinite(band.depth)}
								<mask id="{shape.id}-m{bandIndex}">
									<rect
										x={context.plot.left}
										y={context.plot.top - 4}
										width={context.plot.right - context.plot.left}
										height={plotHeight + 8}
										fill="white"
									/>
									<path
										d={shape.area}
										transform="translate(0 {Math.max(context.cell * 2, band.depth * plotHeight)})"
										fill="black"
										shape-rendering="crispEdges"
									/>
								</mask>
							{/if}
						{/each}
					</defs>
					{#each DENSITY_BANDS as band, bandIndex (band.depth)}
						<path
							d={shape.area}
							fill="url(#{shape.id}-p{bandIndex})"
							mask={Number.isFinite(band.depth) ? `url(#${shape.id}-m${bandIndex})` : undefined}
							shape-rendering="crispEdges"
						/>
					{/each}
				{:else}
					<defs><FillPattern id="{shape.id}-fill" {fill} color={shape.color} cell={context.cell} /></defs>
					<path d={shape.area} fill="url(#{shape.id}-fill)" opacity={context.reveal} shape-rendering="crispEdges" />
				{/if}
			</g>
		</g>
	{/each}
	{#each shapes as shape (shape.key)}
		<path
			d={shape.line}
			pathLength="1"
			fill="none"
			stroke={cssColor(shape.color)}
			stroke-width={fill === 'solid' ? 1.5 : 2}
			stroke-linejoin="round"
			stroke-linecap="round"
			stroke-dasharray="1"
			opacity={context.opacityOf(shape.seriesIndex)}
			class={context.animate ? 'line draw' : 'line'}
		/>
	{/each}
{/snippet}

<CartesianChart
	class={className}
	{data}
	{x}
	{series}
	{colors}
	scale={computed.scale}
	layout="point"
	{height}
	{axes}
	{tooltip}
	legend={legend ?? series.length > 1}
	{interactive}
	{animate}
	{cell}
	{formatValue}
	formatTick={stack === 'percent' ? formatPercent : formatValue}
	{readout}
	{swatch}
	scrub="line"
	pointsAt={(index, { yAt }) =>
		computed.edges.map((row, seriesIndex) => ({ seriesIndex, y: yAt(row[index]?.high ?? 0) }))}
	{summary}
	{marks}
	{ariaLabel}
/>

<style>
	.series,
	.line {
		transition: opacity 200ms ease-out;
	}
	.draw {
		stroke-dashoffset: 0;
		transition:
			stroke-dashoffset 700ms cubic-bezier(0.23, 1, 0.32, 1),
			opacity 200ms ease-out;
	}
	@starting-style {
		.draw {
			stroke-dashoffset: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.series,
		.line,
		.draw {
			transition: none;
		}
	}
</style>
