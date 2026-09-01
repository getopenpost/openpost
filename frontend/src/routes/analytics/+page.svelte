<!--
THESIS: Analytics explains stored account and content measurements without hiding provider limits.
OWN-WORLD: It uses OpenPost's flat borders, compact controls, and provider marks.
STORY: Read exact totals, verify evidence, then inspect managed and external content in one list.
FIRST VIEWPORT: The reporting window, refresh action, metric ledger, and unified follower trend are visible without scrolling.
FORM: Server-owned insights and content rows preserve source, period, sample, and provider context.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { ui } from '$lib/stores/ui.svelte';
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
	import { analyticsMetricLabel } from '$lib/analytics-metric-label';
	import { formatSocialAccountLabel, formatSocialAccountName, getPlatformName } from '$lib/utils';
	import {
		analyticsSourceLabelKey,
		appendAnalyticsContentPage,
		hasEngagementMeasurement,
		hasLimitedAccountHistory,
		insightHasRanking,
		isBuildingAccountHistory,
		type AnalyticsSortMode
	} from '$lib/analytics-overview';
	import {
		allFeatureEffectiveDisabled,
		collectiveDisabledReason,
		loadFeatureStates
	} from '$lib/feature-disabled';
	import type { components as FeatureComponents } from '$lib/api/types';

	type AnalyticsOverview = components['schemas']['Overview'];
	type AnalyticsAccount = components['schemas']['AccountOverview'];
	type AnalyticsContent = components['schemas']['ContentOverview'];
	type AnalyticsInsight = components['schemas']['Insight'];
	type AccountDiscoveryCoverage = components['schemas']['AccountDiscoveryCoverage'];
	type AnalyticsMetricMetadata = components['schemas']['AnalyticsMetricMetadata'];
	type MetricSummary = components['schemas']['MetricSummary'];
	type RangeDays = 7 | 30 | 90;
	type ContentSource = 'all' | 'openpost' | 'external';
	type ChartMetric = 'followers' | 'engagement' | 'views';
	type FeatureState = FeatureComponents['schemas']['FeatureStateResponse'];

	let overview = $state.raw<AnalyticsOverview | null>(null);
	let rangeDays = $state<RangeDays>(30);
	let selectedAccountID = $state('all');
	let chartMetric = $state<ChartMetric>('views');
	let sortMode = $state<AnalyticsSortMode>('engagement');
	let sourceFilter = $state<ContentSource>('all');
	let expandedContentID = $state('');
	let loading = $state(true);
	let loadingMore = $state(false);
	let refreshing = $state(false);
	let repurposingReferenceKey = $state('');
	let error = $state('');
	let toastMessage = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let dataWorkspaceID = $state('');
	let dataRequestSequence = 0;
	let analyticsFeatures = $state.raw<FeatureState[]>([]);

	const currentWorkspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const accounts = $derived(overview?.accounts ?? []);
	const contentItems = $derived(overview?.content ?? []);
	const analyticsInsights = $derived(overview?.insights ?? []);
	const accountCoverage = $derived(overview?.coverage ?? []);
	const buildingCoverage = $derived(accountCoverage.filter(isBuildingAccountHistory));
	const hasLimitedCoverage = $derived(accountCoverage.some(hasLimitedAccountHistory));
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
			contentItems.some((item) => Boolean(item.collected_at || item.last_synced_at))
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
	$effect(() => {
		const workspaceID = currentWorkspaceID;
		const days = rangeDays;
		const accountID = selectedAccountID;
		const requestedSort = sortMode;
		const requestedSource = sourceFilter;
		if (workspaceID)
			void loadAnalytics(workspaceID, days, accountID, requestedSort, requestedSource);
	});

	async function loadAnalytics(
		requestedWorkspaceID = currentWorkspaceID,
		requestedDays = rangeDays,
		requestedAccountID = selectedAccountID,
		requestedSort = sortMode,
		requestedSource = sourceFilter,
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
						source: requestedSource,
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
				append && overview ? appendAnalyticsContentPage(overview, response.data) : response.data;
			dataWorkspaceID = workspaceID;
			void loadAnalyticsFeatures(workspaceID, response.data.accounts ?? []);
			if (
				selectedAccountID !== 'all' &&
				!response.data.accounts?.some((account) => account.id === selectedAccountID)
			) {
				selectedAccountID = 'all';
			}
			if (
				expandedContentID &&
				!response.data.content?.some((item) => contentIdentity(item) === expandedContentID)
			) {
				expandedContentID = '';
			}
		} catch (cause) {
			if (requestSequence !== dataRequestSequence) return;
			if (append) {
				toastTone = 'error';
				toastMessage = m.analytics_load_more_failed();
			} else error = cause instanceof Error ? cause.message : m.analytics_failed_load();
		} finally {
			if (requestSequence === dataRequestSequence) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function loadMoreContent() {
		if (!overview?.content_next_cursor || loadingMore) return;
		void loadAnalytics(
			currentWorkspaceID,
			rangeDays,
			selectedAccountID,
			sortMode,
			sourceFilter,
			overview.content_next_cursor,
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
			toastTone = 'success';
			toastMessage = m.analytics_refresh_queued({ count: response.data.queued });
		} catch {
			toastTone = 'error';
			toastMessage = m.analytics_refresh_failed();
		} finally {
			refreshing = false;
		}
	}

	async function repurposeContent(item: AnalyticsContent) {
		const key = contentIdentity(item);
		if (!currentWorkspaceID || repurposingReferenceKey) return;
		repurposingReferenceKey = key;
		try {
			const response = await client.POST('/analytics/repurpose', {
				body: {
					workspace_id: currentWorkspaceID,
					reference: item.reference,
					range: { days: rangeDays }
				}
			});
			if (response.error || !response.data) {
				throw new Error(response.error?.detail || m.analytics_repurpose_failed());
			}
			ui.setRepurposeHandoff(response.data);
			await goto(resolve('/'));
		} catch (cause) {
			toastTone = 'error';
			toastMessage = cause instanceof Error ? cause.message : m.analytics_repurpose_failed();
		} finally {
			repurposingReferenceKey = '';
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

	function accountLabel(account: AnalyticsAccount): string {
		return formatSocialAccountLabel(account.username, account.platform);
	}

	function accountFilterLabel(account: AnalyticsAccount | undefined): string {
		if (!account) return m.analytics_account_filter();
		return `${m.analytics_account_filter()}: ${accountLabel(account)}`;
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

	function semanticMetricValue(item: AnalyticsContent, key: string, value: number) {
		const unit = item.measurements?.[key]?.metadata.unit ?? item.metric_metadata?.[key]?.unit;
		if (unit === 'basis_points') {
			return new Intl.NumberFormat(getLocaleTag(), {
				style: 'percent',
				minimumFractionDigits: 0,
				maximumFractionDigits: 2
			}).format(value / 10_000);
		}
		if (unit === 'milliseconds') {
			const seconds = value / 1000;
			if (seconds < 60) return `${formatNumber(seconds)}s`;
			return `${formatNumber(seconds / 60)} min`;
		}
		return formatNumber(value);
	}

	function metricEvidence(item: AnalyticsContent) {
		return Object.entries(item.metrics).map(([key, value]) => {
			const measurement = item.measurements?.[key];
			return {
				key,
				label: analyticsMetricLabel(key),
				value: semanticMetricValue(item, key, value),
				metadata: measurement?.metadata ?? item.metric_metadata?.[key],
				collectedAt: measurement?.collected_at ?? item.collected_at,
				availability: measurement?.availability ?? 'available'
			};
		});
	}

	function metricUnit(metadata: AnalyticsMetricMetadata | undefined) {
		switch (metadata?.unit) {
			case 'milliseconds':
				return m.analytics_evidence_milliseconds();
			case 'basis_points':
				return m.analytics_evidence_basis_points();
			case 'count':
				return m.analytics_evidence_count();
			default:
				return m.analytics_evidence_unavailable();
		}
	}

	function aggregationLabel(aggregation: string | undefined) {
		switch (aggregation) {
			case 'current_snapshot':
				return m.analytics_evidence_current_snapshot();
			case 'lifetime_total':
				return m.analytics_evidence_lifetime_total();
			case 'reporting_period_total':
				return m.analytics_evidence_reporting_period_total();
			case 'reporting_period_average':
				return m.analytics_evidence_reporting_period_average();
			default:
				return m.analytics_evidence_unavailable();
		}
	}

	function metricPeriod(metadata: AnalyticsMetricMetadata | undefined) {
		return metadata?.period_start && metadata.period_end
			? `${formatDate(metadata.period_start)} – ${formatDate(metadata.period_end)}`
			: m.analytics_evidence_period_unavailable();
	}

	function availabilityLabel(availability: string) {
		switch (availability) {
			case 'available':
				return m.analytics_evidence_available();
			case 'pending':
				return m.analytics_evidence_pending();
			case 'insufficient_data':
				return m.analytics_evidence_insufficient();
			default:
				return m.analytics_evidence_unavailable();
		}
	}

	function metricCaveat(aggregation: string | undefined) {
		if (aggregation === 'lifetime_total') return m.analytics_insight_lifetime_caveat();
		if (aggregation === 'reporting_period_total' || aggregation === 'reporting_period_average')
			return m.analytics_insight_reporting_period_caveat();
		return '';
	}

	function coverageStatusLabel(coverage: AccountDiscoveryCoverage) {
		if (isBuildingAccountHistory(coverage)) return m.analytics_history_building();
		switch (coverage.status) {
			case 'complete':
				return m.analytics_history_complete();
			case 'partial':
				return m.analytics_history_partial();
			case 'permission_required':
				return m.analytics_history_permission_required();
			case 'rate_limited':
				return m.analytics_history_rate_limited();
			case 'cost_limited':
				return m.analytics_history_cost_limited();
			case 'unsupported':
				return m.analytics_history_unsupported();
			default:
				return m.analytics_history_failed();
		}
	}

	function coverageAccount(coverage: AccountDiscoveryCoverage) {
		const account = accounts.find((candidate) => candidate.id === coverage.account_id);
		return account ? accountLabel(account) : getPlatformName(coverage.platform);
	}

	function contentIdentity(item: AnalyticsContent) {
		return item.reference.type === 'external'
			? `external:${item.reference.account_content_id ?? ''}`
			: `openpost:${item.reference.rendition_id ?? ''}`;
	}

	function contentLabel(item: AnalyticsContent) {
		return item.title || item.excerpt || m.analytics_untitled_publication();
	}

	function sourceLabel(source: AnalyticsContent['source']) {
		return analyticsSourceLabelKey(source) === 'published_elsewhere'
			? m.analytics_source_published_elsewhere()
			: m.analytics_source_published_with_openpost();
	}

	function insightTitle(insight: AnalyticsInsight) {
		switch (insight.kind) {
			case 'most_engagement_actions':
				return m.analytics_insight_most_engagement();
			case 'strongest_measured_destination':
				return m.analytics_insight_top_destination();
			default:
				return m.analytics_insight_follower_decline();
		}
	}

	function insightBody(insight: AnalyticsInsight) {
		if (!insightHasRanking(insight)) {
			switch (insight.reason) {
				case 'low_sample':
					return insight.kind === 'strongest_measured_destination'
						? m.analytics_insight_insufficient_destinations()
						: m.analytics_insight_insufficient_low_sample();
				case 'incompatible_semantics':
					return m.analytics_insight_insufficient_incompatible();
				case 'no_decline':
					return m.analytics_insight_no_decline();
				default:
					return m.analytics_insight_insufficient_missing();
			}
		}
		if (insight.kind === 'follower_decline') {
			return m.analytics_insight_follower_decline_body({
				count: formatNumber(Math.abs(insight.value))
			});
		}
		if (insight.kind === 'strongest_measured_destination') {
			return m.analytics_insight_top_destination_body({
				engagement: formatNumber(insight.value)
			});
		}
		return m.analytics_insight_most_engagement_body({
			content:
				insight.content?.title || insight.content?.excerpt || m.analytics_untitled_publication(),
			engagement: formatNumber(insight.value)
		});
	}

	function insightAccountName(insight: AnalyticsInsight) {
		return (
			formatSocialAccountName(insight.username ?? '', insight.platform ?? '') ||
			getPlatformName(insight.platform ?? '')
		);
	}

	function insightIdentity(insight: AnalyticsInsight) {
		if (
			!insightHasRanking(insight) ||
			(insight.kind !== 'strongest_measured_destination' && insight.kind !== 'follower_decline')
		) {
			return undefined;
		}
		const account = accounts.find((candidate) => candidate.id === insight.account_id);
		return {
			name: account ? accountName(account) : insightAccountName(insight),
			platform: account?.platform ?? insight.platform ?? '',
			avatarUrl: account?.avatar_url
		};
	}

	function insightSample(insight: AnalyticsInsight) {
		return m.analytics_insight_sample({
			measured: insight.measured_count,
			total: insight.comparison_sample
		});
	}

	function insightCaveat(insight: AnalyticsInsight) {
		switch (insight.caveat) {
			case 'filtered_content_lifetime_totals':
				return m.analytics_insight_lifetime_caveat();
			case 'filtered_content_reporting_period_totals':
				return m.analytics_insight_reporting_period_caveat();
			case 'account_wide':
				return m.analytics_insight_account_wide_caveat();
			default:
				return '';
		}
	}

	function insightPeriod(insight: AnalyticsInsight) {
		const start = insight.period.measurement_start ?? insight.period.filter_start;
		const end = insight.period.measurement_end ?? insight.period.filter_end;
		return `${formatDate(start)} – ${formatDate(end)}`;
	}

	function insightPeriodLabel(insight: AnalyticsInsight) {
		return insight.period.aggregation === 'current_snapshot' ||
			insight.period.aggregation === 'reporting_period_total'
			? m.analytics_insight_period_label()
			: m.analytics_insight_content_range_label();
	}

	function insightMetricLabel(insight: AnalyticsInsight) {
		return insight.metric === 'followers'
			? m.analytics_evidence_followers()
			: m.analytics_evidence_engagement_actions();
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
		tone={toastTone}
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
					message={`${accountLabel(account)}: ${account.error_message || m.analytics_permission_required()}`}
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

			{#if accountCoverage.length}
				<section
					class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
					aria-labelledby="analytics-history-heading"
					data-testid="analytics-history-coverage"
				>
					<div class="border-b border-border px-4 py-3">
						<h2 id="analytics-history-heading" class="text-sm font-semibold">
							{buildingCoverage.length
								? m.analytics_history_building()
								: m.analytics_history_title()}
						</h2>
						<p class="mt-1 text-xs leading-5 text-muted-foreground">
							{m.analytics_history_description()}
						</p>
					</div>
					<div class="grid gap-px bg-border sm:grid-cols-2 md:grid-cols-3">
						{#each accountCoverage as coverage (coverage.account_id)}
							<article
								class="min-w-0 bg-card px-4 py-3"
								data-testid={`analytics-coverage-${coverage.account_id}`}
							>
								<div class="flex min-w-0 items-center gap-2">
									<PlatformIcon platform={coverage.platform} class="size-4 shrink-0" />
									<p class="min-w-0 truncate text-sm font-medium">
										{coverageAccount(coverage)}
									</p>
								</div>
								<p class="mt-2 text-xs font-medium">{coverageStatusLabel(coverage)}</p>
								{#if coverage.description}
									<p class="mt-1 text-xs leading-5 text-muted-foreground">
										{coverage.description}
									</p>
								{/if}
								<div class="mt-2 space-y-0.5 text-xs leading-5 text-muted-foreground">
									{#if coverage.initial_items_discovered > 0 || isBuildingAccountHistory(coverage)}
										<p>
											{m.analytics_history_items({ count: coverage.initial_items_discovered })}
										</p>
									{/if}
									{#if coverage.backfill_watermark}
										<p>
											{m.analytics_history_since({
												date: formatDate(coverage.backfill_watermark)
											})}
										</p>
									{/if}
									{#if coverage.last_success_at}
										<p>
											{m.analytics_history_last_success({
												date: formatDateTime(coverage.last_success_at)
											})}
										</p>
									{/if}
									{#if hasLimitedAccountHistory(coverage)}
										<p class="font-medium text-foreground">
											{m.analytics_history_limited_note()}
										</p>
									{/if}
								</div>
							</article>
						{/each}
					</div>
				</section>
			{/if}

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
									{m.analytics_filtered_to_account({
										account: accountLabel(selectedAccount)
									})}</span
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
					<div class="border-b border-border px-4 py-3">
						<h2 id="analytics-insights-heading" class="text-sm font-semibold">
							{m.analytics_insights_title()}
						</h2>
						<p class="mt-1 text-xs leading-5 text-muted-foreground">
							{m.analytics_insights_description()}
						</p>
					</div>
					<div class="grid gap-px bg-border sm:grid-cols-2 md:grid-cols-4">
						{#each analyticsInsights as insight (insight.kind)}
							{@const identity = insightIdentity(insight)}
							<article
								class="min-w-0 bg-card p-4"
								data-testid={`analytics-insight-${insight.kind}`}
							>
								<p class="text-sm font-semibold">{insightTitle(insight)}</p>
								{#if identity}
									<SocialAccountIdentity
										class="mt-2"
										name={identity.name}
										platform={identity.platform}
										avatarUrl={identity.avatarUrl}
										detail={insightBody(insight)}
									/>
								{:else}
									<p class="mt-1 text-sm leading-5 text-muted-foreground">{insightBody(insight)}</p>
								{/if}
								<details class="group mt-2 border-t border-border pt-1">
									<summary
										class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									>
										{m.analytics_evidence_details()}
										<ChevronDownIcon class="size-4 transition-transform group-open:rotate-180" />
									</summary>
									<dl class="space-y-1 pb-2 text-xs leading-5 text-muted-foreground">
										<div class="flex flex-wrap gap-x-1">
											<dt>{m.analytics_evidence_availability()}:</dt>
											<dd>{availabilityLabel(insight.status)}</dd>
										</div>
										<div class="flex flex-wrap gap-x-1">
											<dt>{m.analytics_evidence_metric()}:</dt>
											<dd>{insightMetricLabel(insight)}</dd>
										</div>
										<div class="flex flex-wrap gap-x-1">
											<dt>{m.analytics_evidence_unit()}:</dt>
											<dd>{m.analytics_evidence_count()}</dd>
										</div>
										<div class="flex flex-wrap gap-x-1">
											<dt>{m.analytics_evidence_aggregation()}:</dt>
											<dd>{aggregationLabel(insight.period.aggregation)}</dd>
										</div>
										<div class="flex flex-wrap gap-x-1">
											<dt>{insightPeriodLabel(insight)}:</dt>
											<dd>{insightPeriod(insight)}</dd>
										</div>
										<div class="flex flex-wrap gap-x-1">
											<dt>{m.analytics_insight_sample_label()}:</dt>
											<dd>{insightSample(insight)}</dd>
										</div>
										<div class="flex flex-wrap gap-x-1">
											<dt>{m.analytics_evidence_collection()}:</dt>
											<dd>
												{insight.content?.collected_at
													? formatDateTime(insight.content.collected_at)
													: m.analytics_not_collected()}
											</dd>
										</div>
										{#if insight.destination_count !== undefined}
											<div class="flex flex-wrap gap-x-1">
												<dt>{m.analytics_insight_destinations_label()}:</dt>
												<dd>{insight.destination_count}</dd>
											</div>
										{/if}
									</dl>
									{#if insight.content}
										<div
											class="space-y-1 border-t border-border py-2 text-xs leading-5 text-muted-foreground"
										>
											<p class="flex items-center gap-2">
												<PlatformIcon
													platform={insight.content.platform}
													class="size-3.5 shrink-0"
												/>
												<span>{getPlatformName(insight.content.platform)}</span>
											</p>
											<p>{sourceLabel(insight.content.source)}</p>
										</div>
									{/if}
									{#if insightCaveat(insight)}
										<p class="border-t border-border py-2 text-xs leading-5 text-muted-foreground">
											{insightCaveat(insight)}
										</p>
									{/if}
								</details>
							</article>
						{/each}
					</div>
				</section>
			{/if}

			<section aria-labelledby="analytics-content-heading">
				<div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
					<div class="min-w-0">
						<h2 id="analytics-content-heading" class="text-base font-semibold">
							{m.analytics_content_title()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{selectedAccount
								? m.analytics_content_for_account({ account: accountLabel(selectedAccount) })
								: m.analytics_content_description()}
						</p>
					</div>
					<div class="flex min-w-0 flex-col gap-2 sm:flex-row">
						<div
							class="grid min-h-11 min-w-0 grid-cols-3 items-stretch rounded-md border border-border p-1"
							role="group"
							aria-label={m.analytics_source_filter_label()}
						>
							{#each ['all', 'openpost', 'external'] as source (source)}
								<button
									type="button"
									class={[
										'min-h-11 min-w-0 rounded-sm px-1.5 text-xs leading-4 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-2.5 sm:text-sm',
										sourceFilter === source
											? 'bg-secondary text-secondary-foreground'
											: 'text-muted-foreground hover:text-foreground'
									]}
									aria-pressed={sourceFilter === source}
									onclick={() => (sourceFilter = source as ContentSource)}
								>
									{source === 'all'
										? m.analytics_source_all()
										: source === 'openpost'
											? m.analytics_source_published_with_openpost()
											: m.analytics_source_published_elsewhere()}
								</button>
							{/each}
						</div>
						<Select.Root
							type="single"
							value={sortMode}
							onValueChange={(value) => (sortMode = value as AnalyticsSortMode)}
						>
							<Select.Trigger
								class="h-11 w-full sm:h-9 sm:w-44"
								aria-label={m.analytics_sort_label()}
							>
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
				</div>
				{#if contentItems.length === 0}
					<p class="border-y border-dashed border-border py-8 text-sm text-muted-foreground">
						{m.analytics_content_empty()}
					</p>
				{:else}
					<div class="overflow-hidden rounded-xl border border-border">
						<div
							data-testid="analytics-content-table-header"
							class="analytics-content-grid analytics-content-table-header hidden gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground"
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
							{#each contentItems as item (contentIdentity(item))}
								{@const id = contentIdentity(item)}
								{@const expanded = expandedContentID === id}
								{@const itemEvidence = metricEvidence(item)}
								<article data-testid="analytics-content-row">
									<div class="analytics-content-grid grid min-w-0 gap-4 px-4 py-4">
										<div class="min-w-0">
											{#if item.reference.type === 'openpost' && item.reference.publication_id}
												<a
													href={resolve('/publications/[id]', {
														id: item.reference.publication_id
													})}
													class="line-clamp-2 font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
													>{contentLabel(item)}</a
												>
											{:else}
												<p class="line-clamp-2 font-medium">{contentLabel(item)}</p>
											{/if}
											<p class="analytics-mobile-date mt-1 text-xs text-muted-foreground">
												{formatDate(item.published_at)}
											</p>
										</div>
										<div
											class="flex min-w-0 items-center gap-2 text-sm"
											data-testid="analytics-row-destinations"
										>
											<span
												class="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background"
											>
												<PlatformIcon platform={item.platform} class="size-3.5" />
											</span>
											<span class="min-w-0">
												<span class="block truncate text-xs">{renditionName(item)}</span>
												<span
													class="block truncate text-xs text-muted-foreground"
													data-testid={`analytics-source-${id}`}>{sourceLabel(item.source)}</span
												>
											</span>
										</div>
										<div class="analytics-metric flex items-baseline justify-between gap-3 text-sm">
											<span class="analytics-row-label text-xs text-muted-foreground"
												>{m.analytics_summary_engagement()}</span
											>
											<span class="font-medium tabular-nums"
												>{hasEngagementMeasurement(item)
													? formatNumber(item.engagement)
													: '—'}</span
											>
										</div>
										<div class="analytics-metric flex items-baseline justify-between gap-3 text-sm">
											<span class="analytics-row-label text-xs text-muted-foreground"
												>{m.analytics_views()}</span
											>
											<span class="font-medium tabular-nums"
												>{item.metrics.views === undefined
													? '—'
													: semanticMetricValue(item, 'views', item.metrics.views)}</span
											>
										</div>
										<div class="analytics-published hidden text-sm text-muted-foreground">
											<span class="analytics-row-label">{m.analytics_table_published()}: </span>
											{formatDate(item.published_at)}
										</div>
										<div class="analytics-actions flex min-h-11 w-full items-center gap-1">
											<Button
												size="sm"
												class="min-h-11 flex-1 md:flex-none"
												disabled={Boolean(repurposingReferenceKey)}
												onclick={() => repurposeContent(item)}
												data-testid={`analytics-repurpose-${id}`}
											>
												{repurposingReferenceKey === id
													? m.analytics_repurposing()
													: m.analytics_repurpose()}
											</Button>
											<Button
												variant="outline"
												size="sm"
												class="min-h-11 flex-1 justify-between md:flex-none"
												aria-expanded={expanded}
												aria-controls={`analytics-content-${id.replace(':', '-')}`}
												onclick={() => (expandedContentID = expanded ? '' : id)}
												data-testid={`analytics-details-${id}`}
											>
												<span class="sm:hidden">{m.analytics_evidence_details()}</span>
												<span class="hidden sm:inline">
													{expanded ? m.analytics_hide_details() : m.analytics_show_details()}
												</span>
												<ChevronDownIcon
													class={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
												/>
											</Button>
										</div>
									</div>
									{#if expanded}
										<div
											id={`analytics-content-${id.replace(':', '-')}`}
											class="border-t border-border bg-muted/20 px-4 py-3"
										>
											{#if itemEvidence.length}
												<div class="divide-y divide-border border-y border-border">
													{#each itemEvidence as metric (metric.key)}
														<div class="py-3 text-xs leading-5">
															<div class="flex flex-wrap items-baseline justify-between gap-x-3">
																<p class="font-medium">{metric.label}</p>
																<p class="font-semibold tabular-nums">{metric.value}</p>
															</div>
															<dl class="mt-1 grid gap-x-4 text-muted-foreground sm:grid-cols-2">
																<div class="flex flex-wrap gap-x-1">
																	<dt>{m.analytics_evidence_availability()}:</dt>
																	<dd>{availabilityLabel(metric.availability)}</dd>
																</div>
																<div class="flex flex-wrap gap-x-1">
																	<dt>{m.analytics_evidence_unit()}:</dt>
																	<dd>{metricUnit(metric.metadata)}</dd>
																</div>
																<div class="flex flex-wrap gap-x-1">
																	<dt>{m.analytics_evidence_aggregation()}:</dt>
																	<dd>{aggregationLabel(metric.metadata?.aggregation)}</dd>
																</div>
																<div class="flex flex-wrap gap-x-1">
																	<dt>{m.analytics_evidence_period()}:</dt>
																	<dd>{metricPeriod(metric.metadata)}</dd>
																</div>
																<div class="flex flex-wrap gap-x-1 sm:col-span-2">
																	<dt>{m.analytics_evidence_collection()}:</dt>
																	<dd>
																		{metric.collectedAt
																			? formatDateTime(metric.collectedAt)
																			: m.analytics_not_collected()}
																	</dd>
																</div>
															</dl>
															{#if metricCaveat(metric.metadata?.aggregation)}
																<p class="mt-1 text-muted-foreground">
																	{metricCaveat(metric.metadata?.aggregation)}
																</p>
															{/if}
														</div>
													{/each}
												</div>
											{:else}
												<p class="border-y border-border py-3 text-xs text-muted-foreground">
													{m.analytics_evidence_availability()}: {availabilityLabel(
														item.metric_availability
													)}
												</p>
											{/if}
											<div
												class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground"
											>
												<span
													>{m.analytics_collected_at({
														date: item.collected_at
															? formatDateTime(item.collected_at)
															: m.analytics_not_collected()
													})}</span
												>
												{#if contentStatus(item)}<span>{contentStatus(item)}</span>{/if}
												{#if item.external_url}
													<Button
														href={item.external_url}
														target="_blank"
														rel="noreferrer"
														variant="ghost"
														size="sm"
													>
														{m.analytics_open_native()}<ExternalLinkIcon class="size-3.5" />
													</Button>
												{/if}
											</div>
										</div>
									{/if}
								</article>
							{/each}
						</div>
					</div>
					<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
						<div class="text-xs leading-5 text-muted-foreground">
							<p>
								{m.analytics_results_range_stored({
									shown: contentItems.length,
									total: overview?.content_total ?? contentItems.length
								})}
							</p>
							{#if hasLimitedCoverage}
								<p>{m.analytics_history_limited_note()}</p>
							{/if}
						</div>
						{#if overview?.content_next_cursor}
							<Button variant="outline" onclick={loadMoreContent} disabled={loadingMore}>
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

<style>
	@container (min-width: 58rem) {
		.analytics-content-grid {
			grid-template-columns:
				minmax(0, 2fr) minmax(9rem, 1fr) 6rem 6rem 7.5rem
				11rem;
			align-items: center;
		}

		.analytics-content-table-header {
			display: grid;
		}

		.analytics-mobile-date {
			display: none;
		}

		.analytics-metric {
			display: block;
			text-align: end;
		}

		.analytics-published {
			display: block;
		}

		.analytics-row-label {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}

		.analytics-actions {
			align-items: stretch;
			flex-direction: column;
			justify-self: stretch;
		}
	}

	@container (min-width: 68rem) {
		.analytics-content-grid {
			grid-template-columns:
				minmax(0, 2fr) minmax(9rem, 1fr) 6rem 6rem 7.5rem
				14rem;
		}

		.analytics-actions {
			align-items: center;
			flex-direction: row;
		}
	}
</style>
