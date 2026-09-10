<script lang="ts">
	import type { components } from '$lib/api/types';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { m } from '$lib/paraglide/messages';

	type Account = components['schemas']['AccountOverview'];
	type Slice = { account: Account | null; value: number };
	let {
		accounts,
		formatValue,
		accountLabel
	}: {
		accounts: Account[];
		formatValue: (value: number) => string;
		accountLabel: (account: Account) => string;
	} = $props();
	const radius = 52;
	const center = 64;
	const circumference = 2 * Math.PI * radius;
	const maximumNamedAccounts = 4;
	const slices = $derived.by(() => {
		const measured = accounts
			.map((account) => ({ account, value: account.metrics.followers }))
			.filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
			.toSorted((left, right) => right.value - left.value);
		const visible: Slice[] = measured.slice(0, maximumNamedAccounts);
		const other = measured.slice(maximumNamedAccounts).reduce((sum, slice) => sum + slice.value, 0);
		if (other > 0) visible.push({ account: null, value: other });
		const total = visible.reduce((sum, slice) => sum + slice.value, 0);
		let offset = 0;
		return visible.map((slice, index) => {
			const length = (slice.value / total) * circumference;
			const segment = {
				...slice,
				length,
				offset,
				color: slice.account ? `var(--chart-${index + 1})` : 'var(--muted-foreground)',
				label: slice.account ? accountLabel(slice.account) : m.analytics_other_accounts()
			};
			offset -= length;
			return segment;
		});
	});
	const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0));
</script>

<figure
	class="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center"
	aria-label={m.analytics_audience_title()}
>
	{#if total > 0}
		<div class="relative mx-auto size-40 sm:mx-0" data-testid="analytics-composition-chart">
			<svg viewBox="0 0 128 128" class="size-full" aria-hidden="true">
				{#each slices as slice (slice.account?.id ?? 'other')}
					<g
						fill="none"
						stroke-width="14"
						stroke-dasharray={`${slice.length} ${circumference - slice.length}`}
						stroke-dashoffset={slice.offset}
						transform="rotate(-90 64 64)"
					>
						<circle data-chart-ring cx={center} cy={center} r={radius} stroke={slice.color} />
						<circle
							class="ring-texture"
							cx={center}
							cy={center}
							r={radius}
							stroke="var(--background)"
						/>
					</g>
				{/each}
			</svg>
			<div
				class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1"
			>
				<span class="text-lg font-semibold tabular-nums">{formatValue(total)}</span>
				<span class="text-xs text-muted-foreground">{m.analytics_summary_followers()}</span>
			</div>
		</div>
		<dl class="grid min-w-0 gap-3">
			{#each slices as slice (slice.account?.id ?? 'other')}
				<div class="flex min-w-0 items-center gap-3 text-sm">
					<dt class="flex min-w-0 flex-1 items-center gap-2">
						<span
							class="size-2.5 shrink-0 rounded-xs"
							style:background={slice.color}
							aria-hidden="true"
						></span>
						{#if slice.account}<PlatformIcon
								platform={slice.account.platform}
								class="size-4 shrink-0"
							/>{/if}
						<span class="truncate">{slice.label}</span>
					</dt>
					<dd class="shrink-0 tabular-nums" title={String(slice.value)}>
						{formatValue(slice.value)}
					</dd>
				</div>
			{/each}
		</dl>
	{:else}
		<p class="py-8 text-sm text-muted-foreground sm:col-span-2">{m.analytics_audience_empty()}</p>
	{/if}
</figure>

<style>
	.ring-texture {
		display: none;
	}
	:global([data-theme-decoration='dither']) .ring-texture {
		display: block;
		opacity: 0.22;
		mask-image: var(--theme-dither-mask);
		mask-size: 8px 100%;
		mask-repeat: repeat-x;
		mask-origin: stroke-box;
		mask-clip: stroke-box;
	}
	@media (forced-colors: active) {
		:global([data-theme-decoration='dither']) .ring-texture {
			display: none;
		}
	}
</style>
