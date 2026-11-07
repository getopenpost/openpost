<script lang="ts" module>
	export interface HeatmapDatum {
		/** The day, as "YYYY-MM-DD" or a Date (read in UTC). */
		date: string | Date;
		value: number;
	}
</script>

<script lang="ts">
	import './chart.css';
	import { createFrameLoop, cssColor, MOTION, readDitherCell, subscribeToTheme } from '@openpost/dither/engine';
	import type { Bloom, DitherColor } from '@openpost/dither/engine';
	import { getUiMessages } from '../../messages.js';
	import BloomGroup from './bloom-group.svelte';
	import { svgId } from './dither-context.svelte.js';

	/**
	 * A heatmap built from dither cells. Every square is a 4×4 block, so its
	 * density steps cleanly from dots to solid. Calendar mode draws a day per
	 * square and a week per column; matrix mode draws any grid, such as weekday
	 * by hour. Ported from dithercn's `heatmap` (MIT).
	 */
	let {
		mode = 'calendar',
		data = [],
		matrix = [],
		rows: rowNames = [],
		columns: columnNames = [],
		weeks = 53,
		weekStart = 0,
		steps: rawSteps = 4,
		max,
		color = 'ink',
		bloom = 'off',
		cell,
		legend = true,
		interactive = true,
		animate = false,
		locale,
		formatValue,
		summary: summaryText,
		class: className = '',
		testId
	}: {
		mode?: 'calendar' | 'matrix';
		/** Calendar values by day. */
		data?: readonly HeatmapDatum[];
		/** Matrix values: `matrix[row][column]`. */
		matrix?: readonly (readonly number[])[];
		rows?: readonly string[];
		columns?: readonly string[];
		weeks?: number;
		weekStart?: 0 | 1;
		/** Densities above empty, 2 to 6. Default 4. */
		steps?: number;
		max?: number;
		color?: DitherColor;
		bloom?: Bloom;
		/** Largest cell in CSS px; shrinks to 2 to fit. */
		cell?: number;
		legend?: boolean;
		interactive?: boolean;
		animate?: boolean;
		locale?: string;
		/** Value with its unit, such as "3 posts". Default a plain number. */
		formatValue?: (value: number) => string;
		summary?: string;
		class?: string;
		testId?: string;
	} = $props();

	const messages = getUiMessages();
	const propsId = $props.id();
	const uid = svgId(propsId);
	const DAY_MS = 86_400_000;
	const SQUARE = 4;
	const PITCH = 5;
	const TOP = 20;
	const MIN_CELL = 2;
	const DIMMED = 0.18;
	const REVEAL_SECONDS = (MOTION.slow + MOTION.base * 2) / 1000;
	const REVEAL_STEPS = 30;
	const AXIS_CHAR = 6.1;
	const MASKS = {
		checker: ['#.#.', '.#.#', '#.#.', '.#.#'],
		dots: ['#.#.', '....', '#.#.', '....'],
		frame: ['####', '#..#', '#..#', '####'],
		pinhole: ['####', '#.##', '##.#', '####'],
		solid: ['####', '####', '####', '####'],
		sparse: ['....', '.#..', '..#.', '....']
	} as const;
	type MaskName = keyof typeof MASKS;
	const STEP_MASKS: Record<number, readonly MaskName[]> = {
		2: ['checker', 'solid'],
		3: ['dots', 'checker', 'solid'],
		4: ['dots', 'checker', 'frame', 'solid'],
		5: ['sparse', 'dots', 'checker', 'frame', 'solid'],
		6: ['sparse', 'dots', 'checker', 'frame', 'pinhole', 'solid']
	};

	type Square = { column: number; row: number; value: number; bucket: number; label: string };

	const steps = $derived(Math.min(6, Math.max(2, Math.round(rawSteps))));
	const number = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }));
	const withUnit = $derived(formatValue ?? ((value: number) => number.format(value)));
	const longDate = $derived(
		new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC', weekday: 'short', year: 'numeric' })
	);
	const monthName = $derived(new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }));
	const weekdayName = $derived(new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }));

	const dayNumber = (date: string | Date) => {
		if (typeof date !== 'string') return Math.floor(date.getTime() / DAY_MS);
		const [year, month, day] = date.slice(0, 10).split('-').map(Number);
		return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / DAY_MS);
	};
	const dateOf = (day: number) => new Date(day * DAY_MS);
	const bucketOf = (value: number, peak: number) =>
		value <= 0 ? 0 : Math.min(steps, Math.max(1, Math.ceil((value / peak) * steps)));
	const squareInked = (x: number, y: number, bucket: number) => {
		const name = STEP_MASKS[steps]?.[bucket - 1];
		return name !== undefined && MASKS[name][y]?.[x] === '#';
	};

	const full = $derived.by(() => {
		if (mode === 'matrix') {
			const values = matrix.flatMap((row) => row.filter((value) => Number.isFinite(value)));
			const peak = max ?? Math.max(1, ...values);
			const squares: Square[] = [];
			for (let column = 0; column < columnNames.length; column += 1) {
				for (let row = 0; row < rowNames.length; row += 1) {
					const raw = matrix[row]?.[column];
					if (raw === undefined || !Number.isFinite(raw)) continue;
					const value = Math.max(0, raw);
					squares.push({ bucket: bucketOf(value, peak), column, label: `${rowNames[row] ?? ''} · ${columnNames[column] ?? ''}`, row, value });
				}
			}
			return {
				columnLabels: columnNames.map((text, column) => ({ column, text })),
				columns: columnNames.length,
				peak,
				rowLabels: rowNames.map((text, row) => ({ row, text })),
				rows: rowNames.length,
				squares
			};
		}
		const totals = new Map<number, number>();
		for (const datum of data) {
			const day = dayNumber(datum.date);
			totals.set(day, (totals.get(day) ?? 0) + (Number.isFinite(datum.value) ? datum.value : 0));
		}
		const lastDay = totals.size > 0 ? Math.max(...totals.keys()) : Math.floor(Date.now() / DAY_MS);
		const lastRow = (((lastDay + 4 - weekStart) % 7) + 7) % 7;
		const columns = Math.max(1, weeks);
		const firstDay = lastDay - lastRow - (columns - 1) * 7;
		const peak = max ?? Math.max(1, ...totals.values());
		const squares: Square[] = [];
		for (let day = firstDay; day <= lastDay; day += 1) {
			const value = Math.max(0, totals.get(day) ?? 0);
			const offset = day - firstDay;
			squares.push({ bucket: bucketOf(value, peak), column: Math.floor(offset / 7), label: longDate.format(dateOf(day)), row: offset % 7, value });
		}
		const columnLabels: { column: number; text: string }[] = [];
		let previousMonth = dateOf(firstDay).getUTCMonth();
		let previousColumn = -10;
		for (let column = 0; column < columns; column += 1) {
			const date = dateOf(firstDay + column * 7 + 6);
			const month = date.getUTCMonth();
			const starts = column === 0 ? date.getUTCDate() <= 7 : month !== previousMonth;
			if (starts && column - previousColumn >= 3 && column <= columns - 2) {
				columnLabels.push({ column, text: monthName.format(date) });
				previousColumn = column;
			}
			previousMonth = month;
		}
		const rowLabels = [1, 3, 5].map((weekday) => {
			const row = (weekday - weekStart + 7) % 7;
			return { row, text: weekdayName.format(dateOf(firstDay + row)) };
		});
		return { columnLabels, columns, peak, rowLabels, rows: 7, squares };
	});

	let host: HTMLDivElement;
	let box = $state({ base: 2, width: 0 });
	let reveal = $state(1);
	let hoveredBucket = $state<number | null>(null);
	let lockedBucket = $state<number | null>(null);
	let active = $state<{ column: number; row: number; glide: boolean; visible: boolean } | null>(null);
	let readoutEl = $state<HTMLDivElement>();

	$effect(() => {
		const read = (width: number) => (box = { base: cell ?? readDitherCell(host), width });
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
			reveal = 1;
			return;
		}
		reveal = 0;
		let loop: ReturnType<typeof createFrameLoop> | undefined;
		loop = createFrameLoop(
			(time) => {
				const linear = Math.min(1, time / REVEAL_SECONDS);
				reveal = Math.round((1 - (1 - linear) ** 2) * REVEAL_STEPS) / REVEAL_STEPS;
				if (reveal >= 1) loop?.update({ enabled: false, stillTime: REVEAL_SECONDS });
			},
			{ stillTime: REVEAL_SECONDS, target: host }
		);
		return () => loop?.destroy();
	});

	const layout = $derived.by(() => {
		const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
		const left = Math.ceil(Math.max(0, ...full.rowLabels.map(({ text }) => text.length)) * AXIS_CHAR) + 8;
		const room = Math.max(0, box.width - left);
		const ideal = room / (full.columns * PITCH - 1);
		const snapped = Math.max(1, Math.floor(ideal * dpr)) / dpr;
		const size = Math.max(MIN_CELL, Math.min(box.base, snapped));
		const fits = Math.max(1, Math.floor((room / size + 1) / PITCH));
		const widest = mode === 'matrix' ? Math.max(0, ...full.columnLabels.map(({ text }) => text.length)) : 0;
		return {
			cell: size,
			columns: Math.min(full.columns, fits),
			labelEvery: widest === 0 ? 1 : Math.max(1, Math.ceil((widest * AXIS_CHAR + 6) / (size * PITCH))),
			left
		};
	});
	// Narrow boxes drop the oldest weeks or first columns.
	const offset = $derived(full.columns - layout.columns);
	const model = $derived.by(() => {
		const squares =
			offset <= 0 ? full.squares : full.squares.filter((square) => square.column >= offset).map((square) => ({ ...square, column: square.column - offset }));
		const lookup = new Map<number, Square>();
		for (const square of squares) lookup.set(square.column * full.rows + square.row, square);
		return {
			at: (column: number, row: number) => (row < 0 || row >= full.rows || column < 0 ? undefined : lookup.get(column * full.rows + row)),
			columns: full.columns - Math.max(0, offset),
			squares
		};
	});
	const paths = $derived.by(() => {
		const ink = Array.from({ length: steps + 1 }, () => '');
		let backing = '';
		const span = model.columns + full.rows * 0.8;
		for (const square of model.squares) {
			if ((square.column + square.row * 0.8) / span > reveal) continue;
			const left = square.column * PITCH;
			const top = square.row * PITCH;
			backing += `M${left} ${top}h${SQUARE}v${SQUARE}h${-SQUARE}z`;
			for (let y = 0; y < SQUARE && square.bucket > 0; y += 1) {
				for (let x = 0; x < SQUARE; x += 1) {
					if (squareInked(x, y, square.bucket)) ink[square.bucket] += `M${left + x} ${top + y}h1v1h-1z`;
				}
			}
		}
		return { backing, ink };
	});

	const focusBucket = $derived(interactive ? (hoveredBucket ?? lockedBucket) : null);
	const pitch = $derived(layout.cell * PITCH);
	const width = $derived(layout.left + model.columns * pitch - layout.cell);
	const height = $derived(TOP + full.rows * pitch - layout.cell);
	const current = $derived(active ?? { column: 0, glide: false, row: 0, visible: false });
	const square = $derived(model.at(current.column, current.row));
	const visible = $derived(interactive && current.visible && square !== undefined);
	const summary = $derived.by(() => {
		if (summaryText) return summaryText;
		const total = model.squares.reduce((sum, item) => sum + item.value, 0);
		return `${mode === 'matrix' ? 'Heatmap' : 'Calendar heatmap'}: ${withUnit(total)}.`;
	});
	const swatchPath = (bucket: number) => {
		let path = '';
		for (let y = 0; y < SQUARE; y += 1) for (let x = 0; x < SQUARE; x += 1) if (squareInked(x, y, bucket)) path += `M${x} ${y}h1v1h-1z`;
		return path;
	};
	const bucketText = (bucket: number) => {
		if (bucket === 0) return messages.chart_none();
		const peak = max ?? Math.max(1, ...model.squares.map(({ value }) => value));
		if (bucket === steps) return messages.chart_more_than(withUnit((peak * (bucket - 1)) / steps));
		return messages.chart_up_to(withUnit((peak * bucket) / steps));
	};

	$effect(() => {
		const el = readoutEl;
		if (!el || !visible) return;
		const anchor = { x: layout.left + current.column * pitch + (SQUARE * layout.cell) / 2, y: TOP + current.row * pitch - 2 };
		const left = Math.min(Math.max(0, anchor.x - el.offsetWidth / 2), Math.max(0, width - el.offsetWidth));
		el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(anchor.y - el.offsetHeight - 8)}px, 0)`;
	});

	let pointerFrame = 0;
	let pointer: { x: number; y: number } | null = null;
	const hide = () => {
		if (active) active = { ...active, glide: false, visible: false };
	};
	const point = (x: number, y: number) => {
		const column = Math.floor((x - layout.left) / pitch);
		const row = Math.floor((y - TOP) / pitch);
		if (model.at(column, row) === undefined) return hide();
		if (active?.column === column && active.row === row && active.visible) return;
		active = { column, glide: active?.visible === true, row, visible: true };
	};
	const onpointermove = (event: PointerEvent) => {
		const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
		pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		if (pointerFrame !== 0) return;
		pointerFrame = requestAnimationFrame(() => {
			pointerFrame = 0;
			if (pointer !== null) point(pointer.x, pointer.y);
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
			lockedBucket = null;
			return;
		}
		const last = model.squares.at(-1);
		const from = active ?? { column: last?.column ?? 0, row: last?.row ?? 0 };
		const arrows: Record<string, readonly [number, number]> = { ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1] };
		const step = arrows[event.key];
		let target: Square | undefined;
		if (step !== undefined) target = model.at(from.column + step[0], from.row + step[1]);
		else if (event.key === 'Home') target = model.squares[0];
		else if (event.key === 'End') target = last;
		else return;
		event.preventDefault();
		event.stopPropagation();
		if (target) active = { column: target.column, glide: false, row: target.row, visible: true };
	};
	const onfocus = () => {
		if (active?.visible) return;
		const last = model.squares.at(-1);
		active = { column: active?.column ?? last?.column ?? 0, glide: false, row: active?.row ?? last?.row ?? 0, visible: true };
	};
	$effect(() => () => cancelAnimationFrame(pointerFrame));
</script>

<div class="heatmap {className}" data-testid={testId}>
	<div bind:this={host} class="heatmap-host">
		{#if box.width === 0}
			<div style:height="{TOP + full.rows * PITCH * layout.cell}px"></div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (an interactive chart is a focusable group with arrow-key scrubbing) -->
			<div
				class="heatmap-grid"
				style:width="{width}px"
				style:height="{height}px"
				role={interactive ? 'group' : 'img'}
				aria-label={summary}
				aria-roledescription={interactive ? 'heatmap' : undefined}
				aria-describedby={interactive ? `${uid}-keys` : undefined}
				tabindex={interactive ? 0 : undefined}
				onkeydown={interactive ? onkeydown : undefined}
				onfocus={interactive ? onfocus : undefined}
				onblur={interactive ? hide : undefined}
			>
				<svg
					aria-hidden="true"
					{width}
					{height}
					viewBox="0 0 {width} {height}"
					onpointermove={interactive ? onpointermove : undefined}
					onpointerleave={interactive ? onpointerleave : undefined}
				>
					<g aria-hidden="true" class="axis">
						{#each full.columnLabels as label (label.column)}
							{@const shown = label.column - offset}
							{#if shown >= 0 && shown < layout.columns && shown % layout.labelEvery === 0}
								<text x={layout.left + shown * pitch} y={TOP - 7}>{label.text}</text>
							{/if}
						{/each}
						{#each full.rowLabels as label (label.row)}
							<text x="0" y={TOP + label.row * pitch + (SQUARE * layout.cell) / 2} dy="0.34em">{label.text}</text>
						{/each}
					</g>
					<g transform="translate({layout.left} {TOP})">
						<g transform="scale({layout.cell})" shape-rendering="crispEdges">
							<path d={paths.backing} class="backing" />
							<BloomGroup {bloom}>
								<path d="{paths.ink[steps] ?? ''}{paths.ink[steps - 1] ?? ''}" fill={cssColor(color)} />
							</BloomGroup>
							{#each paths.ink as path, bucket (bucket)}
								{#if bucket > 0}
									<path d={path} fill={cssColor(color)} class="fade" style:opacity={focusBucket === null || focusBucket === bucket ? 1 : DIMMED} />
								{/if}
							{/each}
						</g>
						{#if interactive}
							<rect
								data-glide={String(current.glide)}
								x="-1.5"
								y="-1.5"
								width={SQUARE * layout.cell + 3}
								height={SQUARE * layout.cell + 3}
								rx="1"
								fill="none"
								class="outline dither-glide"
								stroke-width="1"
								style:opacity={visible ? 1 : 0}
								style:transform="translate({current.column * pitch}px, {current.row * pitch}px)"
							/>
						{/if}
					</g>
				</svg>
				{#if interactive}
					<div bind:this={readoutEl} aria-hidden="true" data-glide={String(current.glide)} data-slot="chart-readout"
				class="dither-readout dither-glide" style:opacity={visible ? 1 : 0}>
						{#if square}
							<div class="dither-readout-label">{square.label}</div>
							<div class="dither-readout-value">{square.value > 0 ? withUnit(square.value) : messages.chart_none()}</div>
						{/if}
					</div>
					<p id="{uid}-keys" class="dither-sr-only">{messages.chart_square_keyboard_help()}</p>
					<div aria-live="polite" aria-atomic="true" class="dither-sr-only">
						{visible && square ? `${square.label}: ${square.value > 0 ? withUnit(square.value) : messages.chart_none()}` : ''}
					</div>
				{/if}
			</div>
		{/if}
	</div>
	{#if legend}
		<div class="legend">
			<span>{messages.chart_less()}</span>
			<div class="legend-swatches" role={interactive ? 'group' : undefined} aria-label={interactive ? messages.chart_levels() : undefined} aria-hidden={interactive ? undefined : 'true'}>
				{#each { length: steps + 1 } as _, bucket (bucket)}
					{#snippet swatch()}
						<svg aria-hidden="true" width={SQUARE * layout.cell} height={SQUARE * layout.cell} style="display:block">
							<g transform="scale({layout.cell})" shape-rendering="crispEdges">
								<rect width={SQUARE} height={SQUARE} class="backing" />
								<path d={swatchPath(bucket)} fill={cssColor(color)} />
							</g>
						</svg>
					{/snippet}
					{#if interactive}
						<button
							type="button"
							class="legend-swatch"
							class:dim={focusBucket !== null && focusBucket !== bucket}
							aria-pressed={lockedBucket === bucket}
							aria-label={bucketText(bucket)}
							title={bucketText(bucket)}
							onpointerenter={() => (hoveredBucket = bucket)}
							onpointerleave={() => (hoveredBucket = null)}
							onfocus={() => (hoveredBucket = bucket)}
							onblur={() => (hoveredBucket = null)}
							onclick={() => (lockedBucket = lockedBucket === bucket ? null : bucket)}
							onkeydown={(event) => {
								if (event.key === 'Escape') lockedBucket = null;
							}}>{@render swatch()}</button
						>
					{:else}
						<span class="legend-swatch" class:dim={focusBucket !== null && focusBucket !== bucket}>{@render swatch()}</span>
					{/if}
				{/each}
			</div>
			<span>{messages.chart_more()}</span>
		</div>
	{/if}
</div>

<style>
	.heatmap,
	.heatmap-host {
		position: relative;
		width: 100%;
	}
	.heatmap-grid {
		position: relative;
		border-radius: 0.125rem;
		outline: none;
	}
	.heatmap-grid:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	svg {
		display: block;
		overflow: visible;
		user-select: none;
	}
	.axis {
		fill: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
	}
	.backing {
		fill: color-mix(in oklch, var(--foreground) 7%, transparent);
	}
	.fade {
		transition: opacity 150ms ease-out;
	}
	.outline {
		stroke: var(--foreground);
	}
	.legend {
		margin-top: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
		color: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
	}
	.legend-swatches {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}
	.legend-swatch {
		border-radius: 3px;
		padding: 0.25rem;
		outline: none;
		transition: opacity 150ms ease-out;
	}
	button.legend-swatch {
		cursor: pointer;
	}
	button.legend-swatch:focus-visible {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 60%, transparent);
	}
	button.legend-swatch[aria-pressed='true'] {
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--foreground) 40%, transparent);
	}
	.legend-swatch.dim {
		opacity: 0.35;
	}
	@media (prefers-reduced-motion: reduce) {
	.fade {
			transition: none;
		}
	}
</style>
