<script lang="ts">
	import { scaleUtc } from 'd3-scale';
	import { curveNatural } from 'd3-shape';
	import { LineChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import { paddedMetricDomain } from '$lib/analytics-chart';
	import { m } from '$lib/paraglide/messages';

	interface Point {
		date: string;
		value: number;
	}

	interface Props {
		points: Point[];
		label: string;
		emptyLabel: string;
		formatValue: (value: number) => string;
	}

	let { points, label, emptyLabel, formatValue }: Props = $props();

	const chartData = $derived(
		points.map((point) => ({
			date: new Date(`${point.date}T00:00:00Z`),
			value: point.value
		}))
	);
	const chartConfig = $derived({
		value: {
			label: m.analytics_summary_followers(),
			color: 'var(--chart-1)'
		}
	} satisfies Chart.ChartConfig);
	const yDomain = $derived(paddedMetricDomain(chartData.map((point) => point.value)));
</script>

<figure class="min-w-0">
	{#if chartData.length > 1}
		<Chart.Container
			config={chartConfig}
			class="aspect-auto h-60 w-full"
			role="img"
			aria-label={label}
		>
			<LineChart
				points={{ r: 3 }}
				data={chartData}
				x="date"
				xScale={scaleUtc()}
				{yDomain}
				axis
				series={[
					{
						key: 'value',
						label: chartConfig.value.label,
						color: chartConfig.value.color
					}
				]}
				props={{
					spline: { curve: curveNatural, motion: 'tween', strokeWidth: 2 },
					highlight: { points: { motion: 'none', r: 5 } },
					xAxis: {
						format: (value: Date) =>
							value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
					},
					yAxis: { format: (value: number) => formatValue(value) }
				}}
			>
				{#snippet tooltip()}
					<Chart.Tooltip
						labelFormatter={(value) =>
							value instanceof Date
								? value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
								: String(value)}
					/>
				{/snippet}
			</LineChart>
		</Chart.Container>

		<div class="sr-only">
			<table>
				<caption>{label}</caption>
				<thead>
					<tr
						><th scope="col">{m.analytics_table_date()}</th><th scope="col"
							>{m.analytics_table_value()}</th
						></tr
					>
				</thead>
				<tbody>
					{#each points as point (`table-${point.date}`)}
						<tr><td>{point.date}</td><td>{formatValue(point.value)}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div
			class="flex min-h-56 items-center justify-center border-y border-dashed text-sm text-muted-foreground"
		>
			{emptyLabel}
		</div>
	{/if}
</figure>
