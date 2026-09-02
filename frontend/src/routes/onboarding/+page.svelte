<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { auth } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import type { AuthConfiguration } from '$lib/api/client';
	import {
		adminQueryKeys,
		authConfigurationQueryOptions,
		authQueryKeys,
		openPostBootstrapQueryKeys,
		organizationQueryKeys,
		OpenPostQueryError
	} from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';
	import { queryClient } from '$lib/query/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PurchaseChoiceError from '$lib/components/purchase-choice-error.svelte';
	import PurchaseChoiceSummary from '$lib/components/purchase-choice-summary.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import {
		billingPeriodFromSearchParams,
		hostedPlanFromSearchParams,
		hostedPlans,
		planPriceUSD,
		type BillingPeriod,
		type HostedPlanID
	} from '$lib/billing';
	import {
		purchaseChoiceErrorCode,
		resolvePurchaseChoice,
		type PurchaseChoice,
		type PurchaseChoiceErrorCode
	} from '$lib/purchase-choice';

	let isSubmitting = $state(false);
	let choiceLoading = $state(false);
	let loadError = $state('');
	let configurationBackgroundError = $state('');
	let submitError = $state('');
	let authReady = $state(false);
	let pageLoading = $state(true);
	let managedAccount = $state(false);
	let managedOrganizationName = $state('');
	let workspaceName = $state('');
	let selectedPlanID = $state<HostedPlanID>('founder');
	let billingPeriod = $state<BillingPeriod>('monthly');
	let purchaseChoice = $state.raw<PurchaseChoice | null>(null);
	let choiceErrorCode = $state<PurchaseChoiceErrorCode | null>(null);
	let purchaseChoiceRequired = $state(true);
	let onboardingLoadSequence = 0;
	let onboardingSubmissionSequence = 0;
	let purchaseChoiceRequestSequence = 0;
	let active = true;

	onDestroy(() => {
		active = false;
		onboardingLoadSequence += 1;
		onboardingSubmissionSequence += 1;
		purchaseChoiceRequestSequence += 1;
	});

	function loginTarget() {
		return `/login?redirect=${encodeURIComponent(`${page.url.pathname}${page.url.search}`)}`;
	}

	function existingSignupTarget() {
		return safeSameOriginRedirect(page.url);
	}

	function checkoutTarget(attemptID: string, choice: PurchaseChoice) {
		const params = new URLSearchParams({
			attempt: attemptID,
			plan: choice.plan_id,
			billing_period: choice.billing_period,
			purchase_choice: choice.token
		});
		const redirect = safeSameOriginRedirect(page.url, '');
		if (redirect) params.set('redirect', redirect);
		return `/checkout?${params}`;
	}

	async function invalidateWorkspaceInventory() {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: openPostBootstrapQueryKeys.appRoot()
			}),
			queryClient.invalidateQueries({
				queryKey: openPostBootstrapQueryKeys.workspaces(),
				exact: true
			}),
			queryClient.invalidateQueries({
				queryKey: adminQueryKeys.overview(),
				exact: true
			}),
			queryClient.invalidateQueries({ queryKey: adminQueryKeys.usersRoot() }),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.all(),
				exact: true
			})
		]);
	}

	async function invalidateWelcomeAudit(workspaceID: string) {
		const organizationID =
			workspaceCtx.workspaces.find((workspace) => workspace.id === workspaceID)?.organization_id ??
			'';
		const invalidations = [
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.instanceAuditRoot()
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

	onMount(() => {
		const unsubscribe = auth.subscribe((state) => {
			if (!state.isLoading && !authReady) {
				authReady = true;
				managedAccount = state.user?.is_managed ?? false;
				managedOrganizationName = state.user?.managed_organization_name ?? '';
				if (!state.isAuthenticated) {
					void goto(resolveAppPath(loginTarget()));
					return;
				}
				void loadWelcome();
			}
		});
		return unsubscribe;
	});

	async function loadWelcome() {
		const requestSequence = ++onboardingLoadSequence;
		pageLoading = true;
		loadError = '';
		configurationBackgroundError = '';
		try {
			await workspaceCtx.initialize();
			if (requestSequence !== onboardingLoadSequence) return;
			const currentWorkspace = workspaceCtx.currentWorkspace;
			if (currentWorkspace) {
				await goto(resolveAppPath(existingSignupTarget()));
				return;
			}
			if (!managedAccount) {
				const configurationOptions = authConfigurationQueryOptions(authQueryAPI);
				const cachedConfiguration = queryClient.getQueryData<AuthConfiguration>(
					authQueryKeys.configuration()
				);
				if (cachedConfiguration) {
					await applyAuthConfiguration(cachedConfiguration);
					pageLoading = false;
				}
				try {
					await applyAuthConfiguration(await queryClient.fetchQuery(configurationOptions));
				} catch (cause) {
					if (
						cause instanceof OpenPostQueryError &&
						(cause.status === 401 || cause.status === 403)
					) {
						queryClient.removeQueries({
							queryKey: configurationOptions.queryKey,
							exact: true
						});
						throw cause;
					}
					if (!cachedConfiguration) throw cause;
					configurationBackgroundError = m.onboarding_load_failed();
				}
			}
		} catch (caught) {
			if (requestSequence !== onboardingLoadSequence) return;
			console.error('Failed to load welcome state:', caught);
			loadError = m.onboarding_load_failed();
		} finally {
			if (requestSequence === onboardingLoadSequence) pageLoading = false;
		}
	}

	async function applyAuthConfiguration(configuration: AuthConfiguration) {
		// Hosted signup has always required an explicit purchase choice. Keep that
		// default when older or proxied auth/config responses omit the field.
		purchaseChoiceRequired = configuration.purchase_choice_required !== false;
		if (purchaseChoiceRequired && !purchaseChoice && !choiceErrorCode) {
			await loadPurchaseChoice();
		}
	}

	async function loadPurchaseChoice() {
		const actorID = get(auth).user?.id ?? '';
		const requestSequence = ++purchaseChoiceRequestSequence;
		const sourceURL = new URL(page.url);
		const route = `${sourceURL.pathname}${sourceURL.search}`;
		const isCurrentRequest = () =>
			active &&
			requestSequence === purchaseChoiceRequestSequence &&
			Boolean(actorID) &&
			get(auth).user?.id === actorID &&
			`${window.location.pathname}${window.location.search}` === route;
		const planID = hostedPlanFromSearchParams(sourceURL.searchParams);
		const period = billingPeriodFromSearchParams(sourceURL.searchParams);
		if (planID) selectedPlanID = planID;
		if (period) billingPeriod = period;
		const result = await resolvePurchaseChoice(sourceURL.searchParams);
		if (!isCurrentRequest()) return;
		purchaseChoice = result.choice ?? null;
		choiceErrorCode = result.errorCode ?? null;
		if (result.error && !result.errorCode) loadError = result.error;
	}

	async function choosePurchase(nextPlan: HostedPlanID, nextPeriod: BillingPeriod) {
		if (choiceLoading) return;
		const actorID = get(auth).user?.id ?? '';
		if (!actorID) return;
		const requestSequence = ++purchaseChoiceRequestSequence;
		const sourceURL = new URL(page.url);
		const route = `${sourceURL.pathname}${sourceURL.search}`;
		const isCurrentOperation = () =>
			active && requestSequence === purchaseChoiceRequestSequence && get(auth).user?.id === actorID;
		const isCurrentRequest = () =>
			isCurrentOperation() && `${window.location.pathname}${window.location.search}` === route;
		choiceLoading = true;
		submitError = '';
		try {
			const { data, error } = await client.POST('/billing/purchase-choice', {
				body: { plan_id: nextPlan, billing_period: nextPeriod }
			});
			if (!isCurrentRequest()) return;
			if (error || !data) throw new Error(error?.detail || m.purchase_choice_unavailable());
			selectedPlanID = nextPlan;
			billingPeriod = nextPeriod;
			purchaseChoice = data;
			choiceErrorCode = null;
			const params = new URLSearchParams(sourceURL.searchParams);
			params.set('plan', data.plan_id);
			params.set('billing_period', data.billing_period);
			params.set('purchase_choice', data.token);
			if (!isCurrentRequest()) return;
			window.history.replaceState({}, '', `${sourceURL.pathname}?${params}`);
		} catch (caught) {
			if (isCurrentRequest()) {
				submitError = caught instanceof Error ? caught.message : m.purchase_choice_unavailable();
			}
		} finally {
			if (isCurrentOperation()) choiceLoading = false;
		}
	}

	async function confirmWelcome(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting || (purchaseChoiceRequired && !purchaseChoice) || !workspaceName.trim())
			return;
		isSubmitting = true;
		submitError = '';
		const actorID = get(auth).user?.id ?? '';
		const submissionSequence = ++onboardingSubmissionSequence;
		const isCurrentSubmission = () =>
			active &&
			submissionSequence === onboardingSubmissionSequence &&
			Boolean(actorID) &&
			get(auth).user?.id === actorID;
		const isSameActor = () => Boolean(actorID) && get(auth).user?.id === actorID;
		try {
			if (!purchaseChoiceRequired) {
				const { data, error } = await client.POST('/workspaces', {
					body: { name: workspaceName.trim() }
				});
				if (error || !data?.id) {
					throw new Error(error?.detail || m.onboarding_create_failed());
				}
				if (!isSameActor()) return;
				await invalidateWorkspaceInventory();
				const projection = auth.captureUserProjection(actorID);
				if (!projection) return;
				const bootstrap = await workspaceCtx.loadWorkspaces(data.id, {
					selectionIsCurrent: isCurrentSubmission
				});
				if (!isSameActor() || !auth.projectBootstrap(bootstrap, projection)) return;
				if (!isCurrentSubmission()) return;
				await goto(resolveAppPath('/'));
				return;
			}
			if (!purchaseChoice) return;
			const confirmedPurchaseChoice = purchaseChoice;

			const { data, error } = await client.POST('/billing/welcome', {
				body: {
					workspace_name: workspaceName.trim(),
					plan_id: confirmedPurchaseChoice.plan_id,
					billing_period: confirmedPurchaseChoice.billing_period,
					purchase_choice_token: confirmedPurchaseChoice.token,
					return_path: safeSameOriginRedirect(page.url, '')
				}
			});
			if (error || !data?.workspace_id || !data.checkout.id) {
				choiceErrorCode = error ? purchaseChoiceErrorCode(error) : null;
				throw new Error(error?.detail || m.onboarding_create_failed());
			}
			if (!isSameActor()) return;
			await Promise.all([
				invalidateWorkspaceInventory(),
				invalidateWelcomeAudit(data.workspace_id)
			]);
			const projection = auth.captureUserProjection(actorID);
			if (!projection) return;
			const bootstrap = await workspaceCtx.loadWorkspaces(data.workspace_id, {
				selectionIsCurrent: isCurrentSubmission
			});
			if (!isSameActor() || !auth.projectBootstrap(bootstrap, projection)) return;
			if (!isCurrentSubmission()) return;
			await goto(resolveAppPath(checkoutTarget(data.checkout.id, confirmedPurchaseChoice)));
		} catch (caught) {
			if (isCurrentSubmission()) {
				submitError = caught instanceof Error ? caught.message : m.onboarding_create_failed();
			}
		} finally {
			if (isCurrentSubmission()) isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.onboarding_title()}</title>
</svelte:head>

<StandaloneShell
	title={purchaseChoiceRequired ? m.onboarding_heading() : m.onboarding_selfhost_heading()}
	description={purchaseChoiceRequired
		? m.onboarding_description()
		: m.onboarding_selfhost_description()}
	loading={pageLoading}
	loadingLabel={m.common_loading()}
>
	{#snippet icon()}<RocketIcon class="size-6" />{/snippet}

	<div class="space-y-5">
		{#if configurationBackgroundError}
			<InlineNotice tone="warning" message={configurationBackgroundError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void loadWelcome()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if loadError}
			<div data-testid="onboarding-load-error">
				<InlineNotice tone="error" message={loadError}>
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={() => void loadWelcome()}
							>{m.common_retry()}</Button
						>
					{/snippet}
				</InlineNotice>
			</div>
		{:else if managedAccount}
			<InlineNotice
				tone="info"
				message={m.onboarding_managed_waiting({
					organization: managedOrganizationName || m.onboarding_managed_organization()
				})}
			/>
			<p class="text-sm leading-6 text-muted-foreground">
				{m.onboarding_managed_help()}
			</p>
		{:else if purchaseChoiceRequired && choiceErrorCode}
			<PurchaseChoiceError code={choiceErrorCode} />
		{:else if purchaseChoiceRequired ? purchaseChoice : true}
			<form class="space-y-6" onsubmit={confirmWelcome}>
				<div class="space-y-2">
					<label for="workspace-name" class="text-sm font-medium"
						>{m.onboarding_workspace_name()}</label
					>
					<Input
						id="workspace-name"
						bind:value={workspaceName}
						maxlength={100}
						required
						placeholder={m.onboarding_workspace_placeholder()}
						autocomplete="organization"
					/>
					<p class="text-xs leading-5 text-muted-foreground">
						{m.onboarding_workspace_hint()}
					</p>
				</div>

				{#if purchaseChoiceRequired}
					<div id="welcome-plan" class="space-y-3">
						<div class="flex items-center justify-between gap-3">
							<h2 class="text-sm font-medium">{m.onboarding_plan_heading()}</h2>
							<div
								class="flex rounded-lg bg-muted p-1"
								role="group"
								aria-label={m.checkout_billing_period()}
							>
								<Button
									type="button"
									variant={billingPeriod === 'monthly' ? 'default' : 'ghost'}
									size="sm"
									aria-pressed={billingPeriod === 'monthly'}
									disabled={choiceLoading}
									onclick={() => void choosePurchase(selectedPlanID, 'monthly')}
									>{m.checkout_monthly()}</Button
								>
								<Button
									type="button"
									variant={billingPeriod === 'annual' ? 'default' : 'ghost'}
									size="sm"
									aria-pressed={billingPeriod === 'annual'}
									disabled={choiceLoading}
									onclick={() => void choosePurchase(selectedPlanID, 'annual')}
									>{m.checkout_annual()}</Button
								>
							</div>
						</div>
						<RadioGroup.Root
							value={selectedPlanID}
							name="welcome_plan"
							class="grid gap-2"
							disabled={choiceLoading}
							onValueChange={(value) => void choosePurchase(value as HostedPlanID, billingPeriod)}
						>
							{#each hostedPlans as plan (plan.id)}
								<label
									class={[
										'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2',
										selectedPlanID === plan.id ? 'border-primary bg-primary/5' : 'border-border'
									]}
								>
									<RadioGroup.Item value={plan.id} aria-label={plan.name} />
									<span class="min-w-0 flex-1 font-medium">{plan.name}</span>
									<span class="text-sm text-muted-foreground tabular-nums"
										>${planPriceUSD(plan, billingPeriod).toLocaleString(
											getLocaleTag()
										)}/{billingPeriod === 'annual' ? m.checkout_year() : m.checkout_month()}</span
									>
								</label>
							{/each}
						</RadioGroup.Root>
					</div>

					<PurchaseChoiceSummary choice={purchaseChoice!} changeHref="#welcome-plan" />
				{/if}
				{#if submitError}<InlineNotice tone="error" message={submitError} />{/if}
				<Button
					class="w-full"
					size="lg"
					type="submit"
					disabled={isSubmitting ||
						choiceLoading ||
						!workspaceName.trim() ||
						(purchaseChoiceRequired && !purchaseChoice)}
				>
					{#if isSubmitting}<LoaderIcon class="size-4 animate-spin" />{/if}
					{isSubmitting
						? purchaseChoiceRequired
							? m.onboarding_confirming()
							: m.onboarding_selfhost_confirming()
						: purchaseChoiceRequired
							? m.onboarding_submit()
							: m.onboarding_selfhost_submit()}
				</Button>
			</form>
		{/if}
	</div>
</StandaloneShell>
