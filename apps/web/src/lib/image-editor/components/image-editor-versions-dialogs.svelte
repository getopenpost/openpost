<!--
	Version history, restore confirmation, checkpoint and template dialogs for
	the Image Editor. They share one busy state and mutation sequence so a
	stale save or restore cannot clear a newer operation's progress.
-->
<script lang="ts" generics="MutationView">
	import { m } from '$lib/paraglide/messages';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { imageEditorErrorMessage } from '$lib/image-editor/animation-error-message';
	import {
		queryImageEditorRevision,
		queryImageEditorRevisions,
		queryImageEditorTemplates
	} from '$lib/query/image-editor';
	import {
		createImageEditorCheckpoint,
		createImageEditorTemplate,
		deleteImageEditorCheckpoint,
		restoreImageEditorRevision,
		updateImageEditorTemplate
	} from '../api';
	import { useImageEditor } from '../editor.svelte';
	import { clearLocalImageEditorRecovery } from '../recovery';
	import {
		imageEditorRevisionHasChanges,
		summarizeImageEditorRevision,
		type ImageEditorRevisionChanges
	} from '../revision-summary';
	import type {
		ImageEditorDocumentResponse,
		ImageEditorRevisionResponse,
		ImageEditorRevisionSummary,
		ImageEditorTemplate
	} from '../types';
	import CheckpointRemove from './checkpoint-remove.svelte';
	import TemplatePreview from './template-preview.svelte';
	import { apiErrorStatus } from './image-editor-errors';

	let {
		guestMode,
		historyOpen = $bindable(false),
		checkpointOpen = $bindable(false),
		templateOpen = $bindable(false),
		coverPreviewMediaID,
		saveNow,
		captureMutationView,
		mutationViewIsCurrent,
		onconflict,
		onrestored,
		onannounce
	}: {
		guestMode: boolean;
		historyOpen?: boolean;
		checkpointOpen?: boolean;
		templateOpen?: boolean;
		coverPreviewMediaID: () => string;
		saveNow: () => Promise<boolean>;
		captureMutationView: () => MutationView;
		mutationViewIsCurrent: (view: MutationView) => boolean;
		onconflict: () => void;
		onrestored: (response: ImageEditorDocumentResponse) => void;
		onannounce: (message: string) => void;
	} = $props();

	const editor = useImageEditor();
	let revisions = $state<ImageEditorRevisionSummary[]>([]);
	let historyBusy = $state(false);
	let historyPageBusy = $state(false);
	let historyError = $state('');
	let historyMutationSequence = 0;
	let revisionNextCursor = $state('');
	let revisionPreview = $state.raw<ImageEditorRevisionResponse | null>(null);
	let revisionPreviewBusy = $state(false);
	let revisionPreviewPage = $state(0);
	let restoreConfirmOpen = $state(false);
	let revisionPreviewRequest = 0;
	let revisionPreviewController: AbortController | null = null;
	let revisionChanges = $derived.by<ImageEditorRevisionChanges | null>(() =>
		editor.document && revisionPreview
			? summarizeImageEditorRevision(editor.document, revisionPreview.document, {
					currentCoverPreviewMediaID: coverPreviewMediaID(),
					targetCoverPreviewMediaID: revisionPreview.cover_preview_media_id
				})
			: null
	);
	let checkpointName = $state('');
	let templateName = $state('');
	let templateCategory = $state<string>(m.image_editor_workspace_category());
	let templateTargetID = $state('new');
	let workspaceTemplates = $state<ImageEditorTemplate[]>([]);

	export async function openHistory(): Promise<void> {
		if (guestMode) return;
		setHistoryDialogOpen(true);
		invalidateRevisionPreview();
		historyBusy = true;
		historyError = '';
		revisionPreview = null;
		revisionPreviewPage = 0;
		restoreConfirmOpen = false;
		revisionNextCursor = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_checkpoint_save_first());
			const page = await queryImageEditorRevisions(editor.workspaceID, editor.id);
			revisions = page.revisions;
			revisionNextCursor = page.nextCursor ?? '';
		} catch (cause) {
			historyError = imageEditorErrorMessage(cause) ?? m.image_editor_history_load_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function loadMoreRevisions(): Promise<void> {
		if (!revisionNextCursor || historyPageBusy) return;
		historyPageBusy = true;
		historyError = '';
		try {
			const page = await queryImageEditorRevisions(editor.workspaceID, editor.id, {
				cursor: revisionNextCursor
			});
			const known = new Set(revisions.map((revision) => revision.id));
			revisions = [...revisions, ...page.revisions.filter((revision) => !known.has(revision.id))];
			revisionNextCursor = page.nextCursor ?? '';
		} catch (cause) {
			historyError = imageEditorErrorMessage(cause) ?? m.image_editor_history_load_failed();
		} finally {
			historyPageBusy = false;
		}
	}

	function invalidateRevisionPreview(): void {
		revisionPreviewRequest += 1;
		revisionPreviewController?.abort();
		revisionPreviewController = null;
		revisionPreviewBusy = false;
		revisionPreview = null;
	}

	function setHistoryDialogOpen(open: boolean): void {
		if (historyOpen === open) return;
		historyOpen = open;
		invalidateRevisionPreview();
		if (!open) restoreConfirmOpen = false;
	}

	async function inspectRevision(revision: ImageEditorRevisionSummary): Promise<void> {
		revisionPreviewController?.abort();
		const controller = new AbortController();
		revisionPreviewController = controller;
		const request = ++revisionPreviewRequest;
		revisionPreviewBusy = true;
		historyError = '';
		revisionPreviewPage = 0;
		try {
			const preview = await queryImageEditorRevision(
				editor.workspaceID,
				editor.id,
				revision.id,
				controller.signal
			);
			if (request === revisionPreviewRequest) revisionPreview = preview;
		} catch (cause) {
			if (request === revisionPreviewRequest) {
				historyError = imageEditorErrorMessage(cause) ?? m.image_editor_history_load_failed();
			}
		} finally {
			if (request === revisionPreviewRequest) {
				revisionPreviewBusy = false;
				revisionPreviewController = null;
			}
		}
	}

	async function createCheckpoint(): Promise<void> {
		if (!checkpointName.trim()) return;
		const view = captureMutationView();
		const operationSequence = ++historyMutationSequence;
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_checkpoint_save_first());
			await createImageEditorCheckpoint(
				editor.workspaceID,
				editor.id,
				checkpointName.trim(),
				editor.revision
			);
			if (!mutationViewIsCurrent(view)) return;
			checkpointName = '';
			checkpointOpen = false;
			await openHistory();
			onannounce(m.image_editor_checkpoint_created());
		} catch (cause) {
			if (!mutationViewIsCurrent(view)) return;
			if (apiErrorStatus(cause) === 409) {
				checkpointOpen = false;
				setHistoryDialogOpen(false);
				onconflict();
			} else {
				historyError = imageEditorErrorMessage(cause) ?? m.image_editor_checkpoint_failed();
			}
		} finally {
			if (operationSequence === historyMutationSequence) historyBusy = false;
		}
	}

	async function removeCheckpoint(revision: ImageEditorRevisionSummary): Promise<void> {
		if (!editor.canEdit || historyBusy || revision.kind !== 'checkpoint') return;
		const view = captureMutationView();
		const operationSequence = ++historyMutationSequence;
		historyBusy = true;
		try {
			await deleteImageEditorCheckpoint(editor.workspaceID, editor.id, revision.id);
			if (!mutationViewIsCurrent(view)) return;
			revisions = revisions.filter((entry) => entry.id !== revision.id);
			if (revisionPreview?.summary.id === revision.id) invalidateRevisionPreview();
		} finally {
			if (operationSequence === historyMutationSequence) historyBusy = false;
		}
	}

	async function restoreRevision(): Promise<void> {
		if (!revisionPreview || !revisionChanges || !imageEditorRevisionHasChanges(revisionChanges)) {
			return;
		}
		const view = captureMutationView();
		const operationSequence = ++historyMutationSequence;
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_checkpoint_save_first());
			const response = await restoreImageEditorRevision(
				editor.workspaceID,
				editor.id,
				revisionPreview.summary.id,
				editor.revision
			);
			if (!mutationViewIsCurrent(view)) return;
			editor.load(response);
			onrestored(response);
			await clearLocalImageEditorRecovery(editor.id);
			restoreConfirmOpen = false;
			setHistoryDialogOpen(false);
			onannounce(m.image_editor_version_restored());
		} catch (cause) {
			if (!mutationViewIsCurrent(view)) return;
			if (apiErrorStatus(cause) === 409) {
				restoreConfirmOpen = false;
				setHistoryDialogOpen(false);
				onconflict();
			} else {
				historyError = imageEditorErrorMessage(cause) ?? m.image_editor_restore_failed();
			}
		} finally {
			if (operationSequence === historyMutationSequence) historyBusy = false;
		}
	}

	function revisionLabel(revision: ImageEditorRevisionSummary): string {
		if (revision.kind === 'checkpoint') return revision.name || m.image_editor_checkpoint();
		if (revision.kind === 'restore_point') {
			return m.version_restore_point_label({ revision: revision.revision });
		}
		return m.image_editor_autosave_revision({ revision: revision.revision });
	}

	async function saveAsTemplate(): Promise<void> {
		if (!editor.document || !templateName.trim()) return;
		const view = captureMutationView();
		const operationSequence = ++historyMutationSequence;
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_template_save_first());
			const templateInput = {
				name: templateName.trim(),
				category: templateCategory.trim() || m.image_editor_workspace_category(),
				preview_media_id: editor.document.pages[0]?.latest_export_media_id,
				document: editor.document
			};
			if (templateTargetID === 'new') {
				await createImageEditorTemplate({ workspace_id: editor.workspaceID, ...templateInput });
			} else {
				await updateImageEditorTemplate(editor.workspaceID, templateTargetID, templateInput);
			}
			if (!mutationViewIsCurrent(view)) return;
			templateOpen = false;
			templateName = '';
			onannounce(
				templateTargetID === 'new'
					? m.image_editor_template_created()
					: m.image_editor_template_replaced()
			);
		} catch (cause) {
			if (!mutationViewIsCurrent(view)) return;
			historyError = imageEditorErrorMessage(cause) ?? m.image_editor_template_save_failed();
		} finally {
			if (operationSequence === historyMutationSequence) historyBusy = false;
		}
	}

	export async function openTemplateDialog(): Promise<void> {
		historyError = '';
		templateTargetID = 'new';
		templateName = editor.document?.title ?? '';
		templateCategory = m.image_editor_workspace_category();
		templateOpen = true;
		try {
			workspaceTemplates = (await queryImageEditorTemplates(editor.workspaceID)).filter(
				(template) => !template.built_in
			);
		} catch (cause) {
			historyError = imageEditorErrorMessage(cause) ?? m.image_editor_templates_load_failed();
		}
	}

	function selectTemplateTarget(id: string): void {
		templateTargetID = id;
		const template = workspaceTemplates.find((item) => item.id === id);
		if (template) {
			templateName = template.name;
			templateCategory = template.category;
		}
	}
</script>

<Dialog.Root open={historyOpen} onOpenChange={setHistoryDialogOpen}>
	<Dialog.Content class="max-h-[90dvh] overflow-hidden sm:max-w-4xl">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_version_history()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_history_body()}</Dialog.Description>
		</Dialog.Header>
		<div
			class="grid max-h-[65dvh] min-h-72 gap-4 overflow-hidden sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
		>
			<div class="space-y-2 overflow-y-auto pe-1">
				{#if historyBusy && revisions.length === 0}
					<PageLoading layout="list" label={m.image_editor_loading_history()} items={3} />
				{:else if revisions.length === 0}
					<EmptyState
						themeIconRole="history"
						title={m.image_editor_no_history()}
						variant="muted"
						size="sm"
						headingLevel={3}
					/>
				{:else}
					{#each revisions as revision (revision.id)}
						<Button
							multiline
							variant={revisionPreview?.summary.id === revision.id ? 'secondary' : 'outline'}
							class="h-auto min-h-16 w-full justify-start p-3 text-start whitespace-normal"
							disabled={revisionPreviewBusy}
							onclick={() => void inspectRevision(revision)}
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{revisionLabel(revision)}
								</p>
								<p class="mt-0.5 text-xs font-normal text-muted-foreground">
									{new Date(revision.created_at).toLocaleString()}
									{#if revision.expires_at}
										·
										{m.image_editor_expires({
											date: new Date(revision.expires_at).toLocaleDateString()
										})}
									{/if}
								</p>
								<p class="mt-0.5 truncate text-xs font-normal text-muted-foreground">
									{revision.actor.is_current_user
										? m.version_saved_by_you({ actor: revision.actor.name })
										: m.version_saved_by({ actor: revision.actor.name })}
								</p>
							</div>
						</Button>
					{/each}
					{#if revisionNextCursor}
						<Button
							variant="outline"
							class="w-full"
							disabled={historyPageBusy}
							onclick={() => void loadMoreRevisions()}
						>
							{#if historyPageBusy}<ProtectedIcon
									icon="loading"
									class="me-2 size-4 animate-spin motion-reduce:animate-none"
								/>{/if}
							{m.notifications_load_more()}
						</Button>
					{/if}
				{/if}
				{#if historyError}
					<InlineNotice tone="error" message={historyError} />
				{/if}
			</div>
			<section class="min-h-0 overflow-y-auto rounded-lg border bg-muted/20 p-3" aria-live="polite">
				{#if revisionPreviewBusy}
					<div class="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
						<ProtectedIcon
							icon="loading"
							class="me-2 size-4 animate-spin motion-reduce:animate-none"
						/>
						{m.version_preview_loading()}
					</div>
				{:else if !revisionPreview}
					<div
						class="grid min-h-56 place-items-center px-4 text-center text-sm text-muted-foreground"
					>
						{m.version_preview_select()}
					</div>
				{:else}
					<div class="space-y-3">
						<div class="h-52 overflow-hidden rounded-md border bg-neutral-900">
							<TemplatePreview
								document={revisionPreview.document}
								page={revisionPreview.document.pages[revisionPreviewPage]}
								label={revisionLabel(revisionPreview.summary)}
							/>
						</div>
						{#if revisionPreview.document.pages.length > 1}
							<div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
								<Button
									variant="outline"
									size="sm"
									disabled={revisionPreviewPage === 0}
									onclick={() => (revisionPreviewPage = Math.max(0, revisionPreviewPage - 1))}
									>{m.media_previous_page()}</Button
								>
								<span>
									{m.version_preview_page({
										current: revisionPreviewPage + 1,
										total: revisionPreview.document.pages.length
									})}
								</span>
								<Button
									variant="outline"
									size="sm"
									disabled={revisionPreviewPage >= revisionPreview.document.pages.length - 1}
									onclick={() =>
										(revisionPreviewPage = Math.min(
											revisionPreview!.document.pages.length - 1,
											revisionPreviewPage + 1
										))}>{m.media_next_page()}</Button
								>
							</div>
						{/if}
						<div>
							<h3 class="text-sm font-medium">{m.version_changes()}</h3>
							{#if revisionChanges && imageEditorRevisionHasChanges(revisionChanges)}
								<ul class="mt-1 grid gap-1 text-xs text-muted-foreground">
									{#if revisionChanges.titleChanged}<li>{m.version_change_title()}</li>{/if}
									{#if revisionChanges.coverChanged}<li>{m.version_change_cover()}</li>{/if}
									{#if revisionChanges.canvasChanged}<li>{m.version_change_canvas()}</li>{/if}
									{#if revisionChanges.exportSettingsChanged}<li>
											{m.version_change_export()}
										</li>{/if}
									{#if revisionChanges.brandKitChanged}<li>{m.version_change_brand_kit()}</li>{/if}
									{#if revisionChanges.pagesAdded}<li>
											{m.version_change_pages_added({ count: revisionChanges.pagesAdded })}
										</li>{/if}
									{#if revisionChanges.pagesRemoved}<li>
											{m.version_change_pages_removed({ count: revisionChanges.pagesRemoved })}
										</li>{/if}
									{#if revisionChanges.pagesChanged}<li>
											{m.version_change_pages_changed({ count: revisionChanges.pagesChanged })}
										</li>{/if}
									{#if revisionChanges.layersAdded}<li>
											{m.version_change_layers_added({ count: revisionChanges.layersAdded })}
										</li>{/if}
									{#if revisionChanges.layersRemoved}<li>
											{m.version_change_layers_removed({ count: revisionChanges.layersRemoved })}
										</li>{/if}
									{#if revisionChanges.layersChanged}<li>
											{m.version_change_layers_changed({ count: revisionChanges.layersChanged })}
										</li>{/if}
									{#if revisionChanges.guidePagesChanged}<li>
											{m.version_change_guides({ count: revisionChanges.guidePagesChanged })}
										</li>{/if}
								</ul>
							{:else}
								<p class="mt-1 text-xs text-muted-foreground">{m.version_no_changes()}</p>
							{/if}
						</div>
						<Button
							class="w-full"
							disabled={!editor.canEdit ||
								!revisionChanges ||
								!imageEditorRevisionHasChanges(revisionChanges)}
							onclick={() => (restoreConfirmOpen = true)}>{m.version_restore_version()}</Button
						>
						<CheckpointRemove
							revision={revisionPreview.summary}
							canEdit={editor.canEdit}
							disabled={historyBusy || revisionPreviewBusy}
							onremove={removeCheckpoint}
						/>
					</div>
				{/if}
			</section>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => setHistoryDialogOpen(false)}
				>{m.common_close()}</Button
			>
			<Button
				onclick={() => {
					setHistoryDialogOpen(false);
					checkpointOpen = true;
				}}
				disabled={!editor.canEdit}>{m.image_editor_create_checkpoint()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={restoreConfirmOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.version_restore_confirm_title()}</Dialog.Title>
			<Dialog.Description>{m.version_restore_confirm_body()}</Dialog.Description>
		</Dialog.Header>
		{#if revisionPreview}
			<div class="rounded-md border bg-muted/30 p-3 text-sm">
				<p class="font-medium">{revisionLabel(revisionPreview.summary)}</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{new Date(revisionPreview.summary.created_at).toLocaleString()}
				</p>
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (restoreConfirmOpen = false)}>
				{m.common_cancel()}
			</Button>
			<Button
				disabled={historyBusy ||
					!revisionChanges ||
					!imageEditorRevisionHasChanges(revisionChanges)}
				onclick={() => void restoreRevision()}
			>
				{#if historyBusy}<ProtectedIcon
						icon="loading"
						class="animate-spin motion-reduce:animate-none"
					/>{/if}
				{m.version_restore_confirm()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={checkpointOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_create_checkpoint()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_checkpoint_body()}</Dialog.Description>
		</Dialog.Header>
		<label class="grid gap-1.5 text-sm">
			<span class="font-medium">{m.image_editor_checkpoint_name()}</span>
			<Input
				bind:value={checkpointName}
				maxlength={100}
				placeholder={m.image_editor_checkpoint_placeholder()}
			/>
		</label>
		{#if historyError}
			<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
				{historyError}
			</p>
		{/if}
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (checkpointOpen = false)}>{m.common_cancel()}</Button>
			<Button onclick={createCheckpoint} disabled={!checkpointName.trim() || historyBusy}>
				{#if historyBusy}<ProtectedIcon
						icon="loading"
						class="animate-spin motion-reduce:animate-none"
					/>{/if}
				{m.image_editor_create_checkpoint()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={templateOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_save_template()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_template_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3">
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.image_editor_save_behavior()}</span>
				<AppSelect
					value={templateTargetID}
					ariaLabel={m.image_editor_save_behavior()}
					onValueChange={selectTemplateTarget}
					options={[
						{ value: 'new', label: m.image_editor_create_new_template() },
						...workspaceTemplates.map((template) => ({
							value: template.id,
							label: m.image_editor_replace_named_template({ name: template.name })
						}))
					]}
					class="h-10 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.image_editor_template_name()}</span>
				<Input bind:value={templateName} maxlength={120} />
			</label>
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.image_editor_category()}</span>
				<Input bind:value={templateCategory} maxlength={80} />
			</label>
			{#if historyError}
				<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{historyError}
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (templateOpen = false)}>{m.common_cancel()}</Button>
			<Button onclick={saveAsTemplate} disabled={!templateName.trim() || historyBusy}>
				{#if historyBusy}<ProtectedIcon
						icon="loading"
						class="animate-spin motion-reduce:animate-none"
					/>{/if}
				{templateTargetID === 'new'
					? m.image_editor_save_template_action()
					: m.image_editor_replace_template_action()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
