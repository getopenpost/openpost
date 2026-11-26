<!--
	Image Editor export: encoded preview, size budget, format settings,
	destination choice, resumable media uploads, attach handoff and the guest
	download toast. The shell owns saving and status announcements.
-->
<script lang="ts" generics="MutationView">
	import { onDestroy, untrack } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { imageEditorErrorMessage } from '$lib/image-editor/animation-error-message';
	import { completeImageEditorReturnToken } from '../api';
	import { imageEditorPageAnimations } from '../animation';
	import { imageEditorPageHasTransparency } from '../document';
	import { useImageEditor } from '../editor.svelte';
	import { imageEditorExportBudget } from '../export-budget';
	import {
		imageEditorPageExportFingerprint,
		reusableImageEditorExports,
		type ImageEditorExportResumeLedger
	} from '../export-resume';
	import { imageEditorPageDimensions } from '../page-dimensions';
	import {
		publicImageEditorPageCountBucket,
		trackPublicImageEditorEvent
	} from '../public-telemetry';
	import { parseImageEditorExportResumeLedger } from '../shell-storage';
	import {
		downloadRenderedPages,
		renderImageEditorPages,
		type ImageEditorRenderedPage
	} from '../static-renderer';
	import { startImageEditorMetric } from '../telemetry';
	import type { ImageEditorDocument } from '../types';

	const EXPORT_PREVIEW_DEBOUNCE_MS = 250;
	const EXPORT_QUALITY_DECIMAL_PLACES = 2;

	let {
		open = $bindable(false),
		guestMode,
		returnToken,
		coverHandoff,
		attachLabel,
		isViewActive,
		saveNow,
		captureMutationView,
		mutationViewIsCurrent,
		onexported,
		onannounce,
		onsaveguest
	}: {
		open?: boolean;
		guestMode: boolean;
		returnToken: string;
		coverHandoff: boolean;
		attachLabel: string;
		isViewActive: () => boolean;
		saveNow: (
			coverPreviewMediaID?: string,
			recoveryReason?: 'idle' | 'export' | 'close'
		) => Promise<boolean>;
		captureMutationView: () => MutationView;
		mutationViewIsCurrent: (view: MutationView) => boolean;
		/** Announces a completed export and suppresses the following saved status. */
		onexported: (message: string) => void;
		onannounce: (message: string) => void;
		onsaveguest: () => void;
	} = $props();

	const editor = useImageEditor();

	let exportMode = $state<'download' | 'media' | 'attach'>('download');
	let exportAllPages = $state(true);
	let exportBusy = $state(false);
	let exportProgress = $state('');
	let exportError = $state('');
	let exportSuccessfulByPage = $state.raw<Record<string, string>>({});
	let exportResumeLedger = $state.raw<ImageEditorExportResumeLedger>({});
	let exportAbort: AbortController | null = null;
	let exportPreview = $state.raw<{
		document: ImageEditorDocument;
		pageIDsKey: string;
		pages: ImageEditorRenderedPage[];
		objectURL: string;
		totalBytes: number;
	} | null>(null);
	let exportPreviewBusy = $state(false);
	let exportPreviewError = $state('');
	let exportPreviewProgress = $state('');
	let exportPreviewGeneration = 0;
	let exportPreviewTimer: ReturnType<typeof setTimeout> | undefined;
	let exportPreviewTask: Promise<void> | null = null;
	let exportPreviewAbort: AbortController | null = null;
	let toastVisible = $state(false);

	let exportPages = $derived.by(() => {
		if (!editor.document) return [];
		return exportAllPages && !(coverHandoff && exportMode === 'attach')
			? editor.document.pages
			: editor.document.pages.filter((page) => page.id === editor.activePageID);
	});
	let exportHasTransparency = $derived(exportPages.some(imageEditorPageHasTransparency));
	let exportFormat = $derived(editor.document?.export_defaults.format ?? 'png');
	let exportSupportsTransparency = $derived(exportFormat !== 'jpeg');
	let exportPixelCount = $derived(
		editor.document
			? exportPages.reduce((total, page) => {
					const size = imageEditorPageDimensions(editor.document!, page);
					return total + size.width * size.height;
				}, 0)
			: 0
	);
	let exportSizeLabel = $derived.by(() => {
		if (!editor.document || exportPages.length === 0) return '';
		const first = imageEditorPageDimensions(editor.document, exportPages[0]);
		return exportPages.every((page) => {
			const size = imageEditorPageDimensions(editor.document!, page);
			return size.width === first.width && size.height === first.height;
		})
			? `${first.width} × ${first.height}`
			: m.image_editor_mixed_sizes();
	});
	let exportBudget = $derived(
		editor.document
			? imageEditorExportBudget(
					editor.document,
					exportPages.map((page) => page.id)
				)
			: null
	);

	function exportPageIDsKey(pageIDs: readonly string[]): string {
		return pageIDs.join('\u0000');
	}

	function clearEncodedExportPreview(): void {
		if (exportPreview) URL.revokeObjectURL(exportPreview.objectURL);
		exportPreview = null;
	}

	async function prepareEncodedExportPreview(
		document: ImageEditorDocument,
		pageIDs: string[],
		pageIDsKey: string,
		generation: number,
		controller: AbortController
	): Promise<void> {
		try {
			const pages = await renderImageEditorPages(
				document,
				pageIDs,
				(done, total) => {
					if (generation !== exportPreviewGeneration) return;
					exportPreviewProgress = m.image_editor_export_preview_encoding_progress({
						done,
						total
					});
				},
				controller.signal
			);
			controller.signal.throwIfAborted();
			if (generation !== exportPreviewGeneration || pages.length === 0) return;
			const objectURL = URL.createObjectURL(pages[0].blob);
			if (generation !== exportPreviewGeneration || controller.signal.aborted) {
				URL.revokeObjectURL(objectURL);
				return;
			}
			clearEncodedExportPreview();
			exportPreview = {
				document,
				pageIDsKey,
				pages,
				objectURL,
				totalBytes: pages.reduce((total, page) => total + page.blob.size, 0)
			};
		} catch (cause) {
			if (
				generation !== exportPreviewGeneration ||
				(cause instanceof DOMException && cause.name === 'AbortError')
			)
				return;
			exportPreviewError = imageEditorErrorMessage(cause) || m.image_editor_export_preview_failed();
		} finally {
			if (generation === exportPreviewGeneration) {
				exportPreviewBusy = false;
				exportPreviewProgress = '';
			}
		}
	}

	async function queueEncodedExportPreview(
		document: ImageEditorDocument,
		pageIDs: string[],
		pageIDsKey: string,
		generation: number
	): Promise<void> {
		if (exportPreviewTask) await exportPreviewTask.catch(() => undefined);
		if (generation !== exportPreviewGeneration || !isViewActive()) return;
		const controller = new AbortController();
		exportPreviewAbort = controller;
		const task = prepareEncodedExportPreview(document, pageIDs, pageIDsKey, generation, controller);
		exportPreviewTask = task;
		try {
			await task;
		} finally {
			if (exportPreviewTask === task) exportPreviewTask = null;
			if (exportPreviewAbort === controller) exportPreviewAbort = null;
		}
	}

	function restartEncodedExportPreview(
		document: ImageEditorDocument | null,
		pageIDs: string[],
		allowed: boolean
	): void {
		exportPreviewGeneration++;
		const generation = exportPreviewGeneration;
		if (exportPreviewTimer) clearTimeout(exportPreviewTimer);
		exportPreviewTimer = undefined;
		exportPreviewAbort?.abort();
		clearEncodedExportPreview();
		exportPreviewError = '';
		exportPreviewProgress = '';
		exportPreviewBusy = false;
		if (!open || !document || !allowed || pageIDs.length === 0) return;

		exportPreviewBusy = true;
		exportPreviewProgress = m.image_editor_export_preview_encoding();
		const pageIDsKey = exportPageIDsKey(pageIDs);
		exportPreviewTimer = setTimeout(() => {
			exportPreviewTimer = undefined;
			void queueEncodedExportPreview(document, pageIDs, pageIDsKey, generation);
		}, EXPORT_PREVIEW_DEBOUNCE_MS);
	}

	$effect(() => {
		const document = editor.document;
		const pageIDs = exportPages.map((page) => page.id);
		const allowed = exportBudget?.allowed ?? false;
		const isOpen = open;
		untrack(() => restartEncodedExportPreview(isOpen ? document : null, pageIDs, allowed));
	});

	function retryEncodedExportPreview(): void {
		const document = editor.document;
		const pageIDs = exportPages.map((page) => page.id);
		restartEncodedExportPreview(document, pageIDs, exportBudget?.allowed ?? false);
	}

	function preparedExportPages(
		document: ImageEditorDocument,
		pageIDs: readonly string[]
	): ImageEditorRenderedPage[] | null {
		return exportPreview?.document === document &&
			exportPreview.pageIDsKey === exportPageIDsKey(pageIDs)
			? exportPreview.pages
			: null;
	}

	function formattedExportBytes(bytes: number): string {
		return new Intl.NumberFormat(getLocaleTag()).format(bytes);
	}

	$effect(() => {
		if (
			coverHandoff &&
			exportMode === 'attach' &&
			['webp', 'gif'].includes(editor.document?.export_defaults.format ?? '')
		) {
			editor.mutate('Change cover export format', (document) => {
				document.export_defaults.format = 'png';
			});
		}
	});

	export function openExport(mode: 'download' | 'media' | 'attach'): void {
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
		exportMode = guestMode ? 'download' : mode;
		exportError = '';
		loadExportResumeLedger();
		open = true;
	}

	function exportResumeKey(): string {
		return `openpost-image-editor-export-v1:${editor.id}:${exportMode}:${editor.document?.export_defaults.format ?? 'png'}`;
	}

	function loadExportResumeLedger(): void {
		if (!editor.document || exportMode === 'download') {
			exportResumeLedger = {};
			exportSuccessfulByPage = {};
			return;
		}
		try {
			exportResumeLedger = parseImageEditorExportResumeLedger(
				sessionStorage.getItem(exportResumeKey()) || '{}'
			);
		} catch {
			exportResumeLedger = {};
		}
		exportSuccessfulByPage = reusableImageEditorExports(editor.document, exportResumeLedger);
	}

	function storeExportResumeLedger(): void {
		if (exportMode === 'download') return;
		try {
			sessionStorage.setItem(exportResumeKey(), JSON.stringify(exportResumeLedger));
		} catch {
			// Resume state is optional when session storage is unavailable.
		}
	}

	function clearExportResumeLedger(): void {
		try {
			sessionStorage.removeItem(exportResumeKey());
		} catch {
			// Session storage may be unavailable in hardened browser contexts.
		}
		exportResumeLedger = {};
		exportSuccessfulByPage = {};
	}

	async function exportDesign(): Promise<void> {
		if (!editor.document || exportBusy) return;
		if (!exportBudget?.allowed) {
			exportError = m.image_editor_export_budget_exceeded();
			return;
		}
		const pageIDs =
			exportAllPages && !(coverHandoff && exportMode === 'attach')
				? editor.document.pages.map((page) => page.id)
				: [editor.activePageID];
		const preparedPages = preparedExportPages(editor.document, pageIDs);
		if (!preparedPages) {
			exportError = m.image_editor_export_preview_required();
			return;
		}
		const view = captureMutationView();
		exportBusy = true;
		const controller = new AbortController();
		exportAbort = controller;
		const finishMetric = startImageEditorMetric('export');
		exportError = '';
		exportProgress = m.image_editor_export_saving();
		try {
			const saved = await saveNow();
			if (!mutationViewIsCurrent(view)) return;
			if (!saved && exportMode !== 'download') {
				throw new Error(m.image_editor_export_save_first());
			}
			if (exportMode !== 'download') loadExportResumeLedger();
			const pagesToRender =
				exportMode === 'download'
					? pageIDs
					: pageIDs.filter((pageID) => !exportSuccessfulByPage[pageID]);
			const rendered = preparedPages.filter((page) => pagesToRender.includes(page.page.id));
			controller.signal.throwIfAborted();
			if (!mutationViewIsCurrent(view)) return;
			if (exportMode === 'download') {
				await downloadRenderedPages(rendered, editor.document.title, controller.signal);
				controller.signal.throwIfAborted();
				if (!mutationViewIsCurrent(view)) return;
				open = false;
				exportSuccessfulByPage = {};
				onexported(m.image_editor_export_downloaded());
				captureTelemetryEvent('image design exported', {
					mode: 'download',
					pages: rendered.length
				});
				if (guestMode) {
					trackPublicImageEditorEvent('image_editor_export_completed', {
						format: exportFormat,
						pages: publicImageEditorPageCountBucket(rendered.length)
					});
					toastVisible = true;
				}
				finishMetric();
				return;
			}
			const renderedByPage = new Map(rendered.map((page) => [page.page.id, page] as const));
			const mediaIDs: string[] = [];
			for (let index = 0; index < pageIDs.length; index++) {
				const pageID = pageIDs[index];
				const existingMediaID = exportSuccessfulByPage[pageID];
				if (existingMediaID) {
					mediaIDs.push(existingMediaID);
					continue;
				}
				const page = renderedByPage.get(pageID);
				if (!page) throw new Error(m.image_editor_page_render_failed());
				exportProgress = m.image_editor_saving_media_progress({
					done: index + 1,
					total: pageIDs.length
				});
				const file = new File([page.blob], page.filename, { type: page.blob.type });
				const uploaded = await uploadMediaFile({
					workspaceId: editor.workspaceID,
					file,
					source: 'image_editor_export',
					designDocumentId: editor.id,
					designPageId: page.page.id,
					retentionClass: exportMode === 'attach' ? 'temporary' : 'library',
					signal: controller.signal
				});
				if (!mutationViewIsCurrent(view)) return;
				mediaIDs.push(uploaded.id);
				exportSuccessfulByPage = {
					...exportSuccessfulByPage,
					[page.page.id]: uploaded.id
				};
				exportResumeLedger = {
					...exportResumeLedger,
					[page.page.id]: {
						mediaID: uploaded.id,
						fingerprint: imageEditorPageExportFingerprint(editor.document, page.page)
					}
				};
				storeExportResumeLedger();
				editor.mutate('Record page export', (document) => {
					const target = document.pages.find((item) => item.id === page.page.id);
					if (target) target.latest_export_media_id = uploaded.id;
				});
			}
			await saveNow(mediaIDs[0] ?? '', 'export');
			if (!mutationViewIsCurrent(view)) return;
			if (exportMode === 'attach') {
				if (!returnToken) throw new Error(m.image_editor_attach_missing());
				const returnURL = await completeImageEditorReturnToken(returnToken, editor.id, mediaIDs);
				if (!mutationViewIsCurrent(view)) return;
				captureTelemetryEvent('image design exported', {
					mode: exportMode,
					pages: mediaIDs.length
				});
				clearExportResumeLedger();
				await goto(
					resolveAppPath(
						`${returnURL}${returnURL.includes('?') ? '&' : '?'}image_editor_return=${encodeURIComponent(returnToken)}`
					)
				);
				finishMetric();
				return;
			}
			open = false;
			clearExportResumeLedger();
			captureTelemetryEvent('image design exported', {
				mode: exportMode,
				pages: mediaIDs.length
			});
			onexported(
				m.image_editor_exported_pages({
					count: mediaIDs.length
				})
			);
			finishMetric();
		} catch (cause) {
			finishMetric('error');
			if (!mutationViewIsCurrent(view)) return;
			exportError =
				cause instanceof DOMException && cause.name === 'AbortError'
					? m.image_editor_export_cancelled_resume({
							count: Object.keys(exportSuccessfulByPage).length
						})
					: (imageEditorErrorMessage(cause) ?? m.image_editor_export_failed());
			onannounce(exportError);
		} finally {
			if (exportAbort === controller) {
				exportBusy = false;
				exportProgress = '';
				exportAbort = null;
			}
		}
	}

	function cancelExport(): void {
		exportAbort?.abort();
	}

	onDestroy(() => {
		exportPreviewGeneration++;
		if (exportPreviewTimer) clearTimeout(exportPreviewTimer);
		exportPreviewAbort?.abort();
		clearEncodedExportPreview();
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_export_design()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_export_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<section
				class="overflow-hidden rounded-xl border bg-muted/20"
				aria-labelledby="export-preview-title"
			>
				<div class="flex min-h-11 items-center justify-between gap-3 border-b px-3 py-2">
					<h3 id="export-preview-title" class="text-sm font-medium">
						{m.image_editor_export_preview()}
					</h3>
					{#if exportPreview}
						<p class="text-xs text-muted-foreground tabular-nums">
							{m.image_editor_export_preview_bytes({
								bytes: formattedExportBytes(exportPreview.totalBytes)
							})}
						</p>
					{/if}
				</div>
				<div class="grid min-h-32 place-items-center p-3 sm:min-h-52">
					{#if exportPreviewBusy}
						<div
							class="grid justify-items-center gap-2 text-sm text-muted-foreground"
							role="status"
						>
							<ProtectedIcon
								icon="loading"
								class="size-5 animate-spin motion-reduce:animate-none"
							/>
							<span>{exportPreviewProgress || m.image_editor_export_preview_encoding()}</span>
						</div>
					{:else if exportPreviewError}
						<div class="grid max-w-sm justify-items-center gap-3 text-center">
							<p class="text-sm text-destructive" role="alert">{exportPreviewError}</p>
							<Button variant="outline" size="sm" onclick={retryEncodedExportPreview}>
								{m.image_editor_export_preview_retry()}
							</Button>
						</div>
					{:else if exportPreview}
						<img
							src={exportPreview.objectURL}
							alt={m.image_editor_export_preview_alt()}
							class="max-h-36 max-w-full rounded-md object-contain sm:max-h-56"
						/>
					{/if}
				</div>
			</section>
			<div class="rounded-xl border bg-muted/35 p-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p class="text-sm font-semibold">
							{exportFormat.toUpperCase()} · {exportSizeLabel}
						</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{m.image_editor_export_summary({
								pages: exportPages.length,
								megapixels: (exportPixelCount / 1_000_000).toFixed(1)
							})}
						</p>
					</div>
					<span
						class={[
							'rounded-full border px-2 py-1 text-xs font-medium',
							exportHasTransparency && exportSupportsTransparency
								? 'border-primary/40 bg-primary/8'
								: ''
						]}
					>
						{exportHasTransparency && exportSupportsTransparency
							? m.image_editor_transparency_preserved()
							: exportHasTransparency
								? m.image_editor_transparency_flattened()
								: m.image_editor_opaque_output()}
					</span>
				</div>
			</div>
			{#if exportBudget && !exportBudget.allowed}
				<p
					class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
					role="alert"
				>
					{m.image_editor_export_budget_exceeded()}
				</p>
			{/if}
			{#if Object.keys(exportSuccessfulByPage).length > 0}
				<p class="rounded-md border border-primary/30 bg-primary/8 p-3 text-sm" role="status">
					{m.image_editor_export_resume_ready({
						count: Object.keys(exportSuccessfulByPage).length
					})}
				</p>
			{/if}

			{#if (editor.document?.pages.length ?? 0) > 1 && !(coverHandoff && exportMode === 'attach')}
				<label class="flex min-h-11 items-center gap-2 rounded-lg border px-3">
					<Checkbox bind:checked={exportAllPages} />
					<span
						>{m.image_editor_export_all_pages({ count: editor.document?.pages.length ?? 0 })}</span
					>
				</label>
			{/if}

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.image_editor_format()}</span>
					<AppSelect
						value={editor.document?.export_defaults.format ?? 'png'}
						ariaLabel={m.image_editor_format()}
						disabled={!editor.canEdit}
						onValueChange={(value) =>
							editor.mutate('Change export format', (document) => {
								document.export_defaults.format = value as 'png' | 'jpeg' | 'webp' | 'gif';
							})}
						options={[
							{ value: 'png', label: 'PNG' },
							{ value: 'jpeg', label: 'JPEG' },
							...(!(coverHandoff && exportMode === 'attach')
								? [
										{ value: 'webp', label: 'WebP' },
										{
											value: 'gif',
											label: 'GIF',
											disabled: !exportPages.every(
												(page) => imageEditorPageAnimations(page).length > 0
											)
										}
									]
								: [])
						]}
						class="h-10 w-full"
					/>
				</label>
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">
						{m.image_editor_quality({
							quality: Math.round((editor.document?.export_defaults.quality ?? 0.92) * 100)
						})}
					</span>
					<Slider
						class="h-10"
						min={0.5}
						max={1}
						step={0.01}
						value={editor.document?.export_defaults.quality ?? 0.92}
						disabled={!editor.canEdit || ['png', 'gif'].includes(exportFormat)}
						ariaLabel={m.image_editor_quality({
							quality: Math.round((editor.document?.export_defaults.quality ?? 0.92) * 100)
						})}
						onValueChange={(quality) => {
							if (['png', 'gif'].includes(exportFormat) || !editor.document) return;
							const nextQuality = Number(quality.toFixed(EXPORT_QUALITY_DECIMAL_PLACES));
							const currentQuality = Number(
								editor.document.export_defaults.quality.toFixed(EXPORT_QUALITY_DECIMAL_PLACES)
							);
							if (nextQuality === currentQuality) return;
							editor.mutate(
								'Change export quality',
								(document) => {
									document.export_defaults.quality = nextQuality;
								},
								'export-quality'
							);
						}}
					/>
				</label>
			</div>

			{#if exportFormat === 'gif'}
				<p class="text-sm text-muted-foreground">{m.image_editor_animation_export_help()}</p>
			{/if}
			{#if exportHasTransparency && !exportSupportsTransparency}
				<InlineNotice tone="warning">
					<div class="grid gap-2">
						<p class="text-sm leading-relaxed">{m.image_editor_jpeg_transparency_warning()}</p>
						<ColorPicker
							label={m.image_editor_jpeg_matte_color()}
							value={editor.document?.export_defaults.matte_color ?? '#ffffff'}
							disabled={!editor.canEdit}
							brandColors={editor.brandKit?.colors ?? []}
							recentColors={editor.recentColors}
							onChange={(matteColor) =>
								editor.mutate(
									'Change export matte color',
									(document) => {
										document.export_defaults.matte_color = matteColor;
									},
									'export-matte-color'
								)}
							onCommit={(color) => editor.rememberColor(color)}
						/>
					</div>
				</InlineNotice>
			{/if}

			{#if !guestMode}
				<div class="space-y-2">
					<p class="text-sm font-medium">{m.image_editor_export_destination()}</p>
					<RadioGroup.Root bind:value={exportMode} class="grid gap-2 sm:grid-cols-2">
						<label
							class="flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
						>
							<RadioGroup.Item value="download" aria-label={m.image_editor_download()} />
							<span class="grid gap-0.5">
								<span class="text-sm font-medium">{m.image_editor_download()}</span>
								<span class="text-xs text-muted-foreground"
									>{m.image_editor_download_description()}</span
								>
							</span>
						</label>
						<label
							class="flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50"
						>
							<RadioGroup.Item
								value="media"
								disabled={!editor.canEdit}
								aria-label={m.image_editor_media()}
							/>
							<span class="grid gap-0.5">
								<span class="text-sm font-medium">{m.image_editor_media()}</span>
								<span class="text-xs text-muted-foreground"
									>{m.image_editor_media_description()}</span
								>
							</span>
						</label>
						{#if returnToken}
							<label
								class="flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 sm:col-span-2"
							>
								<RadioGroup.Item
									value="attach"
									disabled={!editor.canEdit}
									aria-label={attachLabel}
								/>
								<span class="grid gap-0.5">
									<span class="text-sm font-medium">{attachLabel}</span>
									<span class="text-xs text-muted-foreground"
										>{coverHandoff
											? m.compose_cover_return_description()
											: m.image_editor_attach_description()}</span
									>
								</span>
							</label>
						{/if}
					</RadioGroup.Root>
				</div>
			{/if}
			{#if exportProgress}
				<p class="text-sm text-muted-foreground" aria-live="polite">{exportProgress}</p>
			{/if}
			{#if exportError}
				<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{exportError}
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (exportBusy ? cancelExport() : (open = false))}>
				{m.common_cancel()}
			</Button>
			<Button
				onclick={exportDesign}
				disabled={exportBusy ||
					exportPreviewBusy ||
					!exportPreview ||
					!editor.document ||
					!exportBudget?.allowed}
			>
				{#if exportBusy}<ProtectedIcon
						icon="loading"
						class="animate-spin motion-reduce:animate-none"
					/>{/if}
				{exportMode === 'download'
					? m.image_editor_download()
					: exportMode === 'attach'
						? coverHandoff
							? attachLabel
							: m.image_editor_export_attach()
						: m.image_editor_export_media()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if toastVisible}
	<AppToast
		message={m.image_editor_export_downloaded()}
		tone="success"
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (toastVisible = false)}
		actionLabel={guestMode ? m.image_editor_public_save_openpost() : undefined}
		onAction={guestMode ? onsaveguest : undefined}
	/>
{/if}
