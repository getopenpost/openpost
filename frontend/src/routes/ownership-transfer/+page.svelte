<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { auth } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import {
		isBillingStatusQueryKey,
		isWorkspaceSetupQueryKey,
		organizationQueryKeys
	} from '@openpost/query-catalog';
	import { queryClient } from '$lib/query/client';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { m } from '$lib/paraglide/messages';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	type Transfer = components['schemas']['OwnershipTransferResponse'];
	const authState = $derived($auth);
	const transferID = $derived(page.url.searchParams.get('id') ?? '');
	let transfer = $state.raw<Transfer | null>(null),
		loading = $state(true),
		busy = $state(false),
		error = $state(''),
		outcome = $state<'accepted' | 'declined' | ''>(''),
		loadedTransferID: string | undefined;
	$effect(() => {
		const nextTransferID = transferID;
		if (authState.isLoading) return;
		if (!nextTransferID) {
			if (loadedTransferID === nextTransferID) return;
			loadedTransferID = nextTransferID;
			resetTransferState();
			loading = false;
			error = m.ownership_transfer_missing();
			return;
		}
		if (!authState.isAuthenticated) {
			void goto(
				resolveAppPath(
					`/login?redirect=${encodeURIComponent(`/ownership-transfer?id=${transferID}`)}`
				)
			);
			return;
		}
		if (loadedTransferID === nextTransferID) return;
		loadedTransferID = nextTransferID;
		resetTransferState();
		void load(nextTransferID);
	});
	function resetTransferState() {
		loading = true;
		error = '';
		transfer = null;
		outcome = '';
		busy = false;
	}
	async function load(expectedTransferID = transferID) {
		resetTransferState();
		const result = await client.GET('/organization-ownership-transfers/resolve', {
			params: { query: { id: expectedTransferID } }
		});
		if (loadedTransferID !== expectedTransferID) return;
		loading = false;
		if (result.error || !result.data) {
			error = result.error?.detail || m.ownership_transfer_load_failed();
			return;
		}
		transfer = result.data;
	}
	async function complete(action: 'accept' | 'decline') {
		const expectedTransferID = transferID;
		const actorID = authState.user?.id ?? '';
		const resolvedOrganizationID = transfer?.organization_id ?? '';
		busy = true;
		error = '';
		const result =
			action === 'accept'
				? await client.POST('/organization-ownership-transfers/accept', {
						body: { id: expectedTransferID }
					})
				: await client.POST('/organization-ownership-transfers/decline', {
						body: { id: expectedTransferID }
					});
		if (result.error || !result.data) {
			if (loadedTransferID === expectedTransferID) {
				busy = false;
				error = result.error?.detail || m.ownership_transfer_action_failed();
			}
			return;
		}
		if (!actorID || get(auth).user?.id !== actorID) return;
		const organizationID = result.data.organization_id || resolvedOrganizationID;
		const invalidations = [
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.all(),
				exact: true
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.instanceAuditRoot()
			})
		];
		if (action === 'accept') {
			invalidations.push(
				queryClient.invalidateQueries({
					predicate: (query) => isBillingStatusQueryKey(query.queryKey)
				}),
				queryClient.invalidateQueries({
					predicate: (query) => isWorkspaceSetupQueryKey(query.queryKey)
				})
			);
		}
		if (organizationID) {
			invalidations.push(
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.detailRoot(organizationID)
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.ownershipTransfer(organizationID),
					exact: true
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.auditRoot(organizationID)
				})
			);
		}
		await Promise.all(invalidations);
		if (loadedTransferID !== expectedTransferID) return;
		busy = false;
		transfer = result.data;
		outcome = action === 'accept' ? 'accepted' : 'declined';
	}
</script>

{#snippet transferIcon()}<KeyRoundIcon class="size-6" />{/snippet}

<svelte:head><title>{m.ownership_transfer_title()}</title></svelte:head>
<StandaloneShell
	title={m.ownership_transfer_title()}
	description={m.ownership_transfer_description()}
	icon={transferIcon}
>
	{#if loading}<PageLoading
			layout="list"
			label={m.common_loading()}
			items={1}
		/>{:else if error}<InlineNotice tone="error" message={error}
			>{#snippet actions()}<Button variant="outline" onclick={() => void load()}
					>{m.common_retry()}</Button
				>{/snippet}</InlineNotice
		>{:else if outcome}<InlineNotice
			tone="success"
			message={outcome === 'accepted'
				? m.ownership_transfer_accepted()
				: m.ownership_transfer_declined()}
		/>{:else if transfer}<div class="space-y-4 rounded-lg border p-5">
			<p>
				{m.ownership_transfer_prompt({
					owner: transfer.prior_owner_email,
					organization: transfer.organization_name
				})}
			</p>
			<p class="text-sm text-muted-foreground">
				{m.ownership_transfer_expiry({
					date: new Date(transfer.expires_at).toLocaleString()
				})}
			</p>
			<div class="flex flex-wrap gap-2">
				<Button disabled={busy} onclick={() => void complete('accept')}
					>{m.ownership_transfer_accept()}</Button
				><Button variant="outline" disabled={busy} onclick={() => void complete('decline')}
					>{m.ownership_transfer_decline()}</Button
				>
			</div>
		</div>{/if}
</StandaloneShell>
