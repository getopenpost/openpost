<script lang="ts">
	import './chart.css';
	import { cssColor, readDitherCell } from '@openpost/dither/engine';
	import type { Bloom, DitherColor, DitherMatrix, FillVariant } from '@openpost/dither/engine';
	import BloomGroup from './bloom-group.svelte';
	import { snapToDevice } from './cartesian.js';
	import { svgId, themeFill } from './dither-context.svelte.js';
	import FillPattern from './fill-pattern.svelte';

	/**
	 * A tiny inline trend for tables and cards: a line, a dithered area and a
	 * dot on the latest value. Ported from dithercn's `sparkline` (MIT).
	 */
	let {
		data,
		label,
		height = 32,
		color = 'ink',
		area = true,
		fill: fillProp,
		bloom = 'off',
		interactive = false,
		dot = true,
		level = 0.5,
		matrix = 'bayer4',
		cell,
		domain,
		format,
		locale,
		class: className = ''
	}: {
		data: readonly number[];
		/** What the trend measures, for screen readers. */
		label: string;
		height?: number;
		color?: DitherColor;
		area?: boolean;
		fill?: FillVariant;
		bloom?: Bloom;
		interactive?: boolean;
		dot?: boolean;
		level?: number;
		matrix?: DitherMatrix;
		cell?: number;
		domain?: readonly [number, number];
		format?: (value: number) => string;
		locale?: string;
		class?: string;
	} = $props();

	const fill = $derived(fillProp ?? themeFill());

	const STROKE = 1.5;
	const DOT = 2.5;
	const propsId = $props.id();
	const uid = svgId(propsId);

	let root: HTMLSpanElement;
	let width = $state<number | null>(null);
	let px = $state(2);
	let active = $state<{ index: number; glide: boolean } | null>(null);

	$effect(() => {
		px = snapToDevice(cell ?? Math.max(1, readDitherCell(root)), window.devicePixelRatio || 1);
		const observer = new ResizeObserver(([entry]) => {
			if (entry) width = Math.floor(entry.contentRect.width);
		});
		observer.observe(root);
		return () => observer.disconnect();
	});

	const numbers = $derived(format ?? ((value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' }).format(value)));
	const summary = $derived.by(() => {
		const first = data[0];
		const last = data.at(-1);
		if (first === undefined || last === undefined) return label;
		return `${label}: ${numbers(first)} → ${numbers(last)}, ↓${numbers(Math.min(...data))} ↑${numbers(Math.max(...data))}`;
	});
	const geometry = $derived.by(() => {
		const [floor, ceiling] = domain ?? [Math.min(...data), Math.max(...data)];
		const span = ceiling - floor || 1;
		const inset = (dot ? DOT : 0) + STROKE;
		const points =
			width === null
				? []
				: data.map((value, index) => ({
						x: data.length === 1 ? width! / 2 : inset + (index / (data.length - 1)) * (width! - inset * 2),
						y: inset + (1 - (value - floor) / span) * (height - inset * 2)
					}));
		const line = points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join('');
		const start = points[0];
		const end = points.at(-1);
		const shape = start === undefined || end === undefined ? '' : `${line}L${end.x} ${height}L${start.x} ${height}Z`;
		return { area: shape, end, line, points };
	});
	const scrubbed = $derived(active === null ? undefined : geometry.points[active.index]);
	const marker = $derived(scrubbed ?? (dot ? geometry.end : undefined));
	const glide = $derived(String(active?.glide ?? false));
	const readout = $derived(active === null || data[active.index] === undefined ? '' : numbers(data[active.index]!));

	const pick = (index: number, smooth: boolean) => {
		if (active?.index === index) return;
		active = { glide: smooth && active !== null, index };
	};
	const onpointermove = (event: PointerEvent) => {
		if (data.length === 0) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		pick(Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * (data.length - 1)), true);
	};
	const onkeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			active = null;
			return;
		}
		const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : undefined;
		if (step === undefined || data.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		pick(Math.min(data.length - 1, Math.max(0, (active?.index ?? data.length - 1) + step)), false);
	};
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (an interactive chart is a focusable group with arrow-key scrubbing) -->
<span
	bind:this={root}
	class="sparkline {className}"
	class:interactive
	style:height="{height}px"
	role={interactive ? 'group' : 'img'}
	aria-label={summary}
	tabindex={interactive ? 0 : undefined}
	onpointermove={interactive ? onpointermove : undefined}
	onpointerleave={interactive ? () => (active = null) : undefined}
	onkeydown={interactive ? onkeydown : undefined}
	onblur={interactive ? () => (active = null) : undefined}
>
	{#if width !== null && geometry.end !== undefined}
		<svg aria-hidden="true" {width} {height} viewBox="0 0 {width} {height}">
			<BloomGroup {bloom}>
				<path d={area ? geometry.area : geometry.line} fill={area ? cssColor(color) : 'none'} stroke={cssColor(color)} stroke-width="4" />
			</BloomGroup>
			{#if area}
				<defs>
					{#if fill === 'gradient'}
						<FillPattern id="{uid}-low" level={Math.round(level * 8) / 16} {matrix} cell={px} {color} />
						<FillPattern id="{uid}-high" level={Math.round(level * 16) / 16} {matrix} cell={px} {color} />
						<mask id="{uid}-near">
							<rect {width} {height} fill="white" />
							<path d={geometry.area} transform="translate(0 {Math.max(px * 2, height * 0.3)})" fill="black" shape-rendering="crispEdges" />
						</mask>
					{:else}
						<FillPattern id="{uid}-low" {fill} {color} cell={px} />
					{/if}
				</defs>
				<path d={geometry.area} fill="url(#{uid}-low)" opacity={fill === 'solid' ? 0.35 : 1} shape-rendering="crispEdges" />
				{#if fill === 'gradient'}
					<path d={geometry.area} fill="url(#{uid}-high)" mask="url(#{uid}-near)" shape-rendering="crispEdges" />
				{/if}
			{/if}
			<path d={geometry.line} fill="none" stroke={cssColor(color)} stroke-width={STROKE} stroke-linejoin="round" stroke-linecap="round" />
			{#if marker}
				<circle
					data-glide={glide}
					r={scrubbed ? DOT + 0.5 : DOT}
					fill={cssColor(color)}
					stroke="var(--dither-paper)"
					stroke-width="1.5"
					class="marker"
					style:transform="translate({marker.x}px, {marker.y}px)"
				/>
			{/if}
		</svg>
	{/if}
	{#if interactive}
		{#if scrubbed}
			<span aria-hidden="true" data-glide={glide} class="spark-readout" style:transform="translateX(calc({scrubbed.x}px - 50%))">{readout}</span>
		{/if}
		<span aria-live="polite" class="dither-sr-only">{readout}</span>
	{/if}
</span>

<style>
	.sparkline {
		position: relative;
		display: inline-block;
		width: 100%;
		vertical-align: middle;
	}
	.sparkline.interactive {
		border-radius: 0.125rem;
		outline: none;
	}
	.sparkline.interactive:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	svg {
		display: block;
		overflow: visible;
	}
	.marker {
		transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.marker[data-glide='false'] {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
	.marker {
			transition: none;
		}
	}
	.spark-readout {
		position: absolute;
		bottom: 100%;
		left: 0;
		margin-bottom: 0.375rem;
		pointer-events: none;
		white-space: nowrap;
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		background: var(--popover);
		color: var(--popover-foreground);
		padding: 0.125rem 0.375rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.spark-readout[data-glide='false'] {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.spark-readout {
			transition: none;
		}
	}
</style>
