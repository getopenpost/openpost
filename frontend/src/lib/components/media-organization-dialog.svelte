<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import { createMediaTag, deleteMediaTag, updateMediaTag, type MediaTag } from '$lib/media-tags';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';

	let {
		open = $bindable(false),
		workspaceId,
		tags,
		onChanged,
		onNotify
	}: {
		open?: boolean;
		workspaceId: string;
		tags: MediaTag[];
		onChanged: () => void | Promise<void>;
		onNotify?: (message: string, tone?: 'neutral' | 'success' | 'error') => void;
	} = $props();

	let editingId = $state('');
	let name = $state('');
	let saving = $state(false);
	let error = $state('');
	let pendingDelete = $state<MediaTag | null>(null);
	let deleteDialogOpen = $state(false);
	let mutationSequence = 0;

	interface MediaTagMutationView {
		readonly session: QueryMutationSession;
		readonly sequence: number;
		readonly workspaceId: string;
	}

	function captureMediaTagMutationView(): MediaTagMutationView {
		return {
			session: captureQueryMutationSession(),
			sequence: ++mutationSequence,
			workspaceId
		};
	}

	function mediaTagMutationViewIsCurrent(view: MediaTagMutationView): boolean {
		return (
			view.sequence === mutationSequence &&
			view.workspaceId === workspaceId &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function resetForm(): void {
		editingId = '';
		name = '';
		error = '';
	}

	function edit(tag: MediaTag): void {
		editingId = tag.id;
		name = tag.name;
		error = '';
	}

	async function submit(): Promise<void> {
		const nextName = name.trim();
		if (!nextName) return;
		const view = captureMediaTagMutationView();
		const targetID = editingId;
		saving = true;
		error = '';
		try {
			if (targetID) {
				await updateMediaTag(view.workspaceId, targetID, nextName);
				if (!mediaTagMutationViewIsCurrent(view)) return;
				onNotify?.(m.media_tag_updated(), 'success');
			} else {
				await createMediaTag(view.workspaceId, nextName);
				if (!mediaTagMutationViewIsCurrent(view)) return;
				onNotify?.(m.media_tag_created(), 'success');
			}
			resetForm();
			await onChanged();
		} catch (cause) {
			if (!mediaTagMutationViewIsCurrent(view)) return;
			error = cause instanceof Error ? cause.message : m.media_tag_update_failed();
		} finally {
			if (view.sequence === mutationSequence) saving = false;
		}
	}

	function requestDelete(tag: MediaTag): void {
		pendingDelete = tag;
		deleteDialogOpen = true;
	}

	async function confirmDelete(): Promise<DestructiveActionOutcome> {
		const target = pendingDelete;
		if (!target) return { ok: false };
		const view = captureMediaTagMutationView();
		await deleteMediaTag(view.workspaceId, target.id);
		if (!mediaTagMutationViewIsCurrent(view)) return { ok: false };
		if (editingId === target.id) resetForm();
		pendingDelete = null;
		await onChanged();
		if (!mediaTagMutationViewIsCurrent(view)) return { ok: false };
		onNotify?.(m.media_tag_deleted(), 'success');
		return { ok: true };
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{m.media_manage_tags()}</Dialog.Title>
			<Dialog.Description>{m.media_tags_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-5 py-2 sm:grid-cols-[minmax(0,1fr)_15rem]">
			<div class="max-h-96 space-y-1 overflow-y-auto">
				{#each tags as tag (tag.id)}
					<div class="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-muted/60">
						<ThemeIcon role="tag" class="size-4 shrink-0 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-1.5 truncate text-sm font-medium">
								<span class="truncate">{tag.name}</span>
							</p>
							<p class="text-xs text-muted-foreground">
								{m.media_tag_assets({ count: tag.item_count })}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => edit(tag)}
							aria-label={m.media_organization_edit_named({ name: tag.name })}
						>
							<ThemeIcon role="edit" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => requestDelete(tag)}
							aria-label={m.media_organization_delete_named({ name: tag.name })}
						>
							<ThemeIcon role="delete" />
						</Button>
					</div>
				{/each}
				{#if tags.length === 0}
					<p class="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
						{m.media_no_tags()}
					</p>
				{/if}
			</div>

			<form
				class="space-y-3"
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<label class="grid gap-1.5 text-sm font-medium">
					<span>{editingId ? m.media_rename_tag() : m.media_new_tag()}</span>
					<Input bind:value={name} maxlength={64} placeholder={m.media_tag_name()} />
				</label>
				<div class="flex gap-2">
					<Button type="submit" size="sm" disabled={saving || !name.trim()}>
						{#if saving}<ProtectedIcon icon="loading" class="animate-spin" />{/if}
						{editingId ? m.common_save() : m.media_create_tag()}
					</Button>
					{#if editingId}
						<Button type="button" variant="ghost" size="sm" onclick={resetForm}
							>{m.common_cancel()}</Button
						>
					{/if}
				</div>
			</form>
		</div>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	</Dialog.Content>
</Dialog.Root>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.media_delete_tag_title()}
	description={m.media_delete_tag_body({ name: pendingDelete?.name ?? '' })}
	onConfirm={confirmDelete}
/>
