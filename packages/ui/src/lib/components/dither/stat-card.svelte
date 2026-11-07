<script lang="ts" module>
	/** Which way the metric should move: reach `up`, latency `down`. */
	export type StatDirection = 'up' | 'down';
</script>

<script lang="ts">
	import { cssColor, ditherMaskStyle, styleString } from '@openpost/dither/engine';
	import type { Bloom, DitherColor, DitherMatrix, FillVariant } from '@openpost/dither/engine';
	import type { Snippet } from 'svelte';
	import BloomGroup from './bloom-group.svelte';
	import { DitherMeasure, round1, svgId, themeFill } from './dither-context.svelte.js';
	import FillPattern from './fill-pattern.svelte';

	/**
	 * A KPI card: label, headline value, a delta coloured by whether the move is
	 * good, and a dithered area of the recent trend along the bottom, on a faint
	 * dot surface. Ported from dithercn's `stat-card`.
	 */
	let {
		label,
		value,
		delta,
		deltaText,
		deltaLabel,
		good = 'up',
		trend,
		color = 'ink',
		fill: fillProp,
		bloom = 'off',
		matrix = 'bayer4',
		cell,
		icon,
		pressed,
		onclick,
		class: className = '',
		testId
	}: {
		/** What the number is, such as "Visibility". */
		label: string;
		/** The headline, already formatted. */
		value: string;
		/** Signed change used for the arrow and colour. */
		delta?: number;
		/** How the change reads, such as "+12.4%" or "+157". Default: `delta` as a percentage. */
		deltaText?: string;
		/** What the change compares with, such as "vs last period". */
		deltaLabel?: string;
		/** Which direction counts as good. Default `up`. */
		good?: StatDirection;
		/** Recent values, oldest first, drawn as a dithered area along the bottom. */
		trend?: readonly number[];
		color?: DitherColor;
		fill?: FillVariant;
		bloom?: Bloom;
		matrix?: DitherMatrix;
		cell?: number;
		icon?: Snippet;
		/** With `onclick`, the card is a toggle button. */
		pressed?: boolean;
		onclick?: () => void;
		class?: string;
		testId?: string;
	} = $props();

	const fill = $derived(fillProp ?? themeFill());

	const TREND_HEIGHT = 56;
	/** Bands under the line, each a step lighter; the last runs to the bottom. */
	const BAND_LEVELS = [10 / 16, 6 / 16, 3 / 16, 1 / 16] as const;
	const BAND_DEPTH = 7;
	const SURFACE_LEVEL = 1 / 16;

	const propsId = $props.id();
	const uid = svgId(propsId);
	const measure = new DitherMeasure(() => cell);
	const hasTrend = $derived(trend !== undefined && trend.length > 1);

	type Point = { x: number; y: number };
	const toPath = (points: readonly Point[]) =>
		points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join('');

	const paths = $derived.by(() => {
		const width = measure.width;
		const values = trend ?? [];
		if (width <= 0 || values.length < 2) return null;
		const height = TREND_HEIGHT;
		const low = Math.min(...values);
		const high = Math.max(...values);
		const range = high - low || 1;
		// Leave room above the peak for the end marker, and a floor under the low.
		const top = 6;
		const floor = height * 0.3;
		const points = values.map((point, index) => ({
			x: round1((index / Math.max(1, values.length - 1)) * width),
			y: round1(top + (1 - (point - low) / range) * (height - top - floor))
		}));
		const shifted = (depth: number) =>
			points.map(({ x, y }) => ({ x, y: Math.min(height, y + depth) }));
		const bands = BAND_LEVELS.map((_, index) => {
			const upper = toPath(shifted(index * BAND_DEPTH));
			const last = index === BAND_LEVELS.length - 1;
			const lower = last
				? `L${width} ${height}L0 ${height}`
				: [...shifted((index + 1) * BAND_DEPTH)]
						.reverse()
						.map(({ x, y }) => `L${x} ${y}`)
						.join('');
			return `${upper}${lower}Z`;
		});
		return {
			area: `${toPath(points)}L${width} ${height}L0 ${height}Z`,
			bands,
			end: points.at(-1) ?? { x: width, y: height },
			line: toPath(points),
			width
		};
	});

	/** A palette colour pulled toward the text colour, so small text keeps its contrast. */
	const toneOf = (name: 'green' | 'red') =>
		`color-mix(in oklab, ${cssColor(name === 'green' ? '--success-foreground' : '--destructive')}, var(--foreground) 12%)`;

	const change = $derived.by(() => {
		if (delta === undefined) return null;
		const text = deltaText ?? `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)}%`;
		if (delta === 0) return { direction: null, text, tone: undefined };
		const direction: StatDirection = delta > 0 ? 'up' : 'down';
		return { direction, text, tone: toneOf(direction === good ? 'green' : 'red') };
	});

	const surface = $derived(
		styleString(
			{ 'background-color': cssColor(color) },
			ditherMaskStyle(SURFACE_LEVEL, {
				cell: cell === undefined ? 'var(--dither-cell, 2px)' : `${cell}px`,
				matrix
			})
		)
	);
	const marker = $derived(measure.cell * 2);
</script>

{#snippet body()}
	<span class="stat-surface" aria-hidden="true"><span style={surface}></span></span>
	<span class="stat-copy" class:with-trend={hasTrend}>
		<span class="stat-label">
			{#if icon}{@render icon()}{/if}
			<span>{label}</span>
		</span>
		<span class="stat-value">{value}</span>
		{#if change}
			<span class="stat-delta">
				<span class="stat-change" class:muted={!change.tone} style:color={change.tone}>
					{#if change.direction}
						<svg aria-hidden="true" viewBox="0 0 8 8" class:down={change.direction === 'down'}
							><path d="M4 1L7.5 6.5H0.5Z" fill="currentColor" /></svg
						>
					{/if}
					<span>{change.text}</span>
				</span>
				{#if deltaLabel}<span class="muted">{deltaLabel}</span>{/if}
			</span>
		{/if}
	</span>
	{#if hasTrend}
		<span class="stat-trend" aria-hidden="true" {@attach measure.attach}>
			{#if paths}
				<svg width={paths.width} height={TREND_HEIGHT}>
					<defs>
						{#if fill === 'gradient'}
							{#each BAND_LEVELS as level, index (level)}
								<FillPattern id="{uid}-{index}" {level} {matrix} cell={measure.cell} {color} />
							{/each}
						{:else}
							<FillPattern id="{uid}-area" {fill} {color} cell={measure.cell} />
						{/if}
					</defs>
					<BloomGroup {bloom} fill={cssColor(color)}><path d={paths.area} /></BloomGroup>
					{#if fill === 'gradient'}
						{#each paths.bands as band, index (index)}
							<path d={band} fill="url(#{uid}-{index})" />
						{/each}
					{:else}
						<path d={paths.area} fill="url(#{uid}-area)" opacity={fill === 'solid' ? 0.35 : 1} />
					{/if}
					<path
						d={paths.line}
						fill="none"
						stroke={cssColor(color)}
						stroke-width="1.5"
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
					<rect
						x={Math.min(paths.end.x, paths.width - marker / 2) - marker / 2}
						y={paths.end.y - marker / 2}
						width={marker}
						height={marker}
						fill={cssColor(color)}
					/>
				</svg>
			{/if}
		</span>
	{/if}
{/snippet}

{#if onclick}
	<button
		type="button"
		class="stat-card interactive {className}"
		style:--stat-color={cssColor(color)}
		aria-pressed={pressed}
		data-testid={testId}
		{onclick}>{@render body()}</button
	>
{:else}
	<div class="stat-card {className}" data-testid={testId}>{@render body()}</div>
{/if}

<style>
	.stat-card {
		position: relative;
		isolation: isolate;
		display: flex;
		min-width: 0;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-xl, 0.75rem);
		background: var(--card);
		color: var(--card-foreground);
		text-align: left;
	}
	.interactive {
		cursor: pointer;
		transition: border-color 150ms ease-out;
	}
	.interactive:hover {
		border-color: color-mix(in oklch, var(--foreground) 22%, var(--border));
	}
	.interactive[aria-pressed='true'] {
		border-color: var(--stat-color);
		box-shadow: inset 0 0 0 1px var(--stat-color);
	}
	.interactive:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.stat-surface {
		position: absolute;
		inset: 0;
		z-index: -1;
		opacity: 0.6;
		mask-image: radial-gradient(80% 70% at 100% 0%, black, transparent 75%);
		pointer-events: none;
	}
	.stat-surface > span {
		position: absolute;
		inset: 0;
	}
	.stat-copy {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1.25rem;
	}
	.stat-copy.with-trend {
		padding-bottom: 0.5rem;
	}
	.stat-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--muted-foreground);
	}
	.stat-label :global(svg) {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}
	.stat-value {
		font-size: 1.875rem;
		line-height: 2.25rem;
		font-weight: 600;
		letter-spacing: -0.025em;
		font-variant-numeric: tabular-nums;
	}
	.stat-delta {
		margin-top: 0.25rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
	}
	.stat-change {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.stat-change svg {
		width: 0.5rem;
		height: 0.5rem;
		flex-shrink: 0;
	}
	.stat-change svg.down {
		transform: rotate(180deg);
	}
	.muted {
		color: var(--muted-foreground);
	}
	.stat-trend {
		position: relative;
		display: block;
		height: 56px;
	}
	.stat-trend svg {
		position: absolute;
		inset: 0;
		display: block;
	}
</style>
