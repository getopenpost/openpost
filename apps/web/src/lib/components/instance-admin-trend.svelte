<script lang="ts">
	import { BarChart } from '@openpost/ui/components/dither';
	import { getLocaleTag } from '$lib/i18n';

	interface Point {
		date: string;
		value: number;
	}

	interface Props {
		points: Point[];
		label: string;
		seriesLabel: string;
		emptyLabel: string;
	}

	let { points, label, seriesLabel, emptyLabel }: Props = $props();

	const rows = $derived(
		points.map((point) => ({
			label: new Date(`${point.date}T00:00:00Z`).toLocaleDateString(getLocaleTag(), {
				month: 'short',
				day: 'numeric',
				timeZone: 'UTC'
			}),
			value: point.value
		}))
	);
	const hasActivity = $derived(points.some((point) => point.value > 0));
	const formatValue = (value: number) => new Intl.NumberFormat(getLocaleTag()).format(value);
</script>

<figure class="min-w-0" aria-label={label}>
	{#if rows.length > 1 && hasActivity}
		<BarChart
			data={rows}
			x="label"
			series={[{ label: seriesLabel, value: 'value' }]}
			height={224}
			format={formatValue}
			locale={getLocaleTag()}
			ariaLabel={label}
		/>
	{:else}
		<div
			class="flex min-h-56 items-center justify-center border-y border-dashed text-sm text-muted-foreground"
		>
			{emptyLabel}
		</div>
	{/if}
</figure>
