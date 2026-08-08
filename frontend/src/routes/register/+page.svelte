<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { onboardingPathForPlan } from '$lib/billing';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { trackPublicImageEditorEvent } from '$lib/image-editor/public-telemetry';
	import { onMount } from 'svelte';
	import { client, type AuthConfiguration } from '$lib/api/client';
	import type { OIDCProvider } from '$lib/api/client';
	import AuthProviderButtons from '$lib/components/auth-provider-buttons.svelte';

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let isLoading = $state(false);
	let acceptedLegal = $state(false);
	let authConfiguration = $state<AuthConfiguration | null>(null);
	let configurationLoading = $state(true);
	let oidcProviders = $state.raw<OIDCProvider[]>([]);
	const signupProviders = $derived(oidcProviders.filter((provider) => provider.kind === 'oauth'));

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
		}
		oidcProviders = providerResult.data ?? [];
		configurationLoading = false;
	}

	onMount(() => {
		void loadConfiguration();
	});

	function registrationTarget() {
		const onboardingURL = new URL(
			onboardingPathForPlan(page.url.searchParams.get('plan')),
			page.url
		);
		const billingPeriod = page.url.searchParams.get('billing_period');
		if (billingPeriod) onboardingURL.searchParams.set('billing_period', billingPeriod);
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

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';

		if (password !== confirmPassword) {
			error = m.auth_register_password_mismatch();
			return;
		}

		if (password.length < 12) {
			error = m.auth_register_password_short();
			return;
		}

		if (authConfiguration?.legal_acceptance_required && !acceptedLegal) {
			error = m.auth_register_legal_required();
			return;
		}

		isLoading = true;

		const result = await auth.register({ email, password, acceptedLegal });

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
	{#if error}
		<InlineNotice tone="error" message={error} class="mb-4" />
	{/if}

	{#if authConfiguration?.registration_enabled && signupProviders.length}
		<AuthProviderButtons
			providers={signupProviders}
			returnPath={oidcReturnTarget()}
			disabled={isLoading}
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

		<div class="space-y-2">
			<Label for="password">{m.common_password()}</Label>
			<Input
				type="password"
				id="password"
				bind:value={password}
				required
				minlength={12}
				autocomplete="new-password"
				placeholder={m.auth_password_min_placeholder()}
			/>
		</div>

		<div class="space-y-2">
			<Label for="confirmPassword">{m.auth_confirm_password()}</Label>
			<Input
				type="password"
				id="confirmPassword"
				bind:value={confirmPassword}
				required
				minlength={12}
				autocomplete="new-password"
				placeholder={m.auth_password_confirm_placeholder()}
			/>
		</div>

		{#if authConfiguration?.legal_acceptance_required}
			<div class="flex items-start gap-3 rounded-md border p-3">
				<Checkbox id="legal-acceptance" bind:checked={acceptedLegal} required />
				<Label for="legal-acceptance" class="block min-w-0 flex-1 text-sm leading-5 font-normal">
					{m.auth_register_legal_prefix()}
					<a
						href={authConfiguration.terms_url}
						target="_blank"
						rel="noreferrer"
						class="font-medium text-primary underline-offset-4 hover:underline"
						>{m.auth_register_terms()}</a
					>
					{m.auth_register_legal_join()}
					<a
						href={authConfiguration.privacy_url}
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
