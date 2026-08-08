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
	import * as Dialog from '$lib/components/ui/dialog';
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
	import { mode } from 'mode-watcher';
	import {
		initializePaddle,
		type Environments,
		type Paddle,
		type PaddleEventData
	} from '@paddle/paddle-js';
	import CheckIcon from 'lucide-svelte/icons/check';
	import CreditCardIcon from 'lucide-svelte/icons/credit-card';
	import LockIcon from 'lucide-svelte/icons/lock-keyhole';
	import ShieldCheckIcon from 'lucide-svelte/icons/shield-check';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';
	import XIcon from 'lucide-svelte/icons/x';

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
	let paymentDialogOpen = $state(false);
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
			paymentDialogOpen = false;
			paymentFrameLoaded = false;
			if (checkoutState === 'opening') checkoutState = 'ready';
			return;
		}
		if (event.name === 'checkout.completed' && checkoutState !== 'confirming') {
			paymentDialogOpen = false;
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
			checkoutState = 'ready';
		} catch (caught) {
			if (sequence !== requestSequence || stopped) return;
			checkoutState = 'error';
			error = caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
		}
	}

	function closePaymentDialog() {
		if (!paymentDialogOpen) return;
		paymentDialogOpen = false;
		paymentFrameLoaded = false;
		paddle?.Checkout.close();
		if (checkoutState === 'opening') checkoutState = 'ready';
	}

	function handlePaymentDialogChange(open: boolean) {
		if (open) {
			paymentDialogOpen = true;
			return;
		}
		closePaymentDialog();
	}

	async function openPaddleCheckout() {
		if (
			!paddle ||
			!checkout?.id ||
			!checkout.provider_price_id ||
			!checkout.customer_email ||
			!checkout.return_url
		) {
			error = m.checkout_load_failed();
			checkoutState = 'error';
			return;
		}
		checkoutState = 'opening';
		paymentFrameLoaded = false;
		paymentDialogOpen = true;
		await tick();
		if (!paymentDialogOpen || stopped) return;
		paddle.Checkout.open({
			items: [{ priceId: checkout.provider_price_id, quantity: 1 }],
			customData: { checkout_id: checkout.id },
			customer: { email: checkout.customer_email },
			settings: {
				displayMode: 'inline',
				variant: 'one-page',
				theme: mode.current === 'dark' ? 'dark' : 'light',
				locale: paddleLocale(),
				allowLogout: false,
				showAddDiscounts: true,
				showAddTaxId: true,
				frameTarget: 'openpost-paddle-checkout',
				frameInitialHeight: 560,
				frameStyle: 'width: 100%; min-width: 312px; background-color: transparent; border: none;',
				successUrl: checkout.return_url
			}
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
			<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
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
										{#if localizedPrices[plan.id]}
											{localizedPrices[plan.id]}/{billingPeriod === 'annual'
												? m.checkout_year()
												: m.checkout_month()}
										{:else}
											<Skeleton class="mt-1 h-4 w-20" />
										{/if}
									</span>
								</span>
							</label>
						{/each}
					</RadioGroup.Root>

					<Card>
						<CardContent class="space-y-4 p-5">
							<div>
								<p class="font-semibold">{selectedPlan.name}</p>
								<p class="text-sm text-muted-foreground">{selectedPlan.bestFor}</p>
							</div>
							<ul class="grid gap-2 text-sm sm:grid-cols-2">
								{#each selectedPlan.limits as limit (limit)}
									<li class="flex items-center gap-2">
										<CheckIcon class="size-4 text-emerald-600" />{limit}
									</li>
								{/each}
							</ul>
						</CardContent>
					</Card>

					<div class="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
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

				<Card class="overflow-hidden lg:sticky lg:top-6">
					<CardContent class="space-y-5 p-6">
						<div class="flex items-center gap-3">
							<div
								class="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"
							>
								<CreditCardIcon class="size-5" />
							</div>
							<div>
								<p class="font-semibold">{m.checkout_order_summary()}</p>
								<p class="text-sm text-muted-foreground">{userEmail}</p>
							</div>
						</div>

						{#if checkoutState === 'error'}
							<InlineNotice tone="error" message={error} />
							<Button class="w-full" onclick={() => void createCheckout()}
								>{m.common_retry()}</Button
							>
						{:else}
							<div class="space-y-3 border-y py-4">
								<div class="flex items-start justify-between gap-4">
									<div>
										<p class="font-medium">OpenPost {selectedPlan.name}</p>
										<p class="text-sm text-muted-foreground">
											{billingPeriod === 'annual'
												? m.checkout_billed_annually()
												: m.checkout_billed_monthly()}
										</p>
									</div>
									{#if selectedPrice}<p class="text-lg font-semibold">
											{selectedPrice}
										</p>{:else}<Skeleton class="h-7 w-20" />{/if}
								</div>
								<div class="rounded-lg bg-primary/7 p-4">
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

							<Button
								class="w-full"
								size="lg"
								disabled={checkoutState !== 'ready' || !selectedPrice}
								onclick={() => void openPaddleCheckout()}
							>
								<LockIcon class="mr-2 size-4" />{checkoutState === 'opening'
									? m.checkout_opening_secure()
									: m.checkout_open_secure()}
							</Button>
						{/if}

						<p class="text-center text-xs/5 text-muted-foreground">
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
					</CardContent>
				</Card>
			</div>
		{/if}
	</div>
</main>

<Dialog.Root open={paymentDialogOpen} onOpenChange={handlePaymentDialogChange}>
	<Dialog.Content
		class="h-dvh max-h-dvh max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[min(92dvh,56rem)] sm:max-w-5xl sm:rounded-xl"
		showCloseButton={false}
		aria-busy={!paymentFrameLoaded}
	>
		<Dialog.Header class="shrink-0 border-b px-5 py-4 pr-16 sm:px-6 sm:py-5 sm:pr-16">
			<div class="flex items-start justify-between gap-4">
				<div class="min-w-0 space-y-1">
					<Dialog.Title class="text-base font-semibold sm:text-lg"
						>{m.checkout_secure()}</Dialog.Title
					>
					<Dialog.Description class="text-sm text-muted-foreground">
						OpenPost {selectedPlan.name} · {m.checkout_trial()}
					</Dialog.Description>
				</div>
				{#if selectedPrice}
					<div class="shrink-0 text-right">
						<p class="font-semibold">{selectedPrice}</p>
						<p class="text-xs text-muted-foreground">
							{billingPeriod === 'annual'
								? m.checkout_billed_annually()
								: m.checkout_billed_monthly()}
						</p>
					</div>
				{/if}
			</div>
		</Dialog.Header>

		<Button
			variant="ghost"
			size="icon"
			class="absolute top-2.5 right-2.5 z-10 min-h-11 min-w-11 sm:top-3 sm:right-3"
			onclick={closePaymentDialog}
			aria-label={m.common_close()}
		>
			<XIcon class="size-5" />
		</Button>

		<div
			class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/25 px-0 py-3 sm:px-4 sm:py-4"
		>
			{#if checkoutState === 'error'}
				<div class="mx-4 mb-3 sm:mx-0">
					<InlineNotice tone="error" message={error} />
				</div>
			{/if}
			<div
				class="relative mx-auto min-h-[35rem] w-full max-w-4xl overflow-hidden bg-background sm:rounded-lg sm:ring-1 sm:ring-foreground/10"
			>
				{#if !paymentFrameLoaded}
					<div
						class="pointer-events-none absolute inset-0 z-10 grid content-start gap-5 bg-background p-5 sm:grid-cols-[minmax(0,0.85fr)_minmax(20rem,1.15fr)] sm:p-7"
						role="status"
					>
						<span class="sr-only">{m.checkout_loading()}</span>
						<div class="space-y-4">
							<Skeleton class="h-28 w-full" />
							<Skeleton class="h-36 w-full" />
						</div>
						<div class="space-y-4">
							<Skeleton class="h-11 w-full" />
							<Skeleton class="h-24 w-full" />
							<Skeleton class="h-11 w-full" />
							<Skeleton class="h-11 w-full" />
						</div>
					</div>
				{/if}
				<div
					class="openpost-paddle-checkout min-h-[35rem] w-full"
					data-testid="paddle-checkout-frame"
				></div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
