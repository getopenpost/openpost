<script lang="ts">
	import ReauthDeleteDialog, {
		type ReauthDeletePreviewSummary
	} from '$lib/components/reauth-delete-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { client } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type DeletionPreview = components['schemas']['WorkspaceDeletionPreview'];
	type DeletionBlocker = components['schemas']['WorkspaceDeletionBlocker'];

	interface Props {
		open?: boolean;
		workspaceID: string;
		workspaceName: string;
		hasPassword: boolean;
		onConfirm: (
			workspaceID: string,
			confirmation: {
				confirmName: string;
				currentPassword: string;
				reauthGrant?: string;
			}
		) => void | boolean | Promise<void | boolean>;
	}

	let {
		open = $bindable(false),
		workspaceID,
		workspaceName,
		hasPassword,
		onConfirm
	}: Props = $props();
	let deletionPreview = $state<DeletionPreview | null>(null);

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

	async function loadWorkspacePreview(
		targetWorkspaceID: string,
		isCurrent: () => boolean
	): Promise<ReauthDeletePreviewSummary> {
		deletionPreview = null;
		const previewResult = await client.GET('/workspaces/{id}/deletion-preview', {
			params: { path: { id: targetWorkspaceID } }
		});
		if (previewResult.error || !previewResult.data) {
			throw new Error(previewResult.error?.detail ?? m.workspace_delete_preview_failed());
		}
		if (!isCurrent()) return { blockers: [], expectedConfirm: '' };
		deletionPreview = previewResult.data;
		return {
			blockers: (previewResult.data.blockers ?? []).map((blocker) => ({
				key: blocker.code,
				message: blockerMessage(blocker)
			})),
			expectedConfirm: previewResult.data.workspace_name
		};
	}
</script>

<ReauthDeleteDialog
	bind:open
	entityID={workspaceID}
	title={m.workspace_delete_title()}
	description={m.workspace_delete_dialog_description()}
	confirmInputID="workspace-delete-name"
	confirmLabelFor={(name) => m.workspace_delete_name_label({ name: name || workspaceName })}
	passwordInputID="workspace-delete-password"
	{hasPassword}
	reauthAction="workspace.delete"
	previewLoader={loadWorkspacePreview}
	blockerTitle={m.workspace_delete_blockers_title()}
	confirmButtonLabel={m.workspace_delete_confirm()}
	fallbackPreviewError={m.workspace_delete_preview_failed()}
	fallbackDeleteError={m.workspace_delete_failed()}
	onDelete={(payload) =>
		onConfirm(workspaceID, {
			confirmName: payload.confirmText,
			currentPassword: payload.currentPassword,
			reauthGrant: payload.reauthGrant
		})}
>
	{#snippet preview()}
		{#if deletionPreview}
			<div class="grid gap-3 sm:grid-cols-2">
				<section class="rounded-md border p-3">
					<p class="text-sm font-medium">
						{m.workspace_delete_removed_title()}
					</p>
					<ul class="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						{#each deletionPreview.removed ?? [] as item (item)}<li>
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
			<InlineNotice
				tone="warning"
				message={deletionPreview.recovery_possible
					? m.workspace_delete_recovery_available()
					: m.workspace_delete_no_recovery()}
			/>
		{/if}
	{/snippet}
</ReauthDeleteDialog>
