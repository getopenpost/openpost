<script lang="ts">
	import type { components } from '$lib/api/types';
	import { DonutChart, type DonutSlice } from '@openpost/ui/components/dither';
	import SocialAccountAvatar from '$lib/components/social-account-avatar.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	type Account = components['schemas']['AccountOverview'];
	let {
		accounts,
		formatValue,
		accountLabel
	}: {
		accounts: Account[];
		formatValue: (value: number) => string;
		accountLabel: (account: Account) => string;
	} = $props();

	/** Named accounts before the rest share one grey slice. */
	const maximumNamedAccounts = 4;
	type Slice = DonutSlice & { account: Account | null };
	const slices = $derived.by((): Slice[] => {
		const measured = accounts
			.map((account) => ({ account, value: account.metrics.followers }))
			.filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
			.toSorted((left, right) => right.value - left.value);
		const named: Slice[] = measured.slice(0, maximumNamedAccounts).map(({ account, value }) => ({
			account,
			key: account.id,
			label: accountLabel(account),
			value
		}));
		const other = measured.slice(maximumNamedAccounts).reduce((sum, slice) => sum + slice.value, 0);
		return other > 0
			? [
					...named,
					{
						account: null,
						color: 'grey',
						key: 'other',
						label: m.analytics_other_accounts(),
						value: other
					}
				]
			: named;
	});
</script>

<div class="min-w-0" aria-label={m.analytics_audience_title()} role="group">
	{#if slices.length > 0}
		<DonutChart
			data={slices}
			label={m.analytics_summary_followers()}
			size={200}
			format={formatValue}
			locale={getLocaleTag()}
			testId="analytics-composition-chart"
		>
			{#snippet legendLabel(slice: DonutSlice)}
				{@const account = (slice as Slice).account}
				<span class="flex min-w-0 items-center gap-2">
					{#if account}<SocialAccountAvatar
							name={slice.label}
							platform={account.platform}
							avatarUrl={account.avatar_url}
							size="sm"
							class="shrink-0"
						/>{/if}
					<span class="truncate">{slice.label}</span>
				</span>
			{/snippet}
		</DonutChart>
	{:else}
		<p class="py-8 text-sm text-muted-foreground">{m.analytics_audience_empty()}</p>
	{/if}
</div>
