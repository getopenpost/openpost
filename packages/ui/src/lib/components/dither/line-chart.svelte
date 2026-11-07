<script lang="ts" module>
	import type { DitherColor as SeriesColor } from '@openpost/dither/engine';
	import type { Accessor as SeriesAccessor, ChartSeries } from './cartesian.js';

	/** A line, with an optional dithered range band and a dashed style for forecasts. */
	export interface LineSeries<T> extends ChartSeries<T> {
		range?: { low: SeriesAccessor<T, number>; high: SeriesAccessor<T, number>; color?: SeriesColor };
		dashed?: boolean;
	}
</script>

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
		type NonEmpty,
		type ValueFormat
	} from './cartesian.js';
	import FillPattern from './fill-pattern.svelte';

	/** Crisp lines with optional dithered range bands and point markers. Ported from dithercn. */
	let {
		data,
		x,
		series,
		markers = 'last',
		zero = false,
		height = 240,
		curve = 'smooth',
		fill: fillProp,
		bloom = 'off',
		colors,
		level = 0.25,
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
		series: NonEmpty<LineSeries<T>>;
		markers?: 'all' | 'last' | 'none';
		zero?: boolean;
		height?: number;
		curve?: 'smooth' | 'linear';
		fill?: FillVariant;
		bloom?: Bloom;
		colors?: readonly DitherColor[];
		level?: number;
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

	const toPath = $derived(curve === 'smooth' ? monotonePath : linearPath);
	const formatValue = $derived(toFormatter(format, locale));
	const scale = $derived(
		niceScale(
			series.flatMap((entry) =>
				data.flatMap((datum) => {
					const value = readValue(datum, entry.value);
					return entry.range === undefined
						? [value]
						: [value, readValue(datum, entry.range.low), readValue(datum, entry.range.high)];
				})
			),
			{ zero }
		)
	);
	const summary = $derived(summaryText ?? chartSummary({ data, kind: 'Line chart', series, x }));
	const readout = (datum: T) =>
		series.map((entry, index) => {
			const value = formatValue(readValue(datum, entry.value));
			const range =
				entry.range === undefined
					? ''
					: ` (${formatValue(readValue(datum, entry.range.low))}–${formatValue(readValue(datum, entry.range.high))})`;
			return { color: seriesColor(entry.color, index, colors), label: entry.label, value: `${value}${range}` };
		});

	const linesFor = ({ uid, xAt, yAt, colorOf }: ChartContext) =>
		series.map((entry, seriesIndex) => {
			const pointAt = (accessor: Accessor<T, number>) =>
				data.map((datum, index) => ({ x: xAt(index), y: yAt(readValue(datum, accessor)) }));
			const range = entry.range;
			const band =
				range === undefined
					? null
					: `${toPath(pointAt(range.high))}${toPath(pointAt(range.low).reverse()).replace(/^M/u, 'L')}Z`;
			const color = colorOf(seriesIndex);
			const points = pointAt(entry.value);
			const marked = markers === 'all' ? points : markers === 'last' ? points.slice(-1) : [];
			return {
				band,
				bandColor: range?.color ?? color,
				color,
				dashed: entry.dashed === true,
				id: `${uid}-line-${seriesIndex}`,
				key: entry.label,
				line: toPath(points),
				marked,
				seriesIndex
			};
		});
</script>

{#snippet swatch(index: number, color: DitherColor)}
	<svg aria-hidden="true" width="14" height="10" style="flex-shrink:0">
		<line
			x1="1"
			x2="13"
			y1="5"
			y2="5"
			stroke={cssColor(color)}
			stroke-width="2"
			stroke-linecap="round"
			stroke-dasharray={series[index]?.dashed ? '3 3' : undefined}
		/>
	</svg>
{/snippet}

{#snippet marks(context: ChartContext)}
	{@const lines = linesFor(context)}
	<BloomGroup {bloom}>
		{#each lines as line (line.key)}
			<path
				d={line.line}
				fill="none"
				stroke={cssColor(line.color)}
				stroke-width="6"
				stroke-linecap="round"
				stroke-linejoin="round"
				opacity={context.opacityOf(line.seriesIndex)}
			/>
		{/each}
	</BloomGroup>
	{#each lines as line (line.key)}
		{#if line.band !== null}
			<g opacity={context.opacityOf(line.seriesIndex) * (fill === 'solid' ? 0.3 : 1)} class="fade">
				<defs>
					{#if fill === 'gradient'}
						<FillPattern id="{line.id}-band" level={quantizeLevel(level * context.reveal)} {matrix} cell={context.cell} color={line.bandColor} />
					{:else}
						<FillPattern id="{line.id}-band" {fill} color={line.bandColor} cell={context.cell} />
					{/if}
				</defs>
				<path d={line.band} fill="url(#{line.id}-band)" opacity={fill === 'gradient' ? 1 : context.reveal} shape-rendering="crispEdges" />
			</g>
		{/if}
	{/each}
	{#each lines as line (line.key)}
		<g opacity={context.opacityOf(line.seriesIndex)} class="fade">
			{#if line.dashed}
				<path d={line.line} fill="none" stroke={cssColor(line.color)} stroke-width="2" stroke-linecap="round" stroke-dasharray="4 5" />
			{:else}
				<path
					d={line.line}
					pathLength="1"
					fill="none"
					stroke={cssColor(line.color)}
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					stroke-dasharray="1"
					class:draw={context.animate}
				/>
			{/if}
			{#each line.marked as point (point.x)}
				<circle cx={point.x} cy={point.y} r="3.5" fill={cssColor(line.color)} stroke="var(--dither-paper)" stroke-width="2" />
			{/each}
		</g>
	{/each}
{/snippet}

<CartesianChart
	class={className}
	{data}
	{x}
	{series}
	{colors}
	{scale}
	layout="point"
	{height}
	{axes}
	{tooltip}
	legend={legend ?? series.length > 1}
	{interactive}
	{animate}
	{cell}
	{formatValue}
	{readout}
	{swatch}
	scrub="line"
	pointsAt={(index, { yAt }) => {
		const datum = data[index];
		return datum === undefined
			? []
			: series.map((entry, seriesIndex) => ({ seriesIndex, y: yAt(readValue(datum, entry.value)) }));
	}}
	{summary}
	{marks}
	{ariaLabel}
/>

<style>
	.fade {
		transition: opacity 200ms ease-out;
	}
	.draw {
		stroke-dashoffset: 0;
		transition: stroke-dashoffset 700ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	@starting-style {
		.draw {
			stroke-dashoffset: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fade,
		.draw {
			transition: none;
		}
	}
</style>
