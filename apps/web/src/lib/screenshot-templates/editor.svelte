<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Label } from '$lib/components/ui/label';
	import EditorHeader from '$lib/components/editor-header.svelte';
	import { ToolbarGroup } from '$lib/components/editor-density';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { EditorHistory } from '$lib/editor-history';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { editorHandoffReturnURL } from '$lib/editor-handoff';
	import { completeImageEditorReturnToken } from '$lib/image-editor/api';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { queryClient } from '$lib/query/client';
	import {
		mediaQueryKeys,
		type ScreenshotDesign,
		type ScreenshotDocument
	} from '@openpost/query-catalog';
	import {
		createScreenshotDesign,
		saveScreenshotDesign,
		saveScreenshotExport,
		ScreenshotSaveError
	} from './api';
	import { templateName, TEMPLATE_WIDTH, EXPORT_SCALE, MAX_EXPORT_HEIGHT } from './document';
	import { renderScreenshot, downloadScreenshot, screenshotFilename } from './export';
	import Preview from './preview.svelte';
	import TextField from './text-field.svelte';
	import ConversationFields from './conversation-fields.svelte';
	import ReceiptFields from './receipt-fields.svelte';
	import StatusFields from './status-fields.svelte';
	import MemeFields from './meme-fields.svelte';
	import { memeInput } from './meme';
	import { memeGeneratorAPI, memePreviewDataURL } from '$lib/meme-generator/api';
	import type { MemeGeneratorAPI } from '$lib/meme-generator/types';
	import type { MediaUploadResult } from '$lib/media-upload-client';
	let {
		design,
		returnToken = '',
		onAttach,
		onBack,
		onCopy,
		memeAPI = memeGeneratorAPI
	}: {
		design: ScreenshotDesign;
		returnToken?: string;
		onAttach?: (media: MediaUploadResult) => Promise<boolean>;
		onBack?: () => void;
		onCopy?: (design: ScreenshotDesign) => void;
		memeAPI?: MemeGeneratorAPI;
	} = $props();
	let memePreview = $state('');
	let memePreviewError = $state('');
	let memePreviewLoading = $state(false);
	let previewRetry = $state(0);
	const initial = untrack(() => design);
	let doc = $state.raw<ScreenshotDocument>(initial.document);
	let saved = $state(JSON.stringify(initial.document));
	let revision = $state(initial.revision);
	let saving = $state(false);
	let busy = $state(false);
	let error = $state('');
	let retryAction: () => Promise<void> = save;
	let conflict = $state(false);
	let tab = $state<'content' | 'appearance'>('content');
	let mobileView = $state<'edit' | 'preview'>('edit');
	const narrowScreen = new MediaQuery('(max-width: 1023px)');
	const viewportIsNarrow = $derived(narrowScreen.current);
	let historyVersion = $state(0);
	const history = new EditorHistory<ScreenshotDocument>((value) => structuredClone(value));
	const dirty = $derived(JSON.stringify(doc) !== saved);
	const canUndo = $derived(historyVersion >= 0 && history.canUndo);
	const canRedo = $derived(historyVersion >= 0 && history.canRedo);
	const canEdit = $derived(
		design.can_edit && workspaceCtx.currentWorkspace?.id === design.workspace_id
	);
	let previewElement = $state<HTMLDivElement>();
	let contentElement = $state<HTMLDivElement>();
	let viewportWidth = $state(600);
	let previewHeight = $state(0);
	let contentHeight = $state(0);
	let savePromise: Promise<void> | undefined;
	let mounted = true;
	const exportController = new AbortController();
	const scale = $derived(Math.min(1, Math.max(0.1, (viewportWidth - 40) / TEMPLATE_WIDTH)));
	const frameHeight = $derived(doc.frame === 'square' ? 540 : doc.frame === 'portrait' ? 675 : 0);
	const overflow = $derived(frameHeight > 0 && contentHeight > frameHeight + 1);
	const tooTall = $derived(previewHeight * EXPORT_SCALE > MAX_EXPORT_HEIGHT);
	const backURL = $derived(
		resolveAppPath(
			`/templates${returnToken ? `?return_token=${encodeURIComponent(returnToken)}` : ''}`
		)
	);
	let lastExport:
		| { documentJSON: string; mediaID: string; media: MediaUploadResult; linked: boolean }
		| undefined;
	$effect(() => {
		const meme = doc.meme;
		void previewRetry;
		if (!meme) return;
		const controller = new AbortController();
		memePreviewLoading = true;
		memePreviewError = '';
		const timer = setTimeout(async () => {
			try {
				const result = await memeAPI.preview({
					...memeInput(initial.workspace_id, meme, controller.signal),
					format: 'webp'
				});
				if (!controller.signal.aborted) memePreview = memePreviewDataURL(result);
			} catch (cause) {
				if (!controller.signal.aborted)
					memePreviewError =
						cause instanceof Error ? cause.message : m.meme_generator_preview_failed();
			} finally {
				if (!controller.signal.aborted) memePreviewLoading = false;
			}
		}, 320);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	const exportUnavailable = $derived(
		!!doc.meme && (memePreviewLoading || !!memePreviewError || !memePreview)
	);

	function update(next: ScreenshotDocument, key?: string) {
		if (!canEdit || busy) return;
		history.checkpointShared(m.templates_edit(), doc, next, JSON.stringify(next).length * 2, key);
		doc = next;
		historyVersion++;
	}
	function undo() {
		if (!canEdit || busy) return;
		doc = history.undo(doc);
		historyVersion++;
	}
	function redo() {
		if (!canEdit || busy) return;
		doc = history.redo(doc);
		historyVersion++;
	}
	function failure(cause: unknown, retry: () => Promise<void> = save) {
		retryAction = retry;
		error = cause instanceof Error ? cause.message : m.templates_save_failed();
		conflict = cause instanceof ScreenshotSaveError && cause.status === 409;
	}
	export async function flush(): Promise<boolean> {
		if (busy) return false;
		try {
			await save();
			return !dirty;
		} catch {
			return false;
		}
	}
	async function save(): Promise<void> {
		if (savePromise) return savePromise;
		if (!dirty || !canEdit) return;
		saving = true;
		error = '';
		savePromise = (async () => {
			while (mounted && JSON.stringify(doc) !== saved) {
				const snapshot = doc;
				const response = await saveScreenshotDesign(
					initial.workspace_id,
					initial.id,
					revision,
					snapshot
				);
				revision = response.revision;
				saved = JSON.stringify(snapshot);
			}
		})();
		try {
			await savePromise;
		} catch (cause) {
			failure(cause);
			throw cause;
		} finally {
			saving = false;
			savePromise = undefined;
		}
	}
	$effect(() => {
		const current = doc;
		if (!canEdit || error || !dirty || busy) return;
		const timer = setTimeout(() => {
			void current;
			void save().catch(() => {});
		}, 650);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		const element = previewElement;
		const content = contentElement;
		if (!element || !content) return;
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				previewHeight = element.offsetHeight;
				contentHeight = content.offsetHeight;
			});
		});
		observer.observe(element);
		observer.observe(content);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});
	onMount(() =>
		workspaceCtx.registerWorkspaceSwitchGuard(async () => {
			if (busy) return false;
			try {
				await save();
				return !dirty;
			} catch {
				return false;
			}
		})
	);
	onDestroy(() => {
		mounted = false;
		exportController.abort();
	});
	beforeNavigate((navigation) => {
		if (!dirty && !busy) return;
		if (navigation.willUnload) {
			navigation.cancel();
			return;
		}
		navigation.cancel();
		if (busy || !navigation.to) return;
		const target = navigation.to.url;
		void save()
			.then(() => {
				if (!dirty) void goto(target);
			})
			.catch(() => {});
	});
	async function copy() {
		if (!canEdit || busy) return;
		busy = true;
		error = '';
		try {
			const next = await createScreenshotDesign(initial.workspace_id, doc);
			if (onCopy) {
				saved = JSON.stringify(doc);
				onCopy(next);
				return;
			}
			saved = JSON.stringify(doc);
			busy = false;
			await goto(
				resolveAppPath(
					`/templates/${next.id}${returnToken ? `?return_token=${encodeURIComponent(returnToken)}` : ''}`
				)
			);
		} catch (cause) {
			failure(cause, copy);
		} finally {
			busy = false;
		}
	}
	let exportMenuOpen = $state(false);
	async function exportImage(destination: 'download' | 'media' | 'publication') {
		if (busy || (!doc.meme && !previewElement) || overflow || tooTall || exportUnavailable) return;
		exportMenuOpen = false;
		busy = true;
		error = '';
		try {
			if (canEdit) await save();
			await tick();
			const snapshot = doc;
			const snapshotJSON = JSON.stringify(snapshot);
			const blob = snapshot.meme
				? undefined
				: await renderScreenshot(previewElement!, { contentElement, frameHeight });
			if (!mounted) return;
			if (destination === 'download' && blob) {
				downloadScreenshot(blob, snapshot.title);
				showToast(m.image_editor_export_downloaded(), 'success');
				return;
			}
			if (!canEdit) throw new Error(m.image_editor_read_only());
			if (lastExport?.documentJSON !== snapshotJSON) {
				const media = snapshot.meme
					? (
							await memeAPI.render(
								memeInput(initial.workspace_id, snapshot.meme, exportController.signal)
							)
						).media
					: await uploadMediaFile({
							workspaceId: initial.workspace_id,
							file: new File([blob!], screenshotFilename(snapshot.title), { type: 'image/png' }),
							source: 'screenshot_template',
							signal: exportController.signal
						});
				lastExport = {
					documentJSON: snapshotJSON,
					mediaID: media.id,
					media,
					linked: !!snapshot.meme
				};
			}
			if (!lastExport.linked) {
				await saveScreenshotExport(initial.id, revision, lastExport.mediaID);
				lastExport.linked = true;
			}
			if (!mounted || workspaceCtx.currentWorkspace?.id !== initial.workspace_id) return;
			await queryClient.invalidateQueries({ queryKey: mediaQueryKeys.all(initial.workspace_id) });
			if (destination === 'download') {
				const response = await fetch(`/media/${encodeURIComponent(lastExport.mediaID)}`, {
					signal: exportController.signal
				});
				if (!response.ok) throw new Error(m.image_editor_export_failed());
				downloadScreenshot(await response.blob(), snapshot.title, snapshot.meme?.format);
				showToast(m.image_editor_export_downloaded(), 'success');
				return;
			}
			if (destination === 'media') {
				showToast(m.templates_saved_media(), 'success');
				return;
			}
			if (onAttach) {
				if (!(await onAttach(lastExport.media))) throw new Error(m.meme_generator_attach_failed());
				return;
			}
			let target = resolveAppPath(
				`/?workspace_id=${encodeURIComponent(initial.workspace_id)}&media_id=${encodeURIComponent(lastExport.mediaID)}`
			);
			if (returnToken) {
				const returnURL = await completeImageEditorReturnToken(returnToken, '', [
					lastExport.mediaID
				]);
				target = resolveAppPath(
					`${returnURL}${returnURL.includes('?') ? '&' : '?'}image_editor_return=${encodeURIComponent(returnToken)}`
				);
			}
			busy = false;
			await goto(target);
		} catch (cause) {
			if (mounted) failure(cause, () => exportImage(destination));
		} finally {
			busy = false;
		}
	}
	async function focusField(id: string) {
		mobileView = 'edit';
		tab = 'content';
		await tick();
		const field = document.getElementById(`field-${id}`);
		const control = field?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea,input');
		control?.focus();
		control?.scrollIntoView({ block: 'center', behavior: 'instant' });
	}
	function keyboard(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey)) return;
		if (event.key.toLowerCase() === 's') {
			event.preventDefault();
			void save().catch(() => {});
			return;
		}
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.matches('input,textarea') || target.isContentEditable)
		)
			return;
		if (event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		}
	}
	async function cancelHandoff() {
		const target = editorHandoffReturnURL(returnToken, 'image', 'cancelled');
		if (target) {
			await save();
			await goto(resolveAppPath(target));
		}
	}
</script>

<svelte:window onkeydown={keyboard} />
<div
	class="template-editor editor-density flex min-h-0 flex-1 flex-col"
	class:embedded={!!onAttach}
	aria-busy={busy}
>
	<EditorHeader>
		{#snippet identity()}<Button
				href={onBack ? undefined : backURL}
				onclick={onBack
					? async () => {
							await save()
								.then(() => onBack?.())
								.catch(failure);
						}
					: undefined}
				variant="ghost"
				size="icon-sm"
				aria-label={m.common_back()}><ThemeIcon role="arrow-left" class="size-4" /></Button
			><span class="truncate text-sm font-medium">{m.templates_title()}</span>{/snippet}
		{#snippet workspaces()}<span class="hidden text-xs text-muted-foreground sm:inline"
				>{templateName(doc.template_id)}</span
			>{/snippet}
		{#snippet actions()}<span class="max-w-24 truncate" role="status"
				>{saving ? m.common_saving() : dirty ? m.templates_unsaved() : m.image_editor_saved()}</span
			><ToolbarGroup ariaLabel={m.templates_history()}
				><Button
					size="icon-sm"
					variant="ghost"
					disabled={!canUndo || busy || !canEdit}
					onclick={undo}
					aria-label={m.image_editor_undo()}><ThemeIcon role="undo" class="size-3.5" /></Button
				><Button
					size="icon-sm"
					variant="ghost"
					disabled={!canRedo || busy || !canEdit}
					onclick={redo}
					aria-label={m.image_editor_redo()}><ThemeIcon role="redo" class="size-3.5" /></Button
				></ToolbarGroup
			>{/snippet}
	</EditorHeader>
	<div class="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2">
		<div class="flex gap-1 lg:hidden">
			<Button
				variant={mobileView === 'edit' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => (mobileView = 'edit')}
				aria-pressed={mobileView === 'edit'}>{m.common_edit()}</Button
			><Button
				variant={mobileView === 'preview' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => (mobileView = 'preview')}
				aria-pressed={mobileView === 'preview'}>{m.templates_preview()}</Button
			>
		</div>
		<div class="hidden text-xs text-muted-foreground lg:block">{m.templates_editor_hint()}</div>
		<div class="flex items-center gap-2">
			{#if (!viewportIsNarrow || !canEdit) && (!doc.meme || canEdit)}
				<Button
					variant="outline"
					size="sm"
					disabled={busy ||
						exportUnavailable ||
						overflow ||
						tooTall ||
						(!doc.meme && !previewElement)}
					onclick={() => exportImage('download')}
					><ThemeIcon role="download" class="size-3.5" />{m.image_editor_download()}</Button
				>
			{/if}
			{#if canEdit}
				{#if !viewportIsNarrow}<Button
						variant="outline"
						size="sm"
						disabled={busy || exportUnavailable || overflow || tooTall}
						onclick={() => exportImage('media')}>{m.templates_save_media()}</Button
					>{/if}
				<Button
					size="sm"
					disabled={busy || exportUnavailable || overflow || tooTall}
					onclick={() => exportImage('publication')}
					>{returnToken ? m.templates_return_publication() : m.templates_add_publication()}</Button
				>
				{#if viewportIsNarrow}<DropdownMenu.Root bind:open={exportMenuOpen}
						><DropdownMenu.Trigger
							>{#snippet child({ props })}<Button
									{...props}
									variant="outline"
									size="icon-sm"
									aria-label={m.image_editor_more_actions()}
									><ThemeIcon role="more-horizontal" class="size-4" /></Button
								>{/snippet}</DropdownMenu.Trigger
						><DropdownMenu.Content align="end">
							<DropdownMenu.Item
								disabled={busy ||
									exportUnavailable ||
									overflow ||
									tooTall ||
									(!doc.meme && !previewElement)}
								onclick={() => exportImage('download')}
								><ThemeIcon
									role="download"
									class="size-4"
								/>{m.image_editor_download()}</DropdownMenu.Item
							>
							<DropdownMenu.Item
								disabled={busy || exportUnavailable || overflow || tooTall}
								onclick={() => exportImage('media')}
								><ThemeIcon
									role="media"
									class="size-4"
								/>{m.templates_save_media()}</DropdownMenu.Item
							>
						</DropdownMenu.Content></DropdownMenu.Root
					>{/if}
			{/if}
		</div>
	</div>
	{#if error}<div class="p-3">
			<InlineNotice tone="error" message={conflict ? m.templates_conflict() : error}
				>{#snippet actions()}<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => retryAction().catch(() => {})}>{m.common_retry()}</Button
					>{#if canEdit}<Button variant="outline" size="sm" disabled={busy} onclick={copy}
							>{m.image_editor_save_copy()}</Button
						>{/if}{/snippet}</InlineNotice
			>
		</div>{/if}
	{#if !canEdit}<InlineNotice message={m.image_editor_read_only()} />{/if}
	{#if overflow || tooTall}<div class="px-3 py-2">
			<InlineNotice
				tone="warning"
				message={tooTall ? m.templates_too_tall() : m.templates_overflow()}
			/>
		</div>{/if}
	<div class="editor-body min-h-0 flex-1">
		<aside
			class:hidden-mobile={mobileView !== 'edit'}
			inert={mobileView !== 'edit' && viewportIsNarrow}
			class="fields-panel min-w-0 overflow-y-auto border-r bg-card"
			aria-label={m.templates_content()}
		>
			{#if !doc.meme}<div class="sticky top-0 z-10 flex border-b bg-card px-3 py-2">
					<Button
						variant={tab === 'content' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={tab === 'content'}
						onclick={() => (tab = 'content')}>{m.templates_content()}</Button
					><Button
						variant={tab === 'appearance' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={tab === 'appearance'}
						onclick={() => (tab = 'appearance')}>{m.templates_appearance()}</Button
					>
				</div>
			{/if}
			<fieldset disabled={!canEdit || busy} class="min-w-0 space-y-5 p-4">
				{#if tab === 'content' || doc.meme}
					<TextField
						label={m.templates_design_name()}
						value={doc.title}
						maxlength={150}
						oninput={(title) => update({ ...doc, title }, 'title')}
					/>
					{#if doc.meme}<MemeFields
							workspaceId={design.workspace_id}
							value={doc.meme}
							onchange={(meme, key) => update({ ...doc, meme }, key)}
						/>{:else if doc.conversation}<ConversationFields
							workspaceId={design.workspace_id}
							value={doc.conversation}
							onchange={(conversation, key) => update({ ...doc, conversation }, key)}
						/>{:else if doc.receipt}<ReceiptFields
							value={doc.receipt}
							onchange={(receipt, key) => update({ ...doc, receipt }, key)}
						/>{:else if doc.status_page}<StatusFields
							value={doc.status_page}
							onchange={(status_page, key) => update({ ...doc, status_page }, key)}
						/>{/if}
				{:else}
					<div class="space-y-1.5">
						<Label for="template-appearance">{m.templates_appearance()}</Label><AppSelect
							id="template-appearance"
							value={doc.appearance}
							options={[
								{ value: 'light', label: m.templates_light() },
								{ value: 'dark', label: m.templates_dark() }
							]}
							onValueChange={(appearance) => {
								if (appearance === 'light' || appearance === 'dark') update({ ...doc, appearance });
							}}
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="template-frame">{m.templates_frame()}</Label><AppSelect
							id="template-frame"
							value={doc.frame}
							options={[
								{ value: 'natural', label: m.templates_natural() },
								{ value: 'square', label: m.templates_square() },
								{ value: 'portrait', label: m.templates_portrait() }
							]}
							onValueChange={(frame) => {
								if (frame === 'natural' || frame === 'square' || frame === 'portrait')
									update({ ...doc, frame });
							}}
						/>
						<p class="text-xs text-muted-foreground">{m.templates_frame_help()}</p>
					</div>
					<div class="space-y-1.5">
						<Label for="template-text-size">{m.templates_text_size()}</Label><AppSelect
							id="template-text-size"
							value={doc.text_size}
							options={[
								{ value: 'small', label: m.templates_small() },
								{ value: 'normal', label: m.templates_normal() },
								{ value: 'large', label: m.templates_large() }
							]}
							onValueChange={(text_size) => {
								if (text_size === 'small' || text_size === 'normal' || text_size === 'large')
									update({ ...doc, text_size });
							}}
						/>
					</div>
				{/if}
			</fieldset>
			{#if returnToken}<div class="border-t p-4">
					<Button
						variant="outline"
						class="w-full"
						disabled={busy}
						onclick={() => cancelHandoff().catch(failure)}>{m.common_cancel()}</Button
					>
				</div>{/if}
		</aside>
		<section
			class:hidden-mobile={mobileView !== 'preview'}
			inert={mobileView !== 'preview' && viewportIsNarrow}
			class="preview-panel min-w-0 overflow-y-auto bg-muted/40"
			aria-label={m.templates_preview()}
		>
			{#if doc.meme}
				<div
					class="flex min-h-full flex-col items-center justify-center gap-3 p-5"
					aria-busy={memePreviewLoading}
				>
					{#if memePreviewLoading}<p role="status" class="text-sm text-muted-foreground">
							{m.meme_generator_preview_loading()}
						</p>{/if}
					{#if memePreviewError}<InlineNotice tone="error" message={memePreviewError}
							>{#snippet actions()}<Button variant="outline" onclick={() => previewRetry++}
									>{m.common_retry()}</Button
								>{/snippet}</InlineNotice
						>{/if}
					{#if memePreview}<img
							src={memePreview}
							alt={doc.meme.alt_text || doc.title}
							class="max-h-[75dvh] max-w-full object-contain"
							class:opacity-50={memePreviewLoading}
						/>{/if}
				</div>
			{:else}
				<div bind:clientWidth={viewportWidth} class="flex min-h-full flex-col items-center py-5">
					<div
						class="mb-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground"
					>
						<span>{m.templates_preview()}</span><span>·</span><span
							>{TEMPLATE_WIDTH * EXPORT_SCALE} × {Math.ceil(previewHeight * EXPORT_SCALE)} px</span
						>
					</div>
					<div
						class="relative shrink-0"
						style:width="{TEMPLATE_WIDTH * scale}px"
						style:height="{previewHeight * scale}px"
					>
						<div
							class="absolute top-0 left-0 origin-top-left ring-1 ring-border"
							style:transform="scale({scale})"
						>
							<Preview
								document={doc}
								onselect={focusField}
								bind:element={previewElement}
								bind:contentElement
							/>
						</div>
					</div>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.template-editor {
		height: calc(100dvh - 64px);
		min-height: 440px;
	}
	.template-editor.embedded {
		height: 100%;
		min-height: 0;
	}
	.editor-body {
		display: grid;
		grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
	}
	@media (max-width: 1023px) {
		.editor-body {
			grid-template-columns: minmax(0, 1fr);
		}
		.hidden-mobile {
			position: absolute !important;
			opacity: 0;
			pointer-events: none;
			width: calc(100% - 32px);
			height: 0;
			overflow: hidden !important;
		}
		.fields-panel {
			border-right: 0;
		}
		.template-editor {
			min-height: calc(100dvh - 64px);
		}
	}
</style>
