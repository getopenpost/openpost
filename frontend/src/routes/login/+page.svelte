<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import ShieldIcon from 'lucide-svelte/icons/shield';
	import KeyRoundIcon from 'lucide-svelte/icons/key-round';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { onMount } from 'svelte';
	import { client, type AuthConfiguration } from '$lib/api/client';

	let email = $state('');
	let password = $state('');
	let totpCode = $state('');
	let error = $state('');
	let isLoading = $state(false);
	let mfaToken = $state('');
	let mfaMethods = $state<string[]>([]);
	let authConfiguration = $state<AuthConfiguration | null>(null);

	const needsMfa = $derived(mfaToken.length > 0);

	onMount(async () => {
		const { data } = await client.GET('/auth/config');
		authConfiguration = data ?? null;
	});

	function loginTarget() {
		return safeSameOriginRedirect($page.url);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		isLoading = true;

		const result = await auth.login(email, password);

		if (result.success) {
			goto(resolve(loginTarget() as '/'));
		} else if (result.requiresMfa && result.mfaToken) {
			mfaToken = result.mfaToken;
			mfaMethods = result.mfaMethods ?? [];
			totpCode = '';
		} else {
			error = result.error || m.auth_login_failed();
		}

		isLoading = false;
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
		error = '';
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

			{#if mfaMethods.includes('totp')}
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
			{/if}

			<Button type="button" variant="ghost" class="w-full" onclick={resetMfa} disabled={isLoading}>
				{m.auth_login_different_account()}
			</Button>
		</div>
	{:else}
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
					autocomplete="current-password"
					placeholder="••••••••"
				/>
			</div>

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

		<p class="mt-6 text-center text-sm text-muted-foreground">
			{m.auth_login_no_account()}
			<a
				href={resolve('/register')}
				class="inline-flex min-h-11 items-center px-1 font-medium text-primary hover:underline"
				>{m.auth_login_create_one()}</a
			>
		</p>
	{/if}
</StandaloneShell>
