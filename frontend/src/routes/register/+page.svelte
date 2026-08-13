<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
	import { onMount } from 'svelte';
	import { client, type AuthConfiguration } from '$lib/api/client';
	import type { OIDCProvider } from '$lib/api/client';
	import AuthProviderButtons from '$lib/components/auth-provider-buttons.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import {
		PASSWORD_MAX_CHARACTERS,
		PASSWORD_MIN_CHARACTERS,
		passwordCharacterCount
	} from '$lib/password-policy';

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let isLoading = $state(false);
	let acceptedLegal = $state(false);
	let authConfiguration = $state<AuthConfiguration | null>(null);
	let configurationLoading = $state(true);
	let oidcProviders = $state.raw<OIDCProvider[]>([]);
	let purchaseChoice = $state.raw<PurchaseChoice | null>(null);
	let purchaseChoiceLoading = $state(false);
	let purchaseChoiceError = $state<PurchaseChoiceErrorCode | ''>('');
	const signupProviders = $derived(oidcProviders.filter((provider) => provider.kind === 'oauth'));
	const passwordLength = $derived(passwordCharacterCount(password));
	const passwordHasMinimum = $derived(passwordLength >= PASSWORD_MIN_CHARACTERS);
	const passwordWithinMaximum = $derived(
		passwordLength > 0 && passwordLength <= PASSWORD_MAX_CHARACTERS
	);
	const passwordsMatch = $derived(confirmPassword.length > 0 && confirmPassword === password);

	async function loadConfiguration() {
		configurationLoading = true;
		error = '';
		const [configurationResult, providerResult] = await Promise.all([
			client.GET('/auth/config'),
			client.GET('/auth/oidc/providers')
		]);
		const { data, error: responseError } = configurationResult;
		if (responseError || !data) {
			error = responseError?.detail ?? m.auth_config_load_failed();
		} else {
			authConfiguration = data;
			if (!data.registration_enabled) error = m.auth_registration_disabled();
			if (data.registration_enabled && data.purchase_choice_required) {
				await loadPurchaseChoice();
			}
		}
		oidcProviders = providerResult.data ?? [];
		configurationLoading = false;
	}

	async function loadPurchaseChoice() {
		purchaseChoiceLoading = true;
		purchaseChoiceError = '';
		const result = await resolvePurchaseChoice(page.url.searchParams);
		purchaseChoiceLoading = false;
		if (!result.choice) {
			purchaseChoice = null;
			purchaseChoiceError = result.errorCode ?? 'unavailable';
			return;
		}
		purchaseChoice = result.choice;
		const target = applyPurchaseChoice(new URL(page.url), result.choice);
		if (target.href !== page.url.href) {
			await goto(resolve(`${target.pathname}${target.search}` as '/'), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		}
	}

	onMount(() => {
		void loadConfiguration();
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

		isLoading = true;

		const result = await auth.register({
			email,
			password,
			acceptedLegal,
			purchaseChoiceToken: purchaseChoice?.token
		});

		if (result.success) {
			if (safeSameOriginRedirect(page.url, '').startsWith('/image-editor/local_design_')) {
				trackPublicImageEditorEvent('image_editor_signup_completed', { source: 'editor' });
			}
			goto(resolve(registrationTarget() as '/'));
		} else if (result.requiresEmailVerification && result.emailVerificationID) {
			const query = new URLSearchParams({
				challenge: result.emailVerificationID,
				email: result.emailVerificationEmail ?? email,
				redirect: registrationTarget(),
				delivery: result.emailDeliveryStatus ?? 'sent'
			});
			if (purchaseChoice) {
				query.set('plan', purchaseChoice.plan_id);
				query.set('billing_period', purchaseChoice.billing_period);
				query.set('purchase_choice', purchaseChoice.token);
			}
			goto(resolve(`/verify-email?${query}` as '/'));
		} else {
			error = result.error || m.auth_register_failed();
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{m.auth_register_title()}</title>
</svelte:head>

<StandaloneShell
	title={m.auth_register_heading()}
	description={m.auth_register_description()}
	logoHref="/"
>
	<div
		class="mb-5 grid grid-cols-3 gap-2 border-y py-3 text-center text-[11px] leading-4 text-muted-foreground"
	>
		<span>{m.auth_register_proof_trial()}</span>
		<span>{m.auth_register_proof_channels()}</span>
		<span>{m.auth_register_proof_cancel()}</span>
	</div>
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
		<InlineNotice tone="error" message={error} class="mb-4" />
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
						{...externalHref(authConfiguration.terms_url, 'https://openpost.social/terms')}
						target="_blank"
						rel="noreferrer"
						class="font-medium text-primary underline-offset-4 hover:underline"
						>{m.auth_register_terms()}</a
					>
					{m.auth_register_legal_join()}
					<a
						{...externalHref(authConfiguration.privacy_url, 'https://openpost.social/privacy')}
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
				!authConfiguration?.registration_enabled ||
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
			href={resolve(loginTarget() as '/')}
			class="inline-flex min-h-11 items-center px-1 font-medium text-primary hover:underline"
			>{m.auth_register_sign_in()}</a
		>
	</p>
</StandaloneShell>
