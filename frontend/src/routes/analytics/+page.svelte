<!--
THESIS: Analytics is a measured operating view, not a reporting spectacle.
OWN-WORLD: It uses OpenPost's existing warm accent, flat borders, compact controls, and provider marks.
STORY: Read totals, inspect one account trend, then compare published content.
FIRST VIEWPORT: The reporting window, refresh action, metric ledger, and trend context are visible without scrolling.
FORM: A ranked account shelf controls one primary chart; content follows as a dense, responsive ledger.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import AnalyticsTrend from '$lib/components/analytics-trend.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import AnalyticsIcon from 'lucide-svelte/icons/chart-no-axes-combined';
	import AccountsIcon from 'lucide-svelte/icons/users';
	import RefreshIcon from 'lucide-svelte/icons/refresh-cw';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';

	type AnalyticsOverview = components['schemas']['Overview'];
	type AnalyticsAccount = components['schemas']['AccountOverview'];
	type AnalyticsContent = components['schemas']['ContentOverview'];
	type MetricSummary = components['schemas']['MetricSummary'];
	type RangeDays = 7 | 30 | 90;

	let overview = $state.raw<AnalyticsOverview | null>(null);
	let rangeDays = $state<RangeDays>(30);
	let selectedAccountID = $state('');
	let loading = $state(true);
	let refreshing = $state(false);
	let error = $state('');
	let toastMessage = $state('');
	let dataWorkspaceID = $state('');
	let dataRequestSequence = 0;

	const currentWorkspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const accounts = $derived(overview?.accounts ?? []);
	const content = $derived(overview?.content ?? []);
	const selectedAccount = $derived(
		accounts.find((account) => account.id === selectedAccountID) ??
			accounts.find((account) => (account.follower_series?.length ?? 0) > 1) ??
			accounts[0]
	);
	const hasMeasurements = $derived(
		accounts.some((account) => Boolean(account.last_synced_at)) ||
			content.some((item) => Boolean(item.last_synced_at))
	);
	const reconnectRequired = $derived(
		accounts.some(
			(account) =>
				account.status === 'permission_required' ||
				(account.missing_content_scopes?.length ?? 0) > 0
		)
	);
	const initialLoading = $derived(
		Boolean(currentWorkspaceID) && loading && (!overview || dataWorkspaceID !== currentWorkspaceID)
	);
	const summaryMetrics = $derived.by(() => {
		const summary = overview?.summary;
		if (!summary) return [];
		return [
			{ label: m.analytics_summary_followers(), metric: summary.followers },
			{ label: m.analytics_summary_engagement(), metric: summary.engagement },
			{ label: m.analytics_views(), metric: summary.views },
			{ label: m.analytics_impressions(), metric: summary.impressions },
			{ label: m.analytics_reach(), metric: summary.reach }
		];
	});

	$effect(() => {
		const workspaceID = currentWorkspaceID;
		const days = rangeDays;
		if (workspaceID) void loadAnalytics(workspaceID, days);
	});

	async function loadAnalytics(
		requestedWorkspaceID = currentWorkspaceID,
		requestedDays = rangeDays
	) {
		const requestSequence = ++dataRequestSequence;
		let workspaceID = requestedWorkspaceID;
		loading = true;
		error = '';
		try {
			if (!workspaceCtx.currentWorkspace) await workspaceCtx.initialize();
			workspaceID ||= workspaceCtx.currentWorkspace?.id ?? '';
			if (!workspaceID) throw new Error(m.analytics_failed_load());
			const response = await client.GET('/analytics', {
				params: { query: { workspace_id: workspaceID, days: requestedDays } }
			});
			if (
				requestSequence !== dataRequestSequence ||
				(workspaceCtx.currentWorkspace?.id ?? '') !== workspaceID
			) {
				return;
			}
			if (response.error || !response.data) throw new Error(m.analytics_failed_load());
			overview = response.data;
			dataWorkspaceID = workspaceID;
			if (!response.data.accounts?.some((account) => account.id === selectedAccountID)) {
				selectedAccountID =
					response.data.accounts?.find((account) => (account.follower_series?.length ?? 0) > 1)
						?.id ??
					response.data.accounts?.[0]?.id ??
					'';
			}
		} catch (cause) {
			if (requestSequence !== dataRequestSequence) return;
			error = cause instanceof Error ? cause.message : m.analytics_failed_load();
		} finally {
			if (requestSequence === dataRequestSequence) loading = false;
		}
	}

	async function refreshAnalytics() {
		if (!currentWorkspaceID || refreshing) return;
		refreshing = true;
		try {
			const response = await client.POST('/analytics/refresh', {
				body: { workspace_id: currentWorkspaceID }
			});
			if (response.error || !response.data) throw new Error(m.analytics_refresh_failed());
			toastMessage = m.analytics_refresh_queued({ count: response.data.queued });
		} catch {
			toastMessage = m.analytics_refresh_failed();
		} finally {
			refreshing = false;
		}
	}

	function formatNumber(value: number) {
		return new Intl.NumberFormat(getLocaleTag(), {
			notation: 'compact',
			maximumFractionDigits: 1
		}).format(value);
	}

	function formatDate(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: workspaceCtx.settings.timezone || 'UTC'
		}).format(new Date(value));
	}

	function formatDateTime(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: workspaceCtx.settings.timezone || 'UTC'
		}).format(new Date(value));
	}

	function metricValue(metric: MetricSummary) {
		return metric.measured > 0 ? formatNumber(metric.value) : '—';
	}

	function accountStatus(account: AnalyticsAccount) {
		if (account.status === 'permission_required') return m.analytics_permission_required();
		if (account.status === 'unsupported') return m.analytics_unsupported();
		if (account.status === 'rate_limited') return m.analytics_rate_limited();
		if (account.status === 'not_found') return m.analytics_not_found();
		if (account.status === 'failed') return m.analytics_collection_failed();
		if (!account.last_synced_at) return m.analytics_no_measurement();
		return '';
	}

	function accountStatusClass(account: AnalyticsAccount) {
		if (account.status === 'permission_required') return 'text-amber-700 dark:text-amber-300';
		if (account.status === 'failed') return 'text-destructive';
		if (account.status === 'rate_limited') return 'text-amber-700 dark:text-amber-300';
		return 'text-muted-foreground';
	}

	function contentStatus(item: AnalyticsContent) {
		if (item.status === 'permission_required') return m.analytics_permission_required();
		if (item.status === 'unsupported') return m.analytics_unsupported();
		if (item.status === 'rate_limited') return m.analytics_rate_limited();
		if (item.status === 'not_found') return m.analytics_not_found();
		if (item.status === 'failed') return m.analytics_collection_failed();
		return '';
	}

	function hasEngagementMeasurement(item: AnalyticsContent) {
		return ['likes', 'comments', 'reposts', 'quotes', 'shares', 'saves', 'clicks'].some(
			(metric) => metric in item.metrics
		);
	}

	function exposure(item: AnalyticsContent) {
		for (const metric of [
			{ key: 'views', label: m.analytics_views() },
			{ key: 'impressions', label: m.analytics_impressions() },
			{ key: 'reach', label: m.analytics_reach() }
		]) {
			if (metric.key in item.metrics)
				return { label: metric.label, value: item.metrics[metric.key] };
		}
		return null;
	}
</script>

<svelte:head>
	<title>{m.analytics_title()} · OpenPost</title>
</svelte:head>

{#snippet actions()}
	<div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
		<div
			class="flex min-h-11 items-center rounded-md border border-border p-1 md:min-h-9"
			role="group"
			aria-label={m.analytics_range_label()}
		>
			{#each [7, 30, 90] as days (days)}
				<button
					type="button"
					class={[
						'min-h-9 rounded-sm px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-7',
						rangeDays === days
							? 'bg-secondary text-secondary-foreground'
							: 'text-muted-foreground hover:text-foreground'
					]}
					aria-pressed={rangeDays === days}
					onclick={() => (rangeDays = days as RangeDays)}
				>
					{m.analytics_range_days({ days })}
				</button>
			{/each}
		</div>
		<Button
			variant="outline"
			size="sm"
			onclick={refreshAnalytics}
			disabled={refreshing || !overview || accounts.length === 0}
		>
			<RefreshIcon class={refreshing ? 'size-4 animate-spin' : 'size-4'} />
			{refreshing ? m.analytics_refreshing() : m.analytics_refresh()}
		</Button>
	</div>
{/snippet}

{#if toastMessage}
	<AppToast
		message={toastMessage}
		onDismiss={() => (toastMessage = '')}
		dismissLabel={m.common_dismiss()}
		tone={toastMessage === m.analytics_refresh_failed() ? 'error' : 'success'}
	/>
{/if}

<PageContainer
	title={m.analytics_title()}
	icon={AnalyticsIcon}
	description={m.analytics_description()}
	{actions}
	loading={initialLoading}
	loadingMessage={m.common_loading()}
	loadingLayout="sections"
	loadingItems={5}
	loadingActionCount={2}
>
	{#if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => loadAnalytics()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else if accounts.length === 0}
		<EmptyState
			icon={AccountsIcon}
			title={m.analytics_no_accounts_title()}
			description={m.analytics_no_accounts_description()}
			actionLabel={m.analytics_no_accounts_action()}
			actionHref="/accounts"
			size="lg"
		/>
	{:else}
		<div class="space-y-8">
			{#if reconnectRequired}
				<InlineNotice tone="warning" message={m.analytics_permission_required()}>
					{#snippet actions()}
						<Button href="/accounts" variant="outline" size="sm">{m.analytics_reconnect()}</Button>
					{/snippet}
				</InlineNotice>
			{/if}

			<section aria-label={m.analytics_title()} class="border-y border-border">
				<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
					{#each summaryMetrics as item (item.label)}
						<div
							class="min-w-0 border-b border-border px-3 py-4 odd:border-r md:border-r lg:border-b-0"
						>
							<p class="text-xs text-muted-foreground">{item.label}</p>
							<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
								{metricValue(item.metric)}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{m.analytics_measured_count({ count: item.metric.measured })}
							</p>
						</div>
					{/each}
					<div class="min-w-0 px-3 py-4">
						<p class="text-xs text-muted-foreground">{m.analytics_published()}</p>
						<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
							{formatNumber(overview?.summary.published ?? 0)}
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{m.analytics_range_days({ days: rangeDays })}
						</p>
					</div>
				</div>
			</section>

			{#if !hasMeasurements}
				<InlineNotice tone="info" message={m.analytics_waiting_description()} />
			{/if}

			<div class="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
				<section class="min-w-0" aria-labelledby="analytics-trend-heading">
					<div class="mb-5">
						<h2 id="analytics-trend-heading" class="text-base font-semibold">
							{m.analytics_trend_title()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{selectedAccount
								? `${selectedAccount.username} · ${m.analytics_trend_description()}`
								: m.analytics_trend_description()}
						</p>
					</div>
					<AnalyticsTrend
						points={selectedAccount?.follower_series ?? []}
						label={`${m.analytics_trend_title()}: ${selectedAccount?.username ?? ''}`}
						emptyLabel={m.analytics_no_trend()}
						formatValue={formatNumber}
					/>
				</section>

				<section aria-labelledby="analytics-accounts-heading">
					<h2 id="analytics-accounts-heading" class="text-base font-semibold">
						{m.analytics_accounts_title()}
					</h2>
					<div class="mt-3 divide-y divide-border border-y border-border">
						{#each accounts as account (account.id)}
							<button
								type="button"
								class={[
									'flex min-h-16 w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
									selectedAccount?.id === account.id && 'bg-muted/70'
								]}
								aria-pressed={selectedAccount?.id === account.id}
								onclick={() => (selectedAccountID = account.id)}
							>
								<span
									class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background"
								>
									<PlatformIcon platform={account.platform} class="size-4" />
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{account.username}</span>
									{#if accountStatus(account)}
										<span class={['mt-0.5 block text-xs', accountStatusClass(account)]}>
											{accountStatus(account)}
										</span>
									{:else if 'followers' in account.metrics}
										<span class="mt-0.5 block text-xs text-muted-foreground">
											{formatNumber(account.metrics.followers)}
											{m.analytics_summary_followers().toLowerCase()}
										</span>
									{:else}
										<span class="mt-0.5 block text-xs text-muted-foreground">
											{m.analytics_no_measurement()}
										</span>
									{/if}
								</span>
								{#if account.follower_delta !== undefined}
									<span
										class={[
											'text-xs font-medium tabular-nums',
											account.follower_delta >= 0
												? 'text-emerald-700 dark:text-emerald-300'
												: 'text-destructive'
										]}
									>
										{account.follower_delta >= 0 ? '+' : ''}{formatNumber(account.follower_delta)}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</section>
			</div>

			<section aria-labelledby="analytics-content-heading">
				<div class="mb-4">
					<h2 id="analytics-content-heading" class="text-base font-semibold">
						{m.analytics_content_title()}
					</h2>
					<p class="mt-1 text-sm text-muted-foreground">{m.analytics_content_description()}</p>
				</div>
				{#if content.length === 0}
					<p class="border-y border-dashed border-border py-8 text-sm text-muted-foreground">
						{m.analytics_content_empty()}
					</p>
				{:else}
					<div class="hidden overflow-x-auto border-y border-border md:block">
						<table class="w-full min-w-[42rem] text-left text-sm">
							<thead class="text-xs text-muted-foreground">
								<tr>
									<th scope="col" class="px-2 py-3 font-medium">{m.analytics_content_title()}</th>
									<th scope="col" class="px-2 py-3 font-medium"
										>{m.analytics_summary_engagement()}</th
									>
									<th scope="col" class="px-2 py-3 font-medium">{m.analytics_views()}</th>
									<th scope="col" class="px-2 py-3 font-medium">{m.analytics_published()}</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border">
								{#each content as item (item.rendition_id)}
									{@const measuredExposure = exposure(item)}
									<tr>
										<td class="max-w-md px-2 py-3">
											<div class="flex items-center gap-2.5">
												<PlatformIcon platform={item.platform} class="size-4 shrink-0" />
												<div class="min-w-0">
													<a
														href={resolve('/publications/[id]', { id: item.publication_id })}
														class="block truncate font-medium hover:underline"
													>
														{item.title}
													</a>
													<p class="truncate text-xs text-muted-foreground">{item.username}</p>
													{#if contentStatus(item)}
														<p class="truncate text-xs text-amber-700 dark:text-amber-300">
															{contentStatus(item)}
														</p>
													{/if}
												</div>
											</div>
										</td>
										<td class="px-2 py-3 font-medium tabular-nums">
											{hasEngagementMeasurement(item) ? formatNumber(item.engagement) : '—'}
										</td>
										<td class="px-2 py-3 tabular-nums">
											{measuredExposure
												? `${formatNumber(measuredExposure.value)} ${measuredExposure.label.toLowerCase()}`
												: '—'}
										</td>
										<td class="px-2 py-3 text-muted-foreground">{formatDate(item.published_at)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="divide-y divide-border border-y border-border md:hidden">
						{#each content as item (item.rendition_id)}
							{@const measuredExposure = exposure(item)}
							<a
								href={resolve('/publications/[id]', { id: item.publication_id })}
								class="block px-1 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								<div class="flex items-start gap-2.5">
									<PlatformIcon platform={item.platform} class="mt-0.5 size-4 shrink-0" />
									<div class="min-w-0 flex-1">
										<p class="line-clamp-2 text-sm font-medium">{item.title}</p>
										<p class="mt-1 text-xs text-muted-foreground">
											{item.username} · {formatDate(item.published_at)}
										</p>
										{#if contentStatus(item)}
											<p class="mt-1 text-xs text-amber-700 dark:text-amber-300">
												{contentStatus(item)}
											</p>
										{/if}
										<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
											<span
												>{m.analytics_summary_engagement()}: {hasEngagementMeasurement(item)
													? formatNumber(item.engagement)
													: '—'}</span
											>
											{#if measuredExposure}
												<span>{measuredExposure.label}: {formatNumber(measuredExposure.value)}</span
												>
											{/if}
										</div>
									</div>
								</div>
							</a>
						{/each}
					</div>
				{/if}
			</section>

			{#if overview?.last_synced_at}
				<p class="text-xs text-muted-foreground">
					{m.analytics_last_updated({ date: formatDateTime(overview.last_synced_at) })}
				</p>
			{/if}
		</div>
	{/if}
</PageContainer>
