<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { client } from '$lib/api/client';
	import { getLocaleTag } from '$lib/i18n';
	import { checkoutPathForPlan, hostedPlanFromSearchParams } from '$lib/billing';
	import {
		billingPortalBody,
		requiresBillingRecovery,
		type BillingPortalPurpose
	} from '$lib/billing-recovery';
	import {
		billingPlans as billingPlanDefinitions,
		type BillingStatus,
		type ProviderCostSummary
	} from '../../../routes/settings/settings-data';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	let billingBusyPlan = $state('');
	let billingPortalBusy = $state(false);
	let billingError = $state('');
	let billingLoadError = $state('');
	let billingStatusLoading = $state(false);
	let billingStatus = $state<BillingStatus | null>(null);
	let handledCheckoutPlan = '';
	let loadedBillingWorkspaceID = '';
	let billingRequestSequence = 0;

	function isCurrentBillingTarget(workspaceID: string, organizationID: string) {
		return (
			workspaceCtx.currentWorkspace?.id === workspaceID &&
			(workspaceCtx.currentWorkspace?.organization_id ?? '') === organizationID
		);
	}

	function billingPlanName(planID: string) {
		if (planID === 'starter') return m.settings_plan_starter();
		if (planID === 'founder') return m.settings_plan_founder();
		if (planID === 'pro') return m.settings_plan_pro();
		if (planID === 'team') return m.settings_plan_team();
		if (planID === 'agency') return m.settings_plan_agency();
		return planID;
	}

	function billingPlanDescription(planID: string) {
		if (planID === 'starter') return m.settings_plan_starter_description();
		if (planID === 'founder') return m.settings_plan_founder_description();
		if (planID === 'pro') return m.settings_plan_pro_description();
		if (planID === 'team') return m.settings_plan_team_description();
		if (planID === 'agency') return m.settings_plan_agency_description();
		return '';
	}

	function billingPlanLimitLabel(limit: { readonly kind: string; readonly count: number }) {
		const value = new Intl.NumberFormat(getLocaleTag()).format(limit.count);
		if (limit.kind === 'workspaces') {
			return limit.count === 1
				? m.settings_plan_limit_workspace_one()
				: m.settings_plan_limit_workspaces({ value });
		}
		if (limit.kind === 'social_accounts') {
			return limit.count === 1
				? m.settings_plan_limit_social_account_one()
				: m.settings_plan_limit_social_accounts({ value });
		}
		if (limit.kind === 'scheduled_posts_monthly') {
			return m.settings_plan_limit_scheduled_posts({ value });
		}
		if (limit.kind === 'media_gb') return m.settings_plan_limit_media({ value });
		if (limit.kind === 'included_seats') return m.settings_plan_limit_seats({ value });
		return value;
	}

	function billingMetricLabel(metric: string) {
		if (metric === 'scheduled_posts_monthly') return m.settings_usage_scheduled_posts();
		if (metric === 'published_posts_monthly') return m.settings_usage_published_posts();
		if (metric === 'media_bytes_uploaded_monthly') return m.settings_usage_uploaded_media();
		if (metric === 'provider_write_calls_monthly') return m.settings_usage_provider_calls();
		return metric;
	}

	function billingStatusLabel(status: string) {
		const normalized = status.toLowerCase();
		if (normalized === 'none') return m.settings_billing_status_none();
		if (normalized === 'active') return m.settings_billing_status_active();
		if (normalized === 'trialing') return m.settings_billing_status_trialing();
		if (normalized === 'past_due') return m.settings_billing_status_past_due();
		if (normalized === 'canceled' || normalized === 'cancelled') {
			return m.settings_billing_status_canceled();
		}
		return status;
	}

	function providerCostName(provider: string) {
		return provider === 'x' ? 'X API' : provider;
	}

	function providerCostOperationLabel(operation: string) {
		if (operation === 'post_create') return m.settings_provider_cost_post_create();
		if (operation === 'post_create_with_url') {
			return m.settings_provider_cost_post_create_with_url();
		}
		return operation;
	}

	function providerCostRequestLabel(count: number) {
		const formatted = new Intl.NumberFormat(getLocaleTag()).format(count);
		return count === 1
			? m.settings_provider_cost_request_one()
			: m.settings_provider_cost_requests({ count: formatted });
	}

	function providerCostReservationLabel(count: number) {
		const formatted = new Intl.NumberFormat(getLocaleTag()).format(count);
		return count === 1
			? m.settings_provider_cost_reservation_one()
			: m.settings_provider_cost_reservations({ count: formatted });
	}

	function formatProviderCost(microunits: number, currency: string) {
		const amount = microunits / 1_000_000;
		try {
			return new Intl.NumberFormat(getLocaleTag(), {
				style: 'currency',
				currency,
				minimumFractionDigits: 2,
				maximumFractionDigits: 3
			}).format(amount);
		} catch {
			return `${amount.toFixed(3)} ${currency}`;
		}
	}

	function providerCostExposure(cost: ProviderCostSummary) {
		return cost.cost_microusd + cost.reserved_cost_microusd;
	}

	function providerCostBudgetLabel(cost: ProviderCostSummary) {
		return m.settings_provider_cost_budget({
			confirmed: formatProviderCost(cost.cost_microusd, cost.currency),
			reserved: formatProviderCost(cost.reserved_cost_microusd, cost.currency),
			budget: formatProviderCost(cost.budget_microusd, cost.currency)
		});
	}

	function providerCostProgress(cost: ProviderCostSummary) {
		const exposure = providerCostExposure(cost);
		if (cost.budget_microusd <= 0) return exposure > 0 ? 100 : 0;
		return Math.min(100, Math.round((exposure / cost.budget_microusd) * 100));
	}

	async function loadBillingStatus(
		workspaceID = workspaceCtx.currentWorkspace?.id ?? '',
		organizationID = workspaceCtx.currentWorkspace?.organization_id ?? ''
	) {
		if (!workspaceID) return;
		const requestSequence = ++billingRequestSequence;
		loadedBillingWorkspaceID = workspaceID;
		billingStatusLoading = true;
		billingError = '';
		billingLoadError = '';
		billingStatus = null;
		try {
			const { data, error: err } = await client.GET('/billing/status', {
				params: { query: { workspace_id: workspaceID } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_billing_load_failed());
			if (
				requestSequence !== billingRequestSequence ||
				!isCurrentBillingTarget(workspaceID, organizationID)
			)
				return;
			billingStatus = data as BillingStatus;
		} catch (e) {
			if (
				requestSequence !== billingRequestSequence ||
				!isCurrentBillingTarget(workspaceID, organizationID)
			)
				return;
			loadedBillingWorkspaceID = '';
			billingStatus = null;
			billingLoadError = (e as Error).message || m.settings_billing_load_failed();
		} finally {
			if (requestSequence === billingRequestSequence) billingStatusLoading = false;
		}
	}

	async function startCheckout(planID: string) {
		if (billingStatus && !billingStatus.can_manage_billing) return;
		billingBusyPlan = planID;
		await goto(resolve(checkoutPathForPlan(planID, 'monthly') as '/'));
		billingBusyPlan = '';
	}

	async function openBillingPortal(purpose: BillingPortalPurpose = 'manage') {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		const organizationID =
			billingStatus?.organization_id ?? workspaceCtx.currentWorkspace?.organization_id ?? '';
		if (!workspaceID || !billingStatus?.can_manage_billing || !billingStatus?.plan_id) return;
		billingPortalBusy = true;
		billingError = '';
		try {
			const { data, error: err } = organizationID
				? await client.POST('/organizations/{id}/billing/portal', {
						params: { path: { id: organizationID }, query: { purpose } }
					})
				: await client.POST('/billing/portal', {
						body: billingPortalBody(workspaceID, purpose)
					});
			if (err || !data?.url) throw new Error(err?.detail || m.settings_action_failed());
			if (!isCurrentBillingTarget(workspaceID, organizationID)) return;
			window.location.assign(data.url);
		} catch (e) {
			if (isCurrentBillingTarget(workspaceID, organizationID)) {
				billingError = (e as Error).message;
			}
		} finally {
			billingPortalBusy = false;
		}
	}

	function refreshBillingAfterReturn() {
		if (
			document.visibilityState === 'visible' &&
			workspaceCtx.currentWorkspace?.id &&
			!billingStatusLoading
		) {
			void loadBillingStatus();
		}
	}

	function formatBillingValue(metric: string, value: number): string {
		if (metric.includes('bytes')) {
			return formatBytes(value);
		}
		return new Intl.NumberFormat(getLocaleTag()).format(value);
	}

	function formatPlanPrice(amount: number): string {
		return new Intl.NumberFormat(getLocaleTag(), {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0
		}).format(amount);
	}

	function formatBytes(value: number): string {
		if (value >= 1_000_000_000) {
			return `${new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 1 }).format(value / 1_000_000_000)} GB`;
		}
		if (value >= 1_000_000) {
			return `${new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 1 }).format(value / 1_000_000)} MB`;
		}
		return `${new Intl.NumberFormat(getLocaleTag()).format(value)} B`;
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag()).format(new Date(value));
	}

	function formatDateTime(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	const billingPlans = $derived(
		billingPlanDefinitions.map((plan) => ({
			...plan,
			name: billingPlanName(plan.id),
			description: billingPlanDescription(plan.id),
			limits: plan.limits.map(billingPlanLimitLabel)
		}))
	);
	const currentBillingPlan = $derived(
		billingPlans.find((plan) => plan.id === billingStatus?.plan_id) ?? null
	);
	const providerCosts = $derived(billingStatus?.provider_costs ?? []);
	const hasActiveBillingPlan = $derived(
		Boolean(
			billingStatus?.plan_id &&
			['active', 'trialing'].includes((billingStatus.status ?? '').toLowerCase())
		)
	);
	const hasBillingSubscription = $derived(
		Boolean(billingStatus?.provider && billingStatus.plan_id)
	);
	const billingRecoveryRequired = $derived(requiresBillingRecovery(billingStatus));
	const requestedBillingPlan = $derived.by(() => {
		const planID = hostedPlanFromSearchParams(page.url.searchParams);
		return billingPlans.some((plan) => plan.id === planID) ? planID : '';
	});
	const monthlyBillingUsageRows = $derived.by(() => {
		if (!billingStatus) return [];
		return Object.entries(billingStatus.limits ?? {})
			.filter(([metric]) => metric.endsWith('_monthly'))
			.map(([metric, limit]) => ({
				metric,
				label: billingMetricLabel(metric),
				current: billingStatus?.usage?.[metric] ?? 0,
				limit
			}));
	});

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		const organizationID = workspaceCtx.currentWorkspace?.organization_id ?? '';
		if (workspaceID && loadedBillingWorkspaceID !== workspaceID) {
			void loadBillingStatus(workspaceID, organizationID);
		}
	});

	$effect(() => {
		if (
			requestedBillingPlan &&
			workspaceCtx.currentWorkspace &&
			billingStatus?.can_manage_billing &&
			handledCheckoutPlan !== requestedBillingPlan &&
			!billingBusyPlan
		) {
			handledCheckoutPlan = requestedBillingPlan;
			void startCheckout(requestedBillingPlan);
		}
	});
</script>

<svelte:window onfocus={refreshBillingAfterReturn} onpageshow={refreshBillingAfterReturn} />

<SectionHeader
	title={m.settings_billing()}
	description={m.settings_billing_body()}
	icon={CreditCardIcon}
	class="mb-4"
>
	{#snippet actions()}
		{#if billingStatus?.can_manage_billing && hasBillingSubscription}
			<Button
				variant="outline"
				onclick={() => void openBillingPortal()}
				disabled={billingPortalBusy}
			>
				{#if billingPortalBusy}
					<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
				{:else}
					<ExternalLinkIcon class="mr-2 h-4 w-4" />
				{/if}
				{m.settings_customer_portal()}
			</Button>
		{/if}
	{/snippet}
</SectionHeader>

{#if billingLoadError}
	<InlineNotice tone="error" message={billingLoadError} class="mb-4">
		{#snippet actions()}
			<Button
				variant="outline"
				size="sm"
				onclick={() => void loadBillingStatus()}
				disabled={billingStatusLoading}
			>
				{m.common_retry()}
			</Button>
		{/snippet}
	</InlineNotice>
{:else if billingStatusLoading}
	<div class="mb-4">
		<PageLoading layout="grid" label={m.common_loading()} items={2} />
	</div>
{:else if billingStatus}
	{#if hasBillingSubscription}
		{#if billingRecoveryRequired}
			<InlineNotice tone="error" class="mb-4">
				<div data-testid="billing-recovery-card">
					<p class="font-semibold">{m.settings_billing_recovery_title()}</p>
					<p class="mt-1 leading-6">{m.settings_billing_recovery_body()}</p>
					{#if billingStatus.past_due_since}
						<p class="mt-1 text-xs">
							{m.billing_recovery_notice_since({
								date: formatDateTime(billingStatus.past_due_since)
							})}
						</p>
					{/if}
					<p class="mt-1 text-sm font-medium">
						{billingStatus.can_manage_billing
							? m.settings_billing_recovery_confirmation()
							: m.billing_recovery_notice_member_action()}
					</p>
					{#if billingStatus.can_manage_billing}
						<Button
							variant="destructive"
							class="mt-3 w-full sm:w-auto"
							onclick={() => void openBillingPortal('update_payment_method')}
							disabled={billingPortalBusy}
						>
							{#if billingPortalBusy}
								<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
							{/if}
							{m.billing_recovery_update_payment_method()}
						</Button>
					{/if}
				</div>
			</InlineNotice>
		{/if}

		<div class="mb-4 grid gap-3 lg:grid-cols-2" data-testid="billing-provider-boundary">
			<div class="rounded-lg border bg-muted/20 p-4">
				<h3 class="font-semibold">{m.settings_openpost_billing_facts()}</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					{m.settings_openpost_billing_facts_body()}
				</p>
				{#if billingStatus.billing_contact_email}
					<dl class="mt-3 text-sm">
						<dt class="text-muted-foreground">{m.settings_billing_contact()}</dt>
						<dd class="font-medium break-all">{billingStatus.billing_contact_email}</dd>
					</dl>
				{/if}
			</div>
			<div class="rounded-lg border bg-background p-4">
				<h3 class="font-semibold">{m.settings_paddle_manages()}</h3>
				<p class="mt-1 text-sm text-muted-foreground">{m.settings_paddle_manages_body()}</p>
				{#if billingStatus.can_manage_billing && hasBillingSubscription}
					<div class="mt-3 flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							onclick={() => void openBillingPortal('update_payment_method')}
							disabled={billingPortalBusy}
						>
							{m.settings_update_payment_method()}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => void openBillingPortal('invoices')}
							disabled={billingPortalBusy}
						>
							{m.settings_view_invoices_receipts()}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => void openBillingPortal('billing_details')}
							disabled={billingPortalBusy}
						>
							{m.settings_update_billing_details()}
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onclick={() => void openBillingPortal('cancel_subscription')}
							disabled={billingPortalBusy}
						>
							{m.settings_cancel_subscription()}
						</Button>
					</div>
				{:else if hasBillingSubscription}
					<p class="mt-3 text-sm font-medium">{m.settings_billing_owner_action()}</p>
				{/if}
			</div>
		</div>

		<div class="mb-4 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
			<div class="rounded-lg border bg-muted/20 p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{m.settings_current_plan()}
				</p>
				<div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
					<p class="text-2xl font-semibold">
						{currentBillingPlan?.name ?? (billingStatus.plan_id || m.settings_no_active_plan())}
					</p>
					<p class="pb-1 text-sm text-muted-foreground">
						{billingStatusLabel(billingStatus.status ?? '')}
					</p>
				</div>
				{#if billingStatus.current_period_end}
					<p class="mt-2 text-sm text-muted-foreground">
						{m.settings_billing_period_ends({ date: formatDate(billingStatus.current_period_end) })}
						{#if billingStatus.cancel_at_period_end}
							· {m.settings_billing_cancels_after_period()}
						{/if}
					</p>
				{:else if hasActiveBillingPlan}
					<p class="mt-2 text-sm text-muted-foreground">
						{m.settings_active_plan()}
					</p>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">
						{m.settings_start_checkout()}
					</p>
				{/if}
			</div>

			<div class="rounded-lg border bg-muted/20 p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{m.settings_usage_month()}
				</p>
				{#if monthlyBillingUsageRows.length}
					<div class="mt-3 grid gap-3 sm:grid-cols-2">
						{#each monthlyBillingUsageRows as row (row.metric)}
							<div>
								<div class="mb-1 flex items-center justify-between gap-2 text-sm">
									<span>{row.label}</span>
									<span class="text-muted-foreground">
										{formatBillingValue(row.metric, row.current)} / {formatBillingValue(
											row.metric,
											row.limit
										)}
									</span>
								</div>
								<div class="h-2 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full bg-primary"
										style:width={`${Math.min(100, Math.round((row.current / Math.max(row.limit, 1)) * 100))}%`}
									></div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">
						{m.settings_usage_empty()}
					</p>
				{/if}
			</div>
		</div>
	{:else}
		<InlineNotice tone="info" message={m.settings_start_checkout()} class="mb-4" />
	{/if}

	{#if providerCosts.length}
		<div class="mb-4 rounded-lg border bg-background p-4" data-testid="provider-cost-usage">
			{#each providerCosts as providerCost (providerCost.provider)}
				<div class="min-w-0">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div class="max-w-2xl">
							<h3 class="font-semibold">{m.settings_provider_costs()}</h3>
							<p class="mt-1 text-sm text-muted-foreground">
								{m.settings_provider_costs_body()}
							</p>
						</div>
						<div class="shrink-0 text-left sm:text-right">
							<p class="font-medium">{providerCostName(providerCost.provider)}</p>
							<p class="text-sm text-muted-foreground">
								{providerCostBudgetLabel(providerCost)}
							</p>
						</div>
					</div>

					<div
						class="mt-4 h-2 overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-label={providerCostBudgetLabel(providerCost)}
						aria-valuemin="0"
						aria-valuemax={Math.max(providerCost.budget_microusd, 1)}
						aria-valuenow={Math.min(
							providerCostExposure(providerCost),
							Math.max(providerCost.budget_microusd, 1)
						)}
					>
						<div
							class={[
								'h-full rounded-full',
								providerCostProgress(providerCost) >= 100
									? 'bg-destructive'
									: providerCostProgress(providerCost) >= 80
										? 'bg-amber-500'
										: 'bg-primary'
							]}
							style:width={`${providerCostProgress(providerCost)}%`}
						></div>
					</div>

					{#if providerCost.operations?.length}
						<ul class="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
							{#each providerCost.operations as operation (operation.operation)}
								<li class="flex min-w-0 items-baseline justify-between gap-3 text-sm">
									<div class="min-w-0">
										<p class="truncate">
											{providerCostOperationLabel(operation.operation)}
										</p>
										<p class="text-xs text-muted-foreground">
											{providerCostRequestLabel(operation.event_count)}
										</p>
										{#if operation.reserved_event_count > 0}
											<p class="text-xs text-amber-700 dark:text-amber-300">
												{providerCostReservationLabel(operation.reserved_event_count)}
											</p>
										{/if}
									</div>
									<div class="shrink-0 text-right">
										<p class="font-medium">
											{formatProviderCost(operation.cost_microusd, providerCost.currency)}
										</p>
										{#if operation.reserved_cost_microusd > 0}
											<p class="text-xs text-amber-700 dark:text-amber-300">
												{m.settings_provider_cost_reserved_amount({
													amount: formatProviderCost(
														operation.reserved_cost_microusd,
														providerCost.currency
													)
												})}
											</p>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}

					<div
						class="mt-4 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"
					>
						<p class="max-w-2xl text-xs text-muted-foreground">
							{m.settings_provider_cost_estimate_note()}
						</p>
						<Button
							href={providerCost.pricing_source_url}
							target="_blank"
							rel="noreferrer"
							variant="ghost"
							size="sm"
							class="self-start sm:self-auto"
						>
							{m.settings_provider_cost_view_pricing()}
							<ExternalLinkIcon class="ml-1 h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}

<details class="border-t pt-4" open={!hasActiveBillingPlan}>
	<summary
		class="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	>
		{hasActiveBillingPlan ? m.settings_compare_plan() : m.settings_choose_plan()}
	</summary>
	<div class="mt-4 grid gap-3 lg:grid-cols-3">
		<p class="text-sm text-muted-foreground lg:col-span-3">
			{m.settings_plan_price_estimate_note()}
		</p>
		{#each billingPlans as plan (plan.id)}
			<article
				class={`rounded-lg border p-4 ${plan.featured ? 'border-primary bg-primary/5 shadow-sm' : 'bg-background'}`}
			>
				<div class="mb-3 flex items-start justify-between gap-3">
					<div>
						<h3 class="font-semibold">{plan.name}</h3>
						<p class="text-sm text-muted-foreground">{plan.description}</p>
					</div>
					<div class="text-right">
						<div class="text-xl font-semibold">
							{formatPlanPrice(plan.monthlyPriceUSD)}
						</div>
						<div class="text-xs text-muted-foreground">
							{m.settings_price_per_month()}
						</div>
					</div>
				</div>
				<ul class="mb-4 space-y-1 text-sm text-muted-foreground">
					{#each plan.limits as limit (limit)}
						<li>{limit}</li>
					{/each}
				</ul>
				<Button
					class="w-full"
					variant={plan.featured ? 'default' : 'outline'}
					onclick={() => startCheckout(plan.id)}
					disabled={Boolean(billingBusyPlan) ||
						hasActiveBillingPlan ||
						billingRecoveryRequired ||
						Boolean(billingStatus && !billingStatus.can_manage_billing)}
				>
					{#if billingBusyPlan === plan.id}
						<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
					{/if}
					{#if hasActiveBillingPlan && billingStatus?.plan_id === plan.id}
						{m.settings_current_plan()}
					{:else if hasActiveBillingPlan}
						{m.settings_use_portal()}
					{:else}
						{m.settings_choose_named_plan({ plan: plan.name })}
					{/if}
				</Button>
			</article>
		{/each}
	</div>
</details>

{#if billingError}
	<InlineNotice tone="error" message={billingError} class="mt-4" />
{/if}
