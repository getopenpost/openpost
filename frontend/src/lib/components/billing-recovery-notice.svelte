<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
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

	interface Props {
		workspaceID: string;
	}

	let { workspaceID }: Props = $props();
	let status = $state<BillingRecoveryStatus | null>(null);
	let recoveryBusy = $state(false);
	let recoveryError = $state('');
	let requestSequence = 0;
	let activeWorkspaceID = '';

	const recoveryDate = $derived(formatRecoveryDate(status?.past_due_since));

	$effect(() => {
		void refreshStatus(workspaceID);
	});

	async function refreshStatus(targetWorkspaceID = workspaceID) {
		if (targetWorkspaceID !== activeWorkspaceID) {
			activeWorkspaceID = targetWorkspaceID;
			requestSequence += 1;
			status = null;
			recoveryBusy = false;
			recoveryError = '';
		}
		if (!targetWorkspaceID) return;
		const currentRequest = ++requestSequence;
		const { data, error } = await client.GET('/billing/status', {
			params: { query: { workspace_id: targetWorkspaceID } }
		});
		if (currentRequest !== requestSequence || targetWorkspaceID !== workspaceID) return;
		if (error || !data) return;
		const nextStatus = parseBillingRecoveryStatus(data);
		if (!nextStatus || nextStatus.workspace_id !== targetWorkspaceID) return;
		status = nextStatus;
		if (status.status.toLowerCase() !== 'past_due') recoveryError = '';
	}

	function refreshAfterReturn() {
		if (document.visibilityState === 'visible') void refreshStatus();
	}

	async function openPaymentRecovery() {
		const targetWorkspaceID = workspaceID;
		if (!targetWorkspaceID || !status?.can_manage_billing || recoveryBusy) return;
		recoveryBusy = true;
		recoveryError = '';
		try {
			const { data, error } = await client.POST('/billing/portal', {
				body: billingPortalBody(targetWorkspaceID, 'update_payment_method')
			});
			if (error || !data?.url) throw new Error(error?.detail || m.billing_recovery_open_failed());
			if (targetWorkspaceID !== workspaceID) return;
			window.location.assign(data.url);
		} catch (error) {
			if (targetWorkspaceID === workspaceID) {
				recoveryError = (error as Error).message || m.billing_recovery_open_failed();
			}
		} finally {
			if (targetWorkspaceID === workspaceID) recoveryBusy = false;
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
					<p class="mt-0.5 text-xs">{m.billing_recovery_notice_since({ date: recoveryDate })}</p>
				{/if}
				{#if !status.can_manage_billing}
					<p class="mt-1 text-sm font-medium">{m.billing_recovery_notice_member_action()}</p>
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
					{#if recoveryBusy}<LoaderIcon class="mr-1.5 size-4 animate-spin" />{/if}
					{m.billing_recovery_update_payment_method()}
				</Button>
			{/if}
		</div>
	</InlineNotice>
{/if}
