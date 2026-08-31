<script lang="ts">
	import type { components } from '$lib/api/types';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { formatSocialAccountName } from '$lib/utils';

	type DailyPoint = components['schemas']['DailyBreakdownPoint'];
	type DailyItem = components['schemas']['DailyBreakdownItem'];
	type Metric = 'followers' | 'engagement' | 'views';

	interface Props {
		points: DailyPoint[];
		metric: Metric;
		label: string;
		emptyLabel: string;
		otherLabel: string;
		formatValue: (value: number) => string;
		formatDate: (value: string) => string;
	}

	let { points, metric, label, emptyLabel, otherLabel, formatValue, formatDate }: Props = $props();
	let activeDate = $state('');
	let viewportWidth = $state(0);

	const margin = { top: 18, right: 16, bottom: 34, left: 52 };
	const plotHeight = 236;
	const chartHeight = margin.top + plotHeight + margin.bottom;
	const minimumSlotWidth = $derived(points.length > 45 ? 18 : points.length > 20 ? 26 : 42);
	const plotWidth = $derived(
		Math.max(
			680 - margin.left - margin.right,
			viewportWidth - margin.left - margin.right,
			points.length * minimumSlotWidth
		)
	);
	const slotWidth = $derived(plotWidth / Math.max(points.length, 1));
	const chartWidth = $derived(margin.left + plotWidth + margin.right);
	const barWidth = $derived(Math.max(8, Math.min(24, slotWidth - 7)));
	const activePoint = $derived(points.find((point) => point.date === activeDate));
	const rankedKeys = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const point of points) {
			for (const item of point.items ?? []) {
				totals.set(item.key, (totals.get(item.key) ?? 0) + Math.abs(item.value));
			}
		}
		return [...totals.entries()]
			.toSorted((left, right) => right[1] - left[1])
			.slice(0, 5)
			.map(([key]) => key);
	});
	const domain = $derived.by(() => {
		let highest = 0;
		let lowest = 0;
		for (const point of points) {
			const positive = (point.items ?? []).reduce(
				(total, item) => total + Math.max(0, item.value),
				0
			);
			const negative = (point.items ?? []).reduce(
				(total, item) => total + Math.min(0, item.value),
				0
			);
			highest = Math.max(highest, positive);
			lowest = Math.min(lowest, negative);
		}
		if (highest === 0 && lowest === 0) highest = 1;
		return { highest, lowest };
	});
	const ticks = $derived(
		Array.from(
			{ length: 5 },
			(_, index) => domain.lowest + ((domain.highest - domain.lowest) * index) / 4
		)
	);
	const labelInterval = $derived(Math.max(1, Math.ceil(points.length / 7)));

	function y(value: number) {
		const span = domain.highest - domain.lowest || 1;
		return margin.top + ((domain.highest - value) / span) * plotHeight;
	}

	function x(index: number) {
		return margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
	}

	function positiveSegments(point: DailyPoint) {
		let top = 0;
		return (point.items ?? [])
			.filter((item) => item.value > 0)
			.map((item) => {
				const start = top;
				top += item.value;
				return { item, start, end: top };
			});
	}

	function negativeSegments(point: DailyPoint) {
		let bottom = 0;
		return (point.items ?? [])
			.filter((item) => item.value < 0)
			.map((item) => {
				const start = bottom;
				bottom += item.value;
				return { item, start, end: bottom };
			});
	}

	function segmentColor(item: DailyItem) {
		const index = rankedKeys.indexOf(item.key);
		return index >= 0 ? `var(--analytics-series-${index + 1})` : 'var(--analytics-series-other)';
	}

	function tooltipItems(point: DailyPoint) {
		const items = [...(point.items ?? [])].toSorted(
			(left, right) => Math.abs(right.value) - Math.abs(left.value)
		);
		if (items.length <= 5) return items;
		const visible = items.slice(0, 5);
		visible.push({
			key: 'other',
			label: otherLabel,
			platform: '',
			value: items.slice(5).reduce((total, item) => total + item.value, 0)
		});
		return visible;
	}

	function pointLabel(point: DailyPoint) {
		return `${formatDate(point.date)}, ${formatValue(point.value)} ${label}`;
	}

	function tooltipItemLabel(item: DailyItem) {
		return metric === 'followers'
			? formatSocialAccountName(item.label, item.platform) || item.label
			: item.label;
	}

	function platformLabel(platform: string) {
		if (platform.toLowerCase() === 'x') return 'X';
		return platform.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
	}
</script>

<figure class="min-w-0" aria-label={label} data-metric={metric}>
	{#if points.length}
		<div
			class="relative overflow-x-auto overscroll-x-contain pb-1"
			data-testid="analytics-chart-scroll"
			bind:clientWidth={viewportWidth}
		>
			<div class="relative" style={`width: ${chartWidth}px; height: ${chartHeight}px`}>
				<svg
					viewBox={`0 0 ${chartWidth} ${chartHeight}`}
					class="block h-full w-full overflow-visible"
					role="img"
					aria-label={label}
				>
					{#each ticks as tick (tick)}
						<line
							x1={margin.left}
							x2={chartWidth - margin.right}
							y1={y(tick)}
							y2={y(tick)}
							class={Math.abs(tick) < 0.0001 ? 'stroke-border' : 'stroke-border/60'}
						/>
						<text
							x={margin.left - 10}
							y={y(tick) + 4}
							text-anchor="end"
							class="fill-muted-foreground text-[11px] tabular-nums"
						>
							{formatValue(Math.round(tick))}
						</text>
					{/each}

					{#each points as point, index (point.date)}
						<g
							class="analytics-day"
							role="button"
							tabindex="0"
							aria-label={pointLabel(point)}
							onclick={() => (activeDate = point.date)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									activeDate = point.date;
								}
							}}
							onmouseenter={() => (activeDate = point.date)}
							onmouseleave={() => (activeDate = '')}
							onfocus={() => (activeDate = point.date)}
							onblur={() => (activeDate = '')}
						>
							{#each positiveSegments(point) as segment (`positive-${segment.item.key}`)}
								<rect
									x={x(index)}
									y={y(segment.end)}
									width={barWidth}
									height={Math.max(1, y(segment.start) - y(segment.end))}
									rx="2"
									fill={segmentColor(segment.item)}
								/>
							{/each}
							{#each negativeSegments(point) as segment (`negative-${segment.item.key}`)}
								<rect
									x={x(index)}
									y={y(segment.start)}
									width={barWidth}
									height={Math.max(1, y(segment.end) - y(segment.start))}
									rx="2"
									fill={segmentColor(segment.item)}
								/>
							{/each}
							<rect
								x={margin.left + index * slotWidth}
								y={margin.top}
								width={slotWidth}
								height={plotHeight}
								fill="transparent"
								class="analytics-hit-area cursor-crosshair"
							/>
							{#if index % labelInterval === 0 || index === points.length - 1}
								<text
									x={x(index) + barWidth / 2}
									y={chartHeight - 9}
									text-anchor="middle"
									class="fill-muted-foreground text-[11px]"
								>
									{formatDate(point.date)}
								</text>
							{/if}
						</g>
					{/each}
				</svg>

				{#if activePoint}
					<div
						class="pointer-events-none absolute top-2 z-10 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
						style={`left: ${Math.min(chartWidth - 140, Math.max(140, x(points.indexOf(activePoint)) + barWidth / 2))}px`}
						role="status"
					>
						<div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
							<p class="text-xs font-medium">{formatDate(activePoint.date)}</p>
							<p class="font-mono text-xs font-semibold tabular-nums">
								{activePoint.value >= 0 ? '+' : ''}{formatValue(activePoint.value)}
							</p>
						</div>
						<div class="mt-2 grid gap-2">
							{#each tooltipItems(activePoint) as item (item.key)}
								<div class="flex min-w-0 items-center gap-2">
									<span
										class="size-2 shrink-0 rounded-[2px]"
										style={`background: ${segmentColor(item)}`}
									></span>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-medium">{tooltipItemLabel(item)}</p>
										{#if item.platform}
											<p
												class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
												data-testid="analytics-tooltip-platform"
											>
												<PlatformIcon platform={item.platform} class="size-3" />
												{platformLabel(item.platform)}
											</p>
										{/if}
									</div>
									<span class="font-mono text-xs font-medium tabular-nums">
										{item.value >= 0 ? '+' : ''}{formatValue(item.value)}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<div class="sr-only">
			<table>
				<caption>{label}</caption>
				<thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
				<tbody>
					{#each points as point (`table-${point.date}`)}
						<tr><td>{point.date}</td><td>{formatValue(point.value)}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div
			class="flex min-h-64 items-center justify-center border-y border-dashed text-sm text-muted-foreground"
		>
			{emptyLabel}
		</div>
	{/if}
</figure>

<style>
	figure {
		--analytics-series-1: oklch(0.62 0.17 45);
		--analytics-series-2: oklch(0.61 0.13 235);
		--analytics-series-3: oklch(0.64 0.14 155);
		--analytics-series-4: oklch(0.63 0.16 315);
		--analytics-series-5: oklch(0.69 0.14 85);
		--analytics-series-other: color-mix(in oklch, var(--muted-foreground) 34%, transparent);
	}

	.analytics-day:focus-visible .analytics-hit-area {
		stroke: var(--ring);
		stroke-width: 2;
	}
</style>
