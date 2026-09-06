<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import {
		billingPortalBody,
		parseBillingRecoveryStatus,
		requiresBillingRecovery,
		type BillingRecoveryStatus
	} from '$lib/billing-recovery';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		billingQueryKeys,
		billingStatusQueryOptions,
		OpenPostQueryError
	} from '@openpost/query-catalog';
	import { billingQueryAPI, invalidateBillingDependencies } from '$lib/query/billing';
	import { queryClient } from '$lib/query/client';
	import { auth } from '$lib/stores/auth';

	interface Props {
		workspaceID: string;
	}

	let { workspaceID }: Props = $props();
	let recoveryBusy = $state(false);
	let recoveryError = $state('');
	let activeWorkspaceID = '';
	let recoveryRequestSequence = 0;
	let active = true;
	let authorizationError = $state('');
	let billingPortalReturnScope = $state<{
		workspaceID: string;
		organizationID: string;
	} | null>(null);

	onDestroy(() => {
		active = false;
		recoveryRequestSequence += 1;
	});
	const billingStatusQuery = createQuery(
		() => ({
			...billingStatusQueryOptions(billingQueryAPI, workspaceID),
			enabled: Boolean(workspaceID) && !authorizationError
		}),
		() => queryClient
	);
	const status = $derived.by<BillingRecoveryStatus | null>(() => {
		const parsed =
			!authorizationError && billingStatusQuery.data
				? parseBillingRecoveryStatus(billingStatusQuery.data)
				: null;
		return parsed?.workspace_id === workspaceID ? parsed : null;
	});

	const recoveryDate = $derived(formatRecoveryDate(status?.past_due_since));

	$effect(() => {
		if (workspaceID !== activeWorkspaceID) {
			activeWorkspaceID = workspaceID;
			authorizationError = '';
			recoveryRequestSequence += 1;
			recoveryBusy = false;
			recoveryError = '';
		}
		if (status && status.status.toLowerCase() !== 'past_due') recoveryError = '';
	});

	$effect(() => {
		const cause = billingStatusQuery.error;
		if (!(cause instanceof OpenPostQueryError) || (cause.status !== 401 && cause.status !== 403))
			return;
		authorizationError = cause.message;
		queryClient.removeQueries({
			queryKey: billingQueryKeys.status(workspaceID),
			exact: true
		});
	});

	async function refreshStatus(includePortalDependencies = false) {
		if (!workspaceID) return;
		const returnScope = includePortalDependencies ? billingPortalReturnScope : null;
		if (returnScope) {
			billingPortalReturnScope = null;
			await invalidateBillingDependencies(queryClient, returnScope);
		} else {
			await queryClient.invalidateQueries({
				queryKey: billingQueryKeys.status(workspaceID),
				exact: true,
				refetchType: 'none'
			});
		}
		await billingStatusQuery.refetch();
	}

	async function retryStatus() {
		authorizationError = '';
		await refreshStatus();
	}

	function refreshAfterReturn() {
		if (document.visibilityState === 'visible') void refreshStatus(true);
	}

	async function openPaymentRecovery() {
		const actorID = get(auth).user?.id ?? '';
		const targetWorkspaceID = workspaceID;
		const organizationID = status?.organization_id ?? '';
		const route = `${window.location.pathname}${window.location.search}`;
		if (!actorID || !targetWorkspaceID || !status?.can_manage_billing || recoveryBusy) return;
		const requestSequence = ++recoveryRequestSequence;
		const isCurrentRequest = () =>
			active &&
			requestSequence === recoveryRequestSequence &&
			targetWorkspaceID === workspaceID &&
			get(auth).user?.id === actorID &&
			`${window.location.pathname}${window.location.search}` === route;
		recoveryBusy = true;
		recoveryError = '';
		try {
			const { data, error } = await client.POST('/billing/portal', {
				body: billingPortalBody(targetWorkspaceID, 'update_payment_method')
			});
			if (!isCurrentRequest()) return;
			if (error || !data?.url) throw new Error(error?.detail || m.billing_recovery_open_failed());
			billingPortalReturnScope = {
				workspaceID: targetWorkspaceID,
				organizationID
			};
			if (!isCurrentRequest()) return;
			window.location.assign(data.url);
		} catch (cause) {
			if (isCurrentRequest()) {
				recoveryError = cause instanceof Error ? cause.message : m.billing_recovery_open_failed();
			}
		} finally {
			if (isCurrentRequest()) recoveryBusy = false;
		}
	}

	function formatRecoveryDate(value: string | undefined) {
		if (!value) return '';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return '';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(parsed);
	}
</script>

<svelte:window onfocus={refreshAfterReturn} onpageshow={refreshAfterReturn} />
<svelte:document onvisibilitychange={refreshAfterReturn} />

{#if workspaceID && (authorizationError || billingStatusQuery.isError)}
	<InlineNotice
		tone="warning"
		message={authorizationError || billingStatusQuery.error?.message || m.settings_action_failed()}
		class="rounded-none border-x-0 border-t-0 px-4 py-3 md:px-6"
	>
		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={retryStatus}>
				{m.common_retry()}
			</Button>
		{/snippet}
	</InlineNotice>
{/if}
{#if status && requiresBillingRecovery(status)}
	<InlineNotice tone="error" class="rounded-none border-x-0 border-t-0 px-4 py-3 md:px-6">
		<div
			class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
			data-testid="billing-recovery-notice"
		>
			<div class="max-w-3xl min-w-0">
				<p class="font-semibold">{m.billing_recovery_notice_title()}</p>
				<p class="mt-0.5 text-sm">{m.billing_recovery_notice_body()}</p>
				{#if recoveryDate}
					<p class="mt-0.5 text-xs">
						{m.billing_recovery_notice_since({ date: recoveryDate })}
					</p>
				{/if}
				{#if !status.can_manage_billing}
					<p class="mt-1 text-sm font-medium">
						{m.billing_recovery_notice_member_action()}
					</p>
				{/if}
				{#if recoveryError}
					<p class="mt-1 text-sm font-medium">{recoveryError}</p>
				{/if}
			</div>
			{#if status.can_manage_billing}
				<Button
					variant="destructive"
					class="w-full self-start sm:w-auto sm:self-center"
					onclick={openPaymentRecovery}
					disabled={recoveryBusy}
				>
					{#if recoveryBusy}<ProtectedIcon icon="loading" class="mr-1.5 size-4 animate-spin" />{/if}
					{m.billing_recovery_update_payment_method()}
				</Button>
			{/if}
		</div>
	</InlineNotice>
{/if}
