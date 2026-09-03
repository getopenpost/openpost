<script lang="ts">
	import { goto } from '$app/navigation';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { page } from '$app/state';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { auth } from '$lib/stores/auth';
	import PurchaseChoiceSummary from '$lib/components/purchase-choice-summary.svelte';
	import PurchaseChoiceError from '$lib/components/purchase-choice-error.svelte';
	import {
		copyPurchaseChoice,
		resolvePurchaseChoice,
		type PurchaseChoice,
		type PurchaseChoiceErrorCode
	} from '$lib/purchase-choice';
	import { onMount } from 'svelte';
	import type { AuthConfiguration } from '$lib/api/client';
	import {
		authConfigurationQueryOptions,
		authQueryKeys,
		OpenPostQueryError
	} from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';
	import { queryClient } from '$lib/query/client';

	let challengeID = $state(page.url.searchParams.get('challenge') ?? '');
	let email = $state(page.url.searchParams.get('email') ?? '');
	let deliveryStatus = $state(page.url.searchParams.get('delivery') ?? 'sent');
	let code = $state('');
	let error = $state('');
	let notice = $state('');
	let isVerifying = $state(false);
	let isResending = $state(false);
	let resendSeconds = $state(page.url.searchParams.get('delivery') === 'sent' ? 60 : 0);
	let purchaseChoice = $state.raw<PurchaseChoice | null>(null);
	let purchaseChoiceRequired = $state(false);
	let purchaseContextLoading = $state(true);
	let purchaseChoiceError = $state<PurchaseChoiceErrorCode | ''>('');
	let configurationBackgroundError = $state('');
	let verificationRequestSequence = 0;
	let resendRequestSequence = 0;
	let purchaseContextRequestSequence = 0;
	let active = true;

	const canVerify = $derived(
		challengeID.length > 0 &&
			/^\d{6}$/.test(code) &&
			!purchaseContextLoading &&
			(!purchaseChoiceRequired || Boolean(purchaseChoice))
	);
	const description = $derived(
		email ? m.auth_verify_email_description({ email }) : m.auth_verify_email_invalid()
	);

	onMount(() => {
		void loadPurchaseContext();
		const timer = window.setInterval(() => {
			if (resendSeconds > 0) resendSeconds -= 1;
		}, 1000);
		return () => {
			active = false;
			window.clearInterval(timer);
			verificationRequestSequence += 1;
			resendRequestSequence += 1;
			purchaseContextRequestSequence += 1;
		};
	});

	async function loadPurchaseContext() {
		const requestSequence = ++purchaseContextRequestSequence;
		const route = `${window.location.pathname}${window.location.search}`;
		const isCurrentRequest = () =>
			active &&
			requestSequence === purchaseContextRequestSequence &&
			`${window.location.pathname}${window.location.search}` === route;
		const configurationOptions = authConfigurationQueryOptions(authQueryAPI);
		const cachedConfiguration = queryClient.getQueryData<AuthConfiguration>(
			authQueryKeys.configuration()
		);
		purchaseContextLoading = cachedConfiguration === undefined;
		error = '';
		configurationBackgroundError = '';
		purchaseChoiceError = '';
		try {
			if (cachedConfiguration) {
				await applyPurchaseConfiguration(cachedConfiguration, isCurrentRequest);
				if (!isCurrentRequest()) return;
				purchaseContextLoading = false;
			}
			const configuration = await queryClient.fetchQuery(configurationOptions);
			if (!isCurrentRequest()) return;
			await applyPurchaseConfiguration(configuration, isCurrentRequest);
		} catch (cause) {
			if (!isCurrentRequest()) return;
			if (cause instanceof OpenPostQueryError && (cause.status === 401 || cause.status === 403)) {
				queryClient.removeQueries({
					queryKey: configurationOptions.queryKey,
					exact: true
				});
				error = m.auth_config_load_failed();
			} else if (cachedConfiguration) {
				configurationBackgroundError = m.auth_config_load_failed();
			} else {
				error = m.auth_config_load_failed();
			}
		} finally {
			if (isCurrentRequest()) purchaseContextLoading = false;
		}
	}

	async function applyPurchaseConfiguration(
		configuration: AuthConfiguration,
		isCurrentRequest: () => boolean
	) {
		if (!isCurrentRequest()) return;
		purchaseChoiceRequired = configuration.purchase_choice_required ?? false;
		const hasPurchaseParams = ['plan', 'billing_period', 'purchase_choice'].some((key) =>
			page.url.searchParams.has(key)
		);
		if (!purchaseChoiceRequired && !hasPurchaseParams) return;
		try {
			const result = await resolvePurchaseChoice(page.url.searchParams);
			if (!isCurrentRequest()) return;
			purchaseChoice = result.choice ?? null;
			purchaseChoiceError = result.choice ? '' : (result.errorCode ?? 'unavailable');
		} catch {
			if (!isCurrentRequest()) return;
			purchaseChoice = null;
			purchaseChoiceError = 'unavailable';
		}
	}

	async function verify(event: SubmitEvent) {
		event.preventDefault();
		if (!canVerify || isVerifying || isResending) return;

		resendRequestSequence += 1;
		const requestSequence = ++verificationRequestSequence;
		const route = `${window.location.pathname}${window.location.search}`;
		const target = safeSameOriginRedirect(page.url);
		const isCurrentRequest = () =>
			active &&
			requestSequence === verificationRequestSequence &&
			`${window.location.pathname}${window.location.search}` === route;
		error = '';
		notice = '';
		isVerifying = true;
		const result = await auth.verifyEmail(challengeID, code);
		if (!isCurrentRequest()) return;
		if (result.success) {
			resendRequestSequence += 1;
			await goto(resolveAppPath(target));
			return;
		}
		error = result.error ?? m.auth_verify_email_invalid();
		isVerifying = false;
	}

	async function resend() {
		if (!challengeID || resendSeconds > 0 || isResending || isVerifying) return;

		const requestSequence = ++resendRequestSequence;
		const sourceURL = new URL(page.url);
		const route = `${sourceURL.pathname}${sourceURL.search}`;
		const pendingChallengeID = challengeID;
		const isCurrentRequest = () =>
			active &&
			requestSequence === resendRequestSequence &&
			`${window.location.pathname}${window.location.search}` === route;
		error = '';
		notice = '';
		isResending = true;
		const result = await auth.resendEmailVerification(pendingChallengeID);
		if (!isCurrentRequest()) return;
		isResending = false;
		if (!result.requiresEmailVerification || !result.emailVerificationID) {
			error = result.error ?? m.auth_verify_email_delivery_failed();
			return;
		}

		challengeID = result.emailVerificationID;
		email = result.emailVerificationEmail ?? email;
		deliveryStatus = result.emailDeliveryStatus ?? 'sent';
		code = '';
		if (deliveryStatus === 'sent') {
			notice = m.auth_verify_email_resent();
			resendSeconds = 60;
		} else {
			error = m.auth_verify_email_delivery_failed();
		}

		const query = new URLSearchParams({
			challenge: challengeID,
			email,
			delivery: deliveryStatus,
			redirect: safeSameOriginRedirect(sourceURL)
		});
		copyPurchaseChoice(sourceURL.searchParams, query);
		if (!isCurrentRequest()) return;
		await goto(resolveAppPath(`/verify-email?${query}`), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<svelte:head>
	<title>{m.auth_verify_email_title()}</title>
</svelte:head>

{#snippet icon()}
	<ThemeIcon role="mail" class="size-6" />
{/snippet}

<StandaloneShell title={m.auth_verify_email_heading()} {description} {icon} logoHref="/">
	{#if !challengeID}
		<InlineNotice tone="error" message={m.auth_verify_email_invalid()} />
		<Button variant="outline" class="mt-4 w-full" href={resolve('/login')}>
			{m.auth_verify_email_back_to_login()}
		</Button>
	{:else}
		{#if purchaseContextLoading}
			<div
				class="mb-4 flex items-center justify-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground"
				role="status"
			>
				<ProtectedIcon icon="loading" class="size-4 animate-spin" />
				{m.purchase_choice_loading()}
			</div>
		{:else if purchaseChoice}
			<div class="mb-4">
				<PurchaseChoiceSummary choice={purchaseChoice} />
			</div>
		{:else if purchaseChoiceRequired && purchaseChoiceError}
			<PurchaseChoiceError code={purchaseChoiceError} className="mb-4" />
		{/if}
		{#if deliveryStatus === 'failed'}
			<InlineNotice tone="warning" message={m.auth_verify_email_delivery_failed()} class="mb-4" />
		{/if}
		{#if configurationBackgroundError}
			<InlineNotice tone="warning" message={configurationBackgroundError} class="mb-4">
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void loadPurchaseContext()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if error}
			<InlineNotice tone="error" message={error} class="mb-4">
				{#snippet actions()}
					{#if error === m.auth_config_load_failed()}
						<Button variant="outline" size="sm" onclick={() => void loadPurchaseContext()}>
							{m.common_retry()}
						</Button>
					{/if}
				{/snippet}
			</InlineNotice>
		{:else if notice}
			<InlineNotice tone="success" message={notice} class="mb-4" />
		{/if}

		<form class="space-y-4" onsubmit={verify}>
			<div class="space-y-2">
				<Label for="verification-code">{m.auth_verify_email_code()}</Label>
				<Input
					id="verification-code"
					bind:value={code}
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern={'[0-9]{6}'}
					maxlength={6}
					placeholder="123456"
					class="text-center font-mono text-lg tracking-[0.35em]"
					disabled={isVerifying || isResending}
					required
				/>
			</div>

			<Button
				type="submit"
				class="w-full gap-2"
				disabled={!canVerify || isVerifying || isResending}
			>
				{#if isVerifying}
					<ProtectedIcon icon="loading" class="size-4 animate-spin" />
					{m.auth_verify_email_loading()}
				{:else}
					{m.auth_verify_email_submit()}
				{/if}
			</Button>
		</form>

		<Button
			type="button"
			variant="ghost"
			class="mt-2 w-full"
			disabled={isResending || isVerifying || resendSeconds > 0}
			onclick={() => void resend()}
		>
			{#if isResending}
				<ProtectedIcon icon="loading" class="size-4 animate-spin" />
				{m.auth_verify_email_resending()}
			{:else if resendSeconds > 0}
				{m.auth_verify_email_resend_in({ seconds: resendSeconds })}
			{:else}
				{m.auth_verify_email_resend()}
			{/if}
		</Button>
	{/if}
</StandaloneShell>
