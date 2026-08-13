<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PasswordField from '$lib/components/password-field.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { onMount } from 'svelte';
	import { client, type AuthConfiguration } from '$lib/api/client';
	import type { OIDCProvider } from '$lib/api/client';
	import AuthProviderButtons from '$lib/components/auth-provider-buttons.svelte';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import { IS_CAPACITOR } from '$lib/env';
	import BuildingIcon from '@lucide/svelte/icons/building-2';

	let email = $state('');
	let password = $state('');
	let totpCode = $state('');
	let recoveryCode = $state('');
	let mfaMode = $state<'totp' | 'recovery'>('totp');
	let error = $state('');
	let isLoading = $state(false);
	let mfaToken = $state('');
	let mfaMethods = $state<string[]>([]);
	let authConfiguration = $state<AuthConfiguration | null>(null);
	let oidcProviders = $state<OIDCProvider[]>([]);
	let discoveryEmail = $state('');
	let ssoLoading = $state('');

	const needsMfa = $derived(mfaToken.length > 0);
	const visibleProviders = $derived(oidcProviders);

	onMount(async () => {
		const [configurationResult, providerResult] = await Promise.all([
			client.GET('/auth/config'),
			client.GET('/auth/oidc/providers')
		]);
		authConfiguration = configurationResult.data ?? null;
		oidcProviders = providerResult.data ?? [];
		const oidcError = $page.url.searchParams.get('oidc_error');
		if (oidcError) error = oidcError;
	});

	function loginTarget() {
		return safeSameOriginRedirect($page.url);
	}

	function registrationTarget() {
		const redirect = $page.url.searchParams.get('redirect');
		return redirect ? `/register?redirect=${encodeURIComponent(redirect)}` : '/register';
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		isLoading = true;

		const result = await auth.login(email, password);

		if (result.success) {
			goto(resolve(loginTarget() as '/'));
		} else if (result.requiresEmailVerification && result.emailVerificationID) {
			goto(
				resolve(
					emailVerificationPath(
						result.emailVerificationID,
						result.emailVerificationEmail ?? email,
						result.emailDeliveryStatus
					) as '/'
				)
			);
			return;
		} else if (result.requiresMfa && result.mfaToken) {
			mfaToken = result.mfaToken;
			mfaMethods = result.mfaMethods ?? [];
			totpCode = '';
			recoveryCode = '';
			mfaMode = mfaMethods.includes('totp') ? 'totp' : 'recovery';
		} else {
			error = result.error || m.auth_login_failed();
		}

		isLoading = false;
	}

	async function handleVerifyRecoveryCode(e: Event) {
		e.preventDefault();
		error = '';
		isLoading = true;

		const result = await auth.verifyRecoveryCode(mfaToken, recoveryCode);
		if (result.success) {
			goto(resolve(loginTarget() as '/'));
		} else {
			error = result.error || m.auth_login_recovery_code_failed();
		}

		isLoading = false;
	}

	function emailVerificationPath(
		challengeID: string,
		verificationEmail: string,
		deliveryStatus: 'sent' | 'failed' | undefined
	) {
		const query = new URLSearchParams({
			challenge: challengeID,
			email: verificationEmail,
			redirect: loginTarget(),
			delivery: deliveryStatus ?? 'sent'
		});
		return `/verify-email?${query}`;
	}

	async function handleVerifyTOTP(e: Event) {
		e.preventDefault();
		error = '';
		isLoading = true;

		const result = await auth.verifyTOTP(mfaToken, totpCode);
		if (result.success) {
			goto(resolve(loginTarget() as '/'));
		} else {
			error = result.error || m.auth_login_authenticator_failed();
		}

		isLoading = false;
	}

	async function handleVerifyPasskey() {
		error = '';
		isLoading = true;

		const result = await auth.verifyPasskey(mfaToken);
		if (result.success) {
			goto(resolve(loginTarget() as '/'));
		} else {
			error = result.error || m.auth_login_passkey_failed();
		}

		isLoading = false;
	}

	function resetMfa() {
		mfaToken = '';
		mfaMethods = [];
		totpCode = '';
		recoveryCode = '';
		mfaMode = 'totp';
		error = '';
	}

	function setMfaMode(mode: 'totp' | 'recovery') {
		mfaMode = mode;
		error = '';
	}

	function oidcStartURL(provider: OIDCProvider) {
		const base = getApiBase().replace(/\/$/, '');
		const query = new URLSearchParams({
			return_path: loginTarget(),
			...(IS_CAPACITOR ? { native: 'true' } : {})
		});
		return `${base}/auth/oidc/${encodeURIComponent(provider.id)}/start?${query}`;
	}

	async function startOIDC(provider: OIDCProvider) {
		error = '';
		ssoLoading = provider.id;
		const url = oidcStartURL(provider);
		if (IS_CAPACITOR) {
			const { Browser } = await import('@capacitor/browser');
			await Browser.open({ url });
			return;
		}
		window.location.assign(url);
	}

	async function discoverSSO(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		ssoLoading = 'discover';
		const { data, error: discoveryError } = await client.GET('/auth/oidc/discover', {
			params: { query: { email: discoveryEmail.trim() } }
		});
		if (discoveryError || !data?.found || !data.provider) {
			error = discoveryError?.detail ?? m.auth_sso_not_found();
			ssoLoading = '';
			return;
		}
		await startOIDC(data.provider);
	}
</script>

<svelte:head>
	<title>{m.auth_login_title()}</title>
</svelte:head>

<StandaloneShell
	title={needsMfa ? m.auth_login_mfa_heading() : m.auth_login_heading()}
	description={needsMfa ? m.auth_login_mfa_description() : m.auth_login_description()}
	logoHref="/"
>
	{#if error}
		<InlineNotice tone="error" message={error} class="mb-4" />
	{/if}

	{#if needsMfa}
		<div class="space-y-4">
			{#if mfaMethods.includes('passkey')}
				<Button
					type="button"
					class="w-full gap-2"
					onclick={handleVerifyPasskey}
					disabled={isLoading}
				>
					{#if isLoading}
						<LoaderIcon class="h-4 w-4 animate-spin" />
						{m.auth_login_passkey_loading()}
					{:else}
						<KeyRoundIcon class="h-4 w-4" />
						{m.auth_login_passkey_submit()}
					{/if}
				</Button>
			{/if}

			{#if mfaMode === 'totp' && mfaMethods.includes('totp')}
				<form onsubmit={handleVerifyTOTP} class="space-y-4">
					<div class="space-y-2">
						<Label for="totpCode">{m.auth_login_authenticator_code()}</Label>
						<Input
							id="totpCode"
							bind:value={totpCode}
							inputmode="numeric"
							autocomplete="one-time-code"
							pattern="[0-9]*"
							maxlength={6}
							placeholder="123456"
							required
						/>
					</div>

					<Button type="submit" disabled={isLoading} class="w-full gap-2">
						{#if isLoading}
							<LoaderIcon class="h-4 w-4 animate-spin" />
							{m.auth_login_verifying()}
						{:else}
							<ShieldIcon class="h-4 w-4" />
							{m.auth_login_verify_code()}
						{/if}
					</Button>
				</form>
			{:else if mfaMode === 'recovery' && mfaMethods.includes('recovery_code')}
				<form onsubmit={handleVerifyRecoveryCode} class="space-y-4">
					<div class="space-y-2">
						<Label for="recoveryCode">{m.auth_login_recovery_code()}</Label>
						<Input
							id="recoveryCode"
							bind:value={recoveryCode}
							autocomplete="one-time-code"
							autocapitalize="characters"
							spellcheck={false}
							maxlength={32}
							placeholder="XXXX-XXXX-XXXX-XXXX"
							required
						/>
						<p class="text-sm text-muted-foreground">
							{m.auth_login_recovery_code_help()}
						</p>
					</div>

					<Button
						type="submit"
						disabled={isLoading || recoveryCode.trim().length < 16}
						class="w-full gap-2"
					>
						{#if isLoading}
							<LoaderIcon class="h-4 w-4 animate-spin" />
							{m.auth_login_verifying()}
						{:else}
							<ShieldIcon class="h-4 w-4" />
							{m.auth_login_verify_recovery_code()}
						{/if}
					</Button>
				</form>
			{/if}

			{#if mfaMethods.includes('recovery_code') && mfaMode !== 'recovery'}
				<Button
					type="button"
					variant="outline"
					class="w-full"
					onclick={() => setMfaMode('recovery')}
					disabled={isLoading}
				>
					{m.auth_login_use_recovery_code()}
				</Button>
			{:else if mfaMode === 'recovery' && mfaMethods.includes('totp')}
				<Button
					type="button"
					variant="outline"
					class="w-full"
					onclick={() => setMfaMode('totp')}
					disabled={isLoading}
				>
					{m.auth_login_use_authenticator()}
				</Button>
			{/if}

			<Button type="button" variant="ghost" class="w-full" onclick={resetMfa} disabled={isLoading}>
				{m.auth_login_different_account()}
			</Button>
		</div>
	{:else}
		{#if visibleProviders.length}
			<AuthProviderButtons
				providers={visibleProviders}
				returnPath={loginTarget()}
				disabled={Boolean(ssoLoading)}
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
				autocomplete="current-password"
				placeholder="••••••••"
			/>

			<p class="text-sm leading-6 text-muted-foreground">{m.auth_login_session_notice()}</p>

			{#if authConfiguration?.password_reset_enabled}
				<div class="-mt-2 text-right">
					<a
						href={resolve('/forgot-password')}
						class="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
						>{m.auth_login_forgot_password()}</a
					>
				</div>
			{/if}

			<Button type="submit" disabled={isLoading} class="w-full gap-2">
				{#if isLoading}
					<LoaderIcon class="h-4 w-4 animate-spin" />
					{m.auth_login_loading()}
				{:else}
					{m.auth_login_submit()}
				{/if}
			</Button>
		</form>

		<details class="mt-5 rounded-lg border border-border/70 px-4 py-3">
			<summary class="cursor-pointer text-sm font-medium">{m.auth_sso_work_account()}</summary>
			<form onsubmit={discoverSSO} class="mt-3 space-y-3">
				<div class="space-y-2">
					<Label for="sso-email">{m.auth_sso_work_email()}</Label>
					<Input
						id="sso-email"
						type="email"
						bind:value={discoveryEmail}
						autocomplete="email"
						placeholder={m.auth_email_placeholder()}
						required
					/>
				</div>
				<Button type="submit" variant="outline" class="w-full gap-2" disabled={Boolean(ssoLoading)}>
					{#if ssoLoading === 'discover'}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<BuildingIcon class="size-4" />
					{/if}
					{m.auth_sso_find_provider()}
				</Button>
			</form>
		</details>

		<p class="mt-6 text-center text-sm text-muted-foreground">
			{m.auth_login_no_account()}
			<a
				href={resolve(registrationTarget() as '/')}
				class="inline-flex min-h-11 items-center px-1 font-medium text-primary hover:underline"
				>{m.auth_login_create_one()}</a
			>
		</p>
	{/if}
</StandaloneShell>
