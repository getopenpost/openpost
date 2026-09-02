<script lang="ts">
	import { onMount } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import {
		billingPeriodFromSearchParams,
		onboardingPathForPlan,
		hostedPlanFromSearchParams,
		normalizeBillingPeriod,
		normalizeHostedPlanID,
		paddleTransactionIDFromSearchParams,
		type BillingPeriod,
		type HostedPlanID
	} from '$lib/billing';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { initializePaddle, type Paddle, type PaddleEventData } from '@paddle/paddle-js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LockIcon from '@lucide/svelte/icons/lock-keyhole';
	import { resolveAppPath } from '$lib/app-path';
	import {
		billingCheckoutConfigQueryOptions,
		OpenPostQueryError,
		organizationQueryKeys,
		workspaceSettingsQueryKeys
	} from '@openpost/query-catalog';
	import { billingQueryAPI, invalidateBillingDependencies } from '$lib/query/billing';
	import { queryClient } from '$lib/query/client';
	import { auth } from '$lib/stores/auth';

	type BillingURL = components['schemas']['BillingURLResponse'];
	type BrowserCheckoutConfig = components['schemas']['BillingCheckoutConfigResponse'];
	type CheckoutMode = 'attempt' | 'transaction';
	type CheckoutState = 'loading' | 'ready' | 'opening' | 'confirming' | 'success' | 'error';

	let selectedPlanID = $state<HostedPlanID>('founder');
	let billingPeriod = $state<BillingPeriod>('monthly');
	let checkout = $state.raw<BillingURL | null>(null);
	let paddle = $state.raw<Paddle | null>(null);
	let checkoutMode = $state<CheckoutMode>('attempt');
	let checkoutState = $state<CheckoutState>('loading');
	let error = $state('');
	let checkoutConfigWarning = $state('');
	let boundAttemptID = $state('');
	let transactionID = $state('');
	let requestSequence = 0;
	let stopped = false;
	let paddlePromise: Promise<Paddle | undefined> | null = null;
	let paddleConfiguration = '';
	let checkoutWorkspaceID = '';
	let checkoutOrganizationID = '';

	function paddleLocale(): 'en' | 'pt' {
		return getLocaleTag().toLowerCase().startsWith('pt') ? 'pt' : 'en';
	}

	function handlePaddleEvent(event: PaddleEventData) {
		if (stopped) return;
		if (event.name === 'checkout.loaded') {
			checkoutState = 'ready';
			return;
		}
		if (event.name === 'checkout.closed') {
			checkoutState = 'error';
			error = checkoutMode === 'transaction' ? m.checkout_managed_closed() : m.checkout_closed();
			return;
		}
		if (event.name === 'checkout.completed' && checkoutState !== 'confirming') {
			if (checkoutMode === 'transaction') {
				checkoutState = 'success';
				void invalidateBillingAndAudit();
				return;
			}
			void confirmSubscription();
			return;
		}
		if (event.name === 'checkout.error' || event.name === 'checkout.payment.error') {
			checkoutState = 'error';
			error = m.checkout_embed_failed();
		}
	}

	async function invalidateBillingAndAudit() {
		const workspaceID = checkoutWorkspaceID || workspaceCtx.currentWorkspace?.id || '';
		const organizationID = checkoutOrganizationID || organizationIDForWorkspace(workspaceID);
		await invalidateBillingDependencies(queryClient, {
			workspaceID,
			organizationID
		});
	}

	function organizationIDForWorkspace(workspaceID: string) {
		return (
			workspaceCtx.workspaces.find((workspace) => workspace.id === workspaceID)?.organization_id ??
			''
		);
	}

	async function invalidateCheckoutAudit(workspaceID: string, organizationID: string) {
		const invalidations = [
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.instanceAuditRoot()
			}),
			queryClient.invalidateQueries({
				queryKey: workspaceSettingsQueryKeys.setup(workspaceID),
				exact: true
			})
		];
		if (organizationID) {
			invalidations.push(
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.auditRoot(organizationID)
				})
			);
		}
		await Promise.all(invalidations);
	}

	async function initializePaddleForCheckout(config: BrowserCheckoutConfig): Promise<Paddle> {
		const environment = config.environment?.trim().toLowerCase();
		const clientToken = config.client_token?.trim();
		if (!clientToken || (environment !== 'sandbox' && environment !== 'production')) {
			throw new Error(m.checkout_load_failed());
		}
		const configuration = `${environment}:${clientToken}`;
		if (paddle && paddleConfiguration === configuration) return paddle;
		if (paddleConfiguration && paddleConfiguration !== configuration) {
			throw new Error(m.checkout_load_failed());
		}
		if (!paddlePromise) {
			paddleConfiguration = configuration;
			paddlePromise = initializePaddle({
				environment,
				token: clientToken,
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

	async function createCheckout() {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		const organizationID = workspaceCtx.currentWorkspace?.organization_id ?? '';
		const identity = auth.captureIdentity();
		if (!workspaceID) {
			checkoutState = 'error';
			error = m.checkout_workspace_missing();
			return;
		}
		const sequence = ++requestSequence;
		paddle?.Checkout.close();
		checkoutState = 'loading';
		checkout = null;
		error = '';
		try {
			const { data, error: apiError } = await client.POST('/billing/checkout', {
				body: {
					workspace_id: workspaceID,
					plan_id: selectedPlanID,
					billing_period: billingPeriod,
					return_path: safeSameOriginRedirect(page.url, '')
				}
			});
			if (
				apiError ||
				!data?.id ||
				!data.provider_price_id ||
				!data.return_url ||
				!data.customer_email
			) {
				throw new Error(apiError?.detail || m.checkout_load_failed());
			}
			const targetWorkspaceID = data.workspace_id || workspaceID;
			const targetOrganizationID = organizationIDForWorkspace(targetWorkspaceID) || organizationID;
			if (auth.isIdentityCurrent(identity)) {
				await invalidateCheckoutAudit(targetWorkspaceID, targetOrganizationID);
			}
			if (sequence !== requestSequence || stopped || !auth.isIdentityCurrent(identity)) return;
			checkoutWorkspaceID = targetWorkspaceID;
			checkoutOrganizationID = targetOrganizationID;
			checkout = data;
			const instance = await initializePaddleForCheckout(data);
			if (sequence !== requestSequence || stopped) return;
			openAttemptCheckout(instance, data);
		} catch (caught) {
			if (sequence !== requestSequence || stopped) return;
			checkoutState = 'error';
			error = caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
		}
	}

	async function loadBoundCheckout(attemptID: string) {
		const sequence = ++requestSequence;
		checkoutState = 'loading';
		error = '';
		try {
			const { data, error: apiError } = await client.GET('/billing/checkout/{attempt_id}', {
				params: { path: { attempt_id: attemptID } }
			});
			if (sequence !== requestSequence || stopped) return;
			if (
				apiError ||
				!data?.id ||
				!data.provider_price_id ||
				!data.return_url ||
				!data.customer_email ||
				!data.plan_id ||
				!data.billing_period
			) {
				throw new Error(apiError?.detail || m.checkout_load_failed());
			}
			const planID = normalizeHostedPlanID(data.plan_id);
			const period = normalizeBillingPeriod(data.billing_period);
			if (!planID || !period) throw new Error(m.checkout_load_failed());
			selectedPlanID = planID;
			checkoutWorkspaceID = data.workspace_id || workspaceCtx.currentWorkspace?.id || '';
			checkoutOrganizationID = organizationIDForWorkspace(checkoutWorkspaceID);
			billingPeriod = period;
			checkout = data;
			const instance = await initializePaddleForCheckout(data);
			if (sequence !== requestSequence || stopped) return;
			openAttemptCheckout(instance, data);
		} catch (caught) {
			if (sequence !== requestSequence || stopped) return;
			checkoutState = 'error';
			error = caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
		}
	}

	function openAttemptCheckout(instance: Paddle, data: BillingURL) {
		if (!data.id || !data.provider_price_id || !data.customer_email || !data.return_url) {
			checkoutState = 'error';
			error = m.checkout_load_failed();
			return;
		}
		checkoutState = 'opening';
		instance.Checkout.open({
			items: [{ priceId: data.provider_price_id, quantity: 1 }],
			customData: { checkout_id: data.id },
			customer: { email: data.customer_email },
			settings: {
				displayMode: 'overlay',
				variant: 'one-page',
				theme: 'light',
				locale: paddleLocale(),
				allowLogout: false,
				showAddDiscounts: true,
				showAddTaxId: true,
				successUrl: data.return_url
			}
		});
		captureTelemetryEvent('billing checkout opened', {
			billing_period: billingPeriod,
			plan_id: selectedPlanID
		});
	}

	async function loadManagedTransaction(loadOptions: { refresh?: boolean } = {}) {
		checkoutWorkspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		checkoutOrganizationID = workspaceCtx.currentWorkspace?.organization_id ?? '';
		const sequence = ++requestSequence;
		checkoutState = 'loading';
		error = '';
		checkoutConfigWarning = '';
		const options = billingCheckoutConfigQueryOptions(billingQueryAPI);
		const cachedConfig = queryClient.getQueryData<BrowserCheckoutConfig>(options.queryKey);
		if (cachedConfig && !loadOptions.refresh) {
			try {
				await openManagedTransaction(cachedConfig, sequence);
				void queryClient.fetchQuery(options).catch((caught) => {
					if (sequence !== requestSequence || stopped) return;
					handleCheckoutConfigRefreshFailure(caught, options.queryKey);
				});
				return;
			} catch {
				if (sequence !== requestSequence || stopped) return;
				queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
			}
		}
		try {
			if (loadOptions.refresh) {
				await queryClient.invalidateQueries({
					queryKey: options.queryKey,
					exact: true
				});
			}
			const config = await queryClient.fetchQuery(options);
			await openManagedTransaction(config, sequence);
		} catch (caught) {
			if (sequence !== requestSequence || stopped) return;
			const authoritativeFailure = handleCheckoutConfigRefreshFailure(caught, options.queryKey);
			if (cachedConfig && !authoritativeFailure) {
				try {
					await openManagedTransaction(cachedConfig, sequence);
					return;
				} catch {
					if (sequence !== requestSequence || stopped) return;
					queryClient.removeQueries({
						queryKey: options.queryKey,
						exact: true
					});
				}
			}
			checkoutState = 'error';
			error = caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
		}
	}

	async function openManagedTransaction(config: BrowserCheckoutConfig, sequence: number) {
		const instance = await initializePaddleForCheckout(config);
		if (sequence !== requestSequence || stopped) return;
		checkoutState = 'opening';
		instance.Checkout.open({
			transactionId: transactionID,
			settings: {
				displayMode: 'overlay',
				variant: 'one-page',
				theme: 'light',
				locale: paddleLocale()
			}
		});
	}

	function handleCheckoutConfigRefreshFailure(
		cause: unknown,
		queryKey: readonly unknown[]
	): boolean {
		const authoritativeFailure =
			cause instanceof OpenPostQueryError && (cause.status === 401 || cause.status === 403);
		if (authoritativeFailure) {
			queryClient.removeQueries({ queryKey, exact: true });
		}
		checkoutConfigWarning =
			cause instanceof Error && cause.message ? cause.message : m.checkout_load_failed();
		return authoritativeFailure;
	}

	function retryCheckout() {
		if (checkoutMode === 'transaction') return loadManagedTransaction({ refresh: true });
		if (boundAttemptID) return loadBoundCheckout(boundAttemptID);
		return createCheckout();
	}

	async function loadCheckoutReturn(attemptID: string) {
		try {
			const { data, error: apiError } = await client.GET('/billing/checkout/{attempt_id}/return', {
				params: { path: { attempt_id: attemptID } }
			});
			if (apiError || !data) return null;
			return data;
		} catch {
			return null;
		}
	}

	async function confirmSubscription() {
		const identity = auth.captureIdentity();
		const sequence = ++requestSequence;
		checkoutState = 'confirming';
		error = '';
		const isCurrentRequest = () =>
			!stopped && sequence === requestSequence && auth.isIdentityCurrent(identity);
		if (!identity) {
			checkoutState = 'error';
			error = m.checkout_confirmation_delayed();
			return;
		}
		const attemptID = checkout?.id || page.url.searchParams.get('attempt') || '';
		if (!attemptID) {
			checkoutState = 'error';
			error = m.checkout_confirmation_delayed();
			return;
		}
		for (let attempt = 0; attempt < 30 && isCurrentRequest(); attempt += 1) {
			const result = await loadCheckoutReturn(attemptID);
			if (!isCurrentRequest()) return;
			if (result?.status === 'failed') {
				checkoutState = 'error';
				error = m.checkout_confirmation_delayed();
				return;
			}
			if (result?.status === 'success') {
				checkoutState = 'success';
				await invalidateBillingAndAudit();
				if (!isCurrentRequest()) return;
				if (result.return_path) {
					if (!isCurrentRequest()) return;
					await goto(resolveAppPath(result.return_path));
				}
				return;
			}
			await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 1000));
			if (!isCurrentRequest()) return;
		}
		if (isCurrentRequest()) {
			checkoutState = 'error';
			error = m.checkout_confirmation_delayed();
		}
	}

	function continueToAccounts() {
		void goto(resolveAppPath('/settings?tab=accounts&onboarding=1'));
	}

	onMount(() => {
		const requestedTransaction = paddleTransactionIDFromSearchParams(page.url.searchParams);
		if (requestedTransaction) {
			checkoutMode = 'transaction';
			transactionID = requestedTransaction;
			void loadManagedTransaction();
			return () => {
				stopped = true;
				requestSequence += 1;
				paddle?.Checkout.close();
			};
		}

		selectedPlanID = hostedPlanFromSearchParams(page.url.searchParams) || 'founder';
		billingPeriod = billingPeriodFromSearchParams(page.url.searchParams) || 'monthly';
		boundAttemptID = page.url.searchParams.get('attempt')?.trim() ?? '';
		const workspaceReady = workspaceCtx.currentWorkspace?.id
			? Promise.resolve()
			: workspaceCtx.initialize();
		void workspaceReady
			.then(async () => {
				if (stopped) return;
				if (!workspaceCtx.currentWorkspace?.id) {
					const target = new URL(onboardingPathForPlan(selectedPlanID, billingPeriod), page.url);
					const redirect = safeSameOriginRedirect(page.url, '');
					if (redirect) target.searchParams.set('redirect', redirect);
					if (stopped) return;
					await goto(resolveAppPath(`${target.pathname}${target.search}`));
					return;
				}
				if (page.url.searchParams.get('status') === 'success') {
					void confirmSubscription();
					return;
				}
				if (boundAttemptID) {
					void loadBoundCheckout(boundAttemptID);
					return;
				}
				void createCheckout();
			})
			.catch((caught) => {
				if (stopped) return;
				checkoutState = 'error';
				error =
					caught instanceof Error && caught.message ? caught.message : m.checkout_load_failed();
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

<div class="min-h-dvh bg-muted/30">
	<header class="border-b bg-background/95">
		<div
			class="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:min-h-20 sm:px-6"
		>
			<a
				href={resolveAppPath('/')}
				class="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
				aria-label="OpenPost"
			>
				<Logo width={132} height={30} showText />
			</a>
			<div class="hidden items-center gap-2 text-sm font-medium text-muted-foreground sm:flex">
				<LockIcon class="size-4 text-primary" />
				{m.checkout_secure()}
			</div>
		</div>
	</header>

	<main
		class="mx-auto grid w-full max-w-5xl place-items-center px-4 py-12 sm:px-6 sm:py-20"
		style="padding-bottom: max(3rem, calc(env(safe-area-inset-bottom) + 1.5rem));"
	>
		<Card class="w-full max-w-lg shadow-sm">
			<CardContent
				class="flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10 sm:py-12"
			>
				{#if checkoutState === 'success'}
					<div
						class="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"
					>
						<CheckIcon class="size-7" />
					</div>
					<div class="space-y-2">
						<h1 class="text-2xl font-semibold tracking-tight">
							{checkoutMode === 'transaction'
								? m.checkout_managed_success_heading()
								: m.checkout_success_heading()}
						</h1>
						<p class="text-sm/6 text-muted-foreground">
							{checkoutMode === 'transaction'
								? m.checkout_managed_success_description()
								: m.checkout_success_description()}
						</p>
					</div>
					{#if checkoutMode === 'attempt'}
						<Button size="lg" onclick={continueToAccounts}>{m.checkout_connect_account()}</Button>
					{/if}
				{:else if checkoutState === 'confirming'}
					<LoaderCircleIcon class="size-10 animate-spin text-primary" />
					<div class="space-y-2" role="status">
						<h1 class="text-xl font-semibold">
							{m.checkout_confirming_heading()}
						</h1>
						<p class="text-sm/6 text-muted-foreground">
							{m.checkout_confirming_description()}
						</p>
					</div>
				{:else}
					<div
						class="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
					>
						<LockIcon class="size-7" />
					</div>
					<div class="space-y-2">
						<h1 class="text-2xl font-semibold tracking-tight">
							{m.checkout_managed_heading()}
						</h1>
						<p class="text-sm/6 text-muted-foreground">
							{checkoutMode === 'transaction'
								? m.checkout_managed_link_description()
								: m.checkout_managed_description()}
						</p>
					</div>
					{#if checkoutState === 'error'}
						<div class="w-full space-y-4 text-left">
							{#if checkoutConfigWarning}
								<InlineNotice tone="warning" message={checkoutConfigWarning} />
							{/if}
							<InlineNotice tone="error" message={error} />
							<Button class="w-full" size="lg" onclick={() => void retryCheckout()}
								>{m.common_retry()}</Button
							>
						</div>
					{:else}
						{#if checkoutConfigWarning}
							<div class="w-full space-y-3 text-left">
								<InlineNotice tone="warning" message={checkoutConfigWarning} />
								<Button
									class="w-full"
									variant="outline"
									onclick={() => void loadManagedTransaction({ refresh: true })}
									>{m.common_retry()}</Button
								>
							</div>
						{/if}
						<div class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
							<LoaderCircleIcon class="size-4 animate-spin" />
							{checkoutState === 'loading' ? m.checkout_loading() : m.checkout_opening_secure()}
						</div>
					{/if}
				{/if}

				<p class="text-xs/5 text-muted-foreground">
					{m.checkout_paddle_mor()}
					<a
						class="underline underline-offset-2 hover:text-foreground"
						href="https://openpo.st/terms">{m.checkout_terms()}</a
					>,
					<a
						class="underline underline-offset-2 hover:text-foreground"
						href="https://openpo.st/privacy">{m.checkout_privacy()}</a
					>,
					{m.checkout_and()}
					<a
						class="underline underline-offset-2 hover:text-foreground"
						href="https://openpo.st/refunds">{m.checkout_refunds()}</a
					>.
				</p>
			</CardContent>
		</Card>
	</main>
</div>
