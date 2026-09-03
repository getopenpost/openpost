<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PasswordField from '$lib/components/password-field.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PurchaseChoiceError from '$lib/components/purchase-choice-error.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { onboardingPathForPlan } from '$lib/billing';
	import PurchaseChoiceSummary from '$lib/components/purchase-choice-summary.svelte';
	import {
		applyPurchaseChoice,
		resolvePurchaseChoice,
		type PurchaseChoice,
		type PurchaseChoiceErrorCode
	} from '$lib/purchase-choice';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { trackPublicImageEditorEvent } from '$lib/image-editor/public-telemetry';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { onDestroy, onMount } from 'svelte';
	import type { AuthConfiguration } from '$lib/api/client';
	import type { OIDCProvider } from '$lib/api/client';
	import AuthProviderButtons from '$lib/components/auth-provider-buttons.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import {
		PASSWORD_MAX_CHARACTERS,
		PASSWORD_MIN_CHARACTERS,
		passwordCharacterCount
	} from '$lib/password-policy';
	import {
		authConfigurationQueryOptions,
		authQueryKeys,
		oidcProvidersQueryOptions
	} from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';
	import { queryClient } from '$lib/query/client';

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let isLoading = $state(false);
	let acceptedLegal = $state(false);
	let authConfiguration = $state<AuthConfiguration | null>(null);
	let configurationLoading = $state(true);
	let providerLoadError = $state(false);
	let configurationLoadError = $state(false);
	let oidcProviders = $state.raw<OIDCProvider[]>([]);
	let purchaseChoice = $state.raw<PurchaseChoice | null>(null);
	let purchaseChoiceLoading = $state(false);
	let purchaseChoiceError = $state<PurchaseChoiceErrorCode | ''>('');
	let purchaseChoiceRequestSequence = 0;
	let registrationRequestSequence = 0;
	let active = true;
	const signupProviders = $derived(oidcProviders.filter((provider) => provider.kind === 'oauth'));
	const hostedSignup = $derived(authConfiguration?.purchase_choice_required !== false);
	const passwordLength = $derived(passwordCharacterCount(password));
	const passwordHasMinimum = $derived(passwordLength >= PASSWORD_MIN_CHARACTERS);
	const passwordWithinMaximum = $derived(
		passwordLength > 0 && passwordLength <= PASSWORD_MAX_CHARACTERS
	);
	const passwordsMatch = $derived(confirmPassword.length > 0 && confirmPassword === password);

	async function loadConfiguration() {
		const configurationOptions = authConfigurationQueryOptions(authQueryAPI);
		const providerOptions = oidcProvidersQueryOptions(authQueryAPI);
		const cachedConfiguration = queryClient.getQueryData<AuthConfiguration>(
			authQueryKeys.configuration()
		);
		const cachedProviders = queryClient.getQueryData<OIDCProvider[]>(authQueryKeys.oidcProviders());
		if (cachedConfiguration) authConfiguration = cachedConfiguration;
		if (cachedProviders) oidcProviders = cachedProviders;
		configurationLoading = !cachedConfiguration;
		error = '';
		providerLoadError = false;
		configurationLoadError = false;
		if (
			cachedConfiguration?.registration_enabled &&
			cachedConfiguration.purchase_choice_required &&
			!purchaseChoiceLoading
		) {
			void loadPurchaseChoice();
		}
		try {
			const results = await Promise.allSettled([
				queryClient.fetchQuery(configurationOptions),
				queryClient.fetchQuery(providerOptions)
			]);
			const configurationResult = results[0].status === 'fulfilled' ? results[0].value : null;
			const providerResult = results[1].status === 'fulfilled' ? results[1].value : null;

			if (!configurationResult && !authConfiguration) {
				error = m.auth_config_load_failed();
			} else if (configurationResult) {
				authConfiguration = configurationResult;
				if (!configurationResult.registration_enabled) error = m.auth_registration_disabled();
				if (
					configurationResult.registration_enabled &&
					configurationResult.purchase_choice_required
				) {
					if (!purchaseChoiceLoading && !purchaseChoice && !purchaseChoiceError) {
						await loadPurchaseChoice();
					}
				}
			}

			if (providerResult) oidcProviders = providerResult;
			configurationLoadError = results[0].status === 'rejected';
			providerLoadError = results[1].status === 'rejected';

			if ((results[0].status === 'rejected' || providerLoadError) && !error) {
				error = m.auth_config_load_failed();
			}
		} catch {
			error = m.auth_config_load_failed();
		} finally {
			configurationLoading = false;
		}
	}

	async function loadPurchaseChoice() {
		const requestSequence = ++purchaseChoiceRequestSequence;
		const sourceURL = new URL(page.url);
		const route = `${sourceURL.pathname}${sourceURL.search}`;
		const isCurrentRequest = () =>
			active &&
			requestSequence === purchaseChoiceRequestSequence &&
			`${window.location.pathname}${window.location.search}` === route;
		purchaseChoiceLoading = true;
		purchaseChoiceError = '';
		try {
			const result = await resolvePurchaseChoice(sourceURL.searchParams);
			if (!isCurrentRequest()) return;
			if (!result.choice) {
				purchaseChoice = null;
				purchaseChoiceError = result.errorCode ?? 'unavailable';
				return;
			}
			purchaseChoice = result.choice;
			const sourceHref = sourceURL.href;
			const target = applyPurchaseChoice(sourceURL, result.choice);
			if (target.href !== sourceHref) {
				if (!isCurrentRequest()) return;
				await goto(resolveAppPath(`${target.pathname}${target.search}`), {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			}
		} catch {
			if (!isCurrentRequest()) return;
			purchaseChoice = null;
			purchaseChoiceError = 'unavailable';
		} finally {
			if (active && requestSequence === purchaseChoiceRequestSequence) {
				purchaseChoiceLoading = false;
			}
		}
	}

	onMount(() => {
		void loadConfiguration();
	});

	onDestroy(() => {
		active = false;
		purchaseChoiceRequestSequence += 1;
		registrationRequestSequence += 1;
	});

	function registrationTarget() {
		const planID = purchaseChoice?.plan_id ?? page.url.searchParams.get('plan');
		const billingPeriod =
			purchaseChoice?.billing_period ?? page.url.searchParams.get('billing_period');
		const onboardingPath = onboardingPathForPlan(planID, billingPeriod);
		const onboardingURL = new URL(onboardingPath || '/onboarding', page.url);
		if (purchaseChoice) applyPurchaseChoice(onboardingURL, purchaseChoice);
		const onboarding = `${onboardingURL.pathname}${onboardingURL.search}`;
		const redirect = safeSameOriginRedirect(page.url, '');
		if (!redirect) return onboarding;
		const separator = onboarding.includes('?') ? '&' : '?';
		return `${onboarding}${separator}redirect=${encodeURIComponent(redirect)}`;
	}

	function oidcReturnTarget() {
		const target = new URL(registrationTarget(), page.url);
		target.searchParams.set('source', 'signup');
		return `${target.pathname}${target.search}`;
	}

	function loginTarget() {
		const redirect = safeSameOriginRedirect(page.url, '');
		return redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
	}

	function externalHref(href: string | undefined, fallback: string) {
		return { href: href || fallback } as const;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		if (!authConfiguration) {
			error = m.auth_config_load_failed();
			return;
		}
		if (!authConfiguration.registration_enabled) {
			error = m.auth_registration_disabled();
			return;
		}
		if (authConfiguration?.purchase_choice_required && !purchaseChoice) {
			purchaseChoiceError ||= 'missing';
			return;
		}

		if (password !== confirmPassword) {
			error = m.auth_register_password_mismatch();
			return;
		}

		if (passwordLength < PASSWORD_MIN_CHARACTERS) {
			error = m.auth_register_password_short();
			return;
		}

		if (passwordLength > PASSWORD_MAX_CHARACTERS) {
			error = m.auth_register_password_long();
			return;
		}

		if (authConfiguration?.legal_acceptance_required && !acceptedLegal) {
			error = m.auth_register_legal_required();
			return;
		}

		const requestSequence = ++registrationRequestSequence;
		const route = `${window.location.pathname}${window.location.search}`;
		const target = registrationTarget();
		const editorSignup = safeSameOriginRedirect(page.url, '').startsWith(
			'/image-editor/local_design_'
		);
		const selectedPurchaseChoice = purchaseChoice;
		const isCurrentRequest = () =>
			active &&
			requestSequence === registrationRequestSequence &&
			`${window.location.pathname}${window.location.search}` === route;
		isLoading = true;
		captureTelemetryEvent('signup started');

		const result = await auth.register({
			email,
			password,
			acceptedLegal,
			purchaseChoiceToken: selectedPurchaseChoice?.token
		});
		if (!isCurrentRequest()) return;

		if (result.success) {
			if (editorSignup) {
				trackPublicImageEditorEvent('image_editor_signup_completed', {
					source: 'editor'
				});
			}
			goto(resolveAppPath(target));
		} else if (result.requiresEmailVerification && result.emailVerificationID) {
			const query = new URLSearchParams({
				challenge: result.emailVerificationID,
				email: result.emailVerificationEmail ?? email,
				redirect: target,
				delivery: result.emailDeliveryStatus ?? 'sent'
			});
			if (selectedPurchaseChoice) {
				query.set('plan', selectedPurchaseChoice.plan_id);
				query.set('billing_period', selectedPurchaseChoice.billing_period);
				query.set('purchase_choice', selectedPurchaseChoice.token);
			}
			goto(resolveAppPath(`/verify-email?${query}`));
		} else {
			error = result.error || m.auth_register_failed();
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{hostedSignup ? m.auth_register_title() : m.auth_register_selfhost_title()}</title>
</svelte:head>

<StandaloneShell
	title={hostedSignup ? m.auth_register_heading() : m.auth_register_selfhost_heading()}
	description={hostedSignup
		? m.auth_register_description()
		: m.auth_register_selfhost_description()}
	logoHref="/"
>
	{#if hostedSignup}
		<div
			class="mb-5 grid grid-cols-3 gap-2 border-y py-3 text-center text-[11px] leading-4 text-muted-foreground"
		>
			<span>{m.auth_register_proof_trial()}</span>
			<span>{m.auth_register_proof_channels()}</span>
			<span>{m.auth_register_proof_cancel()}</span>
		</div>
	{/if}
	{#if purchaseChoiceLoading}
		<div
			class="mb-4 flex items-center justify-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground"
			role="status"
		>
			<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
			{m.purchase_choice_loading()}
		</div>
	{:else if purchaseChoice}
		<div class="mb-4">
			<PurchaseChoiceSummary choice={purchaseChoice} />
		</div>
	{:else if authConfiguration?.purchase_choice_required && purchaseChoiceError}
		<PurchaseChoiceError code={purchaseChoiceError} className="mb-4" />
	{/if}
	{#if error}
		<InlineNotice tone={authConfiguration ? 'warning' : 'error'} message={error} class="mb-4">
			{#snippet actions()}
				{#if !configurationLoading && (!authConfiguration || configurationLoadError || providerLoadError)}
					<Button variant="outline" size="sm" onclick={() => void loadConfiguration()}>
						{m.common_retry()}
					</Button>
				{/if}
			{/snippet}
		</InlineNotice>
	{/if}

	{#if authConfiguration?.registration_enabled && signupProviders.length}
		<AuthProviderButtons
			providers={signupProviders}
			returnPath={oidcReturnTarget()}
			disabled={isLoading ||
				purchaseChoiceLoading ||
				(authConfiguration.purchase_choice_required && !purchaseChoice)}
			signup={true}
			{purchaseChoice}
			onstart={() => captureTelemetryEvent('signup started')}
			onerror={(message) => (error = message)}
		/>
		<div class="my-5 flex items-center gap-3" aria-hidden="true">
			<div class="h-px flex-1 bg-border"></div>
			<span class="text-xs font-medium text-muted-foreground">{m.common_or()}</span>
			<div class="h-px flex-1 bg-border"></div>
		</div>
	{/if}

	<form onsubmit={handleSubmit} class="space-y-4">
		<div class="space-y-2">
			<Label for="email">{m.common_email()}</Label>
			<Input
				type="email"
				id="email"
				bind:value={email}
				required
				autocomplete="email"
				placeholder={m.auth_email_placeholder()}
			/>
		</div>

		<PasswordField
			id="password"
			label={m.common_password()}
			bind:value={password}
			required
			autocomplete="new-password"
			placeholder={m.auth_password_min_placeholder()}
			describedby="password-rules"
		/>

		<div id="password-rules" class="rounded-md border bg-muted/20 p-3 text-sm">
			<p class="font-medium">{m.auth_password_rules_heading()}</p>
			<ul class="mt-2 space-y-2" aria-live="polite">
				{#each [{ met: passwordHasMinimum, label: m.auth_password_rule_minimum() }, { met: passwordWithinMaximum, label: m.auth_password_rule_maximum() }, { met: passwordsMatch, label: m.auth_password_rule_match() }] as rule (rule.label)}
					<li class="flex items-center gap-2" class:text-muted-foreground={!rule.met}>
						{#if rule.met}
							<CheckIcon class="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
						{:else}
							<CircleIcon class="size-4" aria-hidden="true" />
						{/if}
						<span class="sr-only">
							{rule.met ? m.auth_password_rule_met() : m.auth_password_rule_pending()}
						</span>
						<span>{rule.label}</span>
					</li>
				{/each}
			</ul>
		</div>

		<PasswordField
			id="confirmPassword"
			label={m.auth_confirm_password()}
			bind:value={confirmPassword}
			required
			autocomplete="new-password"
			placeholder={m.auth_password_confirm_placeholder()}
			describedby="password-rules"
		/>

		{#if authConfiguration?.legal_acceptance_required}
			<div class="flex items-start gap-3 rounded-md border p-3">
				<Checkbox id="legal-acceptance" bind:checked={acceptedLegal} required />
				<Label for="legal-acceptance" class="block min-w-0 flex-1 text-sm leading-5 font-normal">
					{m.auth_register_legal_prefix()}
					<a
						{...externalHref(authConfiguration.terms_url, 'https://openpo.st/terms')}
						target="_blank"
						rel="noreferrer"
						class="font-medium text-primary underline-offset-4 hover:underline"
						>{m.auth_register_terms()}</a
					>
					{m.auth_register_legal_join()}
					<a
						{...externalHref(authConfiguration.privacy_url, 'https://openpo.st/privacy')}
						target="_blank"
						rel="noreferrer"
						class="font-medium text-primary underline-offset-4 hover:underline"
						>{m.auth_register_privacy()}</a
					>.
				</Label>
			</div>
		{/if}

		<Button
			type="submit"
			disabled={isLoading ||
				configurationLoading ||
				!authConfiguration ||
				!authConfiguration.registration_enabled ||
				purchaseChoiceLoading ||
				(Boolean(authConfiguration?.purchase_choice_required) && !purchaseChoice) ||
				(Boolean(authConfiguration?.legal_acceptance_required) && !acceptedLegal)}
			class="w-full gap-2"
		>
			{#if isLoading}
				<LoaderIcon class="h-4 w-4 animate-spin" />
				{m.auth_register_loading()}
			{:else}
				{m.auth_register_submit()}
			{/if}
		</Button>
	</form>

	<p class="mt-6 text-center text-sm text-muted-foreground">
		{m.auth_register_have_account()}
		<a
			href={resolveAppPath(loginTarget())}
			class="inline-flex min-h-11 items-center px-1 font-medium text-primary hover:underline"
			>{m.auth_register_sign_in()}</a
		>
	</p>
</StandaloneShell>
