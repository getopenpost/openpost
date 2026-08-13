<!--
THESIS: Analytics follows one OpenPost publication across its provider renditions.
OWN-WORLD: It uses OpenPost's flat borders, compact controls, and provider marks.
STORY: Read exact metric totals, inspect combined or account growth, then expand a publication for provider detail.
FIRST VIEWPORT: The reporting window, refresh action, metric ledger, and unified follower trend are visible without scrolling.
FORM: Publications are the primary rows; provider renditions disclose in place without leaving context.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import AnalyticsTrend from '$lib/components/analytics-trend.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import AnalyticsIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import AccountsIcon from '@lucide/svelte/icons/users';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { hasEngagementMeasurement, type AnalyticsSortMode } from '$lib/analytics-overview';

	type AnalyticsOverview = components['schemas']['Overview'];
	type AnalyticsAccount = components['schemas']['AccountOverview'];
	type AnalyticsContent = components['schemas']['ContentOverview'];
	type AnalyticsPublication = components['schemas']['PublicationOverview'];
	type MetricSummary = components['schemas']['MetricSummary'];
	type RangeDays = 7 | 30 | 90;

	let overview = $state.raw<AnalyticsOverview | null>(null);
	let rangeDays = $state<RangeDays>(30);
	let selectedAccountID = $state('all');
	let sortMode = $state<AnalyticsSortMode>('engagement');
	let expandedPublicationID = $state('');
	let loading = $state(true);
	let loadingMore = $state(false);
	let refreshing = $state(false);
	let error = $state('');
	let toastMessage = $state('');
	let dataWorkspaceID = $state('');
	let dataRequestSequence = 0;

	const currentWorkspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const accounts = $derived(overview?.accounts ?? []);
	const publications = $derived(overview?.publications ?? []);
	const selectedAccount = $derived(
		selectedAccountID === 'all'
			? undefined
			: (accounts.find((account) => account.id === selectedAccountID) ?? accounts[0])
	);
	const selectedFollowerSeries = $derived(
		selectedAccount ? (selectedAccount.follower_series ?? []) : (overview?.follower_series ?? [])
	);
	const accountsNeedingReconnect = $derived(
		accounts.filter(
			(account) =>
				(selectedAccountID === 'all' || account.id === selectedAccountID) &&
				(account.status === 'permission_required' ||
					(account.missing_account_scopes?.length ?? 0) > 0 ||
					(account.missing_content_scopes?.length ?? 0) > 0)
		)
	);
	const displayedSummary = $derived(overview?.summary ?? null);
	const destinationCount = $derived(overview?.content_total ?? 0);
	const hasMeasurements = $derived(
		(selectedAccount
			? Boolean(selectedAccount.last_synced_at)
			: accounts.some((account) => Boolean(account.last_synced_at))) ||
			publications.some((publication) =>
				(publication.renditions ?? []).some((rendition) => Boolean(rendition.last_synced_at))
			)
	);
	const initialLoading = $derived(
		Boolean(currentWorkspaceID) && loading && (!overview || dataWorkspaceID !== currentWorkspaceID)
	);
	const summaryMetrics = $derived.by(() => {
		const summary = displayedSummary;
		if (!summary) return [];
		return [
			{
				label: m.analytics_summary_followers(),
				metric: summary.followers,
				denominator: selectedAccount ? 1 : accounts.length,
				unit: 'account' as const
			},
			{
				label: m.analytics_summary_engagement(),
				metric: summary.engagement,
				denominator: destinationCount,
				unit: 'destination' as const
			},
			{
				label: m.analytics_views(),
				metric: summary.views,
				denominator: destinationCount,
				unit: 'destination' as const
			},
			{
				label: m.analytics_impressions(),
				metric: summary.impressions,
				denominator: destinationCount,
				unit: 'destination' as const
			},
			{
				label: m.analytics_reach(),
				metric: summary.reach,
				denominator: destinationCount,
				unit: 'destination' as const
			}
		];
	});
	const availableSummaryMetrics = $derived(
		summaryMetrics.filter((item) => item.metric.measured > 0)
	);
	const unavailableSummaryMetrics = $derived(
		summaryMetrics.filter((item) => item.metric.measured === 0)
	);
	const analyticsInsights = $derived.by(() => {
		const insights: { title: string; body: string }[] = [];
		const strongestPublication = publications
			.filter((publication) => publication.engagement_measured > 0)
			.toSorted((left, right) => right.engagement - left.engagement)[0];
		if (strongestPublication) {
			insights.push({
				title: m.analytics_insight_top_post(),
				body: m.analytics_insight_top_post_body({
					post: publicationLabel(strongestPublication),
					engagement: formatNumber(strongestPublication.engagement)
				})
			});
		}
		const strongestDestination = publications
			.flatMap((publication) => publication.renditions ?? [])
			.filter(hasEngagementMeasurement)
			.toSorted((left, right) => right.engagement - left.engagement)[0];
		if (strongestDestination) {
			insights.push({
				title: m.analytics_insight_top_destination(),
				body: m.analytics_insight_top_destination_body({
					account: strongestDestination.username,
					engagement: formatNumber(strongestDestination.engagement)
				})
			});
		}
		const decliningAccount = accounts
			.filter((account) => (account.follower_delta ?? 0) < 0)
			.toSorted((left, right) => (left.follower_delta ?? 0) - (right.follower_delta ?? 0))[0];
		if (decliningAccount) {
			insights.push({
				title: m.analytics_insight_follower_decline(),
				body: m.analytics_insight_follower_decline_body({
					account: decliningAccount.username,
					count: formatNumber(Math.abs(decliningAccount.follower_delta ?? 0))
				})
			});
		}
		return insights.slice(0, 3);
	});

	$effect(() => {
		const workspaceID = currentWorkspaceID;
		const days = rangeDays;
		const accountID = selectedAccountID;
		const requestedSort = sortMode;
		if (workspaceID) void loadAnalytics(workspaceID, days, accountID, requestedSort);
	});

	async function loadAnalytics(
		requestedWorkspaceID = currentWorkspaceID,
		requestedDays = rangeDays,
		requestedAccountID = selectedAccountID,
		requestedSort = sortMode,
		cursor = '',
		append = false
	) {
		const requestSequence = ++dataRequestSequence;
		let workspaceID = requestedWorkspaceID;
		if (append) loadingMore = true;
		else loading = true;
		if (!append) error = '';
		try {
			if (!workspaceCtx.currentWorkspace) await workspaceCtx.initialize();
			workspaceID ||= workspaceCtx.currentWorkspace?.id ?? '';
			if (!workspaceID) throw new Error(m.analytics_failed_load());
			const response = await client.GET('/analytics', {
				params: {
					query: {
						workspace_id: workspaceID,
						days: requestedDays,
						account_id: requestedAccountID === 'all' ? undefined : requestedAccountID,
						sort: requestedSort,
						cursor: cursor || undefined,
						limit: 50
					}
				}
			});
			if (
				requestSequence !== dataRequestSequence ||
				(workspaceCtx.currentWorkspace?.id ?? '') !== workspaceID
			) {
				return;
			}
			if (response.error || !response.data) throw new Error(m.analytics_failed_load());
			overview =
				append && overview
					? {
							...response.data,
							publications: [
								...(overview.publications ?? []),
								...(response.data.publications ?? [])
							]
						}
					: response.data;
			dataWorkspaceID = workspaceID;
			if (
				selectedAccountID !== 'all' &&
				!response.data.accounts?.some((account) => account.id === selectedAccountID)
			) {
				selectedAccountID = 'all';
			}
			if (
				expandedPublicationID &&
				!response.data.publications?.some(
					(publication) => publication.publication_id === expandedPublicationID
				)
			) {
				expandedPublicationID = '';
			}
		} catch (cause) {
			if (requestSequence !== dataRequestSequence) return;
			if (append) toastMessage = m.analytics_load_more_failed();
			else error = cause instanceof Error ? cause.message : m.analytics_failed_load();
		} finally {
			if (requestSequence === dataRequestSequence) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function loadMorePublications() {
		if (!overview?.publication_next_cursor || loadingMore) return;
		void loadAnalytics(
			currentWorkspaceID,
			rangeDays,
			selectedAccountID,
			sortMode,
			overview.publication_next_cursor,
			true
		);
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

	function coverageLabel(measured: number, denominator: number, unit: 'account' | 'destination') {
		return unit === 'account'
			? m.analytics_account_coverage({ measured, total: denominator })
			: m.analytics_destination_coverage({ measured, total: denominator });
	}

	function accountStatus(account: AnalyticsAccount) {
		if (
			account.status === 'permission_required' ||
			(account.missing_content_scopes?.length ?? 0) > 0
		) {
			return account.error_message || m.analytics_permission_required();
		}
		if (account.status === 'unsupported') {
			return account.error_message || m.analytics_unsupported();
		}
		if (account.status === 'rate_limited') return m.analytics_rate_limited();
		if (account.status === 'not_found') return m.analytics_not_found();
		if (account.status === 'temporarily_unavailable')
			return account.error_message || m.analytics_collection_delayed();
		if (account.status === 'failed') return m.analytics_collection_failed();
		if (account.stale) {
			return account.next_sync_at
				? m.analytics_stale_retry({ date: formatDateTime(account.next_sync_at) })
				: m.analytics_stale();
		}
		if (!account.last_synced_at) return m.analytics_no_measurement();
		return '';
	}

	function accountStatusClass(account: AnalyticsAccount) {
		if (
			account.status === 'permission_required' ||
			(account.missing_content_scopes?.length ?? 0) > 0
		) {
			return 'text-amber-700 dark:text-amber-300';
		}
		if (account.status === 'failed') return 'text-destructive';
		if (account.status === 'rate_limited') return 'text-amber-700 dark:text-amber-300';
		return 'text-muted-foreground';
	}

	function contentStatus(item: AnalyticsContent) {
		if (item.status === 'permission_required')
			return item.error_message || m.analytics_permission_required();
		if (item.status === 'unsupported') return item.error_message || m.analytics_unsupported();
		if (item.status === 'rate_limited') return m.analytics_rate_limited();
		if (item.status === 'temporarily_unavailable')
			return item.error_message || m.analytics_collection_delayed();
		if (item.status === 'failed') return m.analytics_collection_failed();
		if (item.stale) {
			return item.next_sync_at
				? m.analytics_stale_retry({ date: formatDateTime(item.next_sync_at) })
				: m.analytics_stale();
		}
		if (!item.last_synced_at) return m.analytics_no_measurement();
		return '';
	}

	function publicationExposure(publication: AnalyticsPublication) {
		return exposureMetrics(publication.metrics, publication.measured);
	}

	function engagementMetrics(metrics: Record<string, number>, measured: Record<string, number>) {
		return [
			{ key: 'likes', label: m.analytics_likes() },
			{ key: 'comments', label: m.analytics_comments() },
			{ key: 'reposts', label: m.analytics_reposts() },
			{ key: 'quotes', label: m.analytics_quotes() },
			{ key: 'shares', label: m.analytics_shares() },
			{ key: 'saves', label: m.analytics_saves() },
			{ key: 'clicks', label: m.analytics_clicks() }
		]
			.filter((metric) => (measured[metric.key] ?? 0) > 0)
			.map((metric) => ({ ...metric, value: metrics[metric.key] ?? 0 }));
	}

	function renditionExposure(item: AnalyticsContent) {
		const measured = Object.fromEntries(Object.keys(item.metrics).map((metric) => [metric, 1]));
		return exposureMetrics(item.metrics, measured);
	}

	function renditionEngagement(item: AnalyticsContent) {
		const measured = Object.fromEntries(Object.keys(item.metrics).map((metric) => [metric, 1]));
		return engagementMetrics(item.metrics, measured);
	}

	function exposureMetrics(metrics: Record<string, number>, measured: Record<string, number>) {
		return [
			{ key: 'views', label: m.analytics_views() },
			{ key: 'impressions', label: m.analytics_impressions() },
			{ key: 'reach', label: m.analytics_reach() }
		]
			.filter((metric) => (measured[metric.key] ?? 0) > 0)
			.map((metric) => ({
				...metric,
				value: metrics[metric.key] ?? 0,
				measured: measured[metric.key] ?? 0
			}));
	}

	function publicationLabel(publication: AnalyticsPublication) {
		return publication.title || publication.excerpt || m.analytics_untitled_publication();
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
			actionHref="/settings?tab=accounts"
			size="lg"
		/>
	{:else}
		<div class="space-y-8 transition-opacity" class:opacity-70={loading} aria-busy={loading}>
			{#each accountsNeedingReconnect as account (account.id)}
				<InlineNotice
					tone="warning"
					message={`${account.username}: ${account.error_message || m.analytics_permission_required()}`}
				>
					{#snippet actions()}
						<Button href="/settings?tab=accounts" variant="outline" size="sm"
							>{m.analytics_reconnect()}</Button
						>
					{/snippet}
				</InlineNotice>
			{/each}
			{#if selectedAccount?.stale}
				<InlineNotice
					tone="info"
					message={selectedAccount.next_sync_at
						? m.analytics_stale_retry({ date: formatDateTime(selectedAccount.next_sync_at) })
						: m.analytics_stale()}
				/>
			{/if}

			<section aria-label={m.analytics_title()} class="border-y border-border">
				<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
					{#each availableSummaryMetrics as item (item.label)}
						<div
							class="min-w-0 border-b border-border px-3 py-4 odd:border-r md:border-r lg:border-b-0"
						>
							<p class="text-xs text-muted-foreground">{item.label}</p>
							<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
								{metricValue(item.metric)}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{coverageLabel(item.metric.measured, item.denominator, item.unit)}
							</p>
							{#if item.metric.delta !== undefined}
								<p
									class={[
										'mt-1 text-xs font-medium tabular-nums',
										item.metric.delta >= 0
											? 'text-emerald-700 dark:text-emerald-300'
											: 'text-destructive'
									]}
								>
									{item.metric.delta >= 0 ? '+' : ''}{formatNumber(item.metric.delta)}
									{m.analytics_previous_period()}
								</p>
							{/if}
						</div>
					{/each}
					<div class="min-w-0 px-3 py-4">
						<p class="text-xs text-muted-foreground">{m.analytics_published()}</p>
						<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
							{formatNumber(displayedSummary?.published ?? 0)}
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{m.analytics_range_days({ days: rangeDays })}
						</p>
					</div>
				</div>
				{#if unavailableSummaryMetrics.length}
					<p class="border-t border-border px-3 py-2.5 text-xs leading-5 text-muted-foreground">
						{m.analytics_unavailable_metrics({
							metrics: unavailableSummaryMetrics.map((item) => item.label).join(', ')
						})}
					</p>
				{/if}
				<p class="border-t border-border px-3 py-2.5 text-xs leading-5 text-muted-foreground">
					{m.analytics_metric_definitions()}
				</p>
			</section>

			{#if analyticsInsights.length}
				<section aria-labelledby="analytics-insights-heading">
					<h2 id="analytics-insights-heading" class="mb-3 text-base font-semibold">
						{m.analytics_insights_title()}
					</h2>
					<div class="grid gap-3 md:grid-cols-3">
						{#each analyticsInsights as insight (insight.title)}
							<div class="rounded-xl border bg-muted/20 p-4">
								<p class="text-sm font-semibold">{insight.title}</p>
								<p class="mt-1 text-sm leading-5 text-muted-foreground">{insight.body}</p>
							</div>
						{/each}
					</div>
				</section>
			{/if}

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
								: m.analytics_unified_trend_description()}
						</p>
					</div>
					<AnalyticsTrend
						points={selectedFollowerSeries}
						label={`${m.analytics_trend_title()}: ${selectedAccount?.username ?? m.analytics_all_accounts()}`}
						emptyLabel={m.analytics_no_trend()}
						formatValue={formatNumber}
					/>
				</section>

				<section aria-labelledby="analytics-accounts-heading">
					<h2 id="analytics-accounts-heading" class="text-base font-semibold">
						{m.analytics_accounts_title()}
					</h2>
					<div
						class="mt-3 divide-y divide-border border-y border-border lg:max-h-72 lg:overflow-y-auto lg:overscroll-contain lg:pe-1"
					>
						<button
							type="button"
							class={[
								'flex min-h-16 w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								selectedAccountID === 'all' && 'bg-muted/70'
							]}
							aria-pressed={selectedAccountID === 'all'}
							onclick={() => (selectedAccountID = 'all')}
						>
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background"
							>
								<AccountsIcon class="size-4" />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium">{m.analytics_all_accounts()}</span>
								<span class="mt-0.5 block text-xs text-muted-foreground">
									{overview?.summary.followers.measured
										? `${formatNumber(overview.summary.followers.value)} ${m.analytics_summary_followers().toLowerCase()}`
										: m.analytics_no_measurement()}
								</span>
							</span>
						</button>
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
										<span
											class={['mt-0.5 line-clamp-2 block text-xs', accountStatusClass(account)]}
										>
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
				<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 id="analytics-content-heading" class="text-base font-semibold">
							{m.analytics_content_title()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{selectedAccount
								? m.analytics_content_for_account({ account: selectedAccount.username })
								: m.analytics_content_description()}
						</p>
					</div>
					<Select.Root
						type="single"
						value={sortMode}
						onValueChange={(value) => (sortMode = value as AnalyticsSortMode)}
					>
						<Select.Trigger class="h-11 w-44 sm:h-9" aria-label={m.analytics_sort_label()}>
							{sortMode === 'newest'
								? m.analytics_sort_newest()
								: sortMode === 'views'
									? m.analytics_sort_views()
									: m.analytics_sort_engagement()}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="engagement">{m.analytics_sort_engagement()}</Select.Item>
							<Select.Item value="views">{m.analytics_sort_views()}</Select.Item>
							<Select.Item value="newest">{m.analytics_sort_newest()}</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				{#if publications.length === 0}
					<p class="border-y border-dashed border-border py-8 text-sm text-muted-foreground">
						{m.analytics_content_empty()}
					</p>
				{:else}
					<div class="divide-y divide-border border-y border-border">
						{#each publications as publication (publication.publication_id)}
							{@const renditions = publication.renditions ?? []}
							{@const exposures = publicationExposure(publication)}
							{@const expanded = expandedPublicationID === publication.publication_id}
							<article>
								<div
									class="grid min-w-0 gap-4 px-1 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
								>
									<div class="min-w-0">
										<a
											href={resolve('/publications/[id]', { id: publication.publication_id })}
											class="line-clamp-2 font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										>
											{publicationLabel(publication)}
										</a>
										<div
											class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
										>
											<span>{formatDate(publication.published_at)}</span>
											<span aria-hidden="true">·</span>
											<span
												>{renditions.length === 1
													? m.analytics_destination_singular()
													: m.analytics_destinations({ count: renditions.length })}</span
											>
											<span class="flex items-center gap-1" aria-hidden="true">
												{#each renditions.slice(0, 6) as rendition (rendition.rendition_id)}
													<PlatformIcon platform={rendition.platform} class="size-3.5" />
												{/each}
											</span>
										</div>
									</div>

									<div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
										<div>
											<span class="block text-xs text-muted-foreground">
												{m.analytics_summary_engagement()}
											</span>
											<span class="font-medium tabular-nums">
												{publication.engagement_measured > 0
													? formatNumber(publication.engagement)
													: '—'}
											</span>
										</div>
										{#each exposures as metric (metric.key)}
											<div>
												<span class="block text-xs text-muted-foreground">{metric.label}</span>
												<span class="font-medium tabular-nums">{formatNumber(metric.value)}</span>
											</div>
										{/each}
									</div>

									<Button
										variant="ghost"
										size="sm"
										class="justify-self-start md:justify-self-end"
										aria-expanded={expanded}
										aria-controls={`analytics-publication-${publication.publication_id}`}
										onclick={() =>
											(expandedPublicationID = expanded ? '' : publication.publication_id)}
									>
										{expanded ? m.analytics_hide_details() : m.analytics_show_details()}
										<ChevronDownIcon
											class={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
										/>
									</Button>
								</div>

								{#if expanded}
									<div
										id={`analytics-publication-${publication.publication_id}`}
										class="border-t border-border bg-muted/20 px-2 py-2 sm:px-4"
									>
										{#each renditions as rendition (rendition.rendition_id)}
											{@const renditionExposures = renditionExposure(rendition)}
											{@const renditionEngagementMetrics = renditionEngagement(rendition)}
											<div
												class="grid min-w-0 gap-3 border-b border-border py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
											>
												<div class="flex min-w-0 items-start gap-2.5">
													<PlatformIcon
														platform={rendition.platform}
														class="mt-0.5 size-4 shrink-0"
													/>
													<div class="min-w-0">
														<p class="truncate text-sm font-medium">{rendition.username}</p>
														{#if contentStatus(rendition)}
															<p
																class={[
																	'mt-0.5 line-clamp-2 text-xs',
																	rendition.status === 'permission_required' ||
																	rendition.status === 'rate_limited'
																		? 'text-amber-700 dark:text-amber-300'
																		: 'text-muted-foreground'
																]}
															>
																{contentStatus(rendition)}
															</p>
														{/if}
													</div>
												</div>
												<div class="flex flex-wrap gap-x-5 gap-y-1 text-xs">
													<span>
														<span class="text-muted-foreground">
															{m.analytics_summary_engagement()}:
														</span>
														{hasEngagementMeasurement(rendition)
															? formatNumber(rendition.engagement)
															: '—'}
													</span>
													{#each renditionExposures as metric (metric.key)}
														<span>
															<span class="text-muted-foreground">{metric.label}:</span>
															{formatNumber(metric.value)}
														</span>
													{/each}
													{#each renditionEngagementMetrics as metric (metric.key)}
														<span>
															<span class="text-muted-foreground">{metric.label}:</span>
															{formatNumber(metric.value)}
														</span>
													{/each}
													{#if rendition.external_url}
														<Button
															href={rendition.external_url}
															target="_blank"
															rel="noreferrer"
															variant="ghost"
															size="icon-xs"
															aria-label={m.analytics_open_native()}
															title={m.analytics_open_native()}
														>
															<ExternalLinkIcon class="size-3.5" />
														</Button>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</article>
						{/each}
					</div>
					<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
						<p class="text-xs text-muted-foreground">
							{m.analytics_results_range({
								shown: publications.length,
								total: overview?.publication_total ?? publications.length
							})}
						</p>
						{#if overview?.publication_next_cursor}
							<Button variant="outline" onclick={loadMorePublications} disabled={loadingMore}>
								{loadingMore ? m.analytics_loading_more() : m.analytics_load_more()}
							</Button>
						{/if}
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
