<script lang="ts" generics="T">
	import './chart.css';
	import { createFrameLoop, cssColor, MOTION, readDitherCell, subscribeToTheme } from '@openpost/dither/engine';
	import type { DitherColor } from '@openpost/dither/engine';
	import type { Snippet } from 'svelte';
	import { getUiMessages } from '../../messages.js';
	import {
		DIMMED,
		labelAnchor,
		layoutPlot,
		readLabel,
		readValue,
		seriesColor,
		snapToDevice,
		xLabelIndices,
		type Accessor,
		type ChartContext,
		type ChartSeries,
		type NonEmpty,
		type ReadoutRow,
		type Scale,
		type ScrubPoint
	} from './cartesian.js';
	import { svgId } from './dither-context.svelte.js';

	/**
	 * The shared frame behind AreaChart, LineChart and BarChart: measuring,
	 * scales, axes, the hover and keyboard readout, the legend and the
	 * screen-reader table. Charts pass their marks as snippets of the layout.
	 * Ported from dithercn's `CartesianChart` (MIT).
	 */
	let {
		data,
		x,
		series,
		colors,
		scale,
		layout,
		height,
		axes,
		tooltip,
		legend,
		interactive,
		animate,
		cell,
		formatValue,
		formatTick = formatValue,
		readout,
		swatch,
		scrub: scrubKind,
		pointsAt,
		activeMarks,
		summary,
		marks,
		ariaLabel,
		class: className = ''
	}: {
		data: readonly T[];
		x: Accessor<T, string | number>;
		series: NonEmpty<ChartSeries<T>>;
		colors: readonly DitherColor[] | undefined;
		scale: Scale;
		layout: 'point' | 'band';
		height: number;
		axes: boolean;
		tooltip: boolean;
		legend: boolean;
		interactive: boolean;
		animate: boolean;
		cell?: number | undefined;
		formatValue: (value: number) => string;
		formatTick?: (value: number) => string;
		readout?: ((datum: T) => readonly ReadoutRow[]) | undefined;
		swatch: Snippet<[number, DitherColor]>;
		scrub: 'line' | 'column';
		pointsAt: (index: number, context: ChartContext) => readonly ScrubPoint[];
		activeMarks?: Snippet<[number, ChartContext]> | undefined;
		summary: string;
		marks: Snippet<[ChartContext]>;
		ariaLabel?: string | undefined;
		class?: string;
	} = $props();

	const messages = getUiMessages();
	const propsId = $props.id();
	const uid = svgId(propsId);
	const READOUT_GAP = 12;

	let root: HTMLDivElement;
	let readoutEl = $state<HTMLDivElement>();
	let measured = $state<{ width: number; baseCell: number; dpr: number } | null>(null);
	let reveal = $state(1);
	let hoveredSeries = $state<number | null>(null);
	let lockedSeries = $state<number | null>(null);
	let scrub = $state<{ index: number; glide: boolean; visible: boolean } | null>(null);

	$effect(() => {
		const read = (width: number) => {
			measured = { baseCell: readDitherCell(root), dpr: window.devicePixelRatio || 1, width };
		};
		const observer = new ResizeObserver(([entry]) => {
			if (entry) read(Math.floor(entry.contentRect.width));
		});
		observer.observe(root);
		const unsubscribe = subscribeToTheme(() => read(measured?.width ?? root.clientWidth));
		return () => {
			observer.disconnect();
			unsubscribe();
		};
	});

	// Entrance: 0 → 1 in whole dither steps once on screen; instant without motion.
	$effect(() => {
		if (!animate) {
			reveal = 1;
			return;
		}
		reveal = 0;
		const duration = (MOTION.slow + MOTION.base) / 1000;
		let loop: ReturnType<typeof createFrameLoop> | undefined;
		loop = createFrameLoop(
			(time) => {
				const linear = Math.min(1, time / duration);
				reveal = Math.round((1 - (1 - linear) ** 3) * 16) / 16;
				// Settled: hold the last frame instead of drawing forever.
				if (reveal >= 1) loop?.update({ enabled: false, stillTime: duration });
			},
			{ stillTime: duration, target: root }
		);
		return () => loop?.destroy();
	});

	const count = $derived(data.length);
	const width = $derived(measured?.width ?? 0);
	const frame = $derived(
		layoutPlot({ axes, count, formatTick, height, layout, scale, width })
	);
	const focus = $derived(interactive ? (hoveredSeries ?? lockedSeries) : null);
	const scrubbing = $derived(scrub?.visible === true);
	const colorOf = (index: number) => seriesColor(series[index]?.color, index, colors);

	const context = $derived<ChartContext | null>(
		measured === null
			? null
			: {
					animate,
					band: frame.band,
					cell: snapToDevice(cell ?? measured.baseCell, measured.dpr),
					colorOf,
					focus,
					height,
					opacityOf: (index) => (focus === null || focus === index ? 1 : DIMMED),
					plot: frame.plot,
					reveal,
					scrubbing,
					uid,
					width,
					xAt: frame.xAt,
					yAt: frame.yAt
				}
	);

	const rowsFor = (datum: T): readonly ReadoutRow[] =>
		readout?.(datum) ??
		series.map((entry, index) => ({
			color: colorOf(index),
			label: entry.label,
			value: formatValue(readValue(datum, entry.value))
		}));
	const tableRows = $derived(
		data.map((datum) => ({ label: readLabel(datum, x), values: rowsFor(datum) }))
	);
	const labels = $derived(series.map((entry) => entry.label));

	const view = $derived.by(() => {
		const glide = String(scrub?.glide ?? false);
		if (scrub === null || context === null) {
			return { activeRow: undefined, activeX: 0, anchorY: frame.plot.bottom, glide, points: [] as readonly ScrubPoint[] };
		}
		const points = pointsAt(scrub.index, context);
		return {
			activeRow: tableRows[scrub.index],
			activeX: frame.xAt(scrub.index),
			anchorY: Math.min(frame.plot.bottom, ...points.map((point) => point.y)),
			glide,
			points
		};
	});
	const showReadout = $derived(interactive && tooltip && scrubbing);
	const xShown = $derived(
		xLabelIndices(count, Math.ceil(count / Math.max(1, Math.floor(frame.plotWidth / 72))))
	);

	// Sit the readout above the highest marker, or beside the crosshair when there is no room.
	$effect(() => {
		const el = readoutEl;
		if (!el || !showReadout) return;
		const anchor = { top: frame.plot.top, width, x: view.activeX, y: view.anchorY };
		const { offsetWidth: w, offsetHeight: h } = el;
		const above = anchor.y - h - READOUT_GAP;
		let left = Math.min(Math.max(0, anchor.x - w / 2), Math.max(0, anchor.width - w));
		let top = above;
		if (above < 0) {
			const right = anchor.x + READOUT_GAP;
			left = right + w <= anchor.width ? right : anchor.x - READOUT_GAP - w;
			top = anchor.top;
		}
		el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
	});

	let pointerX: number | null = null;
	let pointerFrame = 0;
	const indexAt = (px: number) => {
		const offset = (px - frame.plot.left) / frame.band;
		const raw = layout === 'band' ? Math.floor(offset) : Math.round(offset);
		return Math.min(count - 1, Math.max(0, raw));
	};
	const hide = () => {
		if (scrub) scrub = { ...scrub, glide: false, visible: false };
	};
	const onpointermove = (event: PointerEvent) => {
		if (count === 0) return;
		pointerX = event.clientX - (event.currentTarget as HTMLElement).getBoundingClientRect().left;
		if (pointerFrame !== 0) return;
		pointerFrame = requestAnimationFrame(() => {
			pointerFrame = 0;
			if (pointerX === null) return;
			const index = indexAt(pointerX);
			if (scrub?.index === index && scrub.visible) return;
			scrub = { glide: scrub?.visible === true, index, visible: true };
		});
	};
	const onpointerleave = () => {
		pointerX = null;
		cancelAnimationFrame(pointerFrame);
		pointerFrame = 0;
		hide();
	};
	const jumpTo = (index: number) => {
		scrub = { glide: false, index: Math.min(count - 1, Math.max(0, index)), visible: true };
	};
	const onkeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			hide();
			lockedSeries = null;
			return;
		}
		if (count === 0) return;
		const current = scrub?.index ?? count - 1;
		const page = Math.max(1, Math.round(count / 10));
		const targets: Record<string, number> = {
			ArrowLeft: current - 1,
			ArrowRight: current + 1,
			End: count - 1,
			Home: 0,
			PageDown: current + page,
			PageUp: current - page
		};
		const target = targets[event.key];
		if (target === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		jumpTo(target);
	};
	const onfocus = () => {
		if (scrub?.visible) return;
		scrub = { glide: false, index: scrub?.index ?? count - 1, visible: true };
	};
	$effect(() => () => cancelAnimationFrame(pointerFrame));
</script>

<div class="cartesian {className}">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (an interactive chart is a focusable group with arrow-key scrubbing) -->
	<div
		bind:this={root}
		class="cartesian-root"
		style:height="{height}px"
		role={interactive ? 'group' : 'img'}
		aria-label={ariaLabel ?? summary}
		aria-roledescription={interactive ? 'chart' : undefined}
		aria-describedby={interactive ? `${uid}-keys` : undefined}
		tabindex={interactive && count > 0 ? 0 : undefined}
		onpointermove={interactive ? onpointermove : undefined}
		onpointerleave={interactive ? onpointerleave : undefined}
		onkeydown={interactive ? onkeydown : undefined}
		onfocus={interactive ? onfocus : undefined}
		onblur={interactive ? hide : undefined}
	>
		{#if context}
			<svg aria-hidden="true" {width} {height} viewBox="0 0 {width} {height}" class="cartesian-svg">
				{#if axes}
					<g>
						{#each scale.ticks as tick, index (tick)}
							<line
								x1={frame.plot.left}
								x2={frame.plot.right}
								y1={Math.round(frame.yAt(tick)) + 0.5}
								y2={Math.round(frame.yAt(tick)) + 0.5}
								class="grid"
								stroke-width="1"
								shape-rendering="crispEdges"
							/>
							<text x={frame.plot.left - 10} y={frame.yAt(tick)} dy="0.32em" text-anchor="end" class="tick"
								>{frame.tickLabels[index]}</text
							>
						{/each}
						{#each data as datum, index (index)}
							{#if xShown.has(index)}
								<text
									x={frame.xAt(index)}
									y={height - 6}
									text-anchor={labelAnchor(layout, index, count)}
									class="tick">{readLabel(datum, x)}</text
								>
							{/if}
						{/each}
					</g>
				{/if}
				{#if interactive && scrubKind === 'column'}
					<rect
						data-glide={view.glide}
						x={-frame.band / 2}
						y={frame.plot.top}
						width={frame.band}
						height={frame.plot.bottom - frame.plot.top}
						class="column dither-glide"
						style:opacity={scrubbing ? 1 : 0}
						style:transform="translateX({view.activeX}px)"
					/>
				{/if}
				{@render marks(context)}
				{#if scrubbing && scrub && activeMarks}
					{@render activeMarks(scrub.index, context)}
				{/if}
				{#if interactive && scrubKind === 'line'}
					<g aria-hidden="true">
						<line
							data-glide={view.glide}
							x1="0.5"
							x2="0.5"
							y1={frame.plot.top}
							y2={frame.plot.bottom}
							class="crosshair dither-glide"
							stroke-width="1"
							stroke-dasharray="2 3"
							style:opacity={scrubbing ? 1 : 0}
							style:transform="translateX({Math.round(view.activeX)}px)"
						/>
						{#each labels as label, index (label)}
							{@const point = view.points.find((candidate) => candidate.seriesIndex === index)}
							<circle
								data-glide={view.glide}
								r="4"
								fill={cssColor(colorOf(index))}
								stroke="var(--dither-paper)"
								stroke-width="2"
								class="dither-glide"
								style:opacity={point === undefined || !scrubbing ? 0 : context.opacityOf(index)}
								style:transform="translate({view.activeX}px, {point?.y ?? view.anchorY}px)"
							/>
						{/each}
					</g>
				{/if}
			</svg>
		{/if}
		{#if interactive && tooltip}
			<div
				bind:this={readoutEl}
				aria-hidden="true"
				data-glide={view.glide}
				data-slot="chart-readout"
				class="dither-readout dither-glide"
				style:opacity={showReadout ? 1 : 0}
			>
				{#if view.activeRow}
					<div class="dither-readout-label">{view.activeRow.label}</div>
					<div class="dither-readout-rows">
						{#each view.activeRow.values as value, index (value.label)}
							<div class="dither-readout-row" class:dim={focus !== null && focus !== index}>
								<span class="dither-swatch" style:background={cssColor(value.color)}></span>
								<span class="dither-readout-name">{value.label}</span>
								<span class="dither-readout-value">{value.value}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
	{#if legend}
		<div
			class="legend"
			role={interactive ? 'group' : undefined}
			aria-label={interactive ? messages.chart_series() : undefined}
			aria-hidden={interactive ? undefined : 'true'}
		>
			{#each labels as label, index (label)}
				{#if interactive}
					<button
						type="button"
						class="dither-legend-item interactive"
						class:dim={focus !== null && focus !== index}
						aria-pressed={lockedSeries === index}
						aria-label={messages.chart_spotlight(label)}
						onpointerenter={() => (hoveredSeries = index)}
						onpointerleave={() => (hoveredSeries = null)}
						onfocus={() => (hoveredSeries = index)}
						onblur={() => (hoveredSeries = null)}
						onclick={() => (lockedSeries = lockedSeries === index ? null : index)}
						onkeydown={(event) => {
							if (event.key === 'Escape') lockedSeries = null;
						}}>{@render swatch(index, colorOf(index))}{label}</button
					>
				{:else}
					<span class="dither-legend-item" class:dim={focus !== null && focus !== index}
						>{@render swatch(index, colorOf(index))}{label}</span
					>
				{/if}
			{/each}
		</div>
	{/if}
	{#if interactive}
		<p id="{uid}-keys" class="dither-sr-only">{messages.chart_keyboard_help()}</p>
		<div aria-live="polite" aria-atomic="true" class="dither-sr-only">
			{scrubbing && view.activeRow
				? `${view.activeRow.label}: ${view.activeRow.values.map((value) => `${value.label} ${value.value}`).join(', ')}`
				: ''}
		</div>
	{/if}
	<div class="dither-sr-only">
		<table>
			<caption>{summary}</caption>
			<thead>
				<tr>
					<th scope="col">{messages.chart_category()}</th>
					{#each series as entry (entry.label)}<th scope="col">{entry.label}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each tableRows as row, index (index)}
					<tr>
						<th scope="row">{row.label}</th>
						{#each row.values as value (value.label)}<td>{value.value}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.cartesian {
		position: relative;
		width: 100%;
	}
	.cartesian-root {
		position: relative;
		width: 100%;
		touch-action: pan-y;
		border-radius: 0.125rem;
		outline: none;
	}
	.cartesian-root:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	.cartesian-svg {
		display: block;
		overflow: visible;
		user-select: none;
	}
	.grid {
		stroke: var(--border);
	}
	.tick {
		fill: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.column {
		fill: color-mix(in oklch, var(--foreground) 6%, transparent);
	}
	.crosshair {
		stroke: color-mix(in oklch, var(--foreground) 35%, transparent);
	}
	.legend {
		margin-top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
</style>
