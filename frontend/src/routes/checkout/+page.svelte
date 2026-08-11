<script lang="ts">
	import { onMount } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
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
		onboardingPathForPlan,
		hostedPlanByID,
		hostedPlanFromSearchParams,
		hostedPlans,
		type BillingPeriod,
		type HostedPlanID
	} from '$lib/billing';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import {
		initializePaddle,
		type Environments,
		type Paddle,
		type PaddleEventData
	} from '@paddle/paddle-js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LockIcon from '@lucide/svelte/icons/lock-keyhole';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	type BillingURL = components['schemas']['BillingURLResponse'];
	type BillingStatus = components['schemas']['BillingStatusResponse'];
	type CheckoutState = 'loading' | 'ready' | 'opening' | 'confirming' | 'success' | 'error';

	let selectedPlanID = $state<HostedPlanID>('founder');
	let billingPeriod = $state<BillingPeriod>('monthly');
	let checkout = $state.raw<BillingURL | null>(null);
	let paddle = $state.raw<Paddle | null>(null);
	let localizedPrices = $state<Record<string, string>>({});
	let checkoutState = $state<CheckoutState>('loading');
	let error = $state('');
	let requestSequence = 0;
	let stopped = false;
	let paddlePromise: Promise<Paddle | undefined> | null = null;
	let paddleConfiguration = '';
	let paymentFrameLoaded = $state(false);

	let selectedPlan = $derived(hostedPlanByID(selectedPlanID));
	let selectedPrice = $derived(localizedPrices[selectedPlanID] ?? '');
	let userEmail = $derived($auth.user?.email ?? '');

	function trialEndLabel(value?: string) {
		const trialEnd = value ? new Date(value) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
		return new Intl.DateTimeFormat(getLocaleTag(), {
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
		params.delete('affiliate_code');
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

	function handlePaddleEvent(event: PaddleEventData) {
		if (event.name === 'checkout.loaded') {
			paymentFrameLoaded = true;
			checkoutState = 'ready';
			return;
		}
		if (event.name === 'checkout.closed') {
			paymentFrameLoaded = false;
			return;
		}
		if (event.name === 'checkout.completed' && checkoutState !== 'confirming') {
			paymentFrameLoaded = false;
			void confirmSubscription();
			return;
		}
		if (event.name === 'checkout.error' || event.name === 'checkout.payment.error') {
			checkoutState = 'error';
			error = m.checkout_embed_failed();
		}
	}

	function paddleLocale(): 'en' | 'pt' {
		return getLocaleTag().toLowerCase().startsWith('pt') ? 'pt' : 'en';
	}

	async function initializePaddleForCheckout(data: BillingURL): Promise<Paddle> {
		if (!data.client_token || !data.environment) {
			throw new Error(m.checkout_load_failed());
		}
		if (data.environment !== 'sandbox' && data.environment !== 'production') {
			throw new Error(m.checkout_load_failed());
		}
		const configuration = `${data.environment}:${data.client_token}`;
		if (paddle && paddleConfiguration === configuration) return paddle;
		if (paddleConfiguration && paddleConfiguration !== configuration) {
			throw new Error(m.checkout_load_failed());
		}
		if (!paddlePromise) {
			paddleConfiguration = configuration;
			paddlePromise = initializePaddle({
				environment: data.environment as Environments,
				token: data.client_token,
				eventCallback: handlePaddleEvent
			});
		}
		try {
			const instance = await paddlePromise;
			if (!instance) throw new Error(m.checkout_embed_failed());
			paddle = instance;
			return instance;
		} catch (caught) {
			paddlePromise = null;
			paddleConfiguration = '';
			throw caught;
		}
	}

	async function loadLocalizedPrices(
		instance: Paddle,
		data: BillingURL
	): Promise<Record<string, string>> {
		const priceIDs = data.price_ids ?? {};
		const entries = Object.entries(priceIDs).filter((entry): entry is [string, string] =>
			Boolean(entry[1])
		);
		if (entries.length !== hostedPlans.length) throw new Error(m.checkout_load_failed());
		const preview = await instance.PricePreview({
			items: entries.map(([, priceId]) => ({ priceId, quantity: 1 }))
		});
		const formattedByPrice = new Map(
			preview.data.details.lineItems.map((item) => [item.price.id, item.formattedTotals.total])
		);
		const nextPrices: Record<string, string> = {};
		for (const [planID, priceID] of entries) {
			const formatted = formattedByPrice.get(priceID);
			if (!formatted) throw new Error(m.checkout_load_failed());
			nextPrices[planID] = formatted;
		}
		return nextPrices;
	}

	async function createCheckout() {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		if (!workspaceID) {
			checkoutState = 'error';
			error = m.checkout_workspace_missing();
			return;
		}
		const sequence = ++requestSequence;
		paddle?.Checkout.close();
		paymentFrameLoaded = false;
		checkoutState = 'loading';
		checkout = null;
		localizedPrices = {};
		error = '';
		try {
			const { data, error: apiError } = await client.POST('/billing/checkout', {
				body: {
					workspace_id: workspaceID,
					plan_id: selectedPlanID,
					billing_period: billingPeriod
				}
			});
			if (sequence !== requestSequence || stopped) return;
			if (
				apiError ||
				!data?.id ||
				!data.provider_price_id ||
				!data.return_url ||
				!data.customer_email
			) {
				throw new Error(apiError?.detail || m.checkout_load_failed());
			}
			const instance = await initializePaddleForCheckout(data);
			const nextPrices = await loadLocalizedPrices(instance, data);
			if (sequence !== requestSequence || stopped) return;
			localizedPrices = nextPrices;
			checkout = data;
			await openPaddleCheckout(instance, data);
		} catch (caught) {
			if (sequence !== requestSequence || stopped) return;
			checkoutState = 'error';
			error = caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
		}
	}

	async function openPaddleCheckout(instance: Paddle, data: BillingURL) {
		if (!data.id || !data.provider_price_id || !data.customer_email || !data.return_url) {
			error = m.checkout_load_failed();
			checkoutState = 'error';
			return;
		}
		checkoutState = 'opening';
		paymentFrameLoaded = false;
		if (stopped) return;
		instance.Checkout.open({
			items: [{ priceId: data.provider_price_id, quantity: 1 }],
			customData: { checkout_id: data.id },
			customer: { email: data.customer_email },
			settings: {
				displayMode: 'inline',
				variant: 'one-page',
				// Granular branded-input colors are managed in Paddle. Keep the hosted fields
				// on a deliberate light canvas so labels, values, and errors remain readable.
				theme: 'light',
				locale: paddleLocale(),
				allowLogout: false,
				showAddDiscounts: true,
				showAddTaxId: true,
				frameTarget: 'openpost-paddle-checkout',
				frameInitialHeight: 720,
				frameStyle:
					'width: 100%; min-width: 312px; background-color: #ffffff; color-scheme: light; border: none;',
				successUrl: data.return_url
			}
		});
		captureTelemetryEvent('billing checkout opened', {
			billing_period: billingPeriod,
			plan_id: selectedPlanID
		});
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
		selectedPlanID = hostedPlanFromSearchParams(page.url.searchParams) || 'founder';
		billingPeriod = billingPeriodFromSearchParams(page.url.searchParams);
		const workspaceReady = workspaceCtx.currentWorkspace?.id
			? Promise.resolve()
			: workspaceCtx.initialize();
		void workspaceReady.then(async () => {
			if (!workspaceCtx.currentWorkspace?.id) {
				const target = new URL(onboardingPathForPlan(selectedPlanID), page.url);
				target.searchParams.set('billing_period', billingPeriod);
				const redirect = safeSameOriginRedirect(page.url, '');
				if (redirect) target.searchParams.set('redirect', redirect);
				await goto(resolve(`${target.pathname}${target.search}` as '/'));
				return;
			}
			if (page.url.searchParams.get('status') === 'success') {
				void confirmSubscription();
				return;
			}
			void createCheckout();
		});
		return () => {
			stopped = true;
			requestSequence += 1;
			paddle?.Checkout.close();
		};
	});
</script>

<svelte:head>
	<title>{m.checkout_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-dvh bg-background">
	<header class="border-b bg-background/95">
		<div
			class="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:min-h-20 sm:px-6 lg:px-8"
		>
			<a
				href={resolve('/')}
				class="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
				aria-label="OpenPost"
			>
				<Logo width={132} height={30} showText />
			</a>
			<div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
				<LockIcon class="size-4 text-primary" />
				{m.checkout_secure()}
			</div>
		</div>
	</header>

	<main
		class="mx-auto w-full max-w-7xl py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-14"
		style="padding-bottom: max(3rem, calc(env(safe-area-inset-bottom) + 1.5rem));"
	>
		{#if checkoutState === 'success'}
			<Card class="mx-4 max-w-xl sm:mx-auto">
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
			<Card class="mx-4 max-w-xl sm:mx-auto">
				<CardContent class="space-y-5 px-6 py-10 text-center sm:px-10" role="status">
					<SparklesIcon class="mx-auto size-10 animate-pulse text-primary" />
					<div class="space-y-2">
						<h1 class="text-xl font-semibold">{m.checkout_confirming_heading()}</h1>
						<p class="text-sm/6 text-muted-foreground">{m.checkout_confirming_description()}</p>
					</div>
				</CardContent>
			</Card>
		{:else}
			<div
				class="grid items-start gap-10 lg:grid-cols-[22rem_minmax(0,47rem)] lg:justify-center lg:gap-16"
			>
				<aside class="space-y-7 px-4 sm:px-0 lg:sticky lg:top-8">
					<div class="space-y-3">
						<p class="text-sm font-semibold text-primary">{m.checkout_eyebrow()}</p>
						<h1
							class="max-w-[15ch] text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl"
						>
							{m.checkout_heading()}
						</h1>
						<p class="max-w-[42ch] text-sm/6 text-muted-foreground">
							{m.checkout_description()}
						</p>
					</div>

					<div class="grid grid-cols-3 gap-3 border-y py-4 text-xs text-muted-foreground">
						<span class="flex flex-col gap-1.5">
							<ShieldCheckIcon class="size-4 text-primary" />{m.checkout_trial()}
						</span>
						<span class="flex flex-col gap-1.5">
							<LockIcon class="size-4 text-primary" />{m.checkout_card_required()}
						</span>
						<span class="flex flex-col gap-1.5">
							<CheckIcon class="size-4 text-primary" />{m.checkout_cancel()}
						</span>
					</div>

					<div class="space-y-3">
						<div
							class="grid grid-cols-2 rounded-lg bg-muted p-1"
							role="group"
							aria-label={m.checkout_billing_period()}
						>
							<Button
								variant={billingPeriod === 'monthly' ? 'default' : 'ghost'}
								size="sm"
								aria-pressed={billingPeriod === 'monthly'}
								onclick={() => void choosePeriod('monthly')}
							>
								{m.checkout_monthly()}
							</Button>
							<Button
								variant={billingPeriod === 'annual' ? 'default' : 'ghost'}
								size="sm"
								aria-pressed={billingPeriod === 'annual'}
								onclick={() => void choosePeriod('annual')}
							>
								{m.checkout_annual()}
								<span class="ml-1 text-xs opacity-80">{m.checkout_save()}</span>
							</Button>
						</div>

						<RadioGroup.Root
							value={selectedPlanID}
							name="checkout_plan"
							class="grid gap-1.5"
							onValueChange={(value) => void choosePlan(value as HostedPlanID)}
						>
							{#each hostedPlans as plan (plan.id)}
								<label
									class={[
										'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
										selectedPlanID === plan.id
											? 'bg-primary/10 text-foreground'
											: 'text-muted-foreground hover:bg-muted hover:text-foreground'
									]}
								>
									<RadioGroup.Item value={plan.id} aria-label={plan.name} />
									<span class="min-w-0 flex-1 font-medium text-foreground">{plan.name}</span>
									{#if plan.featured}
										<span class="text-xs font-medium text-primary">{m.checkout_popular()}</span>
									{/if}
									<span class="shrink-0 text-sm tabular-nums">
										{#if localizedPrices[plan.id]}
											{localizedPrices[plan.id]}/{billingPeriod === 'annual'
												? m.checkout_year()
												: m.checkout_month()}
										{:else}
											<Skeleton class="h-4 w-16" />
										{/if}
									</span>
								</label>
							{/each}
						</RadioGroup.Root>
					</div>

					<div class="space-y-3 border-t pt-5">
						<div class="flex items-start justify-between gap-4">
							<div>
								<p class="font-semibold">OpenPost {selectedPlan.name}</p>
								<p class="mt-0.5 text-sm text-muted-foreground">{selectedPlan.bestFor}</p>
							</div>
							{#if selectedPrice}
								<p class="shrink-0 text-lg font-semibold tabular-nums">{selectedPrice}</p>
							{:else}
								<Skeleton class="h-7 w-20" />
							{/if}
						</div>
						<ul class="grid gap-2 text-sm text-muted-foreground">
							{#each selectedPlan.limits as limit (limit)}
								<li class="flex items-start gap-2">
									<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />{limit}
								</li>
							{/each}
						</ul>
					</div>
				</aside>

				<section class="min-w-0" aria-labelledby="payment-heading">
					<div class="border-y bg-card sm:rounded-xl sm:border">
						<div class="space-y-4 border-b px-4 py-5 sm:px-7 sm:py-6">
							<div class="flex items-start justify-between gap-4">
								<div class="flex min-w-0 items-start gap-3">
									<div
										class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
									>
										<CreditCardIcon class="size-4" />
									</div>
									<div class="min-w-0">
										<h2 id="payment-heading" class="font-semibold">{m.checkout_secure()}</h2>
										<p class="truncate text-sm text-muted-foreground">{userEmail}</p>
									</div>
								</div>
								<div class="shrink-0 text-right">
									<p class="font-semibold tabular-nums">{selectedPrice || '—'}</p>
									<p class="text-xs text-muted-foreground">
										{billingPeriod === 'annual'
											? m.checkout_billed_annually()
											: m.checkout_billed_monthly()}
									</p>
								</div>
							</div>

							<div class="rounded-lg bg-primary/8 px-4 py-3">
								<p class="font-semibold">{m.checkout_zero_today()}</p>
								{#if selectedPrice}
									<p class="mt-1 text-sm/6 text-muted-foreground">
										{m.checkout_charge_date({
											price: selectedPrice,
											date: trialEndLabel(checkout?.trial_ends_at)
										})}
									</p>
								{/if}
							</div>
						</div>

						{#if checkoutState === 'error'}
							<div class="space-y-4 px-4 py-8 sm:px-7">
								<InlineNotice tone="error" message={error} />
								<Button onclick={() => void createCheckout()}>{m.common_retry()}</Button>
							</div>
						{:else}
							<div
								data-testid="checkout-payment-surface"
								class="relative min-h-[45rem] overflow-hidden bg-white text-[#302b28] [color-scheme:light] sm:rounded-b-xl"
								aria-busy={!paymentFrameLoaded}
							>
								{#if !paymentFrameLoaded}
									<div
										class="pointer-events-none absolute inset-0 z-10 grid content-start gap-5 bg-white p-4 sm:p-7 md:grid-cols-[minmax(0,0.85fr)_minmax(20rem,1.15fr)]"
										role="status"
									>
										<span class="sr-only">{m.checkout_loading()}</span>
										<div class="space-y-4">
											<Skeleton class="h-28 w-full bg-[#eceae8]" />
											<Skeleton class="h-36 w-full bg-[#eceae8]" />
										</div>
										<div class="space-y-4">
											<Skeleton class="h-11 w-full bg-[#eceae8]" />
											<Skeleton class="h-24 w-full bg-[#eceae8]" />
											<Skeleton class="h-11 w-full bg-[#eceae8]" />
											<Skeleton class="h-11 w-full bg-[#eceae8]" />
										</div>
									</div>
								{/if}
								<div
									class="openpost-paddle-checkout min-h-[45rem] w-full"
									data-testid="paddle-checkout-frame"
								></div>
							</div>
						{/if}
					</div>

					<p class="px-4 pt-4 text-center text-xs/5 text-muted-foreground sm:px-7">
						{m.checkout_paddle_mor()}
						<a
							class="underline underline-offset-2 hover:text-foreground"
							href="https://openpost.social/terms">{m.checkout_terms()}</a
						>,
						<a
							class="underline underline-offset-2 hover:text-foreground"
							href="https://openpost.social/privacy">{m.checkout_privacy()}</a
						>,
						{m.checkout_and()}
						<a
							class="underline underline-offset-2 hover:text-foreground"
							href="https://openpost.social/refunds">{m.checkout_refunds()}</a
						>.
					</p>
				</section>
			</div>
		{/if}
	</main>
</div>
