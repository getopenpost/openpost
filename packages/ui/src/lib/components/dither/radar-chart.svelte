<script lang="ts" module>
	import type { DitherColor as SeriesColor, FillVariant as SeriesFill } from '@openpost/dither/engine';

	export interface RadarSeries {
		label: string;
		/** One value per axis, in the order of `axes`. Missing values count as 0. */
		values: readonly number[];
		/** Readout text per axis, such as "38% · 4.1K". Default the formatted value. */
		details?: readonly string[];
		color?: SeriesColor;
		fill?: SeriesFill;
	}
</script>

<script lang="ts">
	import './chart.css';
	import { createFrameLoop, cssColor, MOTION, readDitherCell, SERIES_COLORS, subscribeToTheme, thresholdAt } from '@openpost/dither/engine';
	import type { Bloom, DitherColor, DitherMatrix, FillVariant } from '@openpost/dither/engine';
	import { getUiMessages } from '../../messages.js';
	import BloomGroup from './bloom-group.svelte';
	import { listLabels, snapToDevice } from './cartesian.js';
	import { svgId, themeFill } from './dither-context.svelte.js';

	/**
	 * A radar chart drawn in dither cells. Each series is a polygon of whole
	 * cells with a solid outline; the gradient steps up ring by ring so the grid
	 * reads through it, and overlapping series interleave. Ported from
	 * dithercn's `radar-chart` (MIT).
	 */
	let {
		axes,
		series,
		max,
		rings = 4,
		grid = 'polygon',
		fill: fillProp,
		bloom = 'off',
		colors,
		size = 360,
		format,
		locale,
		legend,
		interactive = true,
		animate = false,
		matrix = 'bayer4',
		cell,
		summary: summaryText,
		class: className = '',
		testId
	}: {
		/** Axis labels, clockwise from 12 o'clock. */
		axes: readonly [string, ...string[]];
		series: readonly [RadarSeries, ...RadarSeries[]];
		max?: number;
		rings?: number;
		grid?: 'polygon' | 'circle';
		fill?: FillVariant;
		bloom?: Bloom;
		colors?: readonly DitherColor[];
		/** Largest side in CSS pixels; shrinks to fit. Default 360. */
		size?: number;
		format?: (value: number) => string;
		locale?: string;
		legend?: boolean;
		interactive?: boolean;
		animate?: boolean;
		matrix?: DitherMatrix;
		cell?: number;
		summary?: string;
		class?: string;
		testId?: string;
	} = $props();

	const fill = $derived(fillProp ?? themeFill());

	const messages = getUiMessages();
	const propsId = $props.id();
	const uid = svgId(propsId);
	const TAU = Math.PI * 2;
	const AXIS_CHAR = 6.1;
	const DIMMED = 0.18;
	const GROW_SECONDS = (MOTION.slow + MOTION.base) / 1000;
	const GROW_STEPS = 24;
	const NICE = [1, 2, 2.5, 5, 10];

	type Vec = { x: number; y: number };
	type Shape = {
		index: number;
		label: string;
		color: DitherColor;
		fill: FillVariant;
		values: readonly number[];
		details: readonly string[] | undefined;
		vertices: readonly Vec[];
	};

	let host: HTMLDivElement;
	let box = $state({ baseCell: 2, dpr: 1, width: 0 });
	let scale = $state(1);
	let hovered = $state<number | null>(null);
	let locked = $state<number | null>(null);
	let scrub = $state<{ axis: number; glide: boolean; visible: boolean } | null>(null);
	let readoutEl = $state<HTMLDivElement>();

	$effect(() => {
		const read = (width: number) => {
			box = { baseCell: readDitherCell(host), dpr: window.devicePixelRatio || 1, width };
		};
		const observer = new ResizeObserver(([entry]) => read(Math.floor(entry?.contentRect.width ?? 0)));
		observer.observe(host);
		const unsubscribe = subscribeToTheme(() => read(box.width || host.clientWidth));
		return () => {
			observer.disconnect();
			unsubscribe();
		};
	});

	$effect(() => {
		if (!animate) {
			scale = 1;
			return;
		}
		scale = 0;
		let loop: ReturnType<typeof createFrameLoop> | undefined;
		loop = createFrameLoop(
			(time) => {
				const linear = Math.min(1, time / GROW_SECONDS);
				scale = Math.round((1 - (1 - linear) ** 3) * GROW_STEPS) / GROW_STEPS;
				if (scale >= 1) loop?.update({ enabled: false, stillTime: GROW_SECONDS });
			},
			{ stillTime: GROW_SECONDS, target: host }
		);
		return () => loop?.destroy();
	});

	const formatValue = $derived(
		format ??
			((value: number) =>
				new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' }).format(value))
	);
	const cellSize = $derived(snapToDevice(cell ?? box.baseCell, box.dpr));
	const side = $derived(Math.min(size, box.width));
	// Side labels need their full width beside the plot; long localized labels shrink the radius.
	const labelRoom = $derived(
		Math.min(side * 0.32, Math.max(40, Math.max(...axes.map((label) => label.length)) * AXIS_CHAR + 16))
	);
	const radius = $derived(Math.max(0, side / 2 - labelRoom));
	/** Top and bottom labels are one line tall, so the box only needs that much above and below. */
	const VERTICAL_ROOM = 30;
	const plotHeight = $derived(side > 0 ? Math.round(radius * 2 + VERTICAL_ROOM * 2) : 0);
	const ringCount = $derived(Math.max(1, Math.round(rings)));
	const top = $derived.by(() => {
		if (max !== undefined) return max;
		const value = Math.max(...series.flatMap((entry) => entry.values));
		if (value <= 0) return 1;
		const magnitude = 10 ** Math.floor(Math.log10(value));
		return (NICE.find((candidate) => candidate * magnitude >= value) ?? 10) * magnitude;
	});

	const polar = (angle: number, distance: number): Vec => ({ x: Math.sin(angle) * distance, y: -Math.cos(angle) * distance });
	const angleOf = ({ x, y }: Vec) => {
		const raw = Math.atan2(x, -y);
		return raw < 0 ? raw + TAU : raw;
	};
	const edgeRadius = (angle: number, a: Vec, b: Vec) => {
		const d = polar(angle, 1);
		const ex = b.x - a.x;
		const ey = b.y - a.y;
		const denominator = d.x * ey - d.y * ex;
		if (Math.abs(denominator) < 1e-9) return Math.hypot(a.x, a.y);
		return (a.x * ey - a.y * ex) / denominator;
	};

	const shapes = $derived.by((): Shape[] => {
		const step = TAU / axes.length;
		return series.map((entry, index) => {
			const values = axes.map((_, axis) => {
				const raw = entry.values[axis] ?? 0;
				return Number.isFinite(raw) ? Math.max(0, raw) : 0;
			});
			return {
				color: entry.color ?? colors?.[index] ?? SERIES_COLORS[index % SERIES_COLORS.length] ?? 'ink',
				details: entry.details,
				fill: entry.fill ?? fill,
				index,
				label: entry.label,
				values,
				vertices: values.map((value, axis) => polar(axis * step, (Math.min(value, top) / top) * radius))
			};
		});
	});

	const inked = (shapeFill: FillVariant, x: number, y: number, band: number, outline: boolean) => {
		if (shapeFill === 'solid' || outline) return true;
		if (shapeFill === 'dotted') return y % 2 === 0 && (x + y / 2) % 2 === 0;
		if (shapeFill === 'hatched') return (x + y) % 4 === 3;
		// Terraces: one density per ring band, thin at the centre, dense outside.
		const level = 1 / 16 + (11 / 16) * (band / ringCount) ** 1.4;
		return level > thresholdAt(matrix, x, y);
	};

	const paths = $derived.by(() => {
		if (side <= 0) return shapes.map(() => '');
		const columns = Math.floor(side / cellSize);
		const rowCount = Math.floor(plotHeight / cellSize);
		const centre = side / 2;
		const middle = plotHeight / 2;
		const result = shapes.map(() => '');
		const count = shapes[0]?.vertices.length ?? 0;
		const step = TAU / Math.max(1, count);
		for (let y = 0; y < rowCount; y += 1) {
			for (let x = 0; x < columns; x += 1) {
				const point = { x: (x + 0.5) * cellSize - centre, y: (y + 0.5) * cellSize - middle };
				const distance = Math.hypot(point.x, point.y);
				if (distance > radius * scale + cellSize) continue;
				const angle = angleOf(point);
				const segment = Math.floor(angle / step) % count;
				const band = Math.max(1, Math.ceil((distance / (radius * Math.max(scale, 1e-6))) * ringCount));
				const covering: { shape: Shape; outline: boolean }[] = [];
				for (const shape of shapes) {
					const a = shape.vertices[segment] ?? { x: 0, y: 0 };
					const b = shape.vertices[(segment + 1) % count] ?? { x: 0, y: 0 };
					const reach = edgeRadius(angle, a, b) * scale;
					if (distance < reach) {
						// Distance to the edge itself, so shallow edges keep a full outline.
						const ex = (b.x - a.x) * scale;
						const ey = (b.y - a.y) * scale;
						const length = Math.hypot(ex, ey);
						const across =
							length < 1e-6
								? reach - distance
								: Math.abs(ex * (point.y - a.y * scale) - ey * (point.x - a.x * scale)) / length;
						covering.push({ outline: across < cellSize, shape });
					}
				}
				// Outlines win; overlapping fills interleave along a diagonal.
				let outlined: (typeof covering)[number] | undefined;
				for (const cover of covering) if (cover.outline) outlined = cover;
				const owner =
					outlined !== undefined || covering.length < 2 ? (outlined ?? covering[0]) : covering[(x + y * 2) % covering.length];
				if (owner && inked(owner.shape.fill, x, y, band, owner.outline)) {
					result[owner.shape.index] += `M${x} ${y}h1v1h-1z`;
				}
			}
		}
		return result;
	});

	const focus = $derived(interactive ? (hovered ?? locked) : null);
	const opacityOf = (index: number) => (focus === null || focus === index ? 1 : DIMMED);
	const scrubbing = $derived(interactive && scrub?.visible === true);
	const axis = $derived(scrub?.axis ?? 0);
	const activeAxis = $derived(scrubbing ? axis : null);
	const summary = $derived(
		summaryText ??
			`Radar chart of ${listLabels(series.map((entry) => entry.label))} across ${axes.length} axes, from 0 to ${formatValue(top)}.`
	);
	const rows = $derived(
		shapes.map((shape) => ({
			color: shape.color,
			label: shape.label,
			value: shape.details?.[axis] ?? formatValue(shape.values[axis] ?? 0)
		}))
	);
	const marker = $derived(Math.max(4, cellSize * 2));
	const labelAnchor = (angle: number) => {
		const sin = Math.sin(angle);
		return sin > 0.3 ? 'start' : sin < -0.3 ? 'end' : 'middle';
	};

	$effect(() => {
		const el = readoutEl;
		if (!el || !scrubbing) return;
		const angle = (axis * TAU) / axes.length;
		const tip = polar(angle, radius);
		const anchor = { x: side / 2 + tip.x, y: plotHeight / 2 + tip.y };
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		let left = anchor.x - w / 2 + Math.sin(angle) * (w / 2 + 14);
		let topPx = anchor.y - h / 2 - Math.cos(angle) * (h / 2 + 14);
		left = Math.min(Math.max(0, left), Math.max(0, side - w));
		topPx = Math.min(Math.max(0, topPx), Math.max(0, plotHeight - h));
		el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(topPx)}px, 0)`;
	});

	let pointerFrame = 0;
	let pointer: Vec | null = null;
	const hide = () => {
		if (scrub) scrub = { ...scrub, glide: false, visible: false };
	};
	const update = (point: Vec) => {
		const offset = { x: point.x - side / 2, y: point.y - plotHeight / 2 };
		if (Math.hypot(offset.x, offset.y) > radius + labelRoom * 0.6) {
			hide();
			return;
		}
		const next = Math.round(angleOf(offset) / (TAU / axes.length)) % axes.length;
		if (scrub?.axis === next && scrub.visible) return;
		scrub = { axis: next, glide: scrub?.visible === true, visible: true };
	};
	const onpointermove = (event: PointerEvent) => {
		const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
		pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		if (pointerFrame !== 0) return;
		pointerFrame = requestAnimationFrame(() => {
			pointerFrame = 0;
			if (pointer !== null) update(pointer);
		});
	};
	const onpointerleave = () => {
		pointer = null;
		cancelAnimationFrame(pointerFrame);
		pointerFrame = 0;
		hide();
	};
	const onkeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			hide();
			locked = null;
			return;
		}
		const count = axes.length;
		const current = scrub?.visible === true ? scrub.axis : -1;
		const steps: Record<string, number> = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 };
		const step = steps[event.key];
		let next: number | undefined;
		if (step !== undefined) next = current === -1 ? 0 : (current + step + count) % count;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = count - 1;
		if (next === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		scrub = { axis: next, glide: false, visible: true };
	};
	const onfocus = () => {
		if (scrub?.visible) return;
		scrub = { axis: scrub?.axis ?? 0, glide: false, visible: true };
	};
	$effect(() => () => cancelAnimationFrame(pointerFrame));
</script>

<div class="radar {className}" data-testid={testId}>
	<div bind:this={host} class="radar-host">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (an interactive chart is a focusable group with arrow-key scrubbing) -->
		<div
			class="radar-plot"
			style:width="{side}px"
			style:height="{plotHeight}px"
			role={interactive ? 'group' : 'img'}
			aria-label={summary}
			aria-roledescription={interactive ? 'chart' : undefined}
			aria-describedby={interactive ? `${uid}-keys` : undefined}
			tabindex={interactive ? 0 : undefined}
			onkeydown={interactive ? onkeydown : undefined}
			onfocus={interactive ? onfocus : undefined}
			onblur={interactive ? hide : undefined}
		>
			{#if side > 0}
				<svg
					aria-hidden="true"
					width={side}
					height={plotHeight}
					viewBox="0 0 {side} {plotHeight}"
					onpointermove={interactive ? onpointermove : undefined}
					onpointerleave={interactive ? onpointerleave : undefined}
				>
					<g transform="translate({side / 2} {plotHeight / 2})" fill="none" class="grid">
						{#each { length: ringCount } as _, ring (ring)}
							{@const r = (radius * (ring + 1)) / ringCount}
							{@const dash = ring === ringCount - 1 ? undefined : '1 3'}
							{#if grid === 'circle'}
								<circle {r} stroke-dasharray={dash} />
							{:else}
								<polygon
									points={axes
										.map((_, index) => {
											const p = polar((index * TAU) / axes.length, r);
											return `${p.x},${p.y}`;
										})
										.join(' ')}
									stroke-dasharray={dash}
								/>
							{/if}
						{/each}
						{#each axes as _, index (index)}
							{@const tip = polar((index * TAU) / axes.length, radius)}
							<line x2={tip.x} y2={tip.y} class:active={activeAxis === index} />
						{/each}
					</g>
					<BloomGroup {bloom} transform="scale({cellSize})">
						{#each shapes as shape (shape.index)}
							<path d={paths[shape.index]} fill={cssColor(shape.color)} opacity={opacityOf(shape.index)} />
						{/each}
					</BloomGroup>
					<g transform="scale({cellSize})" shape-rendering="crispEdges">
						{#each shapes as shape (shape.index)}
							<path d={paths[shape.index]} fill={cssColor(shape.color)} class="fade" style:opacity={opacityOf(shape.index)} />
						{/each}
					</g>
					<g transform="translate({side / 2} {plotHeight / 2})">
						{#each shapes as shape (shape.index)}
							<g class="fade" style:opacity={opacityOf(shape.index)}>
								{#each shape.vertices as vertex, index (index)}
									{@const markerSide = activeAxis === index ? marker + 4 : marker}
									<rect
										x={Math.round(vertex.x * scale - markerSide / 2)}
										y={Math.round(vertex.y * scale - markerSide / 2)}
										width={markerSide}
										height={markerSide}
										fill={cssColor(shape.color)}
										stroke="var(--dither-paper)"
										stroke-width={activeAxis === index ? 2 : 1}
									/>
								{/each}
							</g>
						{/each}
						{#each axes as label, index (index)}
							{@const angle = (index * TAU) / axes.length}
							{@const p = polar(angle, radius + 12)}
							<text
								x={p.x}
								y={p.y}
								text-anchor={labelAnchor(angle)}
								dy="{(0.34 - Math.cos(angle) * 0.5).toFixed(2)}em"
								class="axis-label"
								class:active={activeAxis === index}>{label}</text
							>
						{/each}
					</g>
				</svg>
			{/if}
			{#if interactive}
				<div bind:this={readoutEl} aria-hidden="true" data-glide={String(scrub?.glide ?? false)} data-slot="chart-readout"
				class="dither-readout dither-glide" style:opacity={scrubbing ? 1 : 0}>
					<div class="dither-readout-label">{axes[axis] ?? ''}</div>
					<div class="dither-readout-rows">
						{#each rows as row, index (row.label)}
							<div class="dither-readout-row" class:dim={focus !== null && focus !== index}>
								<span class="dither-swatch" style:background={cssColor(row.color)}></span>
								<span class="dither-readout-name">{row.label}</span>
								<span class="dither-readout-value">{row.value}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
	{#if legend ?? series.length > 1}
		<div
			class="legend"
			role={interactive ? 'group' : undefined}
			aria-label={interactive ? messages.chart_series() : undefined}
			aria-hidden={interactive ? undefined : 'true'}
		>
			{#each shapes as shape (shape.index)}
				{#if interactive}
					<button
						type="button"
						class="dither-legend-item interactive"
						class:dim={focus !== null && focus !== shape.index}
						aria-pressed={locked === shape.index}
						aria-label={messages.chart_spotlight(shape.label)}
						onpointerenter={() => (hovered = shape.index)}
						onpointerleave={() => (hovered = null)}
						onfocus={() => (hovered = shape.index)}
						onblur={() => (hovered = null)}
						onclick={() => (locked = locked === shape.index ? null : shape.index)}
						onkeydown={(event) => {
							if (event.key === 'Escape') locked = null;
						}}
						><span class="dither-swatch" style:background={cssColor(shape.color)}></span>{shape.label}</button
					>
				{:else}
					<span class="dither-legend-item" class:dim={focus !== null && focus !== shape.index}
						><span class="dither-swatch" style:background={cssColor(shape.color)}></span>{shape.label}</span
					>
				{/if}
			{/each}
		</div>
	{/if}
	{#if interactive}
		<p id="{uid}-keys" class="dither-sr-only">{messages.chart_axis_keyboard_help()}</p>
		<div aria-live="polite" aria-atomic="true" class="dither-sr-only">
			{scrubbing ? `${axes[axis] ?? ''}: ${rows.map((row) => `${row.label} ${row.value}`).join(', ')}` : ''}
		</div>
	{/if}
	<div class="dither-sr-only">
		<table>
			<caption>{summary}</caption>
			<thead>
				<tr>
					<th scope="col">{messages.chart_axis()}</th>
					{#each shapes as shape (shape.index)}<th scope="col">{shape.label}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each axes as label, index (index)}
					<tr>
						<th scope="row">{label}</th>
						{#each shapes as shape (shape.index)}<td>{shape.details?.[index] ?? formatValue(shape.values[index] ?? 0)}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.radar {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: center;
	}
	.radar-host {
		display: flex;
		width: 100%;
		justify-content: center;
	}
	.radar-plot {
		position: relative;
		border-radius: 0.5rem;
		outline: none;
	}
	.radar-plot:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	svg {
		display: block;
		overflow: visible;
		user-select: none;
	}
	.grid {
		stroke: var(--border);
	}
	.grid line {
		transition: stroke 150ms;
	}
	.grid line.active {
		stroke: color-mix(in oklch, var(--foreground) 60%, transparent);
	}
	.axis-label {
		fill: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		transition: fill 150ms;
	}
	.axis-label.active {
		fill: var(--foreground);
	}
	.fade {
		transition: opacity 150ms ease-out;
	}
	.legend {
		margin-top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.25rem;
	}
	@media (prefers-reduced-motion: reduce) {
	.fade,
	.grid line,
	.axis-label {
			transition: none;
		}
	}
</style>
