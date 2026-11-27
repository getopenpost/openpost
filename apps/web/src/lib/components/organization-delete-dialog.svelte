<script lang="ts">
	import { get } from 'svelte/store';
	import ReauthDeleteDialog, {
		type ReauthDeletePreviewSummary
	} from '$lib/components/reauth-delete-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { client } from '$lib/api/client';
	import { organizationQueryKeys, workspaceSettingsQueryKeys } from '@openpost/query-catalog';
	import { auth } from '$lib/stores/auth';
	import { queryClient } from '$lib/query/client';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type Preview = components['schemas']['OrganizationDeletionPreview'];
	type Blocker = components['schemas']['WorkspaceDeletionBlocker'];

	interface Props {
		open?: boolean;
		organizationID: string;
		organizationName: string;
		hasPassword: boolean;
		onConfirm: (
			organizationID: string,
			confirmation: {
				confirmName: string;
				currentPassword: string;
				reauthGrant?: string;
			}
		) => void | boolean | Promise<void | boolean>;
	}

	let {
		open = $bindable(false),
		organizationID,
		organizationName,
		hasPassword,
		onConfirm
	}: Props = $props();
	let deletionPreview = $state<Preview | null>(null);
	let cancellingCheckouts = $state(false);

	function blockerMessage(blocker: Blocker): string {
		switch (blocker.code) {
			case 'active_billing':
				return m.organization_delete_blocker_active_billing();
			case 'pending_billing_checkout':
				return m.organization_delete_blocker_pending_billing_checkout();
			case 'pending_ownership_transfer':
				return m.organization_delete_blocker_ownership_transfer();
			case 'pending_external_writes':
				return m.organization_delete_blocker_pending_external_writes();
			case 'pending_cleanup':
				return m.organization_delete_blocker_pending_cleanup();
			default:
				return blocker.message;
		}
	}

	function impactMessage(item: string): string {
		switch (item) {
			case 'organization_memberships':
				return m.organization_delete_access_organization_memberships();
			case 'workspace_memberships':
				return m.organization_delete_access_workspace_memberships();
			case 'organization_credentials':
				return m.organization_delete_access_credentials();
			case 'required_audit_evidence':
				return m.organization_delete_retained_audit();
			case 'required_billing_evidence':
				return m.organization_delete_retained_billing();
			case 'workspaces':
				return m.organization_delete_loss_workspaces();
			case 'content':
				return m.organization_delete_loss_content();
			case 'connected_accounts':
				return m.organization_delete_loss_accounts();
			case 'media':
				return m.organization_delete_loss_media();
			case 'settings':
				return m.organization_delete_loss_settings();
			default:
				return item;
		}
	}

	function billingStateLabel(state: string): string {
		const normalized = state.toLowerCase();
		if (normalized === 'none') return m.settings_billing_status_none();
		if (normalized === 'active') return m.settings_billing_status_active();
		if (normalized === 'trialing') return m.settings_billing_status_trialing();
		if (normalized === 'past_due') return m.settings_billing_status_past_due();
		if (normalized === 'canceled' || normalized === 'cancelled') {
			return m.settings_billing_status_canceled();
		}
		return state;
	}

	async function loadOrganizationPreview(
		targetOrganizationID: string,
		isCurrent: () => boolean
	): Promise<ReauthDeletePreviewSummary> {
		deletionPreview = null;
		const previewResult = await client.GET('/organizations/{id}/deletion-preview', {
			params: { path: { id: targetOrganizationID } }
		});
		if (previewResult.error || !previewResult.data) {
			throw new Error(previewResult.error?.detail ?? m.organization_delete_preview_failed());
		}
		if (!isCurrent()) return { blockers: [], expectedConfirm: '' };
		deletionPreview = previewResult.data;
		return {
			blockers: (previewResult.data.blockers ?? []).map((blocker) => ({
				key: blocker.code,
				message: blockerMessage(blocker)
			})),
			expectedConfirm: previewResult.data.organization_name
		};
	}

	async function cancelPendingCheckouts(actions: {
		reloadPreview: () => Promise<void>;
		reportError: (message: string) => void;
	}) {
		const targetOrganizationID = organizationID;
		const actorID = get(auth).user?.id ?? '';
		const workspaceIDs = (deletionPreview?.workspaces ?? []).map(
			(workspace) => workspace.workspace_id
		);
		if (!targetOrganizationID || !actorID) return;
		const isSameActor = () => get(auth).user?.id === actorID;
		const isCurrentDialog = () => isSameActor() && open && organizationID === targetOrganizationID;
		cancellingCheckouts = true;
		try {
			const result = await client.DELETE('/organizations/{id}/billing-checkout-attempts/pending', {
				params: { path: { id: targetOrganizationID } }
			});
			if (result.error) {
				throw new Error(result.error.detail ?? m.organization_delete_checkout_cancel_failed());
			}
			if (!isSameActor()) return;
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.auditRoot(targetOrganizationID)
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.instanceAuditRoot()
				}),
				...workspaceIDs.map((workspaceID) =>
					queryClient.invalidateQueries({
						queryKey: workspaceSettingsQueryKeys.setup(workspaceID),
						exact: true
					})
				)
			]);
			if (!isCurrentDialog()) return;
			await actions.reloadPreview();
		} catch (cause) {
			if (isCurrentDialog()) {
				actions.reportError(
					cause instanceof Error ? cause.message : m.organization_delete_checkout_cancel_failed()
				);
			}
		} finally {
			cancellingCheckouts = false;
		}
	}
</script>

<ReauthDeleteDialog
	bind:open
	entityID={organizationID}
	title={m.organization_delete_title()}
	description={m.organization_delete_dialog_description()}
	confirmInputID="organization-delete-name"
	confirmLabelFor={(name) => m.organization_delete_name_label({ name: name || organizationName })}
	passwordInputID="organization-delete-password"
	{hasPassword}
	reauthAction="organization.delete"
	previewLoader={loadOrganizationPreview}
	blockerTitle={m.workspace_delete_blockers_title()}
	confirmButtonLabel={m.organization_delete_confirm()}
	fallbackPreviewError={m.organization_delete_preview_failed()}
	fallbackDeleteError={m.organization_delete_failed()}
	contentClass="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
	externalBusy={cancellingCheckouts}
	onDelete={(payload) =>
		onConfirm(organizationID, {
			confirmName: payload.confirmText,
			currentPassword: payload.currentPassword,
			reauthGrant: payload.reauthGrant
		})}
>
	{#snippet preview()}
		{#if deletionPreview}
			<section class="rounded-md border p-3">
				<p class="text-sm font-medium">
					{m.organization_delete_workspaces_title()}
				</p>
				<ul class="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
					{#each deletionPreview.workspaces ?? [] as workspace (workspace.workspace_id)}<li>
							{workspace.workspace_name}
						</li>{/each}
				</ul>
			</section>
			<div class="grid gap-3 sm:grid-cols-2">
				<section class="rounded-md border p-3">
					<p class="text-sm font-medium">
						{m.organization_delete_state_title()}
					</p>
					<p class="mt-2 text-sm text-muted-foreground">
						{m.organization_delete_billing_state({
							state: billingStateLabel(deletionPreview.billing_state)
						})}
					</p>
					<ul class="mt-1 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						<li>
							{m.organization_delete_pending_provider_writes({
								count: deletionPreview.pending_work.pending_provider_writes ?? 0
							})}
						</li>
						<li>
							{m.organization_delete_pending_jobs({
								count: deletionPreview.pending_work.pending_jobs ?? 0
							})}
						</li>
						<li>
							{m.organization_delete_pending_cleanup_jobs({
								count: deletionPreview.pending_work.pending_cleanup_jobs ?? 0
							})}
						</li>
					</ul>
				</section>
				<section class="rounded-md border p-3">
					<p class="text-sm font-medium">
						{m.organization_delete_access_title()}
					</p>
					<ul class="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						{#each deletionPreview.access_effects ?? [] as item (item)}<li>
								{impactMessage(item)}
							</li>{/each}
					</ul>
				</section>
				<section class="rounded-md border p-3">
					<p class="text-sm font-medium">
						{m.workspace_delete_removed_title()}
					</p>
					<ul class="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						{#each deletionPreview.irreversible_loss ?? [] as item (item)}<li>
								{impactMessage(item)}
							</li>{/each}
					</ul>
				</section>
				<section class="rounded-md border p-3">
					<p class="text-sm font-medium">
						{m.workspace_delete_retained_title()}
					</p>
					<ul class="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						{#each deletionPreview.retained ?? [] as item (item)}<li>
								{impactMessage(item)}
							</li>{/each}
					</ul>
				</section>
			</div>
			<InlineNotice tone="warning" message={m.organization_delete_no_recovery()} />
		{/if}
	{/snippet}
	{#snippet extraBlockerActions(actions)}
		{#if (deletionPreview?.blockers ?? []).some((blocker) => blocker.code === 'pending_billing_checkout')}
			<Button
				class="mt-3"
				variant="outline"
				size="sm"
				disabled={actions.busy || cancellingCheckouts}
				onclick={() => void cancelPendingCheckouts(actions)}
				>{m.organization_delete_cancel_pending_checkout()}</Button
			>
		{/if}
	{/snippet}
</ReauthDeleteDialog>
