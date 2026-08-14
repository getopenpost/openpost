<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { client } from '$lib/api/client';
	import { acquireReauthGrant } from '$lib/auth/reauth';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type Preview = components['schemas']['OrganizationDeletionPreview'];
	type Blocker = components['schemas']['WorkspaceDeletionBlocker'];

	interface Props {
		open?: boolean;
		organizationID: string;
		organizationName: string;
		hasPassword: boolean;
		onConfirm: (confirmation: {
			confirmName: string;
			currentPassword: string;
			reauthGrant?: string;
		}) => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		organizationID,
		organizationName,
		hasPassword,
		onConfirm
	}: Props = $props();
	let preview = $state<Preview | null>(null);
	let confirmName = $state('');
	let currentPassword = $state('');
	let error = $state('');
	let pending = $state(false);
	let loading = $state(false);
	let loadedOrganizationID = '';
	let hasPasskey = $state(false);
	let reauthProviderID = $state('');

	const blockers = $derived(preview?.blockers ?? []);
	const canDelete = $derived(
		!loading &&
			!pending &&
			preview !== null &&
			blockers.length === 0 &&
			confirmName === preview.organization_name &&
			(hasPassword ? currentPassword.length > 0 : Boolean(hasPasskey || reauthProviderID))
	);

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

	async function loadPreview() {
		if (!organizationID) return;
		loading = true;
		error = '';
		const [previewResult, securityResult, identitiesResult] = await Promise.all([
			client.GET('/organizations/{id}/deletion-preview', {
				params: { path: { id: organizationID } }
			}),
			client.GET('/auth/security'),
			client.GET('/auth/oidc/identities')
		]);
		if (previewResult.error || !previewResult.data) {
			error = previewResult.error?.detail ?? m.organization_delete_preview_failed();
			preview = null;
		} else preview = previewResult.data;
		hasPasskey = (securityResult.data?.passkeys?.length ?? 0) > 0;
		reauthProviderID =
			identitiesResult.data?.find((identity) => identity.active)?.provider_id ?? '';
		loading = false;
	}

	function close() {
		if (pending) return;
		open = false;
		error = '';
		confirmName = '';
		currentPassword = '';
	}

	async function deleteOrganization() {
		if (!canDelete) return;
		pending = true;
		error = '';
		const grant = hasPassword
			? ''
			: await acquireReauthGrant('organization.delete', {
					providerID: reauthProviderID,
					hasPasskey
				}).catch((cause: Error) => {
					error = cause.message;
					return undefined;
				});
		if (grant === null || grant === undefined) {
			pending = false;
			return;
		}
		try {
			await onConfirm({ confirmName, currentPassword, reauthGrant: grant || undefined });
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.organization_delete_failed();
		} finally {
			pending = false;
		}
	}

	async function cancelPendingCheckouts() {
		pending = true;
		error = '';
		const result = await client.DELETE('/organizations/{id}/billing-checkout-attempts/pending', {
			params: { path: { id: organizationID } }
		});
		if (result.error) error = result.error.detail ?? m.organization_delete_checkout_cancel_failed();
		else await loadPreview();
		pending = false;
	}

	$effect(() => {
		if (!open) {
			loadedOrganizationID = '';
			return;
		}
		if (!organizationID || loadedOrganizationID === organizationID) return;
		loadedOrganizationID = organizationID;
		void loadPreview();
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		aria-busy={loading || pending}
		showCloseButton={false}
		class="max-h-[90vh] overflow-y-auto sm:max-w-xl"
	>
		<Dialog.Header>
			<Dialog.Title>{m.organization_delete_title()}</Dialog.Title>
			<Dialog.Description>{m.organization_delete_dialog_description()}</Dialog.Description>
		</Dialog.Header>
		{#if loading}
			<div class="flex min-h-32 items-center justify-center" aria-label={m.common_loading()}>
				<LoaderIcon class="size-5 animate-spin" />
			</div>
		{:else}
			<div class="space-y-4">
				{#if preview}
					<section class="rounded-md border p-3">
						<p class="text-sm font-medium">{m.organization_delete_workspaces_title()}</p>
						<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
							{#each preview.workspaces ?? [] as workspace (workspace.workspace_id)}<li>
									{workspace.workspace_name}
								</li>{/each}
						</ul>
					</section>
					<div class="grid gap-3 sm:grid-cols-2">
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">{m.organization_delete_state_title()}</p>
							<p class="mt-2 text-sm text-muted-foreground">
								{m.organization_delete_billing_state({
									state: billingStateLabel(preview.billing_state)
								})}
							</p>
							<ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								<li>
									{m.organization_delete_pending_provider_writes({
										count: preview.pending_work.pending_provider_writes ?? 0
									})}
								</li>
								<li>
									{m.organization_delete_pending_jobs({
										count: preview.pending_work.pending_jobs ?? 0
									})}
								</li>
								<li>
									{m.organization_delete_pending_cleanup_jobs({
										count: preview.pending_work.pending_cleanup_jobs ?? 0
									})}
								</li>
							</ul>
						</section>
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">{m.organization_delete_access_title()}</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.access_effects ?? [] as item (item)}<li>
										{impactMessage(item)}
									</li>{/each}
							</ul>
						</section>
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">{m.workspace_delete_removed_title()}</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.irreversible_loss ?? [] as item (item)}<li>
										{impactMessage(item)}
									</li>{/each}
							</ul>
						</section>
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">{m.workspace_delete_retained_title()}</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.retained ?? [] as item (item)}<li>{impactMessage(item)}</li>{/each}
							</ul>
						</section>
					</div>
					<InlineNotice tone="warning" message={m.organization_delete_no_recovery()} />
				{/if}
				{#if blockers.length > 0}
					<InlineNotice tone="warning"
						><p class="font-medium">{m.workspace_delete_blockers_title()}</p>
						<ul class="mt-1 list-disc space-y-1 pl-5">
							{#each blockers as blocker (blocker.code)}<li>{blockerMessage(blocker)}</li>{/each}
						</ul>
						{#if blockers.some((blocker) => blocker.code === 'pending_billing_checkout')}
							<Button
								class="mt-3"
								variant="outline"
								size="sm"
								disabled={pending}
								onclick={cancelPendingCheckouts}
								>{m.organization_delete_cancel_pending_checkout()}</Button
							>
						{/if}</InlineNotice
					>
				{/if}
				{#if error}<InlineNotice tone="error" message={error} />{/if}
				<div class="space-y-2">
					<Label for="organization-delete-name"
						>{m.organization_delete_name_label({
							name: preview?.organization_name ?? organizationName
						})}</Label
					>
					<Input
						id="organization-delete-name"
						bind:value={confirmName}
						autocomplete="off"
						disabled={pending || blockers.length > 0}
					/>
				</div>
				{#if hasPassword}
					<div class="space-y-2">
						<Label for="organization-delete-password">{m.settings_current_password()}</Label><Input
							id="organization-delete-password"
							type="password"
							bind:value={currentPassword}
							autocomplete="current-password"
							disabled={pending || blockers.length > 0}
						/>
					</div>
				{:else}<InlineNotice tone="info" message={m.settings_step_up_body()} />{/if}
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" class="w-full sm:w-auto" disabled={pending} onclick={close}
				>{m.common_cancel()}</Button
			>
			<Button
				variant="destructive"
				class="w-full gap-2 sm:w-auto"
				disabled={!canDelete}
				onclick={deleteOrganization}
				>{#if pending}<LoaderIcon
						class="size-4 animate-spin"
					/>{/if}{m.organization_delete_confirm()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
