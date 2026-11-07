<script lang="ts">
	import type { components } from '$lib/api/types';
	import { RadarChart, type RadarSeries } from '@openpost/ui/components/dither';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { getPlatformName } from '$lib/utils';

	type Performance = components['schemas']['AccountPerformance'];
	let {
		items,
		formatValue
	}: {
		items: Performance[];
		formatValue: (value: number) => string;
	} = $props();

	/** More networks than this turns the radar into noise; the strongest ones stay. */
	const MAX_NETWORKS = 4;

	type Totals = {
		platform: string;
		visibility: number;
		visibilityMeasured: boolean;
		engagement: number;
		engagementMeasured: boolean;
		followers: number;
		growth: number;
		posts: number;
	};

	// Accounts on the same network add up; unmeasured metrics stay unmeasured instead of zero.
	const networks = $derived.by(() => {
		const byPlatform = new Map<string, Totals>();
		for (const item of items) {
			const current = byPlatform.get(item.platform) ?? {
				engagement: 0,
				engagementMeasured: false,
				followers: 0,
				growth: 0,
				platform: item.platform,
				posts: 0,
				visibility: 0,
				visibilityMeasured: false
			};
			if (item.visibility.measured > 0) {
				current.visibility += item.visibility.value;
				current.visibilityMeasured = true;
			}
			if (item.engagement.measured > 0) {
				current.engagement += item.engagement.value;
				current.engagementMeasured = true;
			}
			current.followers += item.followers ?? 0;
			current.growth += Math.max(0, item.follower_delta ?? 0);
			current.posts += item.publication_count;
			byPlatform.set(item.platform, current);
		}
		return [...byPlatform.values()]
			.toSorted(
				(left, right) => right.visibility + right.followers - (left.visibility + left.followers)
			)
			.slice(0, MAX_NETWORKS);
	});

	const percent = $derived(
		new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 1, style: 'percent' })
	);
	const measures = $derived([
		{
			label: m.analytics_visibility(),
			read: (n: Totals) => (n.visibilityMeasured ? n.visibility : null),
			text: formatValue
		},
		{
			label: m.analytics_summary_engagement(),
			read: (n: Totals) => (n.engagementMeasured ? n.engagement : null),
			text: formatValue
		},
		{
			label: m.analytics_engagement_rate(),
			read: (n: Totals) =>
				n.visibilityMeasured && n.engagementMeasured && n.visibility > 0
					? n.engagement / n.visibility
					: null,
			text: (value: number) => percent.format(value)
		},
		{ label: m.analytics_summary_followers(), read: (n: Totals) => n.followers, text: formatValue },
		{
			label: m.analytics_follower_growth(),
			read: (n: Totals) => n.growth,
			text: (value: number) => `+${formatValue(value)}`
		},
		{ label: m.analytics_distinct_posts(), read: (n: Totals) => n.posts, text: formatValue }
	]);

	// Each axis is scaled to the strongest network, so one large audience cannot flatten the rest.
	const series = $derived.by((): RadarSeries[] => {
		const leaders = measures.map((measure) =>
			Math.max(0, ...networks.map((network) => measure.read(network) ?? 0))
		);
		return networks.map((network) => ({
			details: measures.map((measure) => {
				const value = measure.read(network);
				return value === null ? '—' : measure.text(value);
			}),
			label: getPlatformName(network.platform),
			values: measures.map((measure, index) => {
				const value = measure.read(network) ?? 0;
				const leader = leaders[index] ?? 0;
				return leader > 0 ? (value / leader) * 100 : 0;
			})
		}));
	});
	const axes = $derived(measures.map((measure): string => measure.label) as [string, ...string[]]);
</script>

{#if series.length >= 2}
	<RadarChart
		{axes}
		series={series as [RadarSeries, ...RadarSeries[]]}
		max={100}
		size={520}
		format={(value) => `${Math.round(value)}%`}
		locale={getLocaleTag()}
		summary={m.analytics_network_profile_description()}
		testId="analytics-network-profile"
	/>
{/if}
