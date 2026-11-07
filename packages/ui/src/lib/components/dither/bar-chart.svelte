<script lang="ts" generics="T">
	import { themeFill } from './dither-context.svelte.js';
	import { cssColor } from '@openpost/dither/engine';
	import type { Bloom, DitherColor, DitherMatrix, FillRamp, FillVariant } from '@openpost/dither/engine';
	import BloomGroup from './bloom-group.svelte';
	import CartesianChart from './cartesian-chart.svelte';
	import {
		chartSummary,
		niceScale,
		readValue,
		seriesColor,
		toFormatter,
		type Accessor,
		type ChartContext,
		type ChartSeries,
		type NonEmpty,
		type Scale,
		type ValueFormat
	} from './cartesian.js';
	import FillPattern from './fill-pattern.svelte';

	/** How several series share a category. */
	type BarLayout = 'grouped' | 'stacked' | 'percent';

	/**
	 * A bar chart: each bar is a dithered body under a solid cap. With the
	 * default `gradient` fill a bar is densest at its top and thins toward the
	 * axis. The highlighted or scrubbed bar fills in to a denser dither. Ported
	 * from dithercn's `bar-chart` (MIT).
	 */
	let {
		data,
		x,
		series,
		layout = 'grouped',
		highlight = 'last',
		height = 240,
		fill: fillProp,
		bloom = 'off',
		colors,
		level = 0.75,
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
		layout?: BarLayout;
		/** The bar drawn emphasised while nothing is scrubbed. Default `last`. */
		highlight?: number | 'last' | 'max' | 'none';
		height?: number;
		fill?: FillVariant;
		bloom?: Bloom;
		colors?: readonly DitherColor[];
		/** Coverage at the top of each gradient bar. Default 0.75. */
		level?: number;
		matrix?: DitherMatrix;
		cell?: number;
		axes?: boolean;
		tooltip?: boolean;
		legend?: boolean;
		interactive?: boolean;
		/** Entrance motion. Default off: product screens update instantly. */
		animate?: boolean;
		format?: ValueFormat;
		locale?: string;
		/** Screen-reader summary. Default generated from the series and range. */
		summary?: string;
		ariaLabel?: string;
		class?: string;
	} = $props();

	const fill = $derived(fillProp ?? themeFill());

	/** Widest a single bar gets, so wide charts keep air between bars. */
	const MAX_BAR = 36;
	const GAP = 2;
	const CAP = 2;
	const FADE = 0.7;
	const FLOOR = 0.125;
	const DENSE_TOP = 1;
	const PERCENT_SCALE: Scale = { max: 100, min: 0, ticks: [0, 25, 50, 75, 100] };
	const formatPercent = (value: number) => `${Math.round(value)}%`;

	const stacked = $derived(layout !== 'grouped');
	const formatValue = $derived(toFormatter(format, locale));
	const computed = $derived.by(() => {
		const raw = data.map((datum) => series.map((entry) => readValue(datum, entry.value)));
		const sums = raw.map((row) => row.reduce((sum, value) => sum + Math.max(0, value), 0));
		const shown =
			layout === 'percent'
				? raw.map((row, index) => row.map((value) => (Math.max(0, value) / (sums[index] || 1)) * 100))
				: raw;
		let range: Scale = PERCENT_SCALE;
		if (layout === 'stacked') range = niceScale(sums);
		else if (layout === 'grouped') range = niceScale(raw.flat());
		return { scale: range, totals: sums, values: shown };
	});
	const highlighted = $derived.by(() => {
		const totals = computed.totals;
		if (totals.length === 0 || highlight === 'none') return null;
		if (highlight === 'last') return totals.length - 1;
		if (highlight === 'max') return totals.indexOf(Math.max(...totals));
		return highlight >= 0 && highlight < totals.length ? highlight : null;
	});
	const summary = $derived(
		summaryText ?? chartSummary({ data, kind: stacked ? 'Stacked bar chart' : 'Bar chart', series, x })
	);
	const readout = $derived(
		layout !== 'percent'
			? undefined
			: (datum: T) => {
					const index = data.indexOf(datum);
					return series.map((entry, seriesIndex) => ({
						color: seriesColor(entry.color, seriesIndex, colors),
						label: entry.label,
						value: `${formatValue(readValue(datum, entry.value))} · ${formatPercent(computed.values[index]?.[seriesIndex] ?? 0)}`
					}));
				}
	);

	const peakAt = (index: number | null) => {
		if (index === null) return 0;
		return layout === 'grouped' ? Math.max(...(computed.values[index] ?? [0])) : (computed.totals[index] ?? 0);
	};

	type Bar = { key: string; seriesIndex: number; x: number; y: number; width: number; height: number };

	const barsAt = (index: number, { band, xAt, yAt }: Pick<ChartContext, 'band' | 'xAt' | 'yAt'>): Bar[] => {
		const row = computed.values[index] ?? [];
		const zero = yAt(0);
		if (stacked) {
			const width = Math.max(2, Math.round(Math.min(MAX_BAR, band * 0.6)));
			const left = Math.round(xAt(index) - width / 2);
			let top = zero;
			let running = 0;
			return row.flatMap((value, seriesIndex) => {
				if (value <= 0) return [];
				running += value;
				const next = Math.round(yAt(running));
				// Every segment above the first leaves a surface gap below it.
				const bottom = top === zero ? Math.round(zero) : top - GAP;
				const bar = { height: Math.max(0, bottom - next), key: `${index}-${seriesIndex}`, seriesIndex, width, x: left, y: next };
				top = next;
				return bar.height > 0 ? [bar] : [];
			});
		}
		const count = row.length;
		const width = Math.max(2, Math.floor(Math.min(MAX_BAR, (band * 0.7 - GAP * (count - 1)) / count)));
		const groupWidth = width * count + GAP * (count - 1);
		const left = Math.round(xAt(index) - groupWidth / 2);
		return row.map((value, seriesIndex) => {
			const end = Math.round(yAt(value));
			const base = Math.round(zero);
			return { height: Math.abs(base - end), key: `${index}-${seriesIndex}`, seriesIndex, width, x: left + seriesIndex * (width + GAP), y: Math.min(base, end) };
		});
	};

	const barFill = (uid: string, bar: Bar, index: number) =>
		fill === 'gradient' ? `url(#${uid}-b${index}-${bar.seriesIndex})` : `url(#${uid}-bar-${bar.seriesIndex})`;
	const denseFill = (uid: string, bar: Bar, index: number) => `url(#${uid}-d${index}-${bar.seriesIndex})`;
</script>

{#snippet swatch(_: number, color: DitherColor)}
	<svg aria-hidden="true" width="10" height="10" style="flex-shrink:0">
		<rect width="10" height="10" fill={cssColor(color)} opacity="0.4" />
		<rect width="10" height={CAP} fill={cssColor(color)} />
	</svg>
{/snippet}

{#snippet marks(context: ChartContext)}
	{@const plotHeight = context.plot.bottom - context.plot.top}
	{@const ramp = { at: 0, edge: 'top', extent: plotHeight + context.cell * 8, length: plotHeight * FADE } satisfies FillRamp}
	{@const columns = data.map((_, index) => barsAt(index, context))}
	{@const denseIndex = context.scrubbing || fill === 'solid' ? null : highlighted}
	{@const labelBar = context.scrubbing || highlighted === null ? undefined : columns[highlighted]?.at(-1)}
	{@const labelValue = peakAt(highlighted)}
	{@const uid = context.uid}
	<defs>
		{#each series as entry, seriesIndex (entry.label)}
			<FillPattern
				id="{uid}-bar-{seriesIndex}"
				{fill}
				color={context.colorOf(seriesIndex)}
				cell={context.cell}
				{level}
				floor={FLOOR}
				{matrix}
				{ramp}
			/>
			<FillPattern
				id="{uid}-dense-{seriesIndex}"
				fill="gradient"
				color={context.colorOf(seriesIndex)}
				cell={context.cell}
				level={DENSE_TOP}
				floor={Math.max(level, FLOOR)}
				{matrix}
				{ramp}
			/>
		{/each}
		{#each columns as bars, index (index)}
			{#each bars as bar (bar.key)}
				{#if fill === 'gradient'}
					<pattern id="{uid}-b{index}-{bar.seriesIndex}" href="#{uid}-bar-{bar.seriesIndex}" y={bar.y} />
				{/if}
				<pattern id="{uid}-d{index}-{bar.seriesIndex}" href="#{uid}-dense-{bar.seriesIndex}" y={bar.y} />
			{/each}
		{/each}
		<clipPath id="{uid}-bar-clip">
			<rect
				x={context.plot.left}
				y={context.plot.top}
				width={context.plot.right - context.plot.left}
				height={plotHeight + 1}
			/>
		</clipPath>
	</defs>
	<BloomGroup {bloom} clip-path="url(#{uid}-bar-clip)">
		{#each columns as bars, column (column)}
			{#each bars as bar (bar.key)}
				<rect
					x={bar.x}
					y={bar.y}
					width={bar.width}
					height={bar.height}
					fill={cssColor(context.colorOf(bar.seriesIndex))}
					opacity={context.opacityOf(bar.seriesIndex)}
				/>
			{/each}
		{/each}
	</BloomGroup>
	<g clip-path="url(#{uid}-bar-clip)">
		{#each columns as bars, index (index)}
			<g class:rise={context.animate} style:transition-delay={context.animate ? `${Math.min(index * 30, 360)}ms` : undefined}>
				{#each bars as bar (bar.key)}
					<g opacity={context.opacityOf(bar.seriesIndex)} class="bar">
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							fill={index === denseIndex ? denseFill(uid, bar, index) : barFill(uid, bar, index)}
							shape-rendering="crispEdges"
						/>
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={Math.min(CAP, bar.height)}
							fill={cssColor(context.colorOf(bar.seriesIndex))}
							shape-rendering="crispEdges"
						/>
					</g>
				{/each}
			</g>
		{/each}
	</g>
	{#if labelBar !== undefined && highlighted !== null}
		<text
			x={context.xAt(highlighted)}
			y={(layout === 'grouped' ? Math.min(labelBar.y, context.yAt(labelValue)) : labelBar.y) - 6}
			text-anchor="middle"
			class="peak">{formatValue(labelValue)}</text
		>
	{/if}
{/snippet}

{#snippet activeMarks(index: number, context: ChartContext)}
	{#if fill !== 'solid'}
		<g clip-path="url(#{context.uid}-bar-clip)">
			{#each barsAt(index, context) as bar (bar.key)}
				<g opacity={context.opacityOf(bar.seriesIndex)}>
					{#if fill !== 'gradient'}
						<rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={cssColor('--dither-paper')} shape-rendering="crispEdges" />
					{/if}
					<rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={denseFill(context.uid, bar, index)} shape-rendering="crispEdges" />
				</g>
			{/each}
		</g>
	{/if}
{/snippet}

<CartesianChart
	class={className}
	{data}
	{x}
	{series}
	{colors}
	scale={computed.scale}
	layout="band"
	{height}
	{axes}
	{tooltip}
	legend={legend ?? series.length > 1}
	{interactive}
	{animate}
	{cell}
	{formatValue}
	formatTick={layout === 'percent' ? formatPercent : formatValue}
	{readout}
	{swatch}
	scrub="column"
	pointsAt={(index, context) => barsAt(index, context).map((bar) => ({ seriesIndex: bar.seriesIndex, y: bar.y }))}
	{activeMarks}
	{summary}
	{marks}
	{ariaLabel}
/>

<style>
	.bar {
		transition: opacity 200ms ease-out;
	}
	.rise {
		translate: 0 0;
		transform-box: fill-box;
		transition: translate 700ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	@starting-style {
		.rise {
			translate: 0 100%;
		}
	}
	.peak {
		fill: var(--foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	@media (prefers-reduced-motion: reduce) {
		.bar,
		.rise {
			transition: none;
		}
	}
</style>
