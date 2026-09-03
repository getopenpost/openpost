<script lang="ts">
	import { ThemeIcon } from '$lib/themes/icons';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import InstanceAdminTrend from '$lib/components/instance-admin-trend.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		adminQueryKeys,
		instanceOverviewQueryOptions,
		OpenPostQueryError
	} from '@openpost/query-catalog';
	import { adminQueryAPI } from '$lib/query/admin';
	import { queryClient } from '$lib/query/client';
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';

	let authorizationError = $state('');
	const overviewQuery = createQuery(() => ({
		...instanceOverviewQueryOptions(adminQueryAPI),
		enabled: !authorizationError
	}));
	const overview = $derived(authorizationError ? null : (overviewQuery.data ?? null));
	const overviewLoading = $derived(!authorizationError && overviewQuery.isPending);
	const overviewError = $derived(authorizationError || overviewQuery.error?.message || '');
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceOverview
	);
	$effect(() => reportInitialLoad(overviewLoading && !overview));

	$effect(() => {
		const cause = overviewQuery.error;
		if (!(cause instanceof OpenPostQueryError) || (cause.status !== 401 && cause.status !== 403))
			return;
		authorizationError = cause.message;
		queryClient.removeQueries({
			queryKey: adminQueryKeys.overview(),
			exact: true
		});
	});

	async function retryOverview() {
		authorizationError = '';
		await overviewQuery.refetch();
	}

	function formatNumber(value: number) {
		return new Intl.NumberFormat(getLocaleTag()).format(value);
	}
</script>

<div class="space-y-10" data-testid="instance-admin-overview">
	<section class="space-y-4">
		<SectionHeader
			title={m.settings_instance_overview()}
			description={m.settings_instance_overview_body()}
			themeIconRole="analytics"
			class="mb-4"
		/>

		{#if overviewError}
			<InlineNotice tone={overview ? 'warning' : 'error'} message={overviewError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryOverview}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if overviewLoading && !overview}
			<PageLoading layout="grid" label={m.common_loading()} items={4} />
		{:else if overview}
			<dl
				class="grid overflow-hidden rounded-lg border bg-muted/15 sm:grid-cols-2 xl:grid-cols-4"
				aria-label={m.settings_instance_overview()}
			>
				<div class="border-b p-4 sm:border-r xl:border-b-0">
					<dt class="text-sm text-muted-foreground">
						{m.settings_instance_total_users()}
					</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.total_users)}
					</dd>
				</div>
				<div class="border-b p-4 xl:border-r xl:border-b-0">
					<dt class="text-sm text-muted-foreground">
						{m.settings_instance_new_users()}
					</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.new_users_last_30_days)}
					</dd>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_last_30_days()}
					</p>
				</div>
				<div class="border-b p-4 sm:border-r sm:border-b-0">
					<dt class="text-sm text-muted-foreground">
						{m.settings_instance_workspaces()}
					</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.total_workspaces)}
					</dd>
				</div>
				<div class="p-4">
					<dt class="text-sm text-muted-foreground">
						{m.settings_instance_published_posts()}
					</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.published_last_30_days)}
					</dd>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_last_30_days()}
					</p>
				</div>
			</dl>

			<div class="grid overflow-hidden rounded-lg border lg:grid-cols-2">
				<div class="min-w-0 border-b p-4 lg:border-r lg:border-b-0">
					<h3 class="text-sm font-semibold">
						{m.settings_instance_registration_trend()}
					</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_registration_trend_body()}
					</p>
					<div class="mt-4">
						<InstanceAdminTrend
							points={overview.user_registration_trend ?? []}
							label={m.settings_instance_registration_trend()}
							seriesLabel={m.settings_instance_new_accounts()}
							emptyLabel={m.settings_instance_chart_no_activity()}
						/>
					</div>
				</div>
				<div class="min-w-0 p-4">
					<h3 class="text-sm font-semibold">
						{m.settings_instance_publication_trend()}
					</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_publication_trend_body()}
					</p>
					<div class="mt-4">
						<InstanceAdminTrend
							points={overview.publication_trend ?? []}
							label={m.settings_instance_publication_trend()}
							seriesLabel={m.settings_instance_successful_publications()}
							emptyLabel={m.settings_instance_chart_no_activity()}
						/>
					</div>
				</div>
			</div>
		{/if}
	</section>
</div>
