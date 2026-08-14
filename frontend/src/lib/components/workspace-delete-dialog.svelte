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

	type DeletionPreview = components['schemas']['WorkspaceDeletionPreview'];
	type DeletionBlocker = components['schemas']['WorkspaceDeletionBlocker'];

	interface Props {
		open?: boolean;
		workspaceID: string;
		workspaceName: string;
		hasPassword: boolean;
		onConfirm: (confirmation: {
			confirmName: string;
			currentPassword: string;
			reauthGrant?: string;
		}) => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		workspaceID,
		workspaceName,
		hasPassword,
		onConfirm
	}: Props = $props();
	let preview = $state<DeletionPreview | null>(null);
	let confirmName = $state('');
	let currentPassword = $state('');
	let error = $state('');
	let pending = $state(false);
	let loading = $state(false);
	let loadedWorkspaceID = '';
	let hasPasskey = $state(false);
	let reauthProviderID = $state('');

	const blockers = $derived(preview?.blockers ?? []);
	const canDelete = $derived(
		!loading &&
			!pending &&
			preview !== null &&
			blockers.length === 0 &&
			confirmName === preview.workspace_name &&
			(hasPassword ? currentPassword.length > 0 : Boolean(hasPasskey || reauthProviderID))
	);

	function impactMessage(item: string): string {
		switch (item) {
			case 'access':
				return m.workspace_delete_removed_access();
			case 'content':
				return m.workspace_delete_removed_content();
			case 'connected_assets':
				return m.workspace_delete_removed_assets();
			case 'required_records':
				return m.workspace_delete_retained_required_records();
			default:
				return item;
		}
	}

	function blockerMessage(blocker: DeletionBlocker): string {
		switch (blocker.code) {
			case 'final_workspace':
				return m.workspace_delete_blocker_final_workspace();
			case 'active_billing':
				return m.workspace_delete_blocker_active_billing();
			case 'pending_external_writes':
				return m.workspace_delete_blocker_pending_external_writes();
			case 'pending_cleanup':
				return m.workspace_delete_blocker_pending_cleanup();
			default:
				return blocker.message;
		}
	}

	async function loadPreview() {
		if (!workspaceID) return;
		loading = true;
		error = '';
		const [previewResult, securityResult, identitiesResult] = await Promise.all([
			client.GET('/workspaces/{id}/deletion-preview', {
				params: { path: { id: workspaceID } }
			}),
			client.GET('/auth/security'),
			client.GET('/auth/oidc/identities')
		]);
		if (previewResult.error || !previewResult.data) {
			error = previewResult.error?.detail ?? m.workspace_delete_preview_failed();
			preview = null;
		} else {
			preview = previewResult.data;
		}
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

	async function deleteWorkspace() {
		if (!canDelete) return;
		pending = true;
		error = '';
		const grant = hasPassword
			? ''
			: await acquireReauthGrant('workspace.delete', {
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
			await onConfirm({
				confirmName,
				currentPassword,
				reauthGrant: grant || undefined
			});
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workspace_delete_failed();
		} finally {
			pending = false;
		}
	}

	$effect(() => {
		if (!open) {
			loadedWorkspaceID = '';
			return;
		}
		if (!workspaceID || loadedWorkspaceID === workspaceID) return;
		loadedWorkspaceID = workspaceID;
		void loadPreview();
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content aria-busy={loading || pending} showCloseButton={false} class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.workspace_delete_title()}</Dialog.Title>
			<Dialog.Description>{m.workspace_delete_dialog_description()}</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<div class="flex min-h-32 items-center justify-center" aria-label={m.common_loading()}>
				<LoaderIcon class="size-5 animate-spin" />
			</div>
		{:else}
			<div class="space-y-4">
				{#if preview}
					<div class="grid gap-3 sm:grid-cols-2">
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">{m.workspace_delete_removed_title()}</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.removed ?? [] as item (item)}<li>{impactMessage(item)}</li>{/each}
							</ul>
						</section>
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">{m.workspace_delete_retained_title()}</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.retained ?? [] as item (item)}<li>{impactMessage(item)}</li>{/each}
							</ul>
						</section>
					</div>
					<InlineNotice
						tone="warning"
						message={preview.recovery_possible
							? m.workspace_delete_recovery_available()
							: m.workspace_delete_no_recovery()}
					/>
				{/if}

				{#if blockers.length > 0}
					<InlineNotice tone="warning">
						<p class="font-medium">{m.workspace_delete_blockers_title()}</p>
						<ul class="mt-1 list-disc space-y-1 pl-5">
							{#each blockers as blocker (blocker.code)}<li>{blockerMessage(blocker)}</li>{/each}
						</ul>
					</InlineNotice>
				{/if}

				{#if error}<InlineNotice tone="error" message={error} />{/if}

				<div class="space-y-2">
					<Label for="workspace-delete-name"
						>{m.workspace_delete_name_label({
							name: preview?.workspace_name ?? workspaceName
						})}</Label
					>
					<Input
						id="workspace-delete-name"
						bind:value={confirmName}
						autocomplete="off"
						disabled={pending || blockers.length > 0}
					/>
				</div>

				{#if hasPassword}
					<div class="space-y-2">
						<Label for="workspace-delete-password">{m.settings_current_password()}</Label>
						<Input
							id="workspace-delete-password"
							type="password"
							bind:value={currentPassword}
							autocomplete="current-password"
							disabled={pending || blockers.length > 0}
						/>
					</div>
				{:else}
					<InlineNotice tone="info" message={m.settings_step_up_body()} />
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" class="w-full sm:w-auto" disabled={pending} onclick={close}>
				{m.common_cancel()}
			</Button>
			<Button
				variant="destructive"
				class="w-full gap-2 sm:w-auto"
				disabled={!canDelete}
				onclick={deleteWorkspace}
			>
				{#if pending}<LoaderIcon class="size-4 animate-spin" />{/if}
				{m.workspace_delete_confirm()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
