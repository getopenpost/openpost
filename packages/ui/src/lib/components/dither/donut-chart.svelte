<script lang="ts" module>
	import type { DitherColor as SliceColor, FillVariant as SliceFill } from '@openpost/dither/engine';

	export interface DonutSlice {
		/** Name in the legend, the centre and the data table. */
		label: string;
		/** Size of the slice. Negative values count as 0. */
		value: number;
		color?: SliceColor;
		fill?: SliceFill;
		/** Stable identity for keyed rendering. Default the label. */
		key?: string;
	}
</script>

<script lang="ts">
	import './chart.css';
	import { createFrameLoop, cssColor, MOTION, readDitherCell, SERIES_COLORS, subscribeToTheme, thresholdAt } from '@openpost/dither/engine';
	import type { Bloom, DitherColor, DitherMatrix, FillVariant } from '@openpost/dither/engine';
	import type { Snippet } from 'svelte';
	import { getUiMessages } from '../../messages.js';
	import BloomGroup from './bloom-group.svelte';
	import { svgId, themeFill } from './dither-context.svelte.js';

	/**
	 * A donut or pie chart drawn in dither cells. Each slice takes a colour and
	 * a texture inside a solid outline. Hover a slice or its legend row to
	 * spotlight it, click to keep it lit, and focus the chart to step through
	 * slices with the arrow keys. Ported from dithercn's `donut-chart` (MIT).
	 */
	let {
		data,
		label,
		mode = 'donut',
		fill: fillProp,
		bloom = 'off',
		colors,
		size = 220,
		thickness = 0.36,
		gap = 1,
		format,
		legend = true,
		legendLabel,
		interactive = true,
		animate = false,
		matrix = 'bayer4',
		cell,
		locale,
		summary: summaryText,
		class: className = '',
		testId
	}: {
		data: readonly DonutSlice[];
		/** What the total counts, such as "Followers". */
		label: string;
		mode?: 'donut' | 'pie';
		fill?: FillVariant;
		bloom?: Bloom;
		colors?: readonly DitherColor[];
		/** Diameter in CSS pixels. Default 220. */
		size?: number;
		/** Ring thickness as a share of the radius. Default 0.36. */
		thickness?: number;
		/** Gap between slices, in dither cells. Default 1. */
		gap?: number;
		format?: (value: number) => string;
		legend?: boolean;
		/** Custom legend label, such as an account identity. Default the slice label. */
		legendLabel?: Snippet<[DonutSlice, number]>;
		interactive?: boolean;
		animate?: boolean;
		matrix?: DitherMatrix;
		cell?: number;
		locale?: string;
		summary?: string;
		class?: string;
		testId?: string;
	} = $props();

	const fill = $derived(fillProp ?? themeFill());

	const messages = getUiMessages();
	const propsId = $props.id();
	const uid = svgId(propsId);
	const TAU = Math.PI * 2;
	const POP = 2;
	const DIMMED = 0.18;
	const FLOOR = 3 / 16;
	const PIE_FLOOR = 6 / 16;
	const SWEEP_SECONDS = (MOTION.slow + MOTION.base * 2) / 1000;
	const SWEEP_STEPS = 60;

	type SliceGeometry = {
		index: number;
		label: string;
		value: number;
		share: number;
		color: DitherColor;
		fill: FillVariant;
		from: number;
		to: number;
	};
	type Cell = { x: number; y: number; slice: number; angle: number };
	type Raster = { side: number; outer: number; inner: number; cells: readonly Cell[] };

	let root: HTMLElement;
	let baseCell = $state(2);
	let dpr = $state(1);
	let sweep = $state(TAU);
	let hovered = $state<number | null>(null);
	let locked = $state<number | null>(null);

	$effect(() => {
		const read = () => {
			baseCell = readDitherCell(root);
			dpr = window.devicePixelRatio || 1;
		};
		read();
		return subscribeToTheme(read);
	});
	const cellSize = $derived(Math.max(1, Math.round((cell ?? baseCell) * dpr)) / dpr);

	const formatValue = $derived(
		format ?? ((value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value))
	);
	const percent = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 1, style: 'percent' }));

	const geometry = $derived.by(() => {
		const values = data.map(({ value }) => (Number.isFinite(value) ? Math.max(0, value) : 0));
		const total = values.reduce((sum, value) => sum + value, 0);
		let angle = 0;
		const slices: SliceGeometry[] = data.map((slice, index) => {
			const value = values[index] ?? 0;
			const share = total > 0 ? value / total : 0;
			const from = angle;
			angle += share * TAU;
			return {
				color: slice.color ?? colors?.[index] ?? SERIES_COLORS[index % SERIES_COLORS.length] ?? 'ink',
				fill: slice.fill ?? fill,
				from,
				index,
				label: slice.label,
				share,
				to: angle,
				value
			};
		});
		return { slices, total };
	});

	/** Angle of a point from the centre, clockwise from 12 o'clock, in [0, 2π). */
	const angleOf = (dx: number, dy: number) => {
		const raw = Math.atan2(dx, -dy);
		return raw < 0 ? raw + TAU : raw;
	};
	const nearEdge = (dx: number, dy: number, angle: number, half: number) => {
		const sx = Math.sin(angle);
		const sy = -Math.cos(angle);
		const along = dx * sx + dy * sy;
		return along > -half && Math.abs(dx * sy - dy * sx) < half;
	};
	const sliceAt = (dx: number, dy: number, slices: readonly SliceGeometry[], gapCells: number) => {
		const angle = angleOf(dx, dy);
		const shown = slices.filter((slice) => slice.share > 0);
		const owner = shown.find((slice) => angle >= slice.from && angle < slice.to);
		if (owner === undefined) return { edge: false, index: -1 };
		if (shown.length < 2) return { edge: false, index: owner.index };
		const half = gapCells / 2;
		const near = (reach: number) => shown.some((slice) => nearEdge(dx, dy, slice.from, reach));
		if (gapCells > 0 && near(half)) return { edge: false, index: -1 };
		return { edge: near(half + 1), index: owner.index };
	};
	const inked = (sliceFill: FillVariant, x: number, y: number, depth: number, outline: boolean, floor: number) => {
		// Every texture is drawn inside a solid outline, like the capped bars.
		if (sliceFill === 'solid' || outline) return true;
		if (sliceFill === 'dotted') return y % 2 === 0 && (x + y / 2) % 2 === 0;
		if (sliceFill === 'hatched') return (x + y) % 4 === 3;
		const level = floor + (1 - floor) * (1 - depth) ** 1.4;
		return level > thresholdAt(matrix, x, y);
	};

	const raster = $derived.by((): Raster => {
		const slices = geometry.slices;
		const side = Math.max(8, Math.floor(size / cellSize));
		const outer = side / 2 - POP;
		const ring = Math.min(0.9, Math.max(0.1, thickness));
		const inner = mode === 'pie' ? 0 : Math.round(outer * (1 - ring));
		const cells: Cell[] = [];
		for (let y = 0; y < side; y += 1) {
			for (let x = 0; x < side; x += 1) {
				const dx = x + 0.5 - side / 2;
				const dy = y + 0.5 - side / 2;
				const radius = Math.hypot(dx, dy);
				if (radius < outer && radius >= inner) {
					const hit = sliceAt(dx, dy, slices, gap);
					const slice = slices[hit.index];
					const depth = (outer - radius) / Math.max(1, outer - inner);
					const outline = outer - radius < 1 || (inner > 0 && radius - inner < 1) || hit.edge;
					if (slice && inked(slice.fill, x, y, depth, outline, mode === 'pie' ? PIE_FLOOR : FLOOR)) {
						cells.push({ angle: angleOf(dx, dy), slice: hit.index, x, y });
					}
				}
			}
		}
		return { cells, inner, outer, side };
	});

	const paths = $derived.by(() => {
		const result = Array.from({ length: geometry.slices.length }, () => '');
		let run: { x: number; y: number; slice: number; length: number } | null = null;
		const flush = () => {
			if (run !== null) result[run.slice] += `M${run.x} ${run.y}h${run.length}v1h${-run.length}z`;
		};
		for (const point of raster.cells) {
			if (point.angle > sweep) continue;
			if (run !== null && run.y === point.y && run.slice === point.slice && run.x + run.length === point.x) {
				run.length += 1;
			} else {
				flush();
				run = { length: 1, slice: point.slice, x: point.x, y: point.y };
			}
		}
		flush();
		return result;
	});

	// Entrance: slices sweep in clockwise once on screen. Off by default in the product.
	$effect(() => {
		if (!animate) {
			sweep = TAU;
			return;
		}
		sweep = 0;
		let loop: ReturnType<typeof createFrameLoop> | undefined;
		loop = createFrameLoop(
			(time) => {
				const linear = Math.min(1, time / SWEEP_SECONDS);
				const eased = 1 - (1 - linear) ** 3;
				sweep = linear >= 1 ? TAU : (Math.round(eased * SWEEP_STEPS) / SWEEP_STEPS) * TAU;
				if (sweep >= TAU) loop?.update({ enabled: false, stillTime: SWEEP_SECONDS });
			},
			{ stillTime: SWEEP_SECONDS, target: root }
		);
		return () => loop?.destroy();
	});

	const focus = $derived(interactive ? (hovered ?? locked) : null);
	const active = $derived(focus === null ? undefined : geometry.slices[focus]);
	const drawn = $derived(raster.side * cellSize);
	const summary = $derived(
		summaryText ??
			`${mode === 'pie' ? 'Pie' : 'Donut'} chart of ${label}: ${formatValue(geometry.total)} in total across ${geometry.slices.length} slices.`
	);
	const centreDiameter = $derived(raster.inner * 2 * cellSize);
	const valueText = $derived(formatValue(active?.value ?? geometry.total));
	const valueSize = $derived(
		Math.round(Math.max(14, Math.min(centreDiameter * 0.19, (centreDiameter * 0.78) / (valueText.length * 0.6))))
	);

	const popOffset = (slice: SliceGeometry) => {
		const middle = (slice.from + slice.to) / 2;
		return {
			x: Math.round(Math.sin(middle) * POP) * cellSize,
			y: Math.round(-Math.cos(middle) * POP) * cellSize
		};
	};

	let pointerFrame = 0;
	let pointer: { x: number; y: number } | null = null;
	const sliceFor = (x: number, y: number) => {
		const dx = x / cellSize - raster.side / 2;
		const dy = y / cellSize - raster.side / 2;
		const radius = Math.hypot(dx, dy);
		if (radius > raster.outer + POP || radius < raster.inner - 1) return null;
		const { index } = sliceAt(dx, dy, geometry.slices, 0);
		return index === -1 ? null : index;
	};
	const onpointermove = (event: PointerEvent) => {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
		if (pointerFrame !== 0) return;
		pointerFrame = requestAnimationFrame(() => {
			pointerFrame = 0;
			if (pointer !== null) hovered = sliceFor(pointer.x, pointer.y);
		});
	};
	const onpointerleave = () => {
		pointer = null;
		cancelAnimationFrame(pointerFrame);
		pointerFrame = 0;
		hovered = null;
	};
	const onclick = (event: MouseEvent) => {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const hit = sliceFor(event.clientX - box.left, event.clientY - box.top);
		locked = hit === locked ? null : hit;
	};
	const onkeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			hovered = null;
			locked = null;
			return;
		}
		const shown = geometry.slices.filter((slice) => slice.share > 0).map((slice) => slice.index);
		if (shown.length === 0) return;
		const position = focus === null ? -1 : shown.indexOf(focus);
		const steps: Record<string, number> = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 };
		const step = steps[event.key];
		let next: number | undefined;
		if (step !== undefined) next = shown[position === -1 ? 0 : (position + step + shown.length) % shown.length];
		else if (event.key === 'Home') next = shown[0];
		else if (event.key === 'End') next = shown.at(-1);
		else if (event.key === 'Enter' || event.key === ' ') locked = locked === focus ? null : focus;
		else return;
		event.preventDefault();
		event.stopPropagation();
		if (next !== undefined) hovered = next;
	};
	$effect(() => () => cancelAnimationFrame(pointerFrame));
</script>

<figure bind:this={root} class="donut {className}" data-testid={testId}>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (an interactive chart is a focusable group with arrow-key scrubbing) -->
	<div
		class="donut-chart"
		style:width="{drawn}px"
		style:height="{drawn}px"
		role={interactive ? 'group' : 'img'}
		aria-label={summary}
		aria-roledescription={interactive ? 'chart' : undefined}
		aria-describedby={interactive ? `${uid}-keys` : undefined}
		tabindex={interactive ? 0 : undefined}
		onkeydown={interactive ? onkeydown : undefined}
		onblur={interactive ? () => (hovered = null) : undefined}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<svg
			aria-hidden="true"
			width={drawn}
			height={drawn}
			viewBox="0 0 {drawn} {drawn}"
			class:pointer={interactive}
			onpointermove={interactive ? onpointermove : undefined}
			onpointerleave={interactive ? onpointerleave : undefined}
			onclick={interactive ? onclick : undefined}
		>
			<BloomGroup {bloom} transform="scale({cellSize})">
				{#each geometry.slices as slice (slice.index)}
					<path d={paths[slice.index]} fill={cssColor(slice.color)} opacity={focus === null || focus === slice.index ? 1 : DIMMED} />
				{/each}
			</BloomGroup>
			{#each geometry.slices as slice (slice.index)}
				{@const offset = focus === slice.index ? popOffset(slice) : { x: 0, y: 0 }}
				<g
					class="dither-glide"
					style:opacity={focus === null || focus === slice.index ? 1 : DIMMED}
					style:transform="translate({offset.x}px, {offset.y}px)"
				>
					<path d={paths[slice.index]} transform="scale({cellSize})" fill={cssColor(slice.color)} shape-rendering="crispEdges" />
				</g>
			{/each}
		</svg>
		{#if mode === 'donut'}
			<div aria-hidden="true" class="centre">
				<div class="centre-stack" style:max-width="{centreDiameter * 0.86}px">
					<span class="centre-label">
						{#if active}<span class="swatch" style:background={cssColor(active.color)}></span>{/if}
						<span class="truncate">{active?.label ?? label}</span>
					</span>
					<span class="centre-value" style:font-size="{valueSize}px">{valueText}</span>
					<span class="centre-share">{active === undefined ? '100%' : percent.format(active.share)}</span>
				</div>
			</div>
		{/if}
	</div>
	{#if interactive}
		<p id="{uid}-keys" class="dither-sr-only">{messages.chart_slice_keyboard_help()}</p>
		<div aria-live="polite" aria-atomic="true" class="dither-sr-only">
			{active === undefined ? '' : `${active.label}: ${formatValue(active.value)}, ${percent.format(active.share)}`}
		</div>
	{/if}
	<div class="dither-sr-only">
		<table>
			<caption>{summary}</caption>
			<thead>
				<tr>
					<th scope="col">{messages.chart_slices()}</th>
					<th scope="col">{messages.chart_value()}</th>
					<th scope="col">{messages.chart_share()}</th>
				</tr>
			</thead>
			<tbody>
				{#each geometry.slices as slice (slice.index)}
					<tr>
						<th scope="row">{slice.label}</th>
						<td>{formatValue(slice.value)}</td>
						<td>{percent.format(slice.share)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<figcaption class="contents">
		<div
			class="legend"
			class:dither-sr-only={!legend}
			role={interactive ? 'group' : undefined}
			aria-label={interactive ? messages.chart_slices() : undefined}
			aria-hidden={interactive ? undefined : 'true'}
		>
			{#each geometry.slices as slice (data[slice.index]?.key ?? slice.label)}
				{#snippet row()}
					<span class="legend-swatch" style:background={cssColor(slice.color)}></span>
					<span class="legend-label">
						{#if legendLabel && data[slice.index]}{@render legendLabel(data[slice.index]!, slice.index)}{:else}{slice.label}{/if}
					</span>
					<span class="legend-value">{formatValue(slice.value)}</span>
					<span class="legend-share">{percent.format(slice.share)}</span>
				{/snippet}
				{#if interactive}
					<button
						type="button"
						class="legend-row interactive"
						class:dim={focus !== null && focus !== slice.index}
						aria-pressed={locked === slice.index}
						onpointerenter={() => (hovered = slice.index)}
						onpointerleave={() => (hovered = null)}
						onfocus={() => (hovered = slice.index)}
						onblur={() => (hovered = null)}
						onclick={() => (locked = locked === slice.index ? null : slice.index)}
						onkeydown={(event) => {
							if (event.key === 'Escape') locked = null;
						}}>{@render row()}</button
					>
				{:else}
					<div class="legend-row" class:dim={focus !== null && focus !== slice.index}>{@render row()}</div>
				{/if}
			{/each}
		</div>
	</figcaption>
</figure>

<style>
	.donut {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1.5rem 2.5rem;
		margin: 0;
	}
	.donut-chart {
		position: relative;
		flex-shrink: 0;
		border-radius: 9999px;
		outline: none;
	}
	.donut-chart:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	svg {
		display: block;
		overflow: visible;
	}
	svg.pointer {
		cursor: pointer;
	}
	.centre {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		text-align: center;
	}
	.centre-stack {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}
	.centre-label {
		display: flex;
		max-width: 100%;
		align-items: center;
		gap: 0.375rem;
		color: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.swatch {
		width: 0.5rem;
		height: 0.5rem;
		flex-shrink: 0;
		border-radius: 2px;
	}
	.centre-value {
		color: var(--foreground);
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.centre-share {
		color: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.contents {
		display: contents;
	}
	.legend {
		display: flex;
		width: 100%;
		max-width: 28rem;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
	}
	@media (min-width: 640px) {
		.legend {
			width: auto;
			/* Wide enough for an account name; narrower boxes put the legend under the chart. */
			min-width: 17rem;
			flex: 1;
		}
	}
	.legend-row {
		display: flex;
		min-height: 2.25rem;
		width: 100%;
		align-items: center;
		gap: 0.75rem;
		border-radius: 0.375rem;
		padding: 0 0.5rem;
		transition:
			opacity 150ms ease-out,
			background-color 150ms ease-out;
	}
	.legend-row.dim {
		opacity: 0.45;
	}
	.legend-row.interactive {
		cursor: pointer;
		outline: none;
	}
	.legend-row.interactive:hover {
		background: color-mix(in oklch, var(--muted) 60%, transparent);
	}
	.legend-row.interactive[aria-pressed='true'] {
		background: var(--muted);
	}
	.legend-row.interactive:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	.legend-swatch {
		width: 0.625rem;
		height: 0.625rem;
		flex-shrink: 0;
		border-radius: 2px;
	}
	.legend-label {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		color: var(--foreground);
		font-size: 0.875rem;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.legend-value {
		color: var(--foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.legend-share {
		width: 3rem;
		color: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
