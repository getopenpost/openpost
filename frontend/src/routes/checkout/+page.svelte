<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		billingPeriodFromSearchParams,
		hostedPlanByID,
		hostedPlanFromSearchParams,
		hostedPlans,
		planPriceUSD,
		type BillingPeriod,
		type HostedPlanID
	} from '$lib/billing';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { m } from '$lib/paraglide/messages';
	import CheckIcon from 'lucide-svelte/icons/check';
	import LockIcon from 'lucide-svelte/icons/lock-keyhole';
	import ShieldCheckIcon from 'lucide-svelte/icons/shield-check';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';

	type BillingURL = components['schemas']['BillingURLResponse'];
	type BillingStatus = components['schemas']['BillingStatusResponse'];
	type CheckoutState = 'loading' | 'ready' | 'confirming' | 'success' | 'error';

	let selectedPlanID = $state<HostedPlanID>('creator');
	let billingPeriod = $state<BillingPeriod>('monthly');
	let checkout = $state.raw<BillingURL | null>(null);
	let checkoutState = $state<CheckoutState>('loading');
	let error = $state('');
	let requestSequence = 0;
	let stopped = false;

	let selectedPlan = $derived(hostedPlanByID(selectedPlanID));
	let selectedPrice = $derived(planPriceUSD(selectedPlan, billingPeriod));
	let monthlyEquivalent = $derived(
		billingPeriod === 'annual'
			? Math.round((selectedPlan.annualPriceUSD / 12) * 100) / 100
			: selectedPrice
	);
	let userEmail = $derived($auth.user?.email ?? '');

	function currency(value: number) {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: Number.isInteger(value) ? 0 : 2
		}).format(value);
	}

	function trialEndLabel(value?: string) {
		const trialEnd = value ? new Date(value) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
		return new Intl.DateTimeFormat(undefined, {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		}).format(trialEnd);
	}

	function updateURL() {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('plan', selectedPlanID);
		params.set('billing_period', billingPeriod);
		params.delete('status');
		window.history.replaceState({}, '', `${page.url.pathname}?${params}`);
	}

	async function choosePlan(planID: HostedPlanID) {
		if (selectedPlanID === planID && checkoutState === 'ready') return;
		selectedPlanID = planID;
		updateURL();
		await createCheckout();
	}

	async function choosePeriod(period: BillingPeriod) {
		if (billingPeriod === period) return;
		billingPeriod = period;
		updateURL();
		await createCheckout();
	}

	async function createCheckout() {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		if (!workspaceID) {
			checkoutState = 'error';
			error = m.checkout_workspace_missing();
			return;
		}
		const sequence = ++requestSequence;
		checkoutState = 'loading';
		checkout = null;
		error = '';
		try {
			const affiliateCode = page.url.searchParams.get('affiliate_code')?.trim() || undefined;
			const { data, error: apiError } = await client.POST('/billing/checkout', {
				body: {
					workspace_id: workspaceID,
					plan_id: selectedPlanID,
					billing_period: billingPeriod,
					affiliate_code: affiliateCode
				}
			});
			if (sequence !== requestSequence || stopped) return;
			if (apiError || !data?.id || !data.provider_plan_id) {
				throw new Error(apiError?.detail || m.checkout_load_failed());
			}
			checkout = data;
			checkoutState = 'ready';
			await tick();
			mountWhopCheckout();
		} catch (caught) {
			if (sequence !== requestSequence || stopped) return;
			checkoutState = 'error';
			error = caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
		}
	}

	function mountWhopCheckout() {
		const existing = document.querySelector<HTMLScriptElement>(
			'script[data-openpost-whop-checkout]'
		);
		existing?.remove();
		const script = document.createElement('script');
		script.src = 'https://js.whop.com/static/checkout/loader.js';
		script.async = true;
		script.defer = true;
		script.dataset.openpostWhopCheckout = 'true';
		script.onerror = () => {
			if (checkoutState !== 'ready') return;
			checkoutState = 'error';
			error = m.checkout_embed_failed();
		};
		document.head.appendChild(script);
	}

	async function loadBillingStatus(): Promise<BillingStatus | null> {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		if (!workspaceID) return null;
		const { data, error: apiError } = await client.GET('/billing/status', {
			params: { query: { workspace_id: workspaceID } }
		});
		if (apiError || !data) return null;
		return data;
	}

	async function confirmSubscription() {
		checkoutState = 'confirming';
		error = '';
		for (let attempt = 0; attempt < 30 && !stopped; attempt += 1) {
			const status = await loadBillingStatus();
			if (status && ['active', 'trialing'].includes(status.status.toLowerCase())) {
				checkoutState = 'success';
				return;
			}
			await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 1000));
		}
		if (!stopped) {
			checkoutState = 'error';
			error = m.checkout_confirmation_delayed();
		}
	}

	function continueToAccounts() {
		void goto(resolve('/settings?tab=accounts&onboarding=1'));
	}

	function continueToOriginalTask() {
		const target = safeSameOriginRedirect(page.url, '');
		if (target) void goto(resolve(target as '/'));
	}

	onMount(() => {
		selectedPlanID = hostedPlanFromSearchParams(page.url.searchParams) || 'creator';
		billingPeriod = billingPeriodFromSearchParams(page.url.searchParams);
		void workspaceCtx.initialize().then(() => {
			if (page.url.searchParams.get('status') === 'success') {
				void confirmSubscription();
				return;
			}
			void createCheckout();
		});
		return () => {
			stopped = true;
			requestSequence += 1;
		};
	});
</script>

<svelte:head>
	<title>{m.checkout_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="min-h-dvh bg-muted/30 px-4 py-8 sm:px-6 lg:py-12">
	<div class="mx-auto w-full max-w-6xl">
		<header class="mb-7 flex items-center justify-between gap-4">
			<a href={resolve('/')} aria-label="OpenPost">
				<Logo width={112} height={33} />
			</a>
			<div class="flex items-center gap-2 text-sm text-muted-foreground">
				<LockIcon class="size-4" />
				{m.checkout_secure()}
			</div>
		</header>

		{#if checkoutState === 'success'}
			<Card class="mx-auto max-w-xl">
				<CardContent class="flex flex-col items-center gap-5 px-6 py-10 text-center sm:px-10">
					<div
						class="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"
					>
						<CheckIcon class="size-7" />
					</div>
					<div class="space-y-2">
						<h1 class="text-2xl font-semibold tracking-tight">{m.checkout_success_heading()}</h1>
						<p class="text-sm/6 text-muted-foreground">{m.checkout_success_description()}</p>
					</div>
					<div class="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
						<Button size="lg" onclick={continueToAccounts}>{m.checkout_connect_account()}</Button>
						{#if safeSameOriginRedirect(page.url, '')}
							<Button size="lg" variant="outline" onclick={continueToOriginalTask}>
								{m.checkout_continue_original()}
							</Button>
						{/if}
					</div>
				</CardContent>
			</Card>
		{:else if checkoutState === 'confirming'}
			<Card class="mx-auto max-w-xl">
				<CardContent class="space-y-5 px-6 py-10 text-center sm:px-10" role="status">
					<SparklesIcon class="mx-auto size-10 animate-pulse text-primary" />
					<div class="space-y-2">
						<h1 class="text-xl font-semibold">{m.checkout_confirming_heading()}</h1>
						<p class="text-sm/6 text-muted-foreground">{m.checkout_confirming_description()}</p>
					</div>
				</CardContent>
			</Card>
		{:else}
			<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,1.1fr)]">
				<section class="space-y-6">
					<div class="space-y-2">
						<p class="text-sm font-medium text-primary">{m.checkout_eyebrow()}</p>
						<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
							{m.checkout_heading()}
						</h1>
						<p class="max-w-xl text-base/7 text-muted-foreground">{m.checkout_description()}</p>
					</div>

					<div
						class="inline-flex rounded-lg border bg-background p-1"
						aria-label={m.checkout_billing_period()}
					>
						<Button
							variant={billingPeriod === 'monthly' ? 'default' : 'ghost'}
							size="sm"
							onclick={() => void choosePeriod('monthly')}
						>
							{m.checkout_monthly()}
						</Button>
						<Button
							variant={billingPeriod === 'annual' ? 'default' : 'ghost'}
							size="sm"
							onclick={() => void choosePeriod('annual')}
						>
							{m.checkout_annual()} <span class="ml-1 text-xs opacity-80">{m.checkout_save()}</span>
						</Button>
					</div>

					<RadioGroup.Root
						value={selectedPlanID}
						name="checkout_plan"
						class="grid gap-2 sm:grid-cols-2"
						onValueChange={(value) => void choosePlan(value as HostedPlanID)}
					>
						{#each hostedPlans as plan (plan.id)}
							<label
								class={[
									'flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-4 transition-colors',
									selectedPlanID === plan.id
										? 'border-primary ring-2 ring-primary/15'
										: 'hover:border-foreground/30'
								]}
							>
								<RadioGroup.Item class="mt-1" value={plan.id} aria-label={plan.name} />
								<span class="min-w-0 flex-1">
									<span class="flex items-center justify-between gap-2 font-medium">
										{plan.name}
										{#if plan.featured}<span class="text-xs text-primary"
												>{m.checkout_popular()}</span
											>{/if}
									</span>
									<span class="mt-1 block text-sm text-muted-foreground">
										{currency(planPriceUSD(plan, billingPeriod))}/{billingPeriod === 'annual'
											? m.checkout_year()
											: m.checkout_month()}
									</span>
								</span>
							</label>
						{/each}
					</RadioGroup.Root>

					<Card>
						<CardContent class="space-y-5 p-5">
							<div class="flex items-start justify-between gap-4">
								<div>
									<p class="font-semibold">{selectedPlan.name}</p>
									<p class="text-sm text-muted-foreground">{selectedPlan.bestFor}</p>
								</div>
								<div class="text-right">
									<p class="text-2xl font-semibold">{currency(selectedPrice)}</p>
									<p class="text-xs text-muted-foreground">
										{billingPeriod === 'annual'
											? `${currency(monthlyEquivalent)}/${m.checkout_month()} · ${m.checkout_billed_annually()}`
											: m.checkout_billed_monthly()}
									</p>
								</div>
							</div>
							<ul class="grid gap-2 text-sm">
								{#each selectedPlan.limits as limit (limit)}
									<li class="flex items-center gap-2">
										<CheckIcon class="size-4 text-emerald-600" />{limit}
									</li>
								{/each}
							</ul>
							<div class="rounded-lg bg-primary/7 p-4">
								<p class="font-semibold">{m.checkout_zero_today()}</p>
								<p class="mt-1 text-sm/6 text-muted-foreground">
									{m.checkout_charge_date({
										price: currency(selectedPrice),
										date: trialEndLabel(checkout?.trial_ends_at)
									})}
								</p>
							</div>
						</CardContent>
					</Card>

					<div
						class="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"
					>
						<span class="flex items-center gap-2"
							><ShieldCheckIcon class="size-4 text-emerald-600" />{m.checkout_trial()}</span
						>
						<span class="flex items-center gap-2"
							><LockIcon class="size-4 text-emerald-600" />{m.checkout_card_required()}</span
						>
						<span class="flex items-center gap-2"
							><CheckIcon class="size-4 text-emerald-600" />{m.checkout_cancel()}</span
						>
					</div>
				</section>

				<Card class="overflow-hidden">
					<CardContent class="p-0">
						{#if checkoutState === 'loading'}
							<div class="space-y-4 p-6" role="status" aria-label={m.checkout_loading()}>
								<Skeleton class="h-8 w-44" />
								<Skeleton class="h-14 w-full" />
								<Skeleton class="h-14 w-full" />
								<Skeleton class="h-44 w-full" />
								<span class="sr-only">{m.checkout_loading()}</span>
							</div>
						{:else if checkoutState === 'error'}
							<div class="space-y-4 p-6">
								<InlineNotice tone="error" message={error} />
								<div class="flex flex-col gap-2 sm:flex-row">
									<Button onclick={() => void createCheckout()}>{m.common_retry()}</Button>
									{#if checkout?.purchase_url}
										<Button href={checkout.purchase_url} variant="outline"
											>{m.checkout_open_secure()}</Button
										>
									{/if}
								</div>
							</div>
						{:else if checkout?.id && checkout.provider_plan_id}
							<div
								id="openpost-whop-checkout"
								class="min-h-[640px]"
								data-whop-checkout-plan-id={checkout.provider_plan_id}
								data-whop-checkout-session={checkout.id}
								data-whop-checkout-return-url={checkout.return_url}
								data-whop-checkout-theme="system"
								data-whop-checkout-theme-accent-color="orange"
								data-whop-checkout-hide-price="true"
								data-whop-checkout-collect-phone-numbers="false"
								data-whop-checkout-prefill-email={userEmail}
								data-whop-checkout-style-padding-x="16"
							></div>
						{/if}
					</CardContent>
				</Card>
			</div>
		{/if}
	</div>
</main>
