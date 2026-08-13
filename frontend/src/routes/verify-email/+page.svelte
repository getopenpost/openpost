<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { auth } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import PurchaseChoiceSummary from '$lib/components/purchase-choice-summary.svelte';
	import PurchaseChoiceError from '$lib/components/purchase-choice-error.svelte';
	import {
		copyPurchaseChoice,
		resolvePurchaseChoice,
		type PurchaseChoice,
		type PurchaseChoiceErrorCode
	} from '$lib/purchase-choice';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import { onMount } from 'svelte';

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
		return () => window.clearInterval(timer);
	});

	async function loadPurchaseContext() {
		purchaseContextLoading = true;
		const configuration = await client.GET('/auth/config');
		purchaseChoiceRequired = configuration.data?.purchase_choice_required ?? false;
		const hasPurchaseParams = ['plan', 'billing_period', 'purchase_choice'].some((key) =>
			page.url.searchParams.has(key)
		);
		if (!purchaseChoiceRequired && !hasPurchaseParams) {
			purchaseContextLoading = false;
			return;
		}
		const result = await resolvePurchaseChoice(page.url.searchParams);
		purchaseChoice = result.choice ?? null;
		purchaseChoiceError = result.choice ? '' : (result.errorCode ?? 'unavailable');
		purchaseContextLoading = false;
	}

	async function verify(event: SubmitEvent) {
		event.preventDefault();
		if (!canVerify) return;

		error = '';
		notice = '';
		isVerifying = true;
		const result = await auth.verifyEmail(challengeID, code);
		if (result.success) {
			await goto(resolve(safeSameOriginRedirect(page.url) as '/'));
			return;
		}
		error = result.error ?? m.auth_verify_email_invalid();
		isVerifying = false;
	}

	async function resend() {
		if (!challengeID || resendSeconds > 0) return;

		error = '';
		notice = '';
		isResending = true;
		const result = await auth.resendEmailVerification(challengeID);
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
			redirect: safeSameOriginRedirect(page.url)
		});
		copyPurchaseChoice(page.url.searchParams, query);
		await goto(resolve(`/verify-email?${query}` as '/'), {
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
	<MailCheckIcon class="size-6" />
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
				<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
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
		{#if error}
			<InlineNotice tone="error" message={error} class="mb-4" />
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
					disabled={isVerifying}
					required
				/>
			</div>

			<Button type="submit" class="w-full gap-2" disabled={!canVerify || isVerifying}>
				{#if isVerifying}
					<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
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
			disabled={isResending || resendSeconds > 0}
			onclick={() => void resend()}
		>
			{#if isResending}
				<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
				{m.auth_verify_email_resending()}
			{:else if resendSeconds > 0}
				{m.auth_verify_email_resend_in({ seconds: resendSeconds })}
			{:else}
				{m.auth_verify_email_resend()}
			{/if}
		</Button>
	{/if}
</StandaloneShell>
