<script lang="ts">
	import type { components } from '$lib/api/types';
	import { AreaChart, BarChart } from '@openpost/ui/components/dither';
	import { getLocaleTag } from '$lib/i18n';
	import { getPlatformName } from '$lib/utils';

	type DailyPoint = components['schemas']['DailyBreakdownPoint'];
	type SeriesPoint = components['schemas']['SeriesPoint'];
	type Metric = 'followers' | 'engagement' | 'views' | 'visibility';

	interface Props {
		points: DailyPoint[];
		/** Account-wide follower totals by day, drawn for the followers metric. */
		followerSeries?: SeriesPoint[];
		metric: Metric;
		label: string;
		emptyLabel: string;
		otherLabel: string;
		formatValue: (value: number) => string;
		formatDate: (value: string) => string;
	}

	let {
		points,
		followerSeries = [],
		metric,
		label,
		emptyLabel,
		otherLabel,
		formatValue,
		formatDate
	}: Props = $props();

	/** Named networks before the rest share one grey Other series. */
	const MAX_PLATFORMS = 4;
	const OTHER = '__other__';

	// Rank networks by their total in the period so each keeps one colour for the whole range.
	const platforms = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const point of points) {
			for (const item of point.items ?? []) {
				const platform = item.platform || item.key;
				totals.set(platform, (totals.get(platform) ?? 0) + Math.max(0, item.value));
			}
		}
		const ranked = [...totals.entries()]
			.filter(([, total]) => total > 0)
			.toSorted((left, right) => right[1] - left[1])
			.map(([platform]) => platform);
		return { named: ranked.slice(0, MAX_PLATFORMS), hasOther: ranked.length > MAX_PLATFORMS };
	});

	type Row = { date: string; label: string; values: Record<string, number> };
	const rows = $derived(
		points.map((point): Row => {
			const values: Record<string, number> = {};
			for (const item of point.items ?? []) {
				const platform = item.platform || item.key;
				const key = platforms.named.includes(platform) ? platform : OTHER;
				values[key] = (values[key] ?? 0) + Math.max(0, item.value);
			}
			return { date: point.date, label: formatDate(point.date), values };
		})
	);
	const series = $derived([
		...platforms.named.map((platform) => ({
			label: getPlatformName(platform),
			value: (row: Row) => row.values[platform] ?? 0
		})),
		...(platforms.hasOther
			? [{ label: otherLabel, value: (row: Row) => row.values[OTHER] ?? 0, color: 'grey' as const }]
			: [])
	]);
	const followerRows = $derived(
		followerSeries.map((point) => ({ label: formatDate(point.date), value: point.value }))
	);
	const followerChart = $derived(metric === 'followers');
</script>

<figure class="min-w-0" data-testid="analytics-performance-chart">
	{#if followerChart}
		{#if followerRows.length > 1}
			<AreaChart
				data={followerRows}
				x="label"
				series={[{ label, value: 'value', color: 'green' }]}
				height={280}
				format={formatValue}
				locale={getLocaleTag()}
				ariaLabel={label}
			/>
		{:else}
			<p class="py-16 text-center text-sm text-muted-foreground">{emptyLabel}</p>
		{/if}
	{:else if series.length > 0}
		<BarChart
			data={rows}
			x="label"
			series={series as [(typeof series)[number], ...(typeof series)[number][]]}
			layout="stacked"
			height={280}
			format={formatValue}
			locale={getLocaleTag()}
			ariaLabel={label}
		/>
	{:else}
		<p class="py-16 text-center text-sm text-muted-foreground">{emptyLabel}</p>
	{/if}
</figure>
