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
	import AnalyticsPerformanceChart from '$lib/components/analytics-performance-chart.svelte';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import AnalyticsIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import AccountsIcon from '@lucide/svelte/icons/users';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import SendIcon from '@lucide/svelte/icons/send';
	import UsersIcon from '@lucide/svelte/icons/users-round';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';
	import { hasEngagementMeasurement, type AnalyticsSortMode } from '$lib/analytics-overview';
	import {
		allFeatureEffectiveDisabled,
		collectiveDisabledReason,
		loadFeatureStates
	} from '$lib/feature-disabled';
	import type { components as FeatureComponents } from '$lib/api/types';

	type AnalyticsOverview = components['schemas']['Overview'];
	type AnalyticsAccount = components['schemas']['AccountOverview'];
	type AnalyticsContent = components['schemas']['ContentOverview'];
	type AnalyticsPublication = components['schemas']['PublicationOverview'];
	type MetricSummary = components['schemas']['MetricSummary'];
	type RangeDays = 7 | 30 | 90;
	type ChartMetric = 'followers' | 'engagement' | 'views';
	type FeatureState = FeatureComponents['schemas']['FeatureStateResponse'];

	let overview = $state.raw<AnalyticsOverview | null>(null);
	let rangeDays = $state<RangeDays>(30);
	let selectedAccountID = $state('all');
	let chartMetric = $state<ChartMetric>('views');
	let sortMode = $state<AnalyticsSortMode>('engagement');
	let expandedPublicationID = $state('');
	let loading = $state(true);
	let loadingMore = $state(false);
	let refreshing = $state(false);
	let error = $state('');
	let toastMessage = $state('');
	let dataWorkspaceID = $state('');
	let dataRequestSequence = 0;
	let analyticsFeatures = $state.raw<FeatureState[]>([]);

	const currentWorkspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const accounts = $derived(overview?.accounts ?? []);
	const publications = $derived(overview?.publications ?? []);
	const selectedAccount = $derived(
		selectedAccountID === 'all'
			? undefined
			: (accounts.find((account) => account.id === selectedAccountID) ?? accounts[0])
	);
	const chartPoints = $derived(overview?.trends?.[chartMetric] ?? []);
	const chartTitle = $derived(
		chartMetric === 'followers'
			? m.analytics_daily_followers()
			: chartMetric === 'engagement'
				? m.analytics_daily_engagement()
				: m.analytics_daily_views()
	);
	const chartDescription = $derived(
		chartMetric === 'followers'
			? m.analytics_daily_followers_description()
			: chartMetric === 'engagement'
				? m.analytics_daily_engagement_description()
				: m.analytics_daily_views_description()
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
	const analyticsAllDisabled = $derived(
		(overview?.accounts?.length ?? 0) > 0 &&
			allFeatureEffectiveDisabled(analyticsFeatures, 'analytics')
	);
	const analyticsReason = $derived(collectiveDisabledReason(analyticsFeatures, 'analytics'));
	const analyticsEmptyIsFeatureDisabled = $derived(
		analyticsAllDisabled && !hasMeasurements && !initialLoading && !error
	);
	const showAnalyticsDisabledNotice = $derived(analyticsAllDisabled && hasMeasurements);
	const summaryMetrics = $derived.by(() => {
		const summary = displayedSummary;
		if (!summary) return [];
		return [
			{
				key: 'followers',
				label: m.analytics_summary_followers(),
				metric: summary.followers,
				denominator: selectedAccount ? 1 : accounts.length,
				unit: 'account' as const
			},
			{
				key: 'engagement',
				label: m.analytics_summary_engagement(),
				metric: summary.engagement,
				denominator: destinationCount,
				unit: 'destination' as const
			},
			{
				key: 'views',
				label: m.analytics_views(),
				metric: summary.views,
				denominator: destinationCount,
				unit: 'destination' as const
			},
			{
				key: 'impressions',
				label: m.analytics_impressions(),
				metric: summary.impressions,
				denominator: destinationCount,
				unit: 'destination' as const
			},
			{
				key: 'reach',
				label: m.analytics_reach(),
				metric: summary.reach,
				denominator: destinationCount,
				unit: 'destination' as const
			}
		];
	});
	const featuredSummaryMetrics = $derived(
		summaryMetrics.filter((item) => ['followers', 'engagement', 'views'].includes(item.key))
	);
	const secondarySummaryMetrics = $derived(
		summaryMetrics.filter(
			(item) => ['impressions', 'reach'].includes(item.key) && item.metric.measured > 0
		)
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
					account:
						formatSocialAccountName(strongestDestination.username, strongestDestination.platform) ||
						getPlatformName(strongestDestination.platform),
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
					account: accountName(decliningAccount),
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
			void loadAnalyticsFeatures(workspaceID, response.data.accounts ?? []);
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

	async function loadAnalyticsFeatures(workspace: string, accs: AnalyticsAccount[]) {
		analyticsFeatures = await loadFeatureStates(workspace, accs);
	}

	async function refreshAnalytics() {
		if (!currentWorkspaceID || refreshing || analyticsAllDisabled) return;
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

	function formatShortDate(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${value}T00:00:00Z`));
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

	function accountName(account: AnalyticsAccount): string {
		return formatSocialAccountName(account.username, account.platform) || account.platform;
	}

	function accountFilterLabel(account: AnalyticsAccount | undefined): string {
		if (!account) return m.analytics_account_filter();
		return `${m.analytics_account_filter()}: ${accountName(account)}, ${getPlatformName(account.platform)}`;
	}

	function renditionAccount(rendition: AnalyticsContent): AnalyticsAccount | undefined {
		return accounts.find((account) => account.id === rendition.account_id);
	}

	function renditionName(rendition: AnalyticsContent): string {
		return (
			formatSocialAccountName(rendition.username, rendition.platform) ||
			getPlatformName(rendition.platform)
		);
	}

	function metricValue(metric: MetricSummary) {
		return metric.measured > 0 ? formatNumber(metric.value) : '—';
	}

	function coverageLabel(measured: number, denominator: number, unit: 'account' | 'destination') {
		return unit === 'account'
			? m.analytics_account_coverage({ measured, total: denominator })
			: m.analytics_destination_coverage({ measured, total: denominator });
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

	function publicationViews(publication: AnalyticsPublication) {
		return (publication.measured.views ?? 0) > 0
			? formatNumber(publication.metrics.views ?? 0)
			: '—';
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
			disabled={refreshing || !overview || accounts.length === 0 || analyticsAllDisabled}
			data-testid="analytics-refresh"
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
	{#if analyticsEmptyIsFeatureDisabled}
		<EmptyState
			icon={AccountsIcon}
			title={m.analytics_feature_disabled_title()}
			description={m.analytics_feature_disabled_description()}
			actionLabel={m.feature_disabled_open_details()}
			actionHref="/settings?tab=accounts"
			size="lg"
		/>
		{#if analyticsReason}
			<p
				class="mt-3 text-xs leading-5 text-muted-foreground"
				data-testid="analytics-disabled-reason"
			>
				{analyticsReason}
			</p>
		{/if}
	{:else if error}
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
			{#if showAnalyticsDisabledNotice}
				<div data-testid="analytics-disabled-notice">
					<InlineNotice tone="warning" message={m.analytics_feature_disabled_notice()}>
						{#snippet actions()}
							<Button
								href="/settings?tab=accounts"
								variant="outline"
								size="sm"
								data-testid="analytics-disabled-recovery"
								>{m.feature_disabled_open_details()}</Button
							>
						{/snippet}
						{#if analyticsReason}
							<p class="mt-1 text-xs leading-5" data-testid="analytics-disabled-reason">
								{analyticsReason}
							</p>
						{/if}
					</InlineNotice>
				</div>
			{/if}
			{#each accountsNeedingReconnect as account (account.id)}
				<InlineNotice
					tone="warning"
					message={`${accountName(account)}: ${account.error_message || m.analytics_permission_required()}`}
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

			<section aria-label={m.analytics_title()}>
				<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					{#each featuredSummaryMetrics as item (item.key)}
						<div class="min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground">
							<div class="flex items-start justify-between gap-3">
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									{#if item.key === 'followers'}
										<UsersIcon class="size-4" />
									{:else if item.key === 'engagement'}
										<HeartIcon class="size-4" />
									{:else}
										<EyeIcon class="size-4" />
									{/if}
									<span>{item.label}</span>
								</div>
								{#if item.metric.delta !== undefined}
									<span
										class={[
											'text-xs font-medium tabular-nums',
											item.metric.delta >= 0
												? 'text-emerald-700 dark:text-emerald-300'
												: 'text-destructive'
										]}
									>
										{item.metric.delta >= 0 ? '+' : ''}{formatNumber(item.metric.delta)}
									</span>
								{/if}
							</div>
							<p class="mt-5 text-3xl font-semibold tracking-[-0.03em] tabular-nums">
								{metricValue(item.metric)}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{coverageLabel(item.metric.measured, item.denominator, item.unit)}
							</p>
						</div>
					{/each}
					<div class="min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<SendIcon class="size-4" />
							<span>{m.analytics_published()}</span>
						</div>
						<p class="mt-5 text-3xl font-semibold tracking-[-0.03em] tabular-nums">
							{formatNumber(displayedSummary?.published ?? 0)}
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{m.analytics_range_days({ days: rangeDays })}
						</p>
					</div>
				</div>
				<div
					class="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs leading-5 text-muted-foreground"
				>
					{#if secondarySummaryMetrics.length}
						<span class="me-3">
							{#each secondarySummaryMetrics as item, index (item.key)}
								{#if index > 0}<span aria-hidden="true"> · </span>{/if}
								<span
									>{item.label}
									<strong class="font-medium text-foreground">{metricValue(item.metric)}</strong
									></span
								>
							{/each}
						</span>
					{/if}
					{#if unavailableSummaryMetrics.length}
						<span>
							{m.analytics_unavailable_metrics({
								metrics: unavailableSummaryMetrics.map((item) => item.label).join(', ')
							})}
						</span>
					{/if}
					<span class="block sm:inline sm:before:mx-2 sm:before:content-['·']">
						{m.analytics_metric_definitions()}
					</span>
				</div>
			</section>

			{#if !hasMeasurements}
				<InlineNotice tone="info" message={m.analytics_waiting_description()} />
			{/if}

			<section
				class="min-w-0 rounded-xl border border-border bg-card text-card-foreground"
				aria-labelledby="analytics-trend-heading"
			>
				<div
					class="flex flex-col gap-4 border-b border-border p-4 lg:flex-row lg:items-end lg:justify-between"
				>
					<div class="min-w-0">
						<h2 id="analytics-trend-heading" class="text-base font-semibold">{chartTitle}</h2>
						<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
							{chartDescription}
							{#if selectedAccount}
								<span>
									{m.analytics_filtered_to_account({ account: accountName(selectedAccount) })}</span
								>
							{/if}
						</p>
					</div>
					<div class="flex flex-col gap-2 sm:flex-row">
						<div
							class="flex min-h-11 items-center rounded-md border border-border p-1 sm:min-h-9"
							role="group"
							aria-label={m.analytics_chart_metric_label()}
						>
							{#each ['views', 'engagement', 'followers'] as metric (metric)}
								<button
									type="button"
									class={[
										'min-h-9 flex-1 rounded-sm px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-7',
										chartMetric === metric
											? 'bg-secondary text-secondary-foreground'
											: 'text-muted-foreground hover:text-foreground'
									]}
									aria-pressed={chartMetric === metric}
									onclick={() => (chartMetric = metric as ChartMetric)}
								>
									{metric === 'views'
										? m.analytics_views()
										: metric === 'engagement'
											? m.analytics_summary_engagement()
											: m.analytics_summary_followers()}
								</button>
							{/each}
						</div>
						<Select.Root
							type="single"
							value={selectedAccountID}
							onValueChange={(value) => (selectedAccountID = value)}
						>
							<Select.Trigger
								class="h-11 w-full sm:h-9 sm:w-60"
								aria-label={accountFilterLabel(selectedAccount)}
							>
								{#if selectedAccount}
									<SocialAccountIdentity
										name={accountName(selectedAccount)}
										platform={selectedAccount.platform}
										avatarUrl={selectedAccount.avatar_url}
										size="sm"
									/>
								{:else}
									<span class="flex items-center gap-2">
										<AccountsIcon class="size-4 text-muted-foreground" aria-hidden="true" />
										{m.analytics_all_accounts()}
									</span>
								{/if}
							</Select.Trigger>
							<Select.Content class="w-72 max-w-[calc(100vw-1rem)]">
								<Select.Item value="all" class="min-h-11">
									<span class="flex items-center gap-2.5">
										<span
											class="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
										>
											<AccountsIcon class="size-4" aria-hidden="true" />
										</span>
										<span class="font-medium">{m.analytics_all_accounts()}</span>
									</span>
								</Select.Item>
								{#each accounts as account (account.id)}
									<Select.Item value={account.id} class="min-h-12 py-2">
										<SocialAccountIdentity
											name={accountName(account)}
											platform={account.platform}
											avatarUrl={account.avatar_url}
										/>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				<div class="p-2 pt-3 sm:p-4">
					<AnalyticsPerformanceChart
						points={chartPoints}
						metric={chartMetric}
						label={chartTitle}
						emptyLabel={m.analytics_no_daily_changes()}
						otherLabel={chartMetric === 'followers'
							? m.analytics_other_accounts()
							: m.analytics_other_posts()}
						formatValue={formatNumber}
						formatDate={formatShortDate}
					/>
				</div>
				<p class="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
					{chartMetric === 'followers'
						? m.analytics_follower_chart_legend()
						: m.analytics_content_chart_legend()}
				</p>
			</section>

			{#if analyticsInsights.length}
				<section
					class="rounded-xl border border-border"
					aria-labelledby="analytics-insights-heading"
				>
					<h2
						id="analytics-insights-heading"
						class="border-b border-border px-4 py-3 text-sm font-semibold"
					>
						{m.analytics_insights_title()}
					</h2>
					<div class="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
						{#each analyticsInsights as insight (insight.title)}
							<div class="p-4">
								<p class="text-sm font-semibold">{insight.title}</p>
								<p class="mt-1 text-sm leading-5 text-muted-foreground">{insight.body}</p>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section aria-labelledby="analytics-content-heading">
				<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 id="analytics-content-heading" class="text-base font-semibold">
							{m.analytics_content_title()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{selectedAccount
								? m.analytics_content_for_account({ account: accountName(selectedAccount) })
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
					<div class="overflow-hidden rounded-xl border border-border">
						<div
							data-testid="analytics-content-table-header"
							class="hidden grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_6rem_6rem_7.5rem_auto] items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid"
							aria-hidden="true"
						>
							<span>{m.analytics_table_post()}</span>
							<span>{m.analytics_table_platforms()}</span>
							<span class="text-end">{m.analytics_summary_engagement()}</span>
							<span class="text-end">{m.analytics_views()}</span>
							<span>{m.analytics_table_published()}</span>
							<span class="sr-only">{m.analytics_table_actions()}</span>
						</div>
						<div class="divide-y divide-border">
							{#each publications as publication (publication.publication_id)}
								{@const renditions = publication.renditions ?? []}
								{@const expanded = expandedPublicationID === publication.publication_id}
								<article>
									<div
										class="grid min-w-0 gap-4 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_6rem_6rem_7.5rem_auto] md:items-center"
									>
										<div class="min-w-0">
											<a
												href={resolve('/publications/[id]', { id: publication.publication_id })}
												class="line-clamp-2 font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
											>
												{publicationLabel(publication)}
											</a>
											<div class="mt-1 text-xs text-muted-foreground md:hidden">
												{formatDate(publication.published_at)}
											</div>
										</div>

										<div class="flex min-w-0 items-center gap-2 text-sm">
											<span class="flex shrink-0 items-center gap-1" aria-hidden="true">
												{#each renditions.slice(0, 4) as rendition (rendition.rendition_id)}
													<span
														class="flex size-7 items-center justify-center rounded-full border border-border bg-background"
													>
														<PlatformIcon platform={rendition.platform} class="size-3.5" />
													</span>
												{/each}
											</span>
											<span class="truncate text-xs text-muted-foreground">
												{renditions.length === 1
													? m.analytics_destination_singular()
													: m.analytics_destinations({ count: renditions.length })}
											</span>
										</div>

										<div
											class="flex items-baseline justify-between gap-3 text-sm md:block md:text-end"
										>
											<span class="text-xs text-muted-foreground md:hidden"
												>{m.analytics_summary_engagement()}</span
											>
											<span class="font-medium tabular-nums">
												{publication.engagement_measured > 0
													? formatNumber(publication.engagement)
													: '—'}
											</span>
										</div>
										<div
											class="flex items-baseline justify-between gap-3 text-sm md:block md:text-end"
										>
											<span class="text-xs text-muted-foreground md:hidden"
												>{m.analytics_views()}</span
											>
											<span class="font-medium tabular-nums">{publicationViews(publication)}</span>
										</div>
										<div class="hidden text-sm text-muted-foreground md:block">
											{formatDate(publication.published_at)}
										</div>

										<Button
											variant="ghost"
											size="sm"
											class="w-full justify-between md:w-auto md:justify-self-end"
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
												{@const account = renditionAccount(rendition)}
												<div
													class="grid min-w-0 gap-3 border-b border-border py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
												>
													<div class="min-w-0">
														<SocialAccountIdentity
															name={renditionName(rendition)}
															platform={rendition.platform}
															avatarUrl={account?.avatar_url}
														/>
														<div class="mt-1 pl-11">
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
