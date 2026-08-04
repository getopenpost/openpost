<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ContextMenu } from 'bits-ui';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Menubar from '$lib/components/ui/menubar';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import SaveIndicator from '$lib/components/save-indicator.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import ImageEditorCanvas from './image-editor-canvas.svelte';
	import AssetPanel from './asset-panel.svelte';
	import LayerTree from './layer-tree.svelte';
	import PropertiesPanel from './properties-panel.svelte';
	import PageStrip from './page-strip.svelte';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import { provideImageEditor, ImageEditorController } from '../editor.svelte';
	import {
		completeImageEditorReturnToken,
		createImageEditorCheckpoint,
		createImageEditorTemplate,
		duplicateImageEditorDesign,
		loadImageEditorDesign,
		listImageEditorRevisions,
		listImageEditorTemplates,
		restoreImageEditorRevision,
		saveImageEditorDesign,
		updateImageEditorTemplate
	} from '../api';
	import {
		clearLocalImageEditorRecovery,
		loadLocalImageEditorRecovery,
		storeLocalImageEditorRecovery
	} from '../recovery';
	import { saveGuestImageEditorDesign, storeGuestImageEditorMedia } from '../local-persistence';
	import {
		publicImageEditorPageCountBucket,
		trackPublicImageEditorEvent
	} from '../public-telemetry';
	import {
		cloneImageEditorLayer,
		imageEditorPageHasTransparency,
		validateImageEditorDocument
	} from '../document';
	import {
		downloadRenderedPages,
		renderImageEditorPages,
		renderImageEditorPreview
	} from '../static-renderer';
	import { canAttachImageEditorPreview } from '../preview-generation';
	import { ImageEditorBackgroundRemoval } from '../background-removal';
	import type {
		ImageEditorBrandKit,
		ImageEditorDocumentResponse,
		ImageEditorLayer,
		ImageEditorRevisionSummary,
		ImageEditorTemplate,
		ImageEditorTool
	} from '../types';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import UndoIcon from 'lucide-svelte/icons/undo-2';
	import RedoIcon from 'lucide-svelte/icons/redo-2';
	import DownloadIcon from 'lucide-svelte/icons/download';
	import SaveIcon from 'lucide-svelte/icons/save';
	import MousePointerIcon from 'lucide-svelte/icons/mouse-pointer-2';
	import RectangleSelectIcon from 'lucide-svelte/icons/square-dashed-mouse-pointer';
	import LassoSelectIcon from 'lucide-svelte/icons/lasso-select';
	import TypeIcon from 'lucide-svelte/icons/type';
	import HandIcon from 'lucide-svelte/icons/hand';
	import ZoomInIcon from 'lucide-svelte/icons/zoom-in';
	import LayersIcon from 'lucide-svelte/icons/layers-3';
	import SlidersIcon from 'lucide-svelte/icons/sliders-horizontal';
	import PanelLeftIcon from 'lucide-svelte/icons/panel-left';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import WandIcon from 'lucide-svelte/icons/wand-sparkles';
	import CircleDashedIcon from 'lucide-svelte/icons/circle-dashed';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import EraserIcon from 'lucide-svelte/icons/eraser';
	import PaintBucketIcon from 'lucide-svelte/icons/paint-bucket';
	import BlendIcon from 'lucide-svelte/icons/blend';
	import GroupIcon from 'lucide-svelte/icons/group';
	import UngroupIcon from 'lucide-svelte/icons/ungroup';
	import MoreIcon from 'lucide-svelte/icons/ellipsis';
	import SquareIcon from 'lucide-svelte/icons/square';
	import CircleIcon from 'lucide-svelte/icons/circle';
	import MinusIcon from 'lucide-svelte/icons/minus';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '../telemetry';

	let {
		initial,
		returnToken = '',
		backgroundModelBaseURL = '/image-editor-models',
		initialAction = '',
		readOnlyReason = '',
		initialBrandKit = null,
		guestMode = false,
		onSaveToOpenPost
	}: {
		initial: ImageEditorDocumentResponse;
		returnToken?: string;
		backgroundModelBaseURL?: string;
		initialAction?: string;
		readOnlyReason?: string;
		initialBrandKit?: ImageEditorBrandKit | null;
		guestMode?: boolean;
		onSaveToOpenPost?: () => void | Promise<void>;
	} = $props();

	const editor = provideImageEditor(new ImageEditorController());
	const backgroundRemoval = new ImageEditorBackgroundRemoval();
	const DESKTOP_TOOL_RAIL_WIDTH = 44;
	const MINIMUM_CANVAS_WIDTH = 320;
	const TOOL_CONTEXT_MENU_CLASS =
		'z-50 min-w-44 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none';
	const TOOL_CONTEXT_MENU_ITEM_CLASS =
		'flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted [&>svg]:size-4 [@media(pointer:coarse)]:min-h-11';
	type SaveRequest = {
		coverPreviewMediaID?: string;
		recoveryReason: 'idle' | 'export' | 'close';
	};
	type SaveAttemptResult = 'saved' | 'retry' | 'blocked';
	const INITIAL_SAVE_RETRY_DELAY = 2_000;
	const MAXIMUM_SAVE_RETRY_DELAY = 30_000;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let savedIndicatorTimer: ReturnType<typeof setTimeout> | undefined;
	let savedIndicatorVisible = $state(false);
	let pendingSave: SaveRequest | null = null;
	let saveDrain: Promise<boolean> | null = null;
	let saveRetryDelay = INITIAL_SAVE_RETRY_DELAY;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let previewPending = false;
	let previewBusy = false;
	let previewTask: Promise<void> | null = null;
	let previewGeneration = 0;
	let lastPreviewAt = 0;
	let coverPreviewMediaID = '';
	let exportDialogOpen = $state(false);
	let postExportDialogOpen = $state(false);
	let conflictDialogOpen = $state(false);
	let historyDialogOpen = $state(false);
	let checkpointDialogOpen = $state(false);
	let templateDialogOpen = $state(false);
	let resizeDialogOpen = $state(false);
	let exportMode = $state<'download' | 'media' | 'attach'>('download');
	let exportAllPages = $state(true);
	let exportBusy = $state(false);
	let exportProgress = $state('');
	let exportError = $state('');
	let exportSuccessfulByPage = $state.raw<Record<string, string>>({});
	let backgroundBusy = $state(false);
	let backgroundProgress = $state('');
	let backgroundError = $state('');
	let backgroundOptimizeDialogOpen = $state(false);
	let mobileSheet = $state<'assets' | 'layers' | 'properties' | null>(null);
	let focusedCanvas = $state(false);
	let copiedLayers = $state.raw<ImageEditorLayer[]>([]);
	let statusAnnouncement = $state('');
	let suppressSavedAnnouncementUntil = 0;
	let revisions = $state<ImageEditorRevisionSummary[]>([]);
	let historyBusy = $state(false);
	let historyError = $state('');
	let checkpointName = $state('');
	let templateName = $state('');
	let templateCategory = $state<string>(m.image_editor_workspace_category());
	let templateTargetID = $state('new');
	let workspaceTemplates = $state<ImageEditorTemplate[]>([]);
	let resizeWidth = $state(1080);
	let resizeHeight = $state(1080);
	let resizeMode = $state<'scale' | 'preserve'>('scale');
	let resizeError = $state('');
	let marqueeSlotTool = $state<'marquee' | 'ellipse_marquee'>('marquee');
	let fillSlotTool = $state<'bucket' | 'gradient'>('bucket');
	let eraserSlotTool = $state<'eraser' | 'magic_eraser'>('eraser');
	let shapeSlotKind = $state<'rectangle' | 'rounded_rectangle' | 'ellipse' | 'line'>('rectangle');
	let assetPanelWidth = $state(260);
	let inspectorPanelWidth = $state(320);
	let layersPanelHeight = $state(280);
	let inspectorElement = $state<HTMLElement>();
	let meaningfulEditTracked = false;
	let panelResize:
		| {
				panel: 'assets' | 'inspector' | 'layers';
				startX: number;
				startY: number;
				startSize: number;
		  }
		| undefined;
	let exportPages = $derived.by(() => {
		if (!editor.document) return [];
		return exportAllPages
			? editor.document.pages
			: editor.document.pages.filter((page) => page.id === editor.activePageID);
	});
	let exportHasTransparency = $derived(exportPages.some(imageEditorPageHasTransparency));
	let exportFormat = $derived(editor.document?.export_defaults.format ?? 'png');
	let exportSupportsTransparency = $derived(exportFormat !== 'jpeg');
	let exportPixelCount = $derived(
		(editor.document?.width_px ?? 0) * (editor.document?.height_px ?? 0) * exportPages.length
	);

	function initializeShell() {
		if (!editor.document) {
			editor.load(initial);
			editor.setBrandKit(initialBrandKit);
			coverPreviewMediaID = initial.cover_preview_media_id ?? '';
		}
	}

	function openExport(mode: 'download' | 'media' | 'attach'): void {
		exportMode = guestMode ? 'download' : mode;
		exportError = '';
		exportSuccessfulByPage = {};
		exportDialogOpen = true;
	}

	async function saveToOpenPost(): Promise<void> {
		if (guestMode && !(await saveNow(undefined, 'close'))) return;
		await onSaveToOpenPost?.();
	}

	onMount(() => {
		try {
			editor.setRecentColors(
				JSON.parse(
					localStorage.getItem('openpost-image-editor-recent-colors-v1') || '[]'
				) as string[]
			);
		} catch {
			editor.setRecentColors([]);
		}
		try {
			const stored = JSON.parse(
				localStorage.getItem('openpost-image-editor-layout-v1') || '{}'
			) as {
				assets?: number;
				inspector?: number;
				layers?: number;
			};
			assetPanelWidth = clampPanelSize(stored.assets, 220, 420, assetPanelWidth);
			inspectorPanelWidth = clampPanelSize(stored.inspector, 280, 480, inspectorPanelWidth);
			layersPanelHeight = clampPanelSize(stored.layers, 120, 520, layersPanelHeight);
			constrainDesktopPanelWidths();
		} catch {
			// Invalid local layout preferences fall back to the balanced defaults.
		}
		if (window.innerWidth < 1024 && window.innerHeight <= 520) {
			editor.pagesExpanded = false;
		}
		const unsubscribe = editor.onChange(() => {
			clearTimeout(saveTimer);
			previewGeneration += 1;
			previewPending = !guestMode;
			if (guestMode && !meaningfulEditTracked) {
				meaningfulEditTracked = true;
				trackPublicImageEditorEvent('image_editor_meaningful_edit', { source: 'editor' });
			}
			if (editor.document && !guestMode) {
				void storeLocalImageEditorRecovery({
					design_id: editor.id,
					workspace_id: editor.workspaceID,
					revision: editor.revision,
					document: editor.document
				}).then(() => {
					if (editor.saveState === 'idle') {
						editor.saveState = 'local';
						editor.saveMessage = m.image_editor_saved_locally();
					}
				});
			}
			saveTimer = setTimeout(() => void saveNow(), 750);
		});
		void (async () => {
			await restoreLocalIfNewer();
			if (initialAction === 'remove-background') {
				const imageLayer = editor.activePage?.layers.find((layer) => Boolean(layer.image));
				if (imageLayer) {
					editor.selectLayer(imageLayer.id);
					const cleanURL = new URL(window.location.href);
					cleanURL.searchParams.delete('action');
					window.history.replaceState(window.history.state, '', cleanURL);
					await removeBackground();
				}
			}
		})();
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (editor.saveState === 'idle' || editor.saveState === 'saving') {
				event.preventDefault();
			}
		};
		window.addEventListener('beforeunload', beforeUnload);
		return () => {
			unsubscribe();
			clearTimeout(saveTimer);
			clearTimeout(savedIndicatorTimer);
			clearTimeout(previewTimer);
			backgroundRemoval.dispose();
			window.removeEventListener('beforeunload', beforeUnload);
		};
	});

	function showSavedIndicator(): void {
		clearTimeout(savedIndicatorTimer);
		savedIndicatorVisible = true;
		savedIndicatorTimer = setTimeout(() => {
			savedIndicatorVisible = false;
		}, 1_600);
	}

	function clampPanelSize(
		value: number | undefined,
		minimum: number,
		maximum: number,
		fallback: number
	): number {
		return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value!)) : fallback;
	}

	function panelMaximum(panel: 'assets' | 'inspector'): number {
		const otherPanelWidth = panel === 'assets' ? inspectorPanelWidth : assetPanelWidth;
		const available =
			document.documentElement.clientWidth -
			DESKTOP_TOOL_RAIL_WIDTH -
			MINIMUM_CANVAS_WIDTH -
			otherPanelWidth;
		return Math.max(
			panel === 'assets' ? 220 : 280,
			Math.min(panel === 'assets' ? 420 : 480, available)
		);
	}

	function constrainDesktopPanelWidths(): void {
		if (window.innerWidth < 1024) return;
		const maximumCombinedWidth =
			document.documentElement.clientWidth - DESKTOP_TOOL_RAIL_WIDTH - MINIMUM_CANVAS_WIDTH;
		let overflow = assetPanelWidth + inspectorPanelWidth - maximumCombinedWidth;
		if (overflow <= 0) return;
		const assetReduction = Math.min(assetPanelWidth - 220, Math.ceil(overflow / 2));
		assetPanelWidth -= assetReduction;
		overflow -= assetReduction;
		inspectorPanelWidth -= Math.min(inspectorPanelWidth - 280, overflow);
	}

	function startPanelResize(event: PointerEvent, panel: 'assets' | 'inspector' | 'layers'): void {
		if (event.button !== 0) return;
		(event.currentTarget as HTMLButtonElement).focus();
		event.preventDefault();
		panelResize = {
			panel,
			startX: event.clientX,
			startY: event.clientY,
			startSize:
				panel === 'assets'
					? assetPanelWidth
					: panel === 'inspector'
						? inspectorPanelWidth
						: layersPanelHeight
		};
	}

	function resizePanels(event: PointerEvent): void {
		if (!panelResize) return;
		if (panelResize.panel === 'assets') {
			assetPanelWidth = clampPanelSize(
				panelResize.startSize + event.clientX - panelResize.startX,
				220,
				panelMaximum('assets'),
				assetPanelWidth
			);
		} else if (panelResize.panel === 'inspector') {
			inspectorPanelWidth = clampPanelSize(
				panelResize.startSize - (event.clientX - panelResize.startX),
				280,
				panelMaximum('inspector'),
				inspectorPanelWidth
			);
		} else {
			const maximum = Math.max(160, (inspectorElement?.clientHeight ?? 680) - 166);
			layersPanelHeight = clampPanelSize(
				panelResize.startSize + event.clientY - panelResize.startY,
				120,
				maximum,
				layersPanelHeight
			);
		}
	}

	function stopPanelResize(): void {
		if (!panelResize) return;
		panelResize = undefined;
		storePanelLayout();
	}

	function storePanelLayout(): void {
		try {
			localStorage.setItem(
				'openpost-image-editor-layout-v1',
				JSON.stringify({
					assets: Math.round(assetPanelWidth),
					inspector: Math.round(inspectorPanelWidth),
					layers: Math.round(layersPanelHeight)
				})
			);
		} catch {
			// Layout persistence is optional when browser storage is unavailable.
		}
	}

	function resizePanelWithKeyboard(
		event: KeyboardEvent,
		panel: 'assets' | 'inspector' | 'layers'
	): void {
		const direction =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (!direction) return;
		event.preventDefault();
		const step = event.shiftKey ? 32 : 8;
		if (panel === 'assets') {
			assetPanelWidth = clampPanelSize(
				assetPanelWidth + direction * step,
				220,
				panelMaximum('assets'),
				assetPanelWidth
			);
		} else if (panel === 'inspector') {
			inspectorPanelWidth = clampPanelSize(
				inspectorPanelWidth - direction * step,
				280,
				panelMaximum('inspector'),
				inspectorPanelWidth
			);
		} else {
			layersPanelHeight = clampPanelSize(
				layersPanelHeight + direction * step,
				120,
				Math.max(160, (inspectorElement?.clientHeight ?? 680) - 166),
				layersPanelHeight
			);
		}
		storePanelLayout();
	}

	async function restoreLocalIfNewer(): Promise<void> {
		if (guestMode) return;
		const local = await loadLocalImageEditorRecovery(editor.id);
		if (!local || local.revision < editor.revision) return;
		if (local.updated_at <= initial.updated_at) return;
		editor.document = local.document;
		editor.saveState = 'local';
		editor.saveMessage = m.image_editor_recovered_local();
		statusAnnouncement = m.image_editor_recovered_announcement();
	}

	function saveNow(
		nextCoverPreviewMediaID: string | undefined = undefined,
		recoveryReason: 'idle' | 'export' | 'close' = 'idle'
	): Promise<boolean> {
		clearTimeout(saveTimer);
		pendingSave = mergeSaveRequest(pendingSave, {
			coverPreviewMediaID: nextCoverPreviewMediaID,
			recoveryReason
		});
		if (!saveDrain) {
			const drain = drainSaves();
			const tracked = drain.finally(() => {
				if (saveDrain === tracked) saveDrain = null;
			});
			saveDrain = tracked;
		}
		return saveDrain;
	}

	function mergeSaveRequest(current: SaveRequest | null, next: SaveRequest): SaveRequest {
		if (!current) return next;
		const reasonPriority = { idle: 0, export: 1, close: 2 } as const;
		return {
			coverPreviewMediaID: next.coverPreviewMediaID ?? current.coverPreviewMediaID,
			recoveryReason:
				reasonPriority[next.recoveryReason] >= reasonPriority[current.recoveryReason]
					? next.recoveryReason
					: current.recoveryReason
		};
	}

	async function drainSaves(): Promise<boolean> {
		while (pendingSave) {
			const request = pendingSave;
			pendingSave = null;
			const result = await performSave(request);
			if (result === 'saved') continue;
			if (result === 'retry') {
				pendingSave = pendingSave ? mergeSaveRequest(request, pendingSave) : request;
				scheduleSaveRetry();
			} else {
				pendingSave = null;
			}
			return false;
		}
		return true;
	}

	function scheduleSaveRetry(): void {
		clearTimeout(saveTimer);
		const delay = saveRetryDelay;
		saveRetryDelay = Math.min(saveRetryDelay * 2, MAXIMUM_SAVE_RETRY_DELAY);
		saveTimer = setTimeout(() => void saveNow(), delay);
	}

	async function performSave(request: SaveRequest): Promise<SaveAttemptResult> {
		if (!editor.document || !editor.canEdit) return 'saved';
		const submittedDocument = editor.document;
		const errors = validateImageEditorDocument(submittedDocument);
		if (errors.length > 0) {
			editor.saveState = 'error';
			editor.saveMessage = errors[0];
			statusAnnouncement = errors[0];
			return 'blocked';
		}
		editor.saveState = 'saving';
		editor.saveMessage = m.common_saving();
		const finishMetric = startImageEditorMetric('autosave');
		try {
			const response = guestMode
				? await saveGuestImageEditorDesign(editor.id, submittedDocument)
				: await saveImageEditorDesign(
						editor.id,
						editor.revision,
						submittedDocument,
						request.coverPreviewMediaID ?? coverPreviewMediaID,
						request.recoveryReason
					);
			editor.revision = response.revision;
			coverPreviewMediaID = response.cover_preview_media_id ?? '';
			if (editor.document === submittedDocument) {
				editor.document = response.document;
				editor.saveState = 'saved';
				editor.saveMessage = guestMode
					? m.image_editor_public_saved_device()
					: m.image_editor_saved();
				showSavedIndicator();
				if (!guestMode) await clearLocalImageEditorRecovery(editor.id);
				if (Date.now() >= suppressSavedAnnouncementUntil) {
					statusAnnouncement = guestMode
						? m.image_editor_public_saved_device()
						: m.image_editor_saved_announcement();
				}
				if (!guestMode && request.recoveryReason === 'idle' && previewPending) schedulePreview();
			}
			saveRetryDelay = INITIAL_SAVE_RETRY_DELAY;
			finishMetric();
			return 'saved';
		} catch (cause) {
			finishMetric('error');
			const status = (cause as Error & { status?: number }).status;
			const retryable = !navigator.onLine || !status || status === 429 || status >= 500;
			if (status === 409) {
				editor.saveState = 'conflict';
				editor.saveMessage = m.image_editor_save_conflict();
				conflictDialogOpen = true;
				statusAnnouncement = m.image_editor_conflict_title();
			} else if (!navigator.onLine) {
				editor.saveState = 'offline';
				editor.saveMessage = m.image_editor_saved_locally();
				statusAnnouncement = m.image_editor_offline_saved();
			} else {
				editor.saveState = 'error';
				editor.saveMessage = cause instanceof Error ? cause.message : m.image_editor_save_failed();
				statusAnnouncement = editor.saveMessage;
			}
			return retryable ? 'retry' : 'blocked';
		}
	}

	function schedulePreview(): void {
		if (guestMode || !editor.canEdit || previewBusy || !previewPending) return;
		clearTimeout(previewTimer);
		const wait = Math.max(1000, 30_000 - (Date.now() - lastPreviewAt));
		previewTimer = setTimeout(() => void runPreview(), wait);
	}

	function runPreview(recoveryReason: 'idle' | 'close' = 'idle'): Promise<void> {
		if (previewTask) return previewTask;
		const task = generatePreview(recoveryReason);
		const tracked = task.finally(() => {
			if (previewTask === tracked) previewTask = null;
		});
		previewTask = tracked;
		return tracked;
	}

	async function generatePreview(recoveryReason: 'idle' | 'close' = 'idle'): Promise<void> {
		if (guestMode || !editor.document || !editor.canEdit || previewBusy || !previewPending) return;
		const page = editor.document.pages.find((item) => item.id === editor.activePageID);
		if (!page) return;
		previewBusy = true;
		const finishMetric = startImageEditorMetric('preview_generation');
		let metricOutcome: 'success' | 'error' = 'success';
		const documentSnapshot = structuredClone(editor.document);
		const pageSnapshot = structuredClone(page);
		const requestedGeneration = previewGeneration;
		try {
			const blob = await renderImageEditorPreview(documentSnapshot, pageSnapshot);
			const uploaded = await uploadMediaFile({
				workspaceId: editor.workspaceID,
				file: new File([blob], `${editor.id}-${page.id}-preview.webp`, {
					type: 'image/webp'
				}),
				source: 'image_editor_edit',
				assetKind: 'design_preview',
				designDocumentId: editor.id,
				designPageId: page.id
			});
			if (
				!canAttachImageEditorPreview(
					requestedGeneration,
					previewGeneration,
					Boolean(editor.document?.pages.some((item) => item.id === page.id))
				)
			) {
				return;
			}
			const nextDocument = structuredClone(editor.document);
			const nextPage = nextDocument.pages.find((item) => item.id === page.id);
			if (!nextPage) return;
			nextPage.preview_media_id = uploaded.id;
			editor.document = nextDocument;
			previewPending = false;
			lastPreviewAt = Date.now();
			const firstPagePreview =
				nextDocument.pages[0]?.id === page.id ? uploaded.id : coverPreviewMediaID;
			await saveNow(firstPagePreview, recoveryReason);
		} catch {
			metricOutcome = 'error';
			// Preview generation is best-effort and must never interrupt editing or autosave.
		} finally {
			finishMetric(metricOutcome);
			previewBusy = false;
			if (previewPending && recoveryReason === 'idle') schedulePreview();
		}
	}

	async function reloadServerVersion(): Promise<void> {
		const response = await loadImageEditorDesign(editor.id);
		editor.replaceFromServer(response);
		coverPreviewMediaID = response.cover_preview_media_id ?? '';
		await clearLocalImageEditorRecovery(editor.id);
		conflictDialogOpen = false;
	}

	async function saveConflictAsCopy(): Promise<void> {
		if (!editor.document) return;
		const localDocument = structuredClone(editor.document);
		const duplicate = await duplicateImageEditorDesign(editor.id);
		const saved = await saveImageEditorDesign(duplicate.id, duplicate.revision, localDocument);
		editor.load(saved);
		conflictDialogOpen = false;
		await goto(resolve(`/image-editor/${duplicate.id}` as '/'));
	}

	async function goBack(): Promise<void> {
		if (editor.canEdit) {
			const saved = editor.saveState === 'saved' ? true : await saveNow(undefined, 'close');
			if (previewTask) await previewTask;
			if (!guestMode && saved && previewPending) await runPreview('close');
		}
		if (history.length > 1) history.back();
		else void goto(resolve((guestMode ? '/image-editor' : '/media') as '/'));
	}

	async function openHistory(): Promise<void> {
		if (guestMode) return;
		historyDialogOpen = true;
		historyBusy = true;
		historyError = '';
		try {
			revisions = await listImageEditorRevisions(editor.id);
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.image_editor_history_load_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function createCheckpoint(): Promise<void> {
		if (!checkpointName.trim()) return;
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_checkpoint_save_first());
			await createImageEditorCheckpoint(editor.id, checkpointName.trim());
			checkpointName = '';
			checkpointDialogOpen = false;
			await openHistory();
			statusAnnouncement = m.image_editor_checkpoint_created();
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.image_editor_checkpoint_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function restoreRevision(revision: ImageEditorRevisionSummary): Promise<void> {
		historyBusy = true;
		historyError = '';
		try {
			const response = await restoreImageEditorRevision(editor.id, revision.id, editor.revision);
			editor.load(response);
			await clearLocalImageEditorRecovery(editor.id);
			historyDialogOpen = false;
			statusAnnouncement = m.image_editor_version_restored();
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.image_editor_restore_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function saveAsTemplate(): Promise<void> {
		if (!editor.document || !templateName.trim()) return;
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
				await updateImageEditorTemplate(templateTargetID, templateInput);
			}
			templateDialogOpen = false;
			templateName = '';
			statusAnnouncement =
				templateTargetID === 'new'
					? m.image_editor_template_created()
					: m.image_editor_template_replaced();
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.image_editor_template_save_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function openTemplateDialog(): Promise<void> {
		historyError = '';
		templateTargetID = 'new';
		templateName = editor.document?.title ?? '';
		templateCategory = m.image_editor_workspace_category();
		templateDialogOpen = true;
		try {
			workspaceTemplates = (await listImageEditorTemplates(editor.workspaceID)).filter(
				(template) => !template.built_in
			);
		} catch (cause) {
			historyError =
				cause instanceof Error ? cause.message : m.image_editor_templates_load_failed();
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

	function openResizeDialog(): void {
		if (!editor.document) return;
		resizeWidth = editor.document.width_px;
		resizeHeight = editor.document.height_px;
		resizeMode = 'scale';
		resizeError = '';
		resizeDialogOpen = true;
	}

	function resizeDocument(): void {
		if (!editor.document) return;
		if (
			resizeWidth < 64 ||
			resizeHeight < 64 ||
			resizeWidth > 4096 ||
			resizeHeight > 4096 ||
			resizeWidth * resizeHeight > 25_000_000
		) {
			resizeError = m.image_editor_resize_limits();
			return;
		}
		const previousWidth = editor.document.width_px;
		const previousHeight = editor.document.height_px;
		editor.mutate('Resize design', (document) => {
			if (resizeMode === 'scale') {
				const scaleX = resizeWidth / previousWidth;
				const scaleY = resizeHeight / previousHeight;
				for (const page of document.pages) {
					for (const layer of page.layers) {
						layer.transform.x *= scaleX;
						layer.transform.y *= scaleY;
						layer.transform.width *= scaleX;
						layer.transform.height *= scaleY;
						if (layer.text) layer.text.font_size *= Math.min(scaleX, scaleY);
					}
				}
			}
			document.width_px = resizeWidth;
			document.height_px = resizeHeight;
			document.preset_key = 'custom';
		});
		resizeDialogOpen = false;
	}

	function setTool(tool: ImageEditorTool): void {
		if (tool === 'shape') {
			insertShape(shapeSlotKind);
			return;
		}
		editor.activeTool = tool;
		if (isMarqueeTool(tool)) marqueeSlotTool = tool;
		if (isFillTool(tool)) fillSlotTool = tool;
		if (isEraserTool(tool)) eraserSlotTool = tool;
		if (tool === 'text') editor.addText();
		if (tool === 'image' || tool === 'camera') {
			editor.leftPanel = 'media';
			if (window.innerWidth < 1024) mobileSheet = 'assets';
		}
	}

	function insertShape(kind: typeof shapeSlotKind): void {
		shapeSlotKind = kind;
		editor.addShape(kind);
		editor.activeTool = 'select';
	}

	function openBackgroundMediaPicker(): void {
		editor.backgroundImagePickerActive = true;
		editor.leftPanel = 'media';
		if (window.innerWidth < 1024) mobileSheet = 'assets';
	}

	function editableTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function handleShortcut(event: KeyboardEvent): void {
		if (editableTarget(event.target)) return;
		const modifier = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		if (modifier && key === 's') {
			event.preventDefault();
			void saveNow();
			return;
		}
		if (modifier && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) editor.redo();
			else editor.undo();
			return;
		}
		if (modifier && key === 'y') {
			event.preventDefault();
			editor.redo();
			return;
		}
		if (modifier && key === 'j') {
			event.preventDefault();
			editor.duplicateSelected();
			return;
		}
		if (modifier && key === 'g') {
			event.preventDefault();
			if (event.shiftKey) editor.ungroupSelected();
			else editor.groupSelected();
			return;
		}
		if (modifier && key === 'a') {
			event.preventDefault();
			editor.selectAll();
			return;
		}
		if (modifier && key === 'd') {
			event.preventDefault();
			if (editor.pixelSelection) editor.clearPixelSelection();
			else editor.selectLayer('');
			return;
		}
		if (modifier && key === 'c') {
			event.preventDefault();
			void copySelection();
			return;
		}
		if (modifier && key === 'x') {
			event.preventDefault();
			void copySelection().then(() => editor.deleteSelected());
			return;
		}
		if (modifier && key === 'v') {
			event.preventDefault();
			void pasteSelection();
			return;
		}
		if (modifier && key === '0') {
			event.preventDefault();
			editor.zoom = 0.75;
			editor.panX = 0;
			editor.panY = 0;
			return;
		}
		if (modifier && key === '1') {
			event.preventDefault();
			editor.zoom = 1;
			return;
		}
		if (
			editor.pixelSelection &&
			['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
		) {
			event.preventDefault();
			const distance = event.shiftKey ? 10 : 1;
			const deltaX = key === 'arrowleft' ? -distance : key === 'arrowright' ? distance : 0;
			const deltaY = key === 'arrowup' ? -distance : key === 'arrowdown' ? distance : 0;
			editor.movePixelSelection(editor.pixelSelection.data, deltaX, deltaY);
			return;
		}
		if (key === 'delete' || key === 'backspace') {
			event.preventDefault();
			editor.deleteSelected();
			return;
		}
		const tools: Record<string, ImageEditorTool> = {
			v: 'select',
			l: 'lasso',
			w: 'magic_wand',
			b: 'pencil',
			p: 'pencil',
			e: event.shiftKey ? 'magic_eraser' : 'eraser',
			g: event.shiftKey ? 'bucket' : 'gradient',
			t: 'text',
			h: 'hand',
			z: 'zoom'
		};
		if (key === 'u') {
			insertShape(shapeSlotKind);
			return;
		}
		if (key === 'm') setTool(event.shiftKey ? 'ellipse_marquee' : 'marquee');
		else if (tools[key]) setTool(tools[key]);
		if (key === 'f') focusedCanvas = !focusedCanvas;
	}

	async function copySelection(): Promise<void> {
		copiedLayers = structuredClone(editor.selectedLayers);
		if (copiedLayers.length === 0) return;
		const payload = JSON.stringify({ version: 1, layers: copiedLayers });
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					'application/x-openpost-image-editor-layers+json': new Blob([payload], {
						type: 'application/x-openpost-image-editor-layers+json'
					}),
					'text/plain': new Blob([payload], { type: 'text/plain' })
				})
			]);
		} catch {
			// The in-session clipboard remains available when custom clipboard MIME is blocked.
		}
	}

	async function pasteSelection(): Promise<void> {
		let source = copiedLayers;
		let externalImage: Blob | null = null;
		let externalText = '';
		try {
			const items = await navigator.clipboard.read();
			const item = items.find((entry) =>
				entry.types.includes('application/x-openpost-image-editor-layers+json')
			);
			if (item) {
				const blob = await item.getType('application/x-openpost-image-editor-layers+json');
				const parsed = JSON.parse(await blob.text()) as {
					version: number;
					layers: ImageEditorLayer[];
				};
				if (parsed.version === 1 && Array.isArray(parsed.layers)) source = parsed.layers;
			} else {
				const imageItem = items.find((entry) =>
					entry.types.some((type) => type.startsWith('image/'))
				);
				const imageType = imageItem?.types.find((type) => type.startsWith('image/'));
				if (imageItem && imageType) externalImage = await imageItem.getType(imageType);
			}
		} catch {
			// Use the sanitized in-session clipboard.
		}
		if (source.length === 0 && externalImage) {
			const extension =
				externalImage.type === 'image/png'
					? 'png'
					: externalImage.type === 'image/webp'
						? 'webp'
						: 'jpg';
			const file = new File([externalImage], `pasted-image.${extension}`, {
				type: externalImage.type
			});
			const uploaded = guestMode
				? await storeGuestImageEditorMedia(editor.id, file)
				: await uploadMediaFile({
						workspaceId: editor.workspaceID,
						file,
						source: 'upload'
					});
			editor.addImage({ id: uploaded.id, name: m.image_editor_pasted_image() });
			return;
		}
		if (source.length === 0) {
			try {
				externalText = (await navigator.clipboard.readText()).trim();
			} catch {
				externalText = '';
			}
			if (externalText) {
				editor.addText();
				const textLayer = editor.selectedLayers[0];
				if (textLayer?.text) {
					editor.updateLayer(textLayer.id, { text: { ...textLayer.text, text: externalText } });
				}
				return;
			}
		}
		if (source.length === 0) return;
		const copies = source.map((layer) =>
			cloneImageEditorLayer(layer, m.image_editor_layer_copy_name({ name: layer.name }))
		);
		editor.mutate('Paste layers', (document) => {
			document.pages
				.find((page) => page.id === editor.activePageID)
				?.layers.push(...structuredClone(copies));
		});
		editor.selectedLayerIDs = copies.map((layer) => layer.id);
	}

	async function removeBackground(optimizeLarge = false): Promise<void> {
		const layer = editor.selectedLayers[0];
		if (!layer?.image || backgroundBusy) return;
		backgroundBusy = true;
		const finishMetric = startImageEditorMetric('background_removal');
		backgroundError = '';
		backgroundProgress = m.image_editor_background_loading();
		try {
			const response = await fetch(getAuthenticatedMediaURL(`/media/${layer.image.media_id}`), {
				credentials: 'include'
			});
			if (!response.ok) throw new Error(m.image_editor_background_source_failed());
			let source = await response.blob();
			const sourceBitmap = await createImageBitmap(source);
			const sourcePixels = sourceBitmap.width * sourceBitmap.height;
			const sourceMaxDimension = Math.max(sourceBitmap.width, sourceBitmap.height);
			sourceBitmap.close();
			if (
				!optimizeLarge &&
				(source.size > 15 * 1024 * 1024 || sourcePixels > 16_000_000 || sourceMaxDimension > 4096)
			) {
				backgroundOptimizeDialogOpen = true;
				return;
			}
			if (optimizeLarge) {
				backgroundProgress = m.image_editor_background_optimizing();
				source = await optimizeBackgroundSource(source);
			}
			const result = await backgroundRemoval.remove(source, backgroundModelBaseURL, (progress) => {
				backgroundProgress = `${progress.stage} ${Math.round(progress.progress * 100)}%`;
			});
			backgroundProgress = m.image_editor_background_saving();
			const file = new File([result], `${layer.name || 'image'}-no-background.png`, {
				type: 'image/png'
			});
			const uploaded = guestMode
				? await storeGuestImageEditorMedia(editor.id, file)
				: await uploadMediaFile({
						workspaceId: editor.workspaceID,
						file,
						source: 'background_removal',
						parentMediaId: layer.image.media_id,
						designDocumentId: editor.id,
						designPageId: editor.activePageID
					});
			editor.updateLayer(layer.id, {
				image: { ...layer.image, media_id: uploaded.id }
			});
			statusAnnouncement = m.image_editor_background_done();
			finishMetric();
		} catch (cause) {
			finishMetric('error');
			backgroundError = cause instanceof Error ? cause.message : m.image_editor_background_failed();
			statusAnnouncement = backgroundError;
		} finally {
			backgroundBusy = false;
			backgroundProgress = '';
		}
	}

	async function optimizeBackgroundSource(source: Blob): Promise<Blob> {
		const bitmap = await createImageBitmap(source);
		const scale = Math.min(
			1,
			3072 / Math.max(bitmap.width, bitmap.height),
			Math.sqrt(12_000_000 / (bitmap.width * bitmap.height))
		);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext('2d');
		if (!context) {
			bitmap.close();
			throw new Error(m.image_editor_background_preparation_failed());
		}
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) =>
					blob ? resolve(blob) : reject(new Error(m.image_editor_background_prepare_failed())),
				'image/png'
			);
		});
	}

	async function exportDesign(): Promise<void> {
		if (!editor.document || exportBusy) return;
		exportBusy = true;
		const finishMetric = startImageEditorMetric('export');
		exportError = '';
		exportProgress = m.image_editor_export_saving();
		try {
			const saved = await saveNow();
			if (!saved && exportMode !== 'download') {
				throw new Error(m.image_editor_export_save_first());
			}
			const pageIDs = exportAllPages
				? editor.document.pages.map((page) => page.id)
				: [editor.activePageID];
			const rendered = await renderImageEditorPages(editor.document, pageIDs, (done, total) => {
				exportProgress = m.image_editor_rendering_progress({ done, total });
			});
			if (exportMode === 'download') {
				downloadRenderedPages(rendered, editor.document.title);
				exportDialogOpen = false;
				exportSuccessfulByPage = {};
				suppressSavedAnnouncementUntil = Date.now() + 5_000;
				statusAnnouncement = m.image_editor_export_downloaded();
				if (guestMode) {
					trackPublicImageEditorEvent('image_editor_export_completed', {
						format: exportFormat,
						pages: publicImageEditorPageCountBucket(rendered.length)
					});
					postExportDialogOpen = true;
				}
				finishMetric();
				return;
			}
			const mediaIDs: string[] = [];
			for (let index = 0; index < rendered.length; index++) {
				const page = rendered[index];
				const existingMediaID = exportSuccessfulByPage[page.page.id];
				if (existingMediaID) {
					mediaIDs.push(existingMediaID);
					continue;
				}
				exportProgress = m.image_editor_saving_media_progress({
					done: index + 1,
					total: rendered.length
				});
				const file = new File([page.blob], page.filename, { type: page.blob.type });
				const uploaded = await uploadMediaFile({
					workspaceId: editor.workspaceID,
					file,
					source: 'image_editor_export',
					designDocumentId: editor.id,
					designPageId: page.page.id
				});
				mediaIDs.push(uploaded.id);
				exportSuccessfulByPage = {
					...exportSuccessfulByPage,
					[page.page.id]: uploaded.id
				};
				editor.mutate('Record page export', (document) => {
					const target = document.pages.find((item) => item.id === page.page.id);
					if (target) target.latest_export_media_id = uploaded.id;
				});
			}
			await saveNow(mediaIDs[0] ?? '', 'export');
			if (exportMode === 'attach') {
				if (!returnToken) throw new Error(m.image_editor_attach_missing());
				const returnURL = await completeImageEditorReturnToken(returnToken, editor.id, mediaIDs);
				await goto(
					resolve(
						`${returnURL}${returnURL.includes('?') ? '&' : '?'}image_editor_return=${encodeURIComponent(returnToken)}` as '/'
					)
				);
				finishMetric();
				return;
			}
			exportDialogOpen = false;
			exportSuccessfulByPage = {};
			suppressSavedAnnouncementUntil = Date.now() + 5_000;
			statusAnnouncement = m.image_editor_exported_pages({
				count: mediaIDs.length,
				suffix: mediaIDs.length === 1 ? '' : 's'
			});
			finishMetric();
		} catch (cause) {
			finishMetric('error');
			exportError = cause instanceof Error ? cause.message : m.image_editor_export_failed();
			statusAnnouncement = exportError;
		} finally {
			exportBusy = false;
			exportProgress = '';
		}
	}

	const tools: Array<{ key: ImageEditorTool; label: string; icon: typeof MousePointerIcon }> = [
		{ key: 'select', label: m.image_editor_select(), icon: MousePointerIcon },
		{ key: 'marquee', label: m.image_editor_pixel_select(), icon: RectangleSelectIcon },
		{ key: 'lasso', label: m.image_editor_lasso_select(), icon: LassoSelectIcon },
		{ key: 'magic_wand', label: m.image_editor_magic_select(), icon: WandIcon },
		{ key: 'text', label: m.image_editor_text(), icon: TypeIcon },
		{ key: 'shape', label: m.image_editor_shape(), icon: SquareIcon },
		{ key: 'pencil', label: m.image_editor_pencil(), icon: PencilIcon },
		{ key: 'bucket', label: m.image_editor_fill(), icon: PaintBucketIcon },
		{ key: 'eraser', label: m.image_editor_erase(), icon: EraserIcon },
		{ key: 'hand', label: m.image_editor_hand(), icon: HandIcon },
		{ key: 'zoom', label: m.image_editor_zoom(), icon: ZoomInIcon }
	];

	function isMarqueeTool(
		tool: ImageEditorTool
	): tool is Extract<ImageEditorTool, 'marquee' | 'ellipse_marquee'> {
		return tool === 'marquee' || tool === 'ellipse_marquee';
	}

	function isFillTool(
		tool: ImageEditorTool
	): tool is Extract<ImageEditorTool, 'bucket' | 'gradient'> {
		return tool === 'bucket' || tool === 'gradient';
	}

	function isEraserTool(
		tool: ImageEditorTool
	): tool is Extract<ImageEditorTool, 'eraser' | 'magic_eraser'> {
		return tool === 'eraser' || tool === 'magic_eraser';
	}

	function selectionToolLabel(tool: ImageEditorTool): string {
		if (tool === 'marquee') return m.image_editor_rectangle_select();
		if (tool === 'ellipse_marquee') return m.image_editor_ellipse_select();
		if (tool === 'lasso') return m.image_editor_lasso_select();
		if (tool === 'magic_wand') return m.image_editor_magic_select();
		return m.image_editor_pixel_select();
	}
</script>

{#snippet toolGroupIndicator()}
	<span
		aria-hidden="true"
		class="pointer-events-none absolute right-[3px] bottom-[3px] size-[5px] bg-current opacity-50 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
	></span>
{/snippet}

<svelte:window
	onkeydown={handleShortcut}
	onresize={constrainDesktopPanelWidths}
	onpointermove={resizePanels}
	onpointerup={stopPanelResize}
	onpointercancel={stopPanelResize}
/>

<div
	class="image-editor-theme fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground"
	data-testid="image-editor-shell"
	{@attach initializeShell}
>
	<div class="sr-only" aria-live="polite">{statusAnnouncement}</div>
	<header
		class="flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur md:h-12"
	>
		<Button
			variant="ghost"
			size="icon-sm"
			class="size-11 md:size-11 lg:size-8"
			onclick={goBack}
			aria-label={m.common_back()}
		>
			<ArrowLeftIcon />
		</Button>
		<Menubar.Root
			class="ml-1 hidden h-8 gap-0 border-0 bg-transparent p-0 lg:flex"
			aria-label={m.image_editor_menus()}
		>
			<Menubar.Menu value="file">
				<Menubar.Trigger>{m.image_editor_file()}</Menubar.Trigger>
				<Menubar.Content class="min-w-48">
					<Menubar.Item onclick={() => saveNow()} disabled={!editor.canEdit}>
						<SaveIcon />
						{m.common_save()}
						<Menubar.Shortcut>Ctrl S</Menubar.Shortcut>
					</Menubar.Item>
					{#if guestMode}
						<Menubar.Item onclick={saveToOpenPost}>
							{m.image_editor_public_save_openpost()}
						</Menubar.Item>
					{:else}
						<Menubar.Item onclick={openHistory}>{m.image_editor_version_history()}</Menubar.Item>
						<Menubar.Item onclick={() => (checkpointDialogOpen = true)} disabled={!editor.canEdit}>
							{m.image_editor_create_checkpoint()}
						</Menubar.Item>
						<Menubar.Item onclick={openTemplateDialog} disabled={!editor.canEdit}>
							{m.image_editor_save_template()}
						</Menubar.Item>
					{/if}
					<Menubar.Item onclick={openResizeDialog} disabled={!editor.canEdit}>
						{m.image_editor_resize_design()}
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item onclick={() => openExport('download')}>
						<DownloadIcon />
						{m.image_editor_export()}
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="edit">
				<Menubar.Trigger>{m.image_editor_edit()}</Menubar.Trigger>
				<Menubar.Content class="min-w-44">
					<Menubar.Item onclick={() => editor.undo()} disabled={!editor.canUndo}>
						{m.image_editor_undo()}
						<Menubar.Shortcut>Ctrl Z</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onclick={() => editor.redo()} disabled={!editor.canRedo}>
						{m.image_editor_redo()}
						<Menubar.Shortcut>Ctrl ⇧ Z</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Separator />
					<Menubar.Item
						onclick={() => editor.duplicateSelected()}
						disabled={editor.selectedLayerIDs.length === 0}
					>
						{m.image_editor_duplicate()}
						<Menubar.Shortcut>Ctrl J</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item
						onclick={() => editor.deleteSelected()}
						disabled={editor.selectedLayerIDs.length === 0}
					>
						{m.common_delete()}
						<Menubar.Shortcut>⌫</Menubar.Shortcut>
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="layer">
				<Menubar.Trigger>{m.image_editor_layer()}</Menubar.Trigger>
				<Menubar.Content class="min-w-48">
					<Menubar.Item
						onclick={() => editor.groupSelected()}
						disabled={editor.selectedLayers.length < 2}
					>
						<GroupIcon />
						{m.image_editor_group()}
						<Menubar.Shortcut>Ctrl G</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item
						onclick={() => editor.ungroupSelected()}
						disabled={!editor.selectedLayers.some((layer) => layer.type === 'group')}
					>
						<UngroupIcon />
						{m.image_editor_ungroup()}
						<Menubar.Shortcut>Ctrl ⇧ G</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item
						onclick={() => removeBackground()}
						disabled={!editor.selectedLayers[0]?.image}
					>
						<WandIcon />
						{m.image_editor_remove_background()}
					</Menubar.Item>
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="view">
				<Menubar.Trigger>{m.image_editor_view()}</Menubar.Trigger>
				<Menubar.Content class="min-w-48">
					<Menubar.CheckboxItem
						checked={editor.rightPanelVisible}
						onCheckedChange={(checked) => (editor.rightPanelVisible = checked)}
					>
						{m.image_editor_toggle_inspector()}
					</Menubar.CheckboxItem>
					<Menubar.Separator />
					<Menubar.Item
						onclick={() => {
							editor.zoom = 0.75;
							editor.panX = 0;
							editor.panY = 0;
						}}
					>
						{m.image_editor_fit_canvas()}
						<Menubar.Shortcut>Ctrl 0</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.Item onclick={() => (editor.zoom = 1)}>
						{m.image_editor_zoom_100()}
						<Menubar.Shortcut>Ctrl 1</Menubar.Shortcut>
					</Menubar.Item>
					<Menubar.CheckboxItem
						checked={focusedCanvas}
						onCheckedChange={(checked) => (focusedCanvas = checked)}
					>
						{m.image_editor_focused_canvas()}
						<Menubar.Shortcut>F</Menubar.Shortcut>
					</Menubar.CheckboxItem>
				</Menubar.Content>
			</Menubar.Menu>
		</Menubar.Root>
		<SaveIndicator
			saving={editor.saveState === 'saving'}
			saved={savedIndicatorVisible && editor.saveState === 'saved'}
			savingLabel={m.common_saving()}
			savedLabel={guestMode ? m.image_editor_public_saved_device() : m.image_editor_saved()}
			testId="image-editor-save-indicator"
		/>
		{#if ['local', 'offline', 'conflict', 'error'].includes(editor.saveState)}
			<div
				class="hidden max-w-52 min-w-0 items-center gap-1.5 truncate px-2 text-xs text-muted-foreground sm:flex"
				title={editor.saveMessage}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-amber-500"></span>
				<span class="truncate">{editor.saveMessage}</span>
			</div>
		{/if}
		<Input
			value={editor.document?.title ?? ''}
			class="h-11 min-w-0 flex-1 border-transparent bg-transparent px-2 font-medium hover:border-input focus:border-input sm:max-w-56 sm:flex-none md:h-11 lg:ml-auto lg:h-8 lg:max-w-72"
			aria-label={m.image_editor_design_title()}
			disabled={!editor.canEdit}
			oninput={(event) =>
				editor.mutate(
					'Rename design',
					(document) => (document.title = event.currentTarget.value),
					'document-title'
				)}
		/>
		<div class="flex items-center gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				class="size-11 max-[359px]:hidden md:size-11 lg:size-8"
				onclick={() => editor.undo()}
				disabled={!editor.canUndo}
				aria-label={m.image_editor_undo()}><UndoIcon /></Button
			>
			<Button
				variant="ghost"
				size="icon-sm"
				class="size-11 max-[359px]:hidden md:size-11 lg:size-8"
				onclick={() => editor.redo()}
				disabled={!editor.canRedo}
				aria-label={m.image_editor_redo()}><RedoIcon /></Button
			>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="size-11 md:size-11 lg:hidden"
							aria-label={m.image_editor_more_actions()}
						>
							<MoreIcon />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={() => saveNow()} disabled={!editor.canEdit}
						>{m.common_save()}</DropdownMenu.Item
					>
					{#if guestMode}
						<DropdownMenu.Item onclick={saveToOpenPost}
							>{m.image_editor_public_save_openpost()}</DropdownMenu.Item
						>
					{:else}
						<DropdownMenu.Item onclick={openHistory}
							>{m.image_editor_version_history()}</DropdownMenu.Item
						>
						<DropdownMenu.Item
							onclick={() => (checkpointDialogOpen = true)}
							disabled={!editor.canEdit}>{m.image_editor_create_checkpoint()}</DropdownMenu.Item
						>
					{/if}
					<DropdownMenu.Item onclick={() => (mobileSheet = 'layers')}
						>{m.image_editor_layers()}</DropdownMenu.Item
					>
					<DropdownMenu.Item onclick={() => (mobileSheet = 'properties')}
						>{m.image_editor_properties()}</DropdownMenu.Item
					>
					<DropdownMenu.Item
						onclick={() => removeBackground()}
						disabled={!editor.selectedLayers[0]?.image}
						>{m.image_editor_remove_background()}</DropdownMenu.Item
					>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if guestMode}
				<Button
					variant="outline"
					size="sm"
					class="hidden h-8 xl:inline-flex"
					onclick={saveToOpenPost}
				>
					{m.image_editor_public_save_openpost()}
				</Button>
			{/if}
			<Button
				size="sm"
				class="h-11 md:h-11 lg:h-8"
				onclick={() => openExport(returnToken && editor.canEdit ? 'attach' : 'download')}
			>
				{#if returnToken}{m.image_editor_attach()}{:else}{m.image_editor_export()}{/if}
			</Button>
		</div>
	</header>

	{#if !editor.canEdit}
		<div class="border-b bg-muted px-3 py-2 text-center text-xs">
			{readOnlyReason || m.image_editor_read_only()}
		</div>
	{/if}
	{#if backgroundBusy}
		<div class="border-b bg-primary/10 px-3 py-2 text-center text-xs" aria-live="polite">
			{backgroundProgress || m.image_editor_background_removing()}
			<Button variant="ghost" size="xs" class="ml-2" onclick={() => backgroundRemoval.cancel()}
				>{m.common_cancel()}</Button
			>
		</div>
	{/if}
	{#if backgroundError}
		<div
			class="flex items-center justify-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"
			role="alert"
		>
			<span>{backgroundError}</span>
			<Button variant="ghost" size="xs" onclick={() => (backgroundError = '')}
				>{m.common_dismiss()}</Button
			>
		</div>
	{/if}

	<div
		class="image-editor-workspace grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]"
		data-focused={focusedCanvas}
		data-inspector={editor.rightPanelVisible}
		style:--image-editor-assets-width={`${assetPanelWidth}px`}
		style:--image-editor-inspector-width={`${inspectorPanelWidth}px`}
	>
		<nav
			class="hidden min-h-0 flex-col items-center gap-1 border-r bg-background py-2 lg:flex"
			aria-label={m.image_editor_tools()}
		>
			{#each tools as tool (tool.key)}
				{@const Icon = tool.icon}
				{#if tool.key === 'select'}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant={editor.activeTool === 'select' ? 'secondary' : 'ghost'}
									size="icon-sm"
									onclick={() => setTool('select')}
									aria-label={m.image_editor_select_objects()}
									aria-pressed={editor.activeTool === 'select'}
								>
									<MousePointerIcon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{m.image_editor_select_objects()} · V</Tooltip.Content>
					</Tooltip.Root>
				{:else if tool.key === 'marquee'}
					<ContextMenu.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props: tooltipProps })}
									<ContextMenu.Trigger>
										{#snippet child({ props: menuProps })}
											<Button
												{...tooltipProps}
												{...menuProps}
												variant={isMarqueeTool(editor.activeTool) ? 'secondary' : 'ghost'}
												size="icon-sm"
												class="relative"
												onclick={() => setTool(marqueeSlotTool)}
												aria-label={selectionToolLabel(marqueeSlotTool)}
												aria-pressed={isMarqueeTool(editor.activeTool)}
											>
												{#if marqueeSlotTool === 'marquee'}
													<RectangleSelectIcon />
												{:else}
													<CircleDashedIcon />
												{/if}
												{@render toolGroupIndicator()}
											</Button>
										{/snippet}
									</ContextMenu.Trigger>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">
								{selectionToolLabel(marqueeSlotTool)}
							</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => setTool('marquee')}
								>
									<RectangleSelectIcon />
									{m.image_editor_rectangle_select()}
									<span class="ml-auto text-xs text-muted-foreground">M</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => setTool('ellipse_marquee')}
								>
									<CircleDashedIcon />
									{m.image_editor_ellipse_select()}
									<span class="ml-auto text-xs text-muted-foreground">⇧M</span>
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Portal>
					</ContextMenu.Root>
				{:else if tool.key === 'shape'}
					<ContextMenu.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props: tooltipProps })}
									<ContextMenu.Trigger disabled={!editor.canEdit}>
										{#snippet child({ props: menuProps })}
											<Button
												{...tooltipProps}
												{...menuProps}
												variant="ghost"
												size="icon-sm"
												class="relative"
												onclick={() => insertShape(shapeSlotKind)}
												aria-label={m.image_editor_add_shape()}
												disabled={!editor.canEdit}
											>
												{#if shapeSlotKind === 'ellipse'}
													<CircleIcon />
												{:else if shapeSlotKind === 'line'}
													<MinusIcon />
												{:else}
													<SquareIcon />
												{/if}
												{@render toolGroupIndicator()}
											</Button>
										{/snippet}
									</ContextMenu.Trigger>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">{m.image_editor_add_shape()} · U</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => insertShape('rectangle')}
								>
									<SquareIcon />
									{m.image_editor_rectangle()}
									<span class="ml-auto text-xs text-muted-foreground">U</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => insertShape('rounded_rectangle')}
								>
									<SquareIcon />
									{m.image_editor_rounded_rectangle()}
								</ContextMenu.Item>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => insertShape('ellipse')}
								>
									<CircleIcon />
									{m.image_editor_ellipse()}
								</ContextMenu.Item>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => insertShape('line')}
								>
									<MinusIcon />
									{m.image_editor_line()}
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Portal>
					</ContextMenu.Root>
				{:else if tool.key === 'bucket'}
					<ContextMenu.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props: tooltipProps })}
									<ContextMenu.Trigger disabled={!editor.canEdit}>
										{#snippet child({ props: menuProps })}
											<Button
												{...tooltipProps}
												{...menuProps}
												variant={isFillTool(editor.activeTool) ? 'secondary' : 'ghost'}
												size="icon-sm"
												class="relative"
												onclick={() => setTool(fillSlotTool)}
												aria-label={fillSlotTool === 'gradient'
													? m.image_editor_gradient()
													: m.image_editor_paint_bucket()}
												disabled={!editor.canEdit}
											>
												{#if fillSlotTool === 'gradient'}
													<BlendIcon />
												{:else}
													<PaintBucketIcon />
												{/if}
												{@render toolGroupIndicator()}
											</Button>
										{/snippet}
									</ContextMenu.Trigger>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">{m.image_editor_fill()}</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => setTool('bucket')}
								>
									<PaintBucketIcon />
									{m.image_editor_paint_bucket()}
									<span class="ml-auto text-xs text-muted-foreground">⇧G</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => setTool('gradient')}
								>
									<BlendIcon />
									{m.image_editor_gradient()}
									<span class="ml-auto text-xs text-muted-foreground">G</span>
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Portal>
					</ContextMenu.Root>
				{:else if tool.key === 'eraser'}
					<ContextMenu.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props: tooltipProps })}
									<ContextMenu.Trigger disabled={!editor.canEdit}>
										{#snippet child({ props: menuProps })}
											<Button
												{...tooltipProps}
												{...menuProps}
												variant={isEraserTool(editor.activeTool) ? 'secondary' : 'ghost'}
												size="icon-sm"
												class="relative"
												onclick={() => setTool(eraserSlotTool)}
												aria-label={eraserSlotTool === 'magic_eraser'
													? m.image_editor_magic_erase()
													: m.image_editor_erase()}
												disabled={!editor.canEdit}
											>
												{#if eraserSlotTool === 'magic_eraser'}
													<WandIcon />
												{:else}
													<EraserIcon />
												{/if}
												{@render toolGroupIndicator()}
											</Button>
										{/snippet}
									</ContextMenu.Trigger>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">{m.image_editor_erase()}</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => setTool('eraser')}
								>
									<EraserIcon />
									{m.image_editor_erase()}
									<span class="ml-auto text-xs text-muted-foreground">E</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class={TOOL_CONTEXT_MENU_ITEM_CLASS}
									onclick={() => setTool('magic_eraser')}
								>
									<WandIcon />
									{m.image_editor_magic_erase()}
									<span class="ml-auto text-xs text-muted-foreground">⇧E</span>
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Portal>
					</ContextMenu.Root>
				{:else}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant={editor.activeTool === tool.key ? 'secondary' : 'ghost'}
									size="icon-sm"
									onclick={() => setTool(tool.key)}
									aria-label={tool.label}
									aria-pressed={editor.activeTool === tool.key}
									disabled={!editor.canEdit && !['select', 'hand', 'zoom'].includes(tool.key)}
								>
									<Icon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{tool.label}</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{/each}
		</nav>
		{#if !focusedCanvas}
			<aside
				class="relative hidden min-h-0 min-w-0 overflow-hidden border-r bg-background lg:block"
			>
				<AssetPanel {guestMode} />
				<button
					type="button"
					aria-label={m.image_editor_resize_asset_panel()}
					title={m.image_editor_resize_asset_panel()}
					class="image-editor-resize-handle absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0"
					onpointerdown={(event) => startPanelResize(event, 'assets')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'assets')}
				></button>
			</aside>
		{/if}
		<main class="relative min-h-0 min-w-0">
			<div
				class="absolute inset-0 {focusedCanvas
					? 'bottom-0'
					: editor.pagesExpanded
						? 'bottom-[8.75rem] lg:bottom-33'
						: 'bottom-11 lg:bottom-9'}"
			>
				<ImageEditorCanvas />
			</div>
			<div
				class="absolute right-3 {focusedCanvas
					? 'bottom-3'
					: editor.pagesExpanded
						? 'bottom-[9.5rem] lg:bottom-36'
						: 'bottom-14 lg:bottom-12'} z-10 flex items-center gap-1 rounded-lg bg-background/90 p-1 shadow ring-1 ring-black/10"
			>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-11 md:size-11 lg:size-7"
					onclick={() => (editor.zoom = Math.max(0.1, editor.zoom - 0.1))}
					aria-label={m.image_editor_zoom_out()}>−</Button
				>
				<button
					type="button"
					class="min-h-11 min-w-14 rounded px-2 text-xs md:min-h-11 lg:min-h-7"
					onclick={() => {
						editor.zoom = 0.75;
						editor.panX = 0;
						editor.panY = 0;
					}}
				>
					{Math.round(editor.zoom * 100)}%
				</button>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-11 md:size-11 lg:size-7"
					onclick={() => (editor.zoom = Math.min(4, editor.zoom + 0.1))}
					aria-label={m.image_editor_zoom_in()}>+</Button
				>
			</div>
			{#if !focusedCanvas}
				<div class="absolute inset-x-0 bottom-0">
					<PageStrip />
				</div>
			{/if}
		</main>
		{#if editor.rightPanelVisible && !focusedCanvas}
			<aside
				bind:this={inspectorElement}
				class="image-editor-inspector relative hidden min-h-0 min-w-0 overflow-hidden border-l bg-background lg:grid"
				style:--image-editor-layers-height={`${layersPanelHeight}px`}
			>
				<button
					type="button"
					aria-label={m.image_editor_resize_inspector_panel()}
					title={m.image_editor_resize_inspector_panel()}
					class="image-editor-resize-handle absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0"
					onpointerdown={(event) => startPanelResize(event, 'inspector')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'inspector')}
				></button>
				<div class="min-h-0 min-w-0 overflow-hidden"><LayerTree /></div>
				<button
					type="button"
					aria-label={m.image_editor_resize_layers_properties()}
					title={m.image_editor_resize_layers_properties()}
					class="image-editor-resize-handle relative z-10 cursor-row-resize touch-none border-x-0 border-y bg-background p-0"
					onpointerdown={(event) => startPanelResize(event, 'layers')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'layers')}
				></button>
				<div class="min-h-0 min-w-0 overflow-hidden">
					<PropertiesPanel onOpenMedia={openBackgroundMediaPicker} />
				</div>
			</aside>
		{/if}
	</div>

	<nav
		class="flex h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 snap-x overflow-x-auto border-t bg-background px-1 pt-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
		aria-label={m.image_editor_tools()}
	>
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
			onclick={() => (mobileSheet = 'assets')}
		>
			<PanelLeftIcon />
			{m.image_editor_add()}
		</Button>
		{#each tools.filter( (tool) => ['select', 'marquee', 'lasso', 'magic_wand', 'text', 'pencil', 'bucket', 'eraser', 'hand'].includes(tool.key) ) as tool (tool.key)}
			{@const Icon = tool.icon}
			{#if tool.key === 'select'}
				<Button
					variant={editor.activeTool === 'select' ? 'secondary' : 'ghost'}
					class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
					onclick={() => setTool('select')}
					aria-label={m.image_editor_select_objects()}
					aria-pressed={editor.activeTool === 'select'}
				>
					<MousePointerIcon />
					{m.image_editor_select()}
				</Button>
			{:else if tool.key === 'marquee'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant={isMarqueeTool(editor.activeTool) ? 'secondary' : 'ghost'}
								class="relative h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
								aria-label={m.image_editor_pixel_select()}
							>
								{#if editor.activeTool === 'marquee'}
									<RectangleSelectIcon />
								{:else if editor.activeTool === 'ellipse_marquee'}
									<CircleDashedIcon />
								{:else}
									<RectangleSelectIcon />
								{/if}
								{m.image_editor_pixels()}
								{@render toolGroupIndicator()}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="min-w-52">
						<DropdownMenu.Item onclick={() => setTool('marquee')}>
							<RectangleSelectIcon />
							{m.image_editor_rectangle_select()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => setTool('ellipse_marquee')}>
							<CircleDashedIcon />
							{m.image_editor_ellipse_select()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else if tool.key === 'bucket'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant={isFillTool(editor.activeTool) ? 'secondary' : 'ghost'}
								class="relative h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
								disabled={!editor.canEdit}
								aria-label={editor.activeTool === 'gradient'
									? m.image_editor_gradient()
									: m.image_editor_paint_bucket()}
							>
								{#if editor.activeTool === 'gradient'}
									<BlendIcon />
								{:else}
									<PaintBucketIcon />
								{/if}
								{m.image_editor_fill()}
								{@render toolGroupIndicator()}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="min-w-44">
						<DropdownMenu.Item onclick={() => setTool('bucket')}>
							<PaintBucketIcon />
							{m.image_editor_paint_bucket()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => setTool('gradient')}>
							<BlendIcon />
							{m.image_editor_gradient()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else if tool.key === 'eraser'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant={isEraserTool(editor.activeTool) ? 'secondary' : 'ghost'}
								class="relative h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
								disabled={!editor.canEdit}
								aria-label={editor.activeTool === 'magic_eraser'
									? m.image_editor_magic_erase()
									: m.image_editor_erase()}
							>
								{#if editor.activeTool === 'magic_eraser'}
									<WandIcon />
								{:else}
									<EraserIcon />
								{/if}
								{m.image_editor_erase()}
								{@render toolGroupIndicator()}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="min-w-48">
						<DropdownMenu.Item onclick={() => setTool('eraser')}>
							<EraserIcon />
							{m.image_editor_erase()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => setTool('magic_eraser')}>
							<WandIcon />
							{m.image_editor_magic_erase()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<Button
					variant={editor.activeTool === tool.key ? 'secondary' : 'ghost'}
					class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
					onclick={() => setTool(tool.key)}
					disabled={!editor.canEdit && !['select', 'hand'].includes(tool.key)}
				>
					<Icon />
					{tool.label}
				</Button>
			{/if}
		{/each}
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
			onclick={() => (mobileSheet = 'layers')}
		>
			<LayersIcon />
			{m.image_editor_layers()}
		</Button>
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
			onclick={() => (mobileSheet = 'properties')}
		>
			<SlidersIcon />
			{m.image_editor_edit()}
		</Button>
	</nav>
</div>

<Sheet.Root open={mobileSheet !== null} onOpenChange={(open) => !open && (mobileSheet = null)}>
	<Sheet.Content
		side={mobileSheet === 'layers' ? 'right' : 'bottom'}
		class={mobileSheet === 'layers'
			? 'h-dvh! w-full! p-0 sm:max-w-sm!'
			: 'max-h-[82dvh] w-full! rounded-t-2xl p-0'}
	>
		<Sheet.Header class="sr-only">
			<Sheet.Title
				>{mobileSheet === 'assets'
					? m.image_editor_add()
					: mobileSheet === 'layers'
						? m.image_editor_layers()
						: m.image_editor_properties()}</Sheet.Title
			>
			<Sheet.Description>{m.image_editor_editing_controls()}</Sheet.Description>
		</Sheet.Header>
		<div class={mobileSheet === 'layers' ? 'h-full pt-14' : 'max-h-[82dvh] overflow-y-auto pt-12'}>
			{#if mobileSheet === 'assets'}
				<div class="h-[70dvh]"><AssetPanel {guestMode} /></div>
			{:else if mobileSheet === 'layers'}
				<LayerTree />
			{:else if mobileSheet === 'properties'}
				<PropertiesPanel onOpenMedia={openBackgroundMediaPicker} />
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={backgroundOptimizeDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_optimize_title()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_optimize_body()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (backgroundOptimizeDialogOpen = false)}
				>{m.common_cancel()}</Button
			>
			<Button
				onclick={() => {
					backgroundOptimizeDialogOpen = false;
					void removeBackground(true);
				}}>{m.image_editor_optimize_continue()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={historyDialogOpen}>
	<Dialog.Content class="max-h-[85dvh] overflow-hidden sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_version_history()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_history_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
			{#if historyBusy}
				<div class="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
					<LoaderIcon class="mr-2 size-4 animate-spin" />
					{m.image_editor_loading_history()}
				</div>
			{:else if revisions.length === 0}
				<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					{m.image_editor_no_history()}
				</p>
			{:else}
				{#each revisions as revision (revision.id)}
					<div class="flex min-h-14 items-center gap-3 rounded-lg border p-3">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">
								{revision.kind === 'checkpoint'
									? revision.name || m.image_editor_checkpoint()
									: m.image_editor_autosave_revision({ revision: revision.revision })}
							</p>
							<p class="text-xs text-muted-foreground">
								{new Date(revision.created_at).toLocaleString()}
								{#if revision.expires_at}
									·
									{m.image_editor_expires({
										date: new Date(revision.expires_at).toLocaleDateString()
									})}
								{/if}
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							disabled={!editor.canEdit || historyBusy}
							onclick={() => restoreRevision(revision)}>{m.image_editor_restore()}</Button
						>
					</div>
				{/each}
			{/if}
			{#if historyError}
				<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{historyError}
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (historyDialogOpen = false)}
				>{m.common_close()}</Button
			>
			<Button
				onclick={() => {
					historyDialogOpen = false;
					checkpointDialogOpen = true;
				}}
				disabled={!editor.canEdit}>{m.image_editor_create_checkpoint()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={checkpointDialogOpen}>
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
			<Button variant="ghost" onclick={() => (checkpointDialogOpen = false)}
				>{m.common_cancel()}</Button
			>
			<Button onclick={createCheckpoint} disabled={!checkpointName.trim() || historyBusy}>
				{#if historyBusy}<LoaderIcon class="animate-spin" />{/if}
				{m.image_editor_create_checkpoint()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={templateDialogOpen}>
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
			<Button variant="ghost" onclick={() => (templateDialogOpen = false)}
				>{m.common_cancel()}</Button
			>
			<Button onclick={saveAsTemplate} disabled={!templateName.trim() || historyBusy}>
				{#if historyBusy}<LoaderIcon class="animate-spin" />{/if}
				{templateTargetID === 'new'
					? m.image_editor_save_template_action()
					: m.image_editor_replace_template_action()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={resizeDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_resize_design()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_resize_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.image_editor_width()}</span>
					<Input type="number" min="64" max="4096" bind:value={resizeWidth} />
				</label>
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.image_editor_height()}</span>
					<Input type="number" min="64" max="4096" bind:value={resizeHeight} />
				</label>
			</div>
			<RadioGroup.Root bind:value={resizeMode}>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="scale" aria-label={m.image_editor_scale_content()} />
					<span>{m.image_editor_scale_content()}</span>
				</label>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="preserve" aria-label={m.image_editor_preserve_content()} />
					<span>{m.image_editor_preserve_content()}</span>
				</label>
			</RadioGroup.Root>
			{#if resizeError}
				<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{resizeError}
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (resizeDialogOpen = false)}>{m.common_cancel()}</Button
			>
			<Button onclick={resizeDocument}>{m.image_editor_resize()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={exportDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_export_design()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_export_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<div class="rounded-xl border bg-muted/35 p-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p class="text-sm font-semibold">
							{exportFormat.toUpperCase()} · {editor.document?.width_px ?? 0} ×
							{editor.document?.height_px ?? 0}
						</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{m.image_editor_export_summary({
								pages: exportPages.length,
								suffix: exportPages.length === 1 ? '' : 's',
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

			{#if (editor.document?.pages.length ?? 0) > 1}
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
								document.export_defaults.format = value as 'png' | 'jpeg' | 'webp';
							})}
						options={[
							{ value: 'png', label: 'PNG' },
							{ value: 'jpeg', label: 'JPEG' },
							{ value: 'webp', label: 'WebP' }
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
						disabled={!editor.canEdit || editor.document?.export_defaults.format === 'png'}
						ariaLabel={m.image_editor_quality({
							quality: Math.round((editor.document?.export_defaults.quality ?? 0.92) * 100)
						})}
						onValueChange={(quality) =>
							editor.mutate(
								'Change export quality',
								(document) => {
									document.export_defaults.quality = quality;
								},
								'export-quality'
							)}
					/>
				</label>
			</div>

			{#if exportHasTransparency && !exportSupportsTransparency}
				<div class="space-y-3 rounded-lg border border-amber-500/35 bg-amber-500/8 p-3">
					<p class="text-sm leading-relaxed">{m.image_editor_jpeg_transparency_warning()}</p>
					<ImageEditorColorPicker
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
									aria-label={m.image_editor_attach()}
								/>
								<span class="grid gap-0.5">
									<span class="text-sm font-medium">{m.image_editor_attach()}</span>
									<span class="text-xs text-muted-foreground"
										>{m.image_editor_attach_description()}</span
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
			<Button variant="ghost" onclick={() => (exportDialogOpen = false)} disabled={exportBusy}
				>{m.common_cancel()}</Button
			>
			<Button onclick={exportDesign} disabled={exportBusy || !editor.document}>
				{#if exportBusy}<LoaderIcon class="animate-spin" />{/if}
				{exportMode === 'download'
					? m.image_editor_download()
					: exportMode === 'attach'
						? m.image_editor_export_attach()
						: m.image_editor_export_media()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={postExportDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_public_export_title()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_public_export_description()}</Dialog.Description>
		</Dialog.Header>
		<div class="rounded-lg border bg-muted/35 p-3 text-sm text-muted-foreground">
			{m.image_editor_public_cloud_value()}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (postExportDialogOpen = false)}
				>{m.image_editor_public_keep_editing()}</Button
			>
			<Button
				onclick={() => {
					postExportDialogOpen = false;
					void saveToOpenPost();
				}}>{m.image_editor_public_save_openpost()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={conflictDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_conflict_title()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_conflict_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-2">
			<Button onclick={reloadServerVersion}>{m.image_editor_reload_server()}</Button>
			<Button variant="outline" onclick={saveConflictAsCopy}>{m.image_editor_save_copy()}</Button>
			<Button variant="ghost" onclick={() => (conflictDialogOpen = false)}
				>{m.image_editor_continue_local()}</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.image-editor-theme {
		--image-editor-accent: oklch(0.65 0.18 48);
		--image-editor-panel: var(--background);
		--image-editor-panel-border: var(--border);
	}

	.image-editor-resize-handle::after {
		position: absolute;
		content: '';
		background: var(--border);
		transition: background-color 120ms ease-out;
	}

	.image-editor-resize-handle.absolute::after {
		inset-block: 0;
		inset-inline-start: 50%;
		width: 1px;
	}

	.image-editor-inspector > .image-editor-resize-handle.relative::after {
		inset-inline: 0;
		inset-block-start: 50%;
		height: 1px;
	}

	.image-editor-resize-handle:hover::after,
	.image-editor-resize-handle:focus-visible::after {
		background: var(--primary);
	}

	.image-editor-resize-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	@media (max-width: 63.999rem) {
		.image-editor-theme :global(button) {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}

	@media (min-width: 64rem) {
		.image-editor-workspace {
			grid-template-columns:
				44px
				var(--image-editor-assets-width)
				minmax(0, 1fr)
				var(--image-editor-inspector-width);
		}

		.image-editor-workspace[data-inspector='false'] {
			grid-template-columns: 44px var(--image-editor-assets-width) minmax(0, 1fr);
		}

		.image-editor-workspace[data-focused='true'] {
			grid-template-columns: 44px minmax(0, 1fr);
		}

		.image-editor-inspector {
			grid-template-rows: minmax(120px, var(--image-editor-layers-height)) 6px minmax(160px, 1fr);
		}
	}
</style>
