<script lang="ts">
	import { onMount } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { ContextMenu } from 'bits-ui';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Menubar from '$lib/components/ui/menubar';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import PanelResizeHandle from '$lib/components/panel-resize-handle.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
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
	import TemplatePreview from './template-preview.svelte';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import { provideImageEditor, ImageEditorController } from '../editor.svelte';
	import {
		completeImageEditorReturnToken,
		createImageEditorDesign,
		createImageEditorCheckpoint,
		createImageEditorTemplate,
		getImageEditorRevision,
		loadImageEditorDesign,
		listImageEditorRevisions,
		listImageEditorTemplates,
		restoreImageEditorRevision,
		saveImageEditorDesign,
		updateImageEditorTemplate
	} from '../api';
	import {
		imageEditorRevisionHasChanges,
		summarizeImageEditorRevision,
		type ImageEditorRevisionChanges
	} from '../revision-summary';
	import {
		clearLocalImageEditorRecovery,
		loadLocalImageEditorRecovery,
		storeLocalImageEditorRecovery
	} from '../recovery';
	import { saveGuestImageEditorDesign, storeGuestImageEditorMedia } from '../local-persistence';
	import {
		createGuestImageEditorDesignFromDocument,
		getGuestImageEditorMediaForMigration,
		replaceGuestImageEditorMediaIDs
	} from '../local-persistence';
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
	import { imageEditorExportBudget } from '../export-budget';
	import {
		imageEditorPageExportFingerprint,
		reusableImageEditorExports,
		type ImageEditorExportResumeLedger
	} from '../export-resume';
	import { canAttachImageEditorPreview } from '../preview-generation';
	import { saveImageEditorConflictCopy } from '../conflict-recovery';
	import {
		parseImageEditorClipboardLayers,
		parseImageEditorExportResumeLedger,
		parseImageEditorLayoutPreferences,
		parseImageEditorRecentColors,
		parseImageEditorTabMessage,
		parseImageEditorToolPreferences,
		parseImageEditorViewPreferences
	} from '../shell-storage';
	import { ImageEditorBackgroundRemoval } from '../background-removal';
	import type {
		ImageEditorBrandKit,
		ImageEditorDocumentResponse,
		ImageEditorLayer,
		ImageEditorRevisionResponse,
		ImageEditorRevisionSummary,
		ImageEditorTemplate,
		ImageEditorTool
	} from '../types';
	import type { SelectionPoint } from '../selection';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { editorHandoffReturnURL } from '$lib/editor-handoff';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import UndoIcon from '@lucide/svelte/icons/undo-2';
	import RedoIcon from '@lucide/svelte/icons/redo-2';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SaveIcon from '@lucide/svelte/icons/save';
	import MousePointerIcon from '@lucide/svelte/icons/mouse-pointer-2';
	import RectangleSelectIcon from '@lucide/svelte/icons/square-dashed-mouse-pointer';
	import LassoSelectIcon from '@lucide/svelte/icons/lasso-select';
	import TypeIcon from '@lucide/svelte/icons/type';
	import HandIcon from '@lucide/svelte/icons/hand';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import LayersIcon from '@lucide/svelte/icons/layers-3';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import WandIcon from '@lucide/svelte/icons/wand-sparkles';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import PaintBucketIcon from '@lucide/svelte/icons/paint-bucket';
	import BlendIcon from '@lucide/svelte/icons/blend';
	import GroupIcon from '@lucide/svelte/icons/group';
	import UngroupIcon from '@lucide/svelte/icons/ungroup';
	import MoreIcon from '@lucide/svelte/icons/ellipsis';
	import HelpIcon from '@lucide/svelte/icons/circle-help';
	import SquareIcon from '@lucide/svelte/icons/square';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import CropIcon from '@lucide/svelte/icons/crop';
	import PipetteIcon from '@lucide/svelte/icons/pipette';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '../telemetry';
	import {
		imageEditorCommand,
		imageEditorCommandForKeyboardEvent,
		imageEditorCommandsForCategory,
		imageEditorCommandsForMobileGroup,
		imageEditorCommandsForRail,
		imageEditorShortcutLabel,
		IMAGE_EDITOR_COMMANDS,
		type ImageEditorCommandDescriptor,
		type ImageEditorCommandID
	} from '../commands';
	import {
		createImageEditorProjectArchive,
		parseImageEditorProjectArchive,
		safeImageEditorProjectFilename
	} from '../portable-project';
	import {
		assertImageEditorBatchMemory,
		availableImageEditorImportSlots,
		ImageEditorImportError,
		prepareImageEditorImport
	} from '../image-import';

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
	const editorTabID = crypto.randomUUID();
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
	type PixelSelectionActions = {
		copy(): ImageEditorLayer[];
		begin(mode: 'promote' | 'cut'): boolean;
		delete(): boolean;
	};
	type ExternalImportRequest = {
		id: string;
		file: File;
		offset: number;
	};
	type ExternalImportItem = ExternalImportRequest & {
		status: 'waiting' | 'preparing' | 'uploading' | 'complete' | 'failed' | 'cancelled';
		error?: string;
	};
	const INITIAL_SAVE_RETRY_DELAY = 2_000;
	const MAXIMUM_SAVE_RETRY_DELAY = 30_000;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
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
	let exportToastVisible = $state(false);
	let firstEditHintVisible = $state(false);
	let firstEditActionLabel = $state<string | undefined>();
	let helpDialogOpen = $state(false);
	let conflictDialogOpen = $state(false);
	let conflictBusy = $state(false);
	let conflictError = $state('');
	let conflictServerRevision = $state<number | null>(null);
	let conflictPreservedCopy = $state.raw<ImageEditorDocumentResponse | null>(null);
	let recoveryError = $state('');
	let concurrentTabWarning = $state('');
	let missingMedia = $state.raw<Array<{ mediaID: string; layerID?: string }>>([]);
	let initialMissingMediaLoaded = false;
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
	let exportResumeLedger = $state.raw<ImageEditorExportResumeLedger>({});
	let exportAbort: AbortController | null = null;
	let externalDropBusy = $state(false);
	let externalDropProgress = $state('');
	let externalDropError = $state('');
	let externalDropAbort: AbortController | null = null;
	let externalImportItems = $state.raw<ExternalImportItem[]>([]);
	let externalDropRetry = $state.raw<{
		requests: ExternalImportRequest[];
		point: SelectionPoint;
		pageID: string;
	} | null>(null);
	let projectBusy = $state(false);
	let projectError = $state('');
	let projectProgress = $state('');
	let projectAbort = $state.raw<AbortController | null>(null);
	type ParsedImageEditorProject = Awaited<ReturnType<typeof parseImageEditorProjectArchive>>;
	type ProjectImportRecovery = {
		file: File;
		parsed?: ParsedImageEditorProject;
		replacements: Map<string, string>;
		guestDesignID?: string;
		cloudDesignID?: string;
	};
	let projectImportRecovery = $state.raw<ProjectImportRecovery | null>(null);
	let projectFileInput = $state<HTMLInputElement | null>(null);
	let toolPreferencesReady = $state(false);
	let guideDialogOpen = $state(false);
	let guideAxis = $state<'horizontal' | 'vertical'>('vertical');
	let overlayWasOpen = false;
	let overlayReturnFocus: HTMLElement | null = null;

	$effect(() => {
		const overlayOpen = Boolean(
			mobileSheet ||
			backgroundOptimizeDialogOpen ||
			historyDialogOpen ||
			checkpointDialogOpen ||
			templateDialogOpen ||
			resizeDialogOpen ||
			guideDialogOpen ||
			exportDialogOpen ||
			helpDialogOpen ||
			conflictDialogOpen
		);
		if (overlayOpen && !overlayWasOpen) {
			overlayReturnFocus =
				document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}
		if (!overlayOpen && overlayWasOpen) {
			const target = overlayReturnFocus;
			queueMicrotask(() => {
				if (target?.isConnected) target.focus({ preventScroll: true });
			});
			overlayReturnFocus = null;
		}
		overlayWasOpen = overlayOpen;
	});
	let guidePosition = $state(0);
	let backgroundBusy = $state(false);
	let backgroundProgress = $state('');
	let backgroundError = $state('');
	let backgroundOptimizeDialogOpen = $state(false);
	let mobileSheet = $state<'assets' | 'layers' | 'properties' | null>(null);
	let focusedCanvas = $state(false);
	let copiedLayers = $state.raw<ImageEditorLayer[]>([]);
	let pixelSelectionActions = $state.raw<PixelSelectionActions | null>(null);
	let statusAnnouncement = $state('');
	let suppressSavedAnnouncementUntil = 0;
	let revisions = $state<ImageEditorRevisionSummary[]>([]);
	let historyBusy = $state(false);
	let historyPageBusy = $state(false);
	let historyError = $state('');
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
					currentCoverPreviewMediaID: coverPreviewMediaID,
					targetCoverPreviewMediaID: revisionPreview.cover_preview_media_id
				})
			: null
	);
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
	let mobileSelectTool = $state<ImageEditorTool>('select');
	let mobileDrawTool = $state<ImageEditorTool>('pencil');
	let mobileRetouchTool = $state<ImageEditorTool>('eraser');
	let assetPanelWidth = $state(260);
	let inspectorPanelWidth = $state(320);
	let layersPanelHeight = $state(280);
	let pagesPanelHeight = $state(132);
	let inspectorElement = $state<HTMLElement>();
	let desktopViewportWidth = $state(1280);
	let inspectorPanelHeight = $state(680);
	let shortcutModifier = $state('Ctrl');
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
	let exportBudget = $derived(
		editor.document
			? imageEditorExportBudget(
					editor.document,
					exportPages.map((page) => page.id)
				)
			: null
	);

	$effect(() => {
		if (!toolPreferencesReady) return;
		const preferences = {
			selectionMode: editor.selectionMode,
			magicSelectTolerance: editor.magicSelectTolerance,
			magicSelectContiguous: editor.magicSelectContiguous,
			sampleAllLayers: editor.sampleAllLayers,
			eyedropperTarget: editor.eyedropperTarget,
			pencilSize: editor.pencilSize,
			pencilRoughness: editor.pencilRoughness,
			pencilSmoothing: editor.pencilSmoothing,
			pencilPressure: editor.pencilPressure,
			eraserSize: editor.eraserSize,
			magicEraserTolerance: editor.magicEraserTolerance,
			magicEraserContiguous: editor.magicEraserContiguous,
			bucketTolerance: editor.bucketTolerance,
			bucketContiguous: editor.bucketContiguous,
			paintOpacity: editor.paintOpacity,
			gradientType: editor.gradientType,
			gradientReverse: editor.gradientReverse
		};
		try {
			localStorage.setItem('openpost-image-editor-tools-v1', JSON.stringify(preferences));
		} catch {
			// Tool preferences are optional when browser storage is unavailable.
		}
	});

	function initializeShell() {
		if (!initialMissingMediaLoaded) {
			initialMissingMediaLoaded = true;
			missingMedia = (initial.missing_local_media_ids ?? []).map((mediaID) => ({ mediaID }));
		}
		if (!editor.document) {
			editor.load(initial);
			editor.setBrandKit(initialBrandKit);
			coverPreviewMediaID = initial.cover_preview_media_id ?? '';
		}
	}

	function openExport(mode: 'download' | 'media' | 'attach'): void {
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
		exportMode = guestMode ? 'download' : mode;
		exportError = '';
		loadExportResumeLedger();
		exportDialogOpen = true;
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

	async function saveToOpenPost(): Promise<void> {
		if (guestMode && !(await saveNow(undefined, 'close'))) return;
		await onSaveToOpenPost?.();
	}

	onMount(() => {
		const designChannel =
			!guestMode && typeof BroadcastChannel !== 'undefined'
				? new BroadcastChannel(`openpost-image-editor:${editor.id}`)
				: null;
		if (designChannel) {
			designChannel.onmessage = (event: MessageEvent) => {
				const message = parseImageEditorTabMessage(event.data);
				if (message.tabID === editorTabID) return;
				if (message.type === 'editing') {
					concurrentTabWarning = m.image_editor_concurrent_tab_warning();
				}
				if (
					message.type === 'saved' &&
					(message.revision ?? 0) > editor.revision &&
					editor.saveState !== 'saved'
				) {
					conflictServerRevision = message.revision ?? null;
					conflictError = '';
					editor.saveState = 'conflict';
					editor.saveMessage = m.image_editor_save_conflict();
					conflictDialogOpen = true;
				}
			};
		}
		shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
		try {
			const tools = parseImageEditorToolPreferences(
				localStorage.getItem('openpost-image-editor-tools-v1') || '{}'
			);
			if (
				tools.selectionMode &&
				['replace', 'add', 'subtract', 'intersect'].includes(tools.selectionMode)
			)
				editor.selectionMode = tools.selectionMode;
			if (tools.magicSelectTolerance !== undefined)
				editor.magicSelectTolerance = Math.max(0, Math.min(255, tools.magicSelectTolerance));
			if (tools.magicSelectContiguous !== undefined)
				editor.magicSelectContiguous = tools.magicSelectContiguous;
			if (tools.sampleAllLayers !== undefined) editor.sampleAllLayers = tools.sampleAllLayers;
			if (
				tools.eyedropperTarget &&
				['foreground', 'selected_fill', 'selected_stroke', 'page_background'].includes(
					tools.eyedropperTarget
				)
			)
				editor.eyedropperTarget = tools.eyedropperTarget;
			if (tools.pencilSize !== undefined)
				editor.pencilSize = Math.max(1, Math.min(512, tools.pencilSize));
			if (tools.pencilRoughness !== undefined)
				editor.pencilRoughness = Math.max(0, Math.min(1, tools.pencilRoughness));
			if (tools.pencilSmoothing !== undefined)
				editor.pencilSmoothing = Math.max(0, Math.min(0.95, tools.pencilSmoothing));
			if (tools.pencilPressure !== undefined) editor.pencilPressure = tools.pencilPressure;
			if (tools.eraserSize !== undefined)
				editor.eraserSize = Math.max(1, Math.min(512, tools.eraserSize));
			if (tools.magicEraserTolerance !== undefined)
				editor.magicEraserTolerance = Math.max(0, Math.min(255, tools.magicEraserTolerance));
			if (tools.magicEraserContiguous !== undefined)
				editor.magicEraserContiguous = tools.magicEraserContiguous;
			if (tools.bucketTolerance !== undefined)
				editor.bucketTolerance = Math.max(0, Math.min(255, tools.bucketTolerance));
			if (tools.bucketContiguous !== undefined) editor.bucketContiguous = tools.bucketContiguous;
			if (tools.paintOpacity !== undefined)
				editor.paintOpacity = Math.max(0, Math.min(1, tools.paintOpacity));
			if (
				tools.gradientType &&
				['linear', 'radial', 'angle', 'reflected', 'diamond'].includes(tools.gradientType)
			)
				editor.gradientType = tools.gradientType;
			if (tools.gradientReverse !== undefined) editor.gradientReverse = tools.gradientReverse;
		} catch {
			// Invalid tool preferences fall back to tested defaults.
		} finally {
			toolPreferencesReady = true;
		}
		try {
			firstEditActionLabel =
				window.innerWidth < 1024 ? m.image_editor_open_properties() : undefined;
			if (!localStorage.getItem('openpost-image-editor-first-edit-v1')) {
				const textLayers =
					editor.activePage?.layers.filter(
						(layer) => layer.type === 'text' && Boolean(layer.text?.text.trim())
					) ?? [];
				const editableTextLayers = textLayers.filter(
					(layer) => (layer.text?.text.trim().length ?? 0) > 2
				);
				const firstTextLayer = (
					editableTextLayers.length > 0 ? editableTextLayers : textLayers
				).reduce<ImageEditorLayer | undefined>(
					(largest, layer) =>
						!largest || (layer.text?.fontSize ?? 0) > (largest.text?.fontSize ?? 0)
							? layer
							: largest,
					undefined
				);
				if (firstTextLayer) {
					editor.selectLayer(firstTextLayer.id);
					firstEditHintVisible = true;
				}
			}
		} catch {
			// First-edit guidance is optional when browser storage is unavailable.
		}
		try {
			editor.setRecentColors(
				parseImageEditorRecentColors(
					localStorage.getItem('openpost-image-editor-recent-colors-v1') || '[]'
				)
			);
		} catch {
			editor.setRecentColors([]);
		}
		try {
			const stored = parseImageEditorLayoutPreferences(
				localStorage.getItem('openpost-image-editor-layout-v1') || '{}'
			);
			assetPanelWidth = clampPanelSize(stored.assets, 220, 420, assetPanelWidth);
			inspectorPanelWidth = clampPanelSize(stored.inspector, 280, 480, inspectorPanelWidth);
			layersPanelHeight = clampPanelSize(stored.layers, 120, 520, layersPanelHeight);
			pagesPanelHeight = clampPanelSize(stored.pages, 120, 320, pagesPanelHeight);
			constrainDesktopPanelWidths();
		} catch {
			// Invalid local layout preferences fall back to the balanced defaults.
		}
		try {
			const view = parseImageEditorViewPreferences(
				localStorage.getItem('openpost-image-editor-view-v1') || '{}'
			);
			if (view.snapping !== undefined) editor.snappingEnabled = view.snapping;
			if (view.rulers !== undefined) editor.showRulers = view.rulers;
			if (view.guides !== undefined) editor.showGuides = view.guides;
			if (view.grid !== undefined) editor.showGrid = view.grid;
			if (view.snapToGrid !== undefined) editor.snapToGrid = view.snapToGrid;
			if (view.gridSize !== undefined) editor.gridSize = view.gridSize;
		} catch {
			// Invalid view preferences fall back to snapping enabled.
		}
		if (window.innerWidth < 1024 && window.innerHeight <= 520) {
			editor.pagesExpanded = false;
		}
		handleWindowResize();
		const unsubscribe = editor.onChange(() => {
			conflictPreservedCopy = null;
			designChannel?.postMessage({
				type: 'editing',
				tabID: editorTabID,
				revision: editor.revision
			});
			clearTimeout(saveTimer);
			previewGeneration += 1;
			previewPending = !guestMode;
			if (guestMode && !meaningfulEditTracked) {
				meaningfulEditTracked = true;
				trackPublicImageEditorEvent('image_editor_meaningful_edit', { source: 'editor' });
			}
			// Floating pixels are an intentionally transient edit. Persist only after
			// commit so recovery/export can never retain the source hole without its pixels.
			if (editor.floatingPixelSelection) return;
			if (editor.document && !guestMode) {
				void storeLocalImageEditorRecovery({
					design_id: editor.id,
					workspace_id: editor.workspaceID,
					revision: editor.revision,
					document: editor.document
				})
					.then(() => {
						recoveryError = '';
						if (editor.saveState === 'idle') {
							editor.saveState = 'local';
							editor.saveMessage = m.image_editor_saved_locally();
						}
					})
					.catch((cause) => {
						recoveryError =
							cause instanceof DOMException && cause.name === 'QuotaExceededError'
								? m.image_editor_recovery_quota_exhausted()
								: m.image_editor_recovery_store_failed();
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
			clearTimeout(previewTimer);
			backgroundRemoval.dispose();
			designChannel?.close();
			window.removeEventListener('beforeunload', beforeUnload);
		};
	});

	function dismissFirstEditHint(): void {
		firstEditHintVisible = false;
		try {
			localStorage.setItem('openpost-image-editor-first-edit-v1', '1');
		} catch {
			// The hint may return when browser storage is unavailable.
		}
	}

	function openFirstEditProperties(): void {
		if (window.innerWidth < 1024) mobileSheet = 'properties';
		dismissFirstEditHint();
	}

	function toggleInspectorPanel(): void {
		editor.rightPanelVisible = !editor.rightPanelVisible;
		if (!editor.rightPanelVisible) return;
		constrainDesktopPanelWidths();
		requestAnimationFrame(() => {
			constrainLayersPanelHeightFromDom();
			storePanelLayout();
		});
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
		const otherPanelWidth =
			panel === 'assets' ? (editor.rightPanelVisible ? inspectorPanelWidth : 0) : assetPanelWidth;
		const available =
			desktopViewportWidth - DESKTOP_TOOL_RAIL_WIDTH - MINIMUM_CANVAS_WIDTH - otherPanelWidth;
		return Math.max(
			panel === 'assets' ? 220 : 280,
			Math.min(panel === 'assets' ? 420 : 480, available)
		);
	}

	function layersPanelMaximum(): number {
		return Math.max(160, inspectorPanelHeight - 166);
	}

	function constrainLayersPanelHeightFromDom(): void {
		if (window.innerWidth < 1024 || !editor.rightPanelVisible || !inspectorElement) return;
		const measuredHeight = inspectorElement.clientHeight;
		if (measuredHeight <= 0) return;
		inspectorPanelHeight = measuredHeight;
		layersPanelHeight = clampPanelSize(
			layersPanelHeight,
			120,
			layersPanelMaximum(),
			layersPanelHeight
		);
	}

	function constrainDesktopPanelWidths(): void {
		if (window.innerWidth < 1024) return;
		const maximumCombinedWidth =
			desktopViewportWidth - DESKTOP_TOOL_RAIL_WIDTH - MINIMUM_CANVAS_WIDTH;
		let overflow = assetPanelWidth + inspectorPanelWidth - maximumCombinedWidth;
		if (overflow <= 0) return;
		const assetReduction = Math.min(assetPanelWidth - 220, Math.ceil(overflow / 2));
		assetPanelWidth -= assetReduction;
		overflow -= assetReduction;
		inspectorPanelWidth -= Math.min(inspectorPanelWidth - 280, overflow);
	}

	function handleWindowResize(): void {
		desktopViewportWidth = window.innerWidth;
		firstEditActionLabel = window.innerWidth < 1024 ? m.image_editor_open_properties() : undefined;
		constrainDesktopPanelWidths();
		constrainLayersPanelHeightFromDom();
		requestAnimationFrame(() => {
			constrainLayersPanelHeightFromDom();
		});
	}

	function startPanelResize(event: PointerEvent, panel: 'assets' | 'inspector' | 'layers'): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) return;
		handle.focus();
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
			layersPanelHeight = clampPanelSize(
				panelResize.startSize + event.clientY - panelResize.startY,
				120,
				layersPanelMaximum(),
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
					layers: Math.round(layersPanelHeight),
					pages: Math.round(pagesPanelHeight)
				})
			);
		} catch {
			// Layout persistence is optional when browser storage is unavailable.
		}
	}

	function setSnapping(enabled: boolean): void {
		editor.snappingEnabled = enabled;
		statusAnnouncement = enabled ? m.image_editor_snapping_on() : m.image_editor_snapping_off();
		storeViewPreferences();
	}

	function storeViewPreferences(): void {
		try {
			localStorage.setItem(
				'openpost-image-editor-view-v1',
				JSON.stringify({
					snapping: editor.snappingEnabled,
					rulers: editor.showRulers,
					guides: editor.showGuides,
					grid: editor.showGrid,
					snapToGrid: editor.snapToGrid,
					gridSize: editor.gridSize
				})
			);
		} catch {
			// View preferences are optional when browser storage is unavailable.
		}
	}

	function setViewOption(
		option: 'rulers' | 'guides' | 'grid' | 'snapToGrid',
		enabled: boolean
	): void {
		if (option === 'rulers') editor.showRulers = enabled;
		else if (option === 'guides') editor.showGuides = enabled;
		else if (option === 'grid') editor.showGrid = enabled;
		else editor.snapToGrid = enabled;
		storeViewPreferences();
	}

	function openGuideDialog(): void {
		guideAxis = 'vertical';
		guidePosition = Math.round((editor.document?.width_px ?? 0) / 2);
		guideDialogOpen = true;
	}

	function addNumericGuide(): void {
		editor.addGuide(guideAxis, guidePosition);
		guideDialogOpen = false;
	}

	function resizePanelWithKeyboard(
		event: KeyboardEvent,
		panel: 'assets' | 'inspector' | 'layers'
	): void {
		const verticalSeparator = panel === 'assets' || panel === 'inspector';
		if (
			(verticalSeparator && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
			(!verticalSeparator && event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
		)
			return;
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
				layersPanelMaximum(),
				layersPanelHeight
			);
		}
		storePanelLayout();
	}

	async function restoreLocalIfNewer(): Promise<void> {
		if (guestMode) return;
		let local;
		try {
			local = await loadLocalImageEditorRecovery(editor.id);
		} catch {
			recoveryError = m.image_editor_recovery_corrupt();
			return;
		}
		if (!local || local.revision < editor.revision) return;
		if (local.updated_at <= initial.updated_at) return;
		if (validateImageEditorDocument(local.document).length > 0) {
			recoveryError = m.image_editor_recovery_corrupt();
			await clearLocalImageEditorRecovery(editor.id).catch(() => undefined);
			return;
		}
		editor.document = local.document;
		editor.saveState = 'local';
		editor.saveMessage = m.image_editor_recovered_local();
		statusAnnouncement = m.image_editor_recovered_announcement();
	}

	function saveNow(
		nextCoverPreviewMediaID: string | undefined = undefined,
		recoveryReason: 'idle' | 'export' | 'close' = 'idle'
	): Promise<boolean> {
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
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

	function openConflictRecovery(): void {
		conflictServerRevision = null;
		conflictError = '';
		editor.saveState = 'conflict';
		editor.saveMessage = m.image_editor_save_conflict();
		conflictDialogOpen = true;
		statusAnnouncement = m.image_editor_conflict_title();
		void loadImageEditorDesign(editor.id)
			.then((latest) => {
				if (conflictDialogOpen && latest.revision > editor.revision) {
					conflictServerRevision = latest.revision;
				}
			})
			.catch(() => undefined);
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
			if (!guestMode && typeof BroadcastChannel !== 'undefined') {
				const channel = new BroadcastChannel(`openpost-image-editor:${editor.id}`);
				channel.postMessage({ type: 'saved', tabID: editorTabID, revision: response.revision });
				channel.close();
			}
			coverPreviewMediaID = response.cover_preview_media_id ?? '';
			if (editor.document === submittedDocument) {
				// Keep the current identity when the server accepted it unchanged. Replacing
				// it resets every document consumer, including the page-strip previews.
				if (JSON.stringify(response.document) !== JSON.stringify(submittedDocument)) {
					editor.document = response.document;
				}
				editor.saveState = 'saved';
				editor.saveMessage = guestMode
					? m.image_editor_public_saved_device()
					: m.image_editor_saved();
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
			const status = apiErrorStatus(cause);
			const retryable = !navigator.onLine || !status || status === 429 || status >= 500;
			if (status === 409) {
				openConflictRecovery();
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
		if (!editor.document || conflictBusy) return;
		conflictBusy = true;
		conflictError = '';
		try {
			conflictPreservedCopy ??= await saveImageEditorConflictCopy(editor.id, editor.document);
			const response = await loadImageEditorDesign(editor.id);
			editor.replaceFromServer(response);
			coverPreviewMediaID = response.cover_preview_media_id ?? '';
			await clearLocalImageEditorRecovery(editor.id);
			conflictDialogOpen = false;
			conflictServerRevision = null;
			conflictPreservedCopy = null;
			statusAnnouncement = m.image_editor_conflict_reloaded_with_copy();
		} catch (cause) {
			conflictError =
				cause instanceof Error ? cause.message : m.image_editor_conflict_preserve_failed();
			statusAnnouncement = conflictError;
		} finally {
			conflictBusy = false;
		}
	}

	async function saveConflictAsCopy(): Promise<void> {
		if (!editor.document || conflictBusy) return;
		conflictBusy = true;
		conflictError = '';
		try {
			const saved =
				conflictPreservedCopy ?? (await saveImageEditorConflictCopy(editor.id, editor.document));
			editor.load(saved);
			conflictDialogOpen = false;
			conflictServerRevision = null;
			conflictPreservedCopy = null;
			await clearLocalImageEditorRecovery(editor.id);
			await goto(resolveAppPath(`/image-editor/${saved.id}`));
		} catch (cause) {
			conflictError =
				cause instanceof Error ? cause.message : m.image_editor_conflict_preserve_failed();
			statusAnnouncement = conflictError;
		} finally {
			conflictBusy = false;
		}
	}

	async function projectMediaSource(id: string): Promise<{
		name: string;
		mimeType: string;
		blob: Blob;
	}> {
		if (guestMode) {
			try {
				const local = await getGuestImageEditorMediaForMigration(id);
				return { name: local.name, mimeType: local.mimeType, blob: local.blob };
			} catch {
				// Built-in templates can retain server-hosted source media in a guest document.
			}
		}
		const response = await fetch(getAuthenticatedMediaURL(`/media/${id}`), {
			credentials: 'include'
		});
		if (!response.ok) throw new Error(m.image_editor_project_media_failed());
		const blob = await response.blob();
		const extension =
			blob.type === 'image/png'
				? 'png'
				: blob.type === 'image/webp'
					? 'webp'
					: blob.type === 'image/jpeg'
						? 'jpg'
						: blob.type.includes('font') || blob.type.includes('woff')
							? 'woff2'
							: 'bin';
		return { name: `${id}.${extension}`, mimeType: blob.type, blob };
	}

	async function exportProject(): Promise<void> {
		if (!editor.document || projectBusy) return;
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
		projectBusy = true;
		projectError = '';
		try {
			const blob = await createImageEditorProjectArchive(editor.document, projectMediaSource);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = safeImageEditorProjectFilename(editor.document.title);
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 0);
			statusAnnouncement = m.image_editor_project_exported();
		} catch (cause) {
			projectError =
				cause instanceof Error ? cause.message : m.image_editor_project_export_failed();
			statusAnnouncement = projectError;
		} finally {
			projectBusy = false;
		}
	}

	async function importProject(event: Event): Promise<void> {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file || projectBusy) return;
		await importProjectFile({ file, replacements: new Map() });
	}

	async function importProjectFile(recovery: ProjectImportRecovery): Promise<void> {
		if (projectBusy) return;
		projectBusy = true;
		projectError = '';
		const controller = new AbortController();
		projectAbort = controller;
		projectImportRecovery = recovery;
		try {
			projectProgress = m.image_editor_project_reading();
			const parsed = recovery.parsed ?? (await parseImageEditorProjectArchive(recovery.file));
			recovery.parsed = parsed;
			controller.signal.throwIfAborted();
			const total = parsed.media.length;
			if (guestMode) {
				if (!recovery.guestDesignID) {
					const created = await createGuestImageEditorDesignFromDocument(parsed.document);
					recovery.guestDesignID = created.id;
				}
				for (let index = 0; index < parsed.media.length; index++) {
					const entry = parsed.media[index];
					if (recovery.replacements.has(entry.id)) continue;
					controller.signal.throwIfAborted();
					projectProgress = m.image_editor_project_import_progress({
						done: index + 1,
						total
					});
					const uploaded = await storeGuestImageEditorMedia(recovery.guestDesignID, entry.file);
					recovery.replacements.set(entry.id, uploaded.id);
				}
				controller.signal.throwIfAborted();
				const imported = replaceGuestImageEditorMediaIDs(parsed.document, recovery.replacements);
				await saveGuestImageEditorDesign(recovery.guestDesignID, imported);
				projectImportRecovery = null;
				await goto(resolveAppPath(`/image-editor/${recovery.guestDesignID}`));
				return;
			}
			for (let index = 0; index < parsed.media.length; index++) {
				const entry = parsed.media[index];
				if (recovery.replacements.has(entry.id)) continue;
				controller.signal.throwIfAborted();
				projectProgress = m.image_editor_project_import_progress({
					done: index + 1,
					total
				});
				const uploaded = await uploadMediaFile({
					workspaceId: editor.workspaceID,
					file: entry.file,
					source: 'upload',
					retentionClass: 'library',
					signal: controller.signal
				});
				recovery.replacements.set(entry.id, uploaded.id);
			}
			controller.signal.throwIfAborted();
			const imported = replaceGuestImageEditorMediaIDs(parsed.document, recovery.replacements);
			let created = recovery.cloudDesignID
				? await loadImageEditorDesign(recovery.cloudDesignID)
				: await createImageEditorDesign(editor.workspaceID, {
						title: imported.title,
						preset_key: 'custom',
						width_px: imported.width_px,
						height_px: imported.height_px
					});
			recovery.cloudDesignID = created.id;
			await saveImageEditorDesign(created.id, created.revision, imported);
			projectImportRecovery = null;
			await goto(resolveAppPath(`/image-editor/${created.id}`));
		} catch (cause) {
			projectError =
				cause instanceof DOMException && cause.name === 'AbortError'
					? m.image_editor_project_import_cancelled_recoverable({
							count: recovery.replacements.size
						})
					: m.image_editor_project_import_partial_recoverable({
							count: recovery.replacements.size,
							error: cause instanceof Error ? cause.message : m.image_editor_project_import_failed()
						});
			statusAnnouncement = projectError;
		} finally {
			projectBusy = false;
			projectProgress = '';
			if (projectAbort === controller) projectAbort = null;
		}
	}

	function cancelProjectImport(): void {
		projectAbort?.abort();
	}

	function reportMissingMedia(mediaID: string, layerID?: string): void {
		if (missingMedia.some((item) => item.mediaID === mediaID && item.layerID === layerID)) return;
		missingMedia = [...missingMedia, { mediaID, layerID }];
		statusAnnouncement = m.image_editor_missing_media_found({ count: missingMedia.length });
	}

	function locateMissingMedia(): void {
		const missing = missingMedia[0];
		if (!missing || !editor.document) return;
		for (const page of editor.document.pages) {
			const layer = page.layers.find(
				(candidate) =>
					candidate.id === missing.layerID || candidate.image?.media_id === missing.mediaID
			);
			if (layer) {
				editor.activePageID = page.id;
				editor.selectLayer(layer.id);
				editor.leftPanel = 'media';
				return;
			}
			if (page.background?.image?.media_id === missing.mediaID) {
				editor.activePageID = page.id;
				editor.selectLayer('');
				editor.leftPanel = 'media';
				return;
			}
		}
	}

	function removeMissingMedia(): void {
		const ids = new Set(missingMedia.map((item) => item.mediaID));
		editor.mutate(m.image_editor_remove_missing_media(), (document) => {
			for (const page of document.pages) {
				page.layers = page.layers.filter((layer) => !layer.image || !ids.has(layer.image.media_id));
				if (page.background?.image && ids.has(page.background.image.media_id)) {
					page.background = {
						type: 'solid',
						color: page.background_color || '#ffffff',
						opacity: 1
					};
				}
			}
		});
		missingMedia = [];
	}

	async function goBack(): Promise<void> {
		if (editor.canEdit) {
			const saved = editor.saveState === 'saved' ? true : await saveNow(undefined, 'close');
			if (!saved) return;
			if (previewTask) await previewTask;
			if (!guestMode && previewPending) await runPreview('close');
		}
		if (returnToken) {
			const returnURL = editorHandoffReturnURL(returnToken, 'image', 'cancelled');
			if (returnURL) {
				await goto(resolveAppPath(returnURL));
				return;
			}
		}
		if (history.length > 1) history.back();
		else void goto(resolveAppPath(guestMode ? '/image-editor' : '/media'));
	}

	async function openHistory(): Promise<void> {
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
			const page = await listImageEditorRevisions(editor.id);
			revisions = page.revisions;
			revisionNextCursor = page.nextCursor ?? '';
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.image_editor_history_load_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function loadMoreRevisions(): Promise<void> {
		if (!revisionNextCursor || historyPageBusy) return;
		historyPageBusy = true;
		historyError = '';
		try {
			const page = await listImageEditorRevisions(editor.id, revisionNextCursor);
			const known = new Set(revisions.map((revision) => revision.id));
			revisions = [...revisions, ...page.revisions.filter((revision) => !known.has(revision.id))];
			revisionNextCursor = page.nextCursor ?? '';
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.image_editor_history_load_failed();
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
		if (historyDialogOpen === open) return;
		historyDialogOpen = open;
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
			const preview = await getImageEditorRevision(editor.id, revision.id, controller.signal);
			if (request === revisionPreviewRequest) revisionPreview = preview;
		} catch (cause) {
			if (request === revisionPreviewRequest) {
				historyError =
					cause instanceof Error ? cause.message : m.image_editor_history_load_failed();
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
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_checkpoint_save_first());
			await createImageEditorCheckpoint(editor.id, checkpointName.trim(), editor.revision);
			checkpointName = '';
			checkpointDialogOpen = false;
			await openHistory();
			statusAnnouncement = m.image_editor_checkpoint_created();
		} catch (cause) {
			if (apiErrorStatus(cause) === 409) {
				checkpointDialogOpen = false;
				setHistoryDialogOpen(false);
				openConflictRecovery();
			} else {
				historyError = cause instanceof Error ? cause.message : m.image_editor_checkpoint_failed();
			}
		} finally {
			historyBusy = false;
		}
	}

	async function restoreRevision(): Promise<void> {
		if (!revisionPreview || !revisionChanges || !imageEditorRevisionHasChanges(revisionChanges)) {
			return;
		}
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.image_editor_checkpoint_save_first());
			const response = await restoreImageEditorRevision(
				editor.id,
				revisionPreview.summary.id,
				editor.revision
			);
			editor.load(response);
			coverPreviewMediaID = response.cover_preview_media_id ?? '';
			await clearLocalImageEditorRecovery(editor.id);
			restoreConfirmOpen = false;
			setHistoryDialogOpen(false);
			statusAnnouncement = m.image_editor_version_restored();
		} catch (cause) {
			if (apiErrorStatus(cause) === 409) {
				restoreConfirmOpen = false;
				setHistoryDialogOpen(false);
				openConflictRecovery();
			} else {
				historyError = cause instanceof Error ? cause.message : m.image_editor_restore_failed();
			}
		} finally {
			historyBusy = false;
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
		editor.fitZoom();
		resizeDialogOpen = false;
	}

	function setTool(tool: ImageEditorTool): void {
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
		if (tool === 'shape') {
			insertShape(shapeSlotKind);
			return;
		}
		if (
			tool === 'crop' &&
			!editor.selectedLayers.some((layer) => layer.type === 'image' && !layer.locked)
		)
			return;
		editor.activeTool = tool;
		if (
			[
				'select',
				'marquee',
				'ellipse_marquee',
				'lasso',
				'magic_wand',
				'eyedropper',
				'hand'
			].includes(tool)
		) {
			mobileSelectTool = tool;
		}
		if (['text', 'pencil', 'bucket', 'gradient'].includes(tool)) mobileDrawTool = tool;
		if (['crop', 'eraser', 'magic_eraser'].includes(tool)) mobileRetouchTool = tool;
		if (isMarqueeTool(tool)) marqueeSlotTool = tool;
		if (isFillTool(tool)) fillSlotTool = tool;
		if (isEraserTool(tool)) eraserSlotTool = tool;
		if (tool === 'text') {
			editor.addText();
			queueMicrotask(() => {
				if (editor.activeTool === 'text') editor.activeTool = 'select';
			});
		}
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

	async function placeExternalFiles(
		files: File[],
		point: SelectionPoint,
		pageID = editor.activePageID,
		offsetBase = 0
	): Promise<void> {
		if (!editor.canEdit || files.length === 0 || externalDropBusy) return;
		const requests = files.map((file, index) => ({
			id: crypto.randomUUID(),
			file,
			offset: offsetBase + index
		}));
		await placeExternalFileRequests(requests, point, pageID);
	}

	async function placeExternalFileRequests(
		requests: ExternalImportRequest[],
		point: SelectionPoint,
		pageID: string
	): Promise<void> {
		if (!editor.canEdit || requests.length === 0 || externalDropBusy) return;
		externalDropBusy = true;
		externalDropError = '';
		externalDropRetry = null;
		externalDropAbort = new AbortController();
		externalImportItems = requests.map((request) => ({ ...request, status: 'waiting' }));
		const signal = externalDropAbort.signal;
		const targetPage = editor.document?.pages.find((page) => page.id === pageID);
		const availableSlots = availableImageEditorImportSlots(targetPage?.layers.length ?? 0);
		const prepared: Array<
			ExternalImportRequest & { preparedFile: File; width: number; height: number }
		> = [];
		let decodedBytes = 0;
		let inserted = 0;
		try {
			for (const [index, request] of requests.entries()) {
				if (signal.aborted) break;
				externalDropProgress = m.image_editor_importing_files({
					current: index + 1,
					total: requests.length
				});
				updateExternalImportItem(request.id, { status: 'preparing', error: undefined });
				try {
					if (prepared.length >= availableSlots) throw new ImageEditorImportError('layer_limit');
					const result = await prepareImageEditorImport(request.file, { guestMode });
					decodedBytes = assertImageEditorBatchMemory(decodedBytes, result.decodedBytes);
					prepared.push({
						...request,
						preparedFile: result.file,
						width: result.width,
						height: result.height
					});
				} catch (cause) {
					updateExternalImportItem(request.id, {
						status: 'failed',
						error: imageEditorImportErrorMessage(cause)
					});
				}
			}

			for (const [index, request] of prepared.entries()) {
				if (signal.aborted) break;
				externalDropProgress = m.image_editor_uploading_file({
					name: request.file.name,
					current: index + 1,
					total: prepared.length
				});
				updateExternalImportItem(request.id, { status: 'uploading', error: undefined });
				try {
					const currentTarget = editor.document?.pages.find((page) => page.id === pageID);
					if (
						!currentTarget ||
						availableImageEditorImportSlots(currentTarget.layers.length) === 0
					) {
						throw new ImageEditorImportError('layer_limit');
					}
					const media = guestMode
						? await storeGuestImageEditorMedia(editor.id, request.preparedFile)
						: await uploadMediaFile({
								workspaceId: editor.workspaceID,
								file: request.preparedFile,
								source: 'upload',
								retentionClass: 'library',
								signal
							});
					const offset = request.offset * 24;
					editor.addImage(
						{
							id: media.id,
							name: media.original_filename,
							width: request.width,
							height: request.height
						},
						{ x: point.x + offset, y: point.y + offset },
						pageID
					);
					inserted++;
					updateExternalImportItem(request.id, { status: 'complete', error: undefined });
				} catch (cause) {
					if (isAbortError(cause)) break;
					updateExternalImportItem(request.id, {
						status: 'failed',
						error: imageEditorImportErrorMessage(cause)
					});
				}
			}

			if (signal.aborted) {
				externalImportItems = externalImportItems.map((item) =>
					item.status === 'waiting' || item.status === 'preparing' || item.status === 'uploading'
						? { ...item, status: 'cancelled' }
						: item
				);
				statusAnnouncement = m.image_editor_import_cancelled({ count: inserted });
			} else {
				statusAnnouncement = m.image_editor_imported_files({ count: inserted });
			}
		} finally {
			if (inserted > 0) editor.refreshMediaLibrary();
			const failed = externalImportItems.filter((item) => item.status === 'failed');
			if (failed.length > 0) {
				// Retain only the files the user can retry. Successful and cancelled files can be
				// large, so release those references as soon as the batch finishes.
				externalImportItems = failed;
				externalDropRetry = {
					requests: failed.map(({ id, file, offset }) => ({ id, file, offset })),
					point,
					pageID
				};
				externalDropError = m.image_editor_import_failed_files({
					failed: failed.length,
					total: requests.length
				});
				statusAnnouncement = externalDropError;
			} else {
				externalImportItems = [];
			}
			externalDropBusy = false;
			externalDropProgress = '';
			externalDropAbort = null;
		}
	}

	function updateExternalImportItem(
		id: string,
		updates: Partial<Pick<ExternalImportItem, 'status' | 'error'>>
	): void {
		externalImportItems = externalImportItems.map((item) =>
			item.id === id ? { ...item, ...updates } : item
		);
	}

	function isAbortError(cause: unknown): boolean {
		return cause instanceof DOMException && cause.name === 'AbortError';
	}

	function apiErrorStatus(cause: unknown): number | undefined {
		if (cause === null || !(cause instanceof Object) || !('status' in cause)) {
			return undefined;
		}
		return Number.isFinite(cause.status) ? Number(cause.status) : undefined;
	}

	function imageEditorImportErrorMessage(cause: unknown): string {
		if (!(cause instanceof ImageEditorImportError)) {
			return cause instanceof Error ? cause.message : m.image_editor_external_drop_failed();
		}
		switch (cause.code) {
			case 'unsupported_type':
				return m.image_editor_import_unsupported_type();
			case 'file_too_large':
				return m.image_editor_import_file_too_large();
			case 'unsafe_svg':
				return m.image_editor_import_unsafe_svg();
			case 'decode_failed':
				return m.image_editor_import_decode_failed();
			case 'dimensions_too_large':
				return m.image_editor_import_dimensions_too_large();
			case 'batch_memory_limit':
				return m.image_editor_import_batch_too_large();
			case 'layer_limit':
				return m.image_editor_import_layer_limit();
		}
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
		if (overlayWasOpen || editableTarget(event.target)) return;
		const key = event.key.toLowerCase();
		if (
			editor.pixelSelection &&
			['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
		) {
			event.preventDefault();
			const distance = event.shiftKey ? 10 : 1;
			const deltaX = key === 'arrowleft' ? -distance : key === 'arrowright' ? distance : 0;
			const deltaY = key === 'arrowup' ? -distance : key === 'arrowdown' ? distance : 0;
			if (editor.floatingPixelSelection) {
				editor.translateFloatingPixelSelection(deltaX, deltaY);
				editor.finishFloatingPixelSelectionMove();
			} else {
				editor.movePixelSelection(editor.pixelSelection.data, deltaX, deltaY);
			}
			return;
		}
		if (
			editor.selectedLayerIDs.length > 0 &&
			['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
		) {
			event.preventDefault();
			const distance = event.shiftKey ? 10 : 1;
			const deltaX = key === 'arrowleft' ? -distance : key === 'arrowright' ? distance : 0;
			const deltaY = key === 'arrowup' ? -distance : key === 'arrowdown' ? distance : 0;
			editor.nudgeSelected(deltaX, deltaY);
			return;
		}
		const command = imageEditorCommandForKeyboardEvent(event);
		if (command) {
			event.preventDefault();
			executeEditorCommand(command);
		}
	}

	function executeEditorCommand(command: ImageEditorCommandID): void {
		if (!commandEnabled(command)) {
			statusAnnouncement = commandDisabledReason(command);
			return;
		}
		commandHandlers[command]();
	}

	const commandHandlers = {
		save: () => void saveNow(),
		save_to_openpost: () => void saveToOpenPost(),
		version_history: () => void openHistory(),
		create_checkpoint: () => (checkpointDialogOpen = true),
		save_template: () => void openTemplateDialog(),
		resize_design: openResizeDialog,
		export_project: () => void exportProject(),
		import_project: () => projectFileInput?.click(),
		export_design: () => openExport('download'),
		undo: undoEditor,
		redo: redoEditor,
		duplicate: () =>
			editor.floatingPixelSelection
				? editor.duplicateFloatingPixelSelection()
				: editor.duplicateSelected(),
		group: () => editor.groupSelected(),
		ungroup: () => editor.ungroupSelected(),
		remove_background: () => void removeBackground(),
		select_all: () => editor.selectAll(),
		deselect: () => (editor.pixelSelection ? editor.clearPixelSelection() : editor.selectLayer('')),
		copy: () => void copySelection(),
		cut: () => void cutSelection(),
		paste: () => void pasteSelection(),
		delete: () => {
			if (editor.floatingPixelSelection) editor.deleteFloatingPixelSelection();
			else if (editor.pixelSelection) pixelSelectionActions?.delete();
			else editor.deleteSelected();
		},
		fit_canvas: () => editor.fitZoom(),
		zoom_100: () => (editor.zoom = 1),
		focus_canvas: () => (focusedCanvas = !focusedCanvas),
		toggle_inspector: toggleInspectorPanel,
		toggle_snapping: () => setSnapping(!editor.snappingEnabled),
		toggle_rulers: () => setViewOption('rulers', !editor.showRulers),
		toggle_guides: () => setViewOption('guides', !editor.showGuides),
		toggle_grid: () => setViewOption('grid', !editor.showGrid),
		toggle_snap_grid: () => setViewOption('snapToGrid', !editor.snapToGrid),
		clear_guides: () => editor.clearGuides(),
		add_guide: openGuideDialog,
		open_help: () => (helpDialogOpen = true),
		tool_select: () => setTool('select'),
		tool_marquee: () => setTool('marquee'),
		tool_ellipse_marquee: () => setTool('ellipse_marquee'),
		tool_lasso: () => setTool('lasso'),
		tool_magic_wand: () => setTool('magic_wand'),
		tool_crop: () => setTool('crop'),
		tool_eyedropper: () => setTool('eyedropper'),
		tool_text: () => setTool('text'),
		tool_shape: () => insertShape(shapeSlotKind),
		tool_pencil: () => setTool('pencil'),
		tool_eraser: () => setTool('eraser'),
		tool_magic_eraser: () => setTool('magic_eraser'),
		tool_bucket: () => setTool('bucket'),
		tool_gradient: () => setTool('gradient'),
		tool_hand: () => setTool('hand'),
		tool_zoom: () => setTool('zoom')
	} satisfies Record<ImageEditorCommandID, () => void>;

	function commandEnabled(id: ImageEditorCommandID): boolean {
		const availability = imageEditorCommand(id).availability;
		if (availability === 'always') return true;
		if (availability === 'editable') return editor.canEdit;
		if (availability === 'undo') return editor.canUndo;
		if (availability === 'redo') return editor.canRedo;
		if (availability === 'selection') {
			return Boolean(editor.pixelSelection || editor.selectedLayerIDs.length > 0);
		}
		if (availability === 'multi_selection') return editor.selectedLayers.length >= 2;
		if (availability === 'group_selection') {
			return editor.selectedLayers.some((layer) => layer.type === 'group');
		}
		if (availability === 'clipboard') return copiedLayers.length > 0 || editor.canEdit;
		if (availability === 'crop_target') {
			return (
				editor.canEdit &&
				editor.selectedLayers.some((layer) => layer.type === 'image' && !layer.locked)
			);
		}
		if (availability === 'image_selection') {
			return Boolean(editor.selectedLayers.some((layer) => layer.image && !layer.locked));
		}
		if (availability === 'project_idle') return !projectBusy;
		if (availability === 'guides') {
			return Boolean(
				editor.activePage?.guides?.horizontal.length || editor.activePage?.guides?.vertical.length
			);
		}
		return false;
	}

	function commandDisabledReason(id: ImageEditorCommandID): string {
		const availability = imageEditorCommand(id).availability;
		if (availability === 'undo') return m.image_editor_nothing_to_undo();
		if (availability === 'redo') return m.image_editor_nothing_to_redo();
		if (availability === 'selection') return m.image_editor_command_requires_selection();
		if (availability === 'multi_selection')
			return m.image_editor_command_requires_multiple_layers();
		if (availability === 'group_selection') return m.image_editor_command_requires_group();
		if (availability === 'clipboard') return m.image_editor_clipboard_empty();
		if (availability === 'crop_target') return m.image_editor_crop_requires_image();
		if (availability === 'image_selection')
			return m.image_editor_remove_background_requires_image();
		if (availability === 'project_idle') return m.image_editor_project_busy_explanation();
		if (availability === 'guides') return m.image_editor_no_guides_to_clear();
		if (!editor.canEdit) return readOnlyReason || m.image_editor_read_only();
		return '';
	}

	function commandTooltip(id: ImageEditorCommandID): string {
		const reason = commandEnabled(id) ? '' : commandDisabledReason(id);
		const shortcut = commandShortcut(id);
		return [commandLabel(id), shortcut, reason].filter(Boolean).join(' · ');
	}

	function undoEditor(): void {
		const label = editor.undoLabel;
		editor.undo();
		if (label) statusAnnouncement = m.image_editor_undid({ name: label });
	}

	function redoEditor(): void {
		const label = editor.redoLabel;
		editor.redo();
		if (label) statusAnnouncement = m.image_editor_redid({ name: label });
	}

	function commandShortcut(id: ImageEditorCommandID): string {
		const command = IMAGE_EDITOR_COMMANDS.find((candidate) => candidate.id === id);
		return command ? imageEditorShortcutLabel(command, shortcutModifier) : '';
	}

	function commandLabel(id: ImageEditorCommandID): string {
		const labels = {
			save: m.common_save(),
			save_to_openpost: m.image_editor_public_save_openpost(),
			version_history: m.image_editor_version_history(),
			create_checkpoint: m.image_editor_create_checkpoint(),
			save_template: m.image_editor_save_template(),
			resize_design: m.image_editor_resize_design(),
			export_project: m.image_editor_export_project(),
			import_project: m.image_editor_import_project(),
			export_design: m.image_editor_export(),
			undo: m.image_editor_undo(),
			redo: m.image_editor_redo(),
			duplicate: m.image_editor_duplicate(),
			group: m.image_editor_group(),
			ungroup: m.image_editor_ungroup(),
			remove_background: m.image_editor_remove_background(),
			select_all: m.image_editor_select_all(),
			deselect: m.image_editor_deselect(),
			copy: m.common_copy(),
			cut: m.image_editor_cut(),
			paste: m.image_editor_paste(),
			delete: m.common_delete(),
			fit_canvas: m.image_editor_fit_canvas(),
			zoom_100: m.image_editor_zoom_100(),
			focus_canvas: m.image_editor_focused_canvas(),
			toggle_inspector: m.image_editor_toggle_inspector(),
			toggle_snapping: m.image_editor_snapping(),
			toggle_rulers: m.image_editor_rulers(),
			toggle_guides: m.image_editor_guides(),
			toggle_grid: m.image_editor_grid(),
			toggle_snap_grid: m.image_editor_snap_grid(),
			clear_guides: m.image_editor_clear_guides(),
			add_guide: m.image_editor_add_guide_ellipsis(),
			open_help: m.image_editor_help_open(),
			tool_select: m.image_editor_select_objects(),
			tool_marquee: m.image_editor_rectangle_select(),
			tool_ellipse_marquee: m.image_editor_ellipse_select(),
			tool_lasso: m.image_editor_lasso_select(),
			tool_magic_wand: m.image_editor_magic_select(),
			tool_crop: m.image_editor_crop(),
			tool_eyedropper: m.image_editor_eyedropper(),
			tool_text: m.image_editor_text(),
			tool_shape: m.image_editor_shape(),
			tool_pencil: m.image_editor_pencil(),
			tool_eraser: m.image_editor_erase(),
			tool_magic_eraser: m.image_editor_magic_erase(),
			tool_bucket: m.image_editor_paint_bucket(),
			tool_gradient: m.image_editor_gradient(),
			tool_hand: m.image_editor_hand(),
			tool_zoom: m.image_editor_zoom()
		} satisfies Record<ImageEditorCommandID, string>;
		return labels[id];
	}

	function commandVisible(command: ImageEditorCommandDescriptor): boolean {
		return (
			!command.audience ||
			command.audience === 'all' ||
			(command.audience === 'guest' ? guestMode : !guestMode)
		);
	}

	function commandChecked(id: ImageEditorCommandID): boolean {
		if (id === 'toggle_inspector') return editor.rightPanelVisible;
		if (id === 'toggle_snapping') return editor.snappingEnabled;
		if (id === 'toggle_rulers') return editor.showRulers;
		if (id === 'toggle_guides') return editor.showGuides;
		if (id === 'toggle_grid') return editor.showGrid;
		if (id === 'toggle_snap_grid') return editor.snapToGrid;
		if (id === 'focus_canvas') return focusedCanvas;
		return false;
	}

	function setCommandChecked(id: ImageEditorCommandID, checked: boolean): void {
		if (commandChecked(id) !== checked) executeEditorCommand(id);
	}

	function commandMenuLabel(id: ImageEditorCommandID): string {
		if (id === 'undo' && editor.undoLabel) {
			return m.image_editor_undo_named({ name: editor.undoLabel });
		}
		if (id === 'redo' && editor.redoLabel) {
			return m.image_editor_redo_named({ name: editor.redoLabel });
		}
		return commandLabel(id);
	}

	async function copySelection(): Promise<void> {
		copiedLayers = editor.pixelSelection
			? (pixelSelectionActions?.copy() ?? [])
			: structuredClone(editor.selectedLayers);
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

	async function cutSelection(): Promise<void> {
		if (!editor.pixelSelection) {
			await copySelection();
			editor.deleteSelected();
			return;
		}
		await copySelection();
		pixelSelectionActions?.begin('cut');
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
				const document = editor.document;
				const page = editor.activePage;
				if (document && page) {
					source = parseImageEditorClipboardLayers(await blob.text(), document, page);
				}
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
			const document = editor.document;
			if (!document) return;
			await placeExternalFiles(
				[file],
				{ x: document.width_px / 2, y: document.height_px / 2 },
				editor.activePageID
			);
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
						designPageId: editor.activePageID,
						retentionClass: 'library'
					});
			editor.refreshMediaLibrary();
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
		if (!exportBudget?.allowed) {
			exportError = m.image_editor_export_budget_exceeded();
			return;
		}
		exportBusy = true;
		const controller = new AbortController();
		exportAbort = controller;
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
			if (exportMode !== 'download') loadExportResumeLedger();
			const pagesToRender =
				exportMode === 'download'
					? pageIDs
					: pageIDs.filter((pageID) => !exportSuccessfulByPage[pageID]);
			const rendered = await renderImageEditorPages(
				editor.document,
				pagesToRender,
				(done, total) => {
					exportProgress = m.image_editor_rendering_progress({ done, total });
				},
				controller.signal
			);
			if (exportMode === 'download') {
				await downloadRenderedPages(rendered, editor.document.title);
				exportDialogOpen = false;
				exportSuccessfulByPage = {};
				suppressSavedAnnouncementUntil = Date.now() + 5_000;
				statusAnnouncement = m.image_editor_export_downloaded();
				captureTelemetryEvent('image design exported', {
					mode: 'download',
					pages: rendered.length
				});
				if (guestMode) {
					trackPublicImageEditorEvent('image_editor_export_completed', {
						format: exportFormat,
						pages: publicImageEditorPageCountBucket(rendered.length)
					});
					exportToastVisible = true;
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
			if (exportMode === 'attach') {
				if (!returnToken) throw new Error(m.image_editor_attach_missing());
				const returnURL = await completeImageEditorReturnToken(returnToken, editor.id, mediaIDs);
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
			exportDialogOpen = false;
			clearExportResumeLedger();
			captureTelemetryEvent('image design exported', {
				mode: exportMode,
				pages: mediaIDs.length
			});
			suppressSavedAnnouncementUntil = Date.now() + 5_000;
			statusAnnouncement = m.image_editor_exported_pages({
				count: mediaIDs.length,
				suffix: mediaIDs.length === 1 ? '' : 's'
			});
			finishMetric();
		} catch (cause) {
			finishMetric('error');
			exportError =
				cause instanceof DOMException && cause.name === 'AbortError'
					? m.image_editor_export_cancelled_resume({
							count: Object.keys(exportSuccessfulByPage).length
						})
					: cause instanceof Error
						? cause.message
						: m.image_editor_export_failed();
			statusAnnouncement = exportError;
		} finally {
			exportBusy = false;
			exportProgress = '';
			if (exportAbort === controller) exportAbort = null;
		}
	}

	function cancelExport(): void {
		exportAbort?.abort();
	}

	const commandIcons = new Map<ImageEditorCommandID, typeof MousePointerIcon>([
		['tool_select', MousePointerIcon],
		['tool_marquee', RectangleSelectIcon],
		['tool_ellipse_marquee', CircleDashedIcon],
		['tool_lasso', LassoSelectIcon],
		['tool_magic_wand', WandIcon],
		['tool_crop', CropIcon],
		['tool_eyedropper', PipetteIcon],
		['tool_text', TypeIcon],
		['tool_shape', SquareIcon],
		['tool_pencil', PencilIcon],
		['tool_bucket', PaintBucketIcon],
		['tool_gradient', BlendIcon],
		['tool_eraser', EraserIcon],
		['tool_magic_eraser', WandIcon],
		['tool_hand', HandIcon],
		['tool_zoom', ZoomInIcon]
	]);
	const tools = imageEditorCommandsForRail().map((command) => ({
		command,
		key: command.tool!,
		label: commandLabel(command.id),
		icon: commandIcons.get(command.id) ?? MousePointerIcon
	}));

	function mobileToolCommands(group: 'select' | 'draw' | 'retouch') {
		return imageEditorCommandsForMobileGroup(group);
	}

	function railSlotCommands(slot: ImageEditorCommandDescriptor['railSlot']) {
		return IMAGE_EDITOR_COMMANDS.filter((command) => command.railSlot === slot);
	}

	function commandTool(command: ImageEditorCommandDescriptor): ImageEditorTool {
		return command.tool ?? 'select';
	}

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
</script>

{#snippet toolGroupIndicator()}
	<span
		aria-hidden="true"
		class="pointer-events-none absolute right-[3px] bottom-[3px] size-[5px] bg-current opacity-50 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
	></span>
{/snippet}

<svelte:window
	onkeydown={handleShortcut}
	onresize={handleWindowResize}
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
	<Input
		bind:ref={projectFileInput}
		type="file"
		accept=".openpost-image,application/x-openpost-image-project+zip,application/zip"
		class="sr-only"
		tabindex={-1}
		onchange={importProject}
	/>
	<header
		class="flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur md:h-12"
	>
		<Button
			variant="ghost"
			size="icon-sm"
			class="size-11 md:size-11 lg:size-8"
			onclick={goBack}
			aria-label={returnToken ? m.editor_back_to_post() : m.common_back()}
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
					{#each imageEditorCommandsForCategory('file').filter(commandVisible) as command (command.id)}
						{#if command.separatorBefore}<Menubar.Separator />{/if}
						<Menubar.Item
							onclick={() => executeEditorCommand(command.id)}
							disabled={!commandEnabled(command.id)}
							title={commandDisabledReason(command.id) || undefined}
						>
							{#if command.id === 'save'}<SaveIcon />{/if}
							{#if command.id === 'export_design'}<DownloadIcon />{/if}
							{commandMenuLabel(command.id)}
							{#if commandShortcut(command.id)}
								<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
							{/if}
						</Menubar.Item>
					{/each}
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="edit">
				<Menubar.Trigger>{m.image_editor_edit()}</Menubar.Trigger>
				<Menubar.Content class="min-w-44">
					{#each imageEditorCommandsForCategory('edit') as command (command.id)}
						{#if command.separatorBefore}<Menubar.Separator />{/if}
						<Menubar.Item
							onclick={() => executeEditorCommand(command.id)}
							disabled={!commandEnabled(command.id)}
							title={commandDisabledReason(command.id) || undefined}
						>
							{commandMenuLabel(command.id)}
							<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
						</Menubar.Item>
					{/each}
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="layer">
				<Menubar.Trigger>{m.image_editor_layer()}</Menubar.Trigger>
				<Menubar.Content class="min-w-48">
					{#each imageEditorCommandsForCategory('layer') as command (command.id)}
						{#if command.separatorBefore}<Menubar.Separator />{/if}
						<Menubar.Item
							onclick={() => executeEditorCommand(command.id)}
							disabled={!commandEnabled(command.id)}
							title={commandDisabledReason(command.id) || undefined}
						>
							{#if command.id === 'group'}<GroupIcon />{/if}
							{#if command.id === 'ungroup'}<UngroupIcon />{/if}
							{#if command.id === 'remove_background'}<WandIcon />{/if}
							{commandLabel(command.id)}
							<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
						</Menubar.Item>
					{/each}
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="view">
				<Menubar.Trigger>{m.image_editor_view()}</Menubar.Trigger>
				<Menubar.Content class="min-w-48">
					{#each imageEditorCommandsForCategory('view').filter((command) => (command.menuOrder ?? 0) <= 60) as command (command.id)}
						{#if command.separatorBefore}<Menubar.Separator />{/if}
						<Menubar.CheckboxItem
							checked={commandChecked(command.id)}
							onCheckedChange={(checked) => setCommandChecked(command.id, checked)}
						>
							{commandLabel(command.id)}
							{#if command.id === 'toggle_snapping'}
								<Menubar.Shortcut>{shortcutModifier} drag</Menubar.Shortcut>
							{/if}
						</Menubar.CheckboxItem>
					{/each}
					<Menubar.Sub>
						<Menubar.SubTrigger>{m.image_editor_grid_spacing()}</Menubar.SubTrigger>
						<Menubar.SubContent>
							{#each [10, 25, 50, 100, 200] as size (size)}
								<Menubar.Item
									onclick={() => {
										editor.gridSize = size;
										storeViewPreferences();
									}}
								>
									{size} px{editor.gridSize === size ? ' ✓' : ''}
								</Menubar.Item>
							{/each}
						</Menubar.SubContent>
					</Menubar.Sub>
					{#each imageEditorCommandsForCategory('view').filter((command) => (command.menuOrder ?? 0) > 60) as command (command.id)}
						{#if command.separatorBefore}<Menubar.Separator />{/if}
						{#if command.id === 'focus_canvas'}
							<Menubar.CheckboxItem
								checked={commandChecked(command.id)}
								onCheckedChange={(checked) => setCommandChecked(command.id, checked)}
							>
								{commandLabel(command.id)}
								<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
							</Menubar.CheckboxItem>
						{:else}
							<Menubar.Item
								onclick={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								{commandLabel(command.id)}
								{#if commandShortcut(command.id)}
									<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
								{/if}
							</Menubar.Item>
						{/if}
					{/each}
				</Menubar.Content>
			</Menubar.Menu>
			<Menubar.Menu value="help">
				<Menubar.Trigger>{m.image_editor_help()}</Menubar.Trigger>
				<Menubar.Content class="min-w-48">
					{#each imageEditorCommandsForCategory('help') as command (command.id)}
						<Menubar.Item onclick={() => executeEditorCommand(command.id)}>
							<HelpIcon />
							{commandLabel(command.id)}
						</Menubar.Item>
					{/each}
				</Menubar.Content>
			</Menubar.Menu>
		</Menubar.Root>
		<SaveIndicator
			saving={editor.saveState === 'saving'}
			saved={editor.saveState === 'saved'}
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
			class="h-11 min-w-0 flex-1 border-transparent bg-transparent px-2 font-medium hover:border-input focus:border-input max-[359px]:hidden sm:max-w-56 sm:flex-none md:h-11 lg:ml-auto lg:h-8 lg:max-w-72"
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
				class="size-11 md:size-11 lg:size-8"
				onclick={undoEditor}
				disabled={!editor.canUndo}
				aria-label={editor.undoLabel
					? m.image_editor_undo_named({ name: editor.undoLabel })
					: m.image_editor_undo()}><UndoIcon /></Button
			>
			<Button
				variant="ghost"
				size="icon-sm"
				class="size-11 md:size-11 lg:size-8"
				onclick={redoEditor}
				disabled={!editor.canRedo}
				aria-label={editor.redoLabel
					? m.image_editor_redo_named({ name: editor.redoLabel })
					: m.image_editor_redo()}><RedoIcon /></Button
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
					{#each imageEditorCommandsForCategory('edit').filter((command) => command.id === 'undo' || command.id === 'redo') as command (command.id)}
						<DropdownMenu.Item
							onclick={() => executeEditorCommand(command.id)}
							disabled={!commandEnabled(command.id)}
							title={commandDisabledReason(command.id) || undefined}
						>
							{#if command.id === 'undo'}<UndoIcon />{:else}<RedoIcon />{/if}
							{commandMenuLabel(command.id)}
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Separator />
					{#each imageEditorCommandsForCategory('file').filter(commandVisible) as command (command.id)}
						{#if command.separatorBefore}<DropdownMenu.Separator />{/if}
						<DropdownMenu.Item
							onclick={() => executeEditorCommand(command.id)}
							disabled={!commandEnabled(command.id)}
							title={commandDisabledReason(command.id) || undefined}
						>
							{commandMenuLabel(command.id)}
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={() => (mobileSheet = 'layers')}
						>{m.image_editor_layers()}</DropdownMenu.Item
					>
					<DropdownMenu.Item onclick={() => (mobileSheet = 'properties')}
						>{m.image_editor_properties()}</DropdownMenu.Item
					>
					<DropdownMenu.Separator />
					{#each imageEditorCommandsForCategory('view') as command (command.id)}
						{#if command.menuKind === 'checkbox' || command.id === 'focus_canvas'}
							<DropdownMenu.CheckboxItem
								checked={commandChecked(command.id)}
								onCheckedChange={(checked) => setCommandChecked(command.id, checked)}
							>
								{commandLabel(command.id)}
							</DropdownMenu.CheckboxItem>
						{:else}
							<DropdownMenu.Item
								onclick={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								{commandLabel(command.id)}
							</DropdownMenu.Item>
						{/if}
					{/each}
					{#each imageEditorCommandsForCategory('layer').filter((command) => command.id === 'remove_background') as command (command.id)}
						<DropdownMenu.Item
							onclick={() => executeEditorCommand(command.id)}
							disabled={!commandEnabled(command.id)}
							title={commandDisabledReason(command.id) || undefined}
						>
							{commandLabel(command.id)}
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Separator />
					{#each imageEditorCommandsForCategory('help') as command (command.id)}
						<DropdownMenu.Item onclick={() => executeEditorCommand(command.id)}>
							<HelpIcon />
							{commandLabel(command.id)}
						</DropdownMenu.Item>
					{/each}
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
				variant="default"
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
	{#if recoveryError || concurrentTabWarning}
		<div
			class="flex flex-wrap items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
			role="alert"
		>
			<span>{recoveryError || concurrentTabWarning}</span>
			{#if concurrentTabWarning}
				<Button variant="ghost" size="xs" onclick={() => (concurrentTabWarning = '')}>
					{m.common_dismiss()}
				</Button>
			{/if}
		</div>
	{/if}
	{#if missingMedia.length > 0}
		<div
			class="flex flex-wrap items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
			role="alert"
		>
			<span>{m.image_editor_missing_media_found({ count: missingMedia.length })}</span>
			<Button variant="outline" size="xs" onclick={locateMissingMedia}>
				{m.image_editor_locate_missing_media()}
			</Button>
			<Button variant="ghost" size="xs" onclick={removeMissingMedia}>
				{m.image_editor_remove_missing_media()}
			</Button>
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
	{#if projectBusy}
		<div
			class="flex min-h-11 items-center justify-center gap-2 border-b bg-primary/10 px-3 py-1.5 text-center text-xs"
			aria-live="polite"
		>
			{projectProgress || m.image_editor_project_working()}
			{#if projectAbort}
				<Button variant="ghost" size="xs" onclick={cancelProjectImport}>
					{m.common_cancel()}
				</Button>
			{/if}
		</div>
	{/if}
	{#if projectError}
		<div
			class="flex items-center justify-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"
			role="alert"
		>
			<span>{projectError}</span>
			{#if projectImportRecovery}
				<Button
					variant="outline"
					size="xs"
					onclick={() => void importProjectFile(projectImportRecovery!)}
				>
					{m.common_retry()}
				</Button>
			{/if}
			<Button variant="ghost" size="xs" onclick={() => (projectError = '')}>
				{m.common_dismiss()}
			</Button>
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
	{#if externalDropBusy}
		<div
			class="flex min-h-11 items-center justify-center gap-2 border-b bg-primary/10 px-3 py-1.5 text-xs"
			aria-live="polite"
			data-testid="image-editor-import-progress"
		>
			<span class="min-w-0 truncate">{externalDropProgress}</span>
			<Button variant="ghost" size="xs" onclick={() => externalDropAbort?.abort()}>
				{m.common_cancel()}
			</Button>
		</div>
	{/if}
	{#if externalDropError}
		<div
			class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"
			role="alert"
			data-testid="image-editor-import-errors"
		>
			<span>{externalDropError}</span>
			<details class="max-w-full">
				<summary class="cursor-pointer font-medium"
					>{m.image_editor_import_failure_details()}</summary
				>
				<ul class="mt-1 max-h-24 max-w-[min(32rem,85vw)] space-y-0.5 overflow-auto text-left">
					{#each externalImportItems.filter((item) => item.status === 'failed') as item (item.id)}
						<li class="truncate" title={`${item.file.name}: ${item.error ?? ''}`}>
							<span class="font-medium">{item.file.name}</span>: {item.error}
						</li>
					{/each}
				</ul>
			</details>
			{#if externalDropRetry}
				<Button
					variant="ghost"
					size="xs"
					onclick={() => {
						const retry = externalDropRetry;
						if (retry) void placeExternalFileRequests(retry.requests, retry.point, retry.pageID);
					}}
				>
					{m.image_editor_retry_failed_files()}
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="xs"
				onclick={() => {
					externalDropError = '';
					externalDropRetry = null;
					externalImportItems = [];
				}}>{m.common_dismiss()}</Button
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
									onclick={() => executeEditorCommand(tool.command.id)}
									aria-label={commandLabel(tool.command.id)}
									aria-pressed={editor.activeTool === 'select'}
									disabled={!commandEnabled(tool.command.id)}
									title={commandDisabledReason(tool.command.id) || undefined}
								>
									<MousePointerIcon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{commandTooltip(tool.command.id)}</Tooltip.Content>
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
												onclick={() =>
													executeEditorCommand(
														marqueeSlotTool === 'ellipse_marquee'
															? 'tool_ellipse_marquee'
															: 'tool_marquee'
													)}
												aria-label={commandLabel(
													marqueeSlotTool === 'ellipse_marquee'
														? 'tool_ellipse_marquee'
														: 'tool_marquee'
												)}
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
								{commandTooltip(
									marqueeSlotTool === 'ellipse_marquee' ? 'tool_ellipse_marquee' : 'tool_marquee'
								)}
							</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								{#each railSlotCommands('pixel_select') as command (command.id)}
									{@const CommandIcon = commandIcons.get(command.id) ?? RectangleSelectIcon}
									<ContextMenu.Item
										class={TOOL_CONTEXT_MENU_ITEM_CLASS}
										onclick={() => executeEditorCommand(command.id)}
										disabled={!commandEnabled(command.id)}
									>
										<CommandIcon />
										{commandLabel(command.id)}
										<span class="ml-auto text-xs text-muted-foreground"
											>{commandShortcut(command.id)}</span
										>
									</ContextMenu.Item>
								{/each}
							</ContextMenu.Content>
						</ContextMenu.Portal>
					</ContextMenu.Root>
				{:else if tool.key === 'shape'}
					<ContextMenu.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props: tooltipProps })}
									<ContextMenu.Trigger disabled={!commandEnabled(tool.command.id)}>
										{#snippet child({ props: menuProps })}
											<Button
												{...tooltipProps}
												{...menuProps}
												variant="ghost"
												size="icon-sm"
												class="relative"
												onclick={() => executeEditorCommand(tool.command.id)}
												aria-label={commandLabel(tool.command.id)}
												disabled={!commandEnabled(tool.command.id)}
												title={commandDisabledReason(tool.command.id) || undefined}
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
							<Tooltip.Content side="right">{commandTooltip(tool.command.id)}</Tooltip.Content>
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
												onclick={() =>
													executeEditorCommand(
														fillSlotTool === 'gradient' ? 'tool_gradient' : 'tool_bucket'
													)}
												aria-label={commandLabel(
													fillSlotTool === 'gradient' ? 'tool_gradient' : 'tool_bucket'
												)}
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
							<Tooltip.Content side="right">
								{commandTooltip(fillSlotTool === 'gradient' ? 'tool_gradient' : 'tool_bucket')}
							</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								{#each railSlotCommands('fill') as command (command.id)}
									{@const CommandIcon = commandIcons.get(command.id) ?? PaintBucketIcon}
									<ContextMenu.Item
										class={TOOL_CONTEXT_MENU_ITEM_CLASS}
										onclick={() => executeEditorCommand(command.id)}
										disabled={!commandEnabled(command.id)}
									>
										<CommandIcon />{commandLabel(command.id)}
										<span class="ml-auto text-xs text-muted-foreground"
											>{commandShortcut(command.id)}</span
										>
									</ContextMenu.Item>
								{/each}
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
												onclick={() =>
													executeEditorCommand(
														eraserSlotTool === 'magic_eraser' ? 'tool_magic_eraser' : 'tool_eraser'
													)}
												aria-label={commandLabel(
													eraserSlotTool === 'magic_eraser' ? 'tool_magic_eraser' : 'tool_eraser'
												)}
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
							<Tooltip.Content side="right">
								{commandTooltip(
									eraserSlotTool === 'magic_eraser' ? 'tool_magic_eraser' : 'tool_eraser'
								)}
							</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content class={TOOL_CONTEXT_MENU_CLASS}>
								{#each railSlotCommands('erase') as command (command.id)}
									{@const CommandIcon = commandIcons.get(command.id) ?? EraserIcon}
									<ContextMenu.Item
										class={TOOL_CONTEXT_MENU_ITEM_CLASS}
										onclick={() => executeEditorCommand(command.id)}
										disabled={!commandEnabled(command.id)}
									>
										<CommandIcon />{commandLabel(command.id)}
										<span class="ml-auto text-xs text-muted-foreground"
											>{commandShortcut(command.id)}</span
										>
									</ContextMenu.Item>
								{/each}
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
									onclick={() => executeEditorCommand(tool.command.id)}
									aria-label={commandLabel(tool.command.id)}
									aria-pressed={editor.activeTool === tool.key}
									disabled={!commandEnabled(tool.command.id)}
									title={commandDisabledReason(tool.command.id) || undefined}
								>
									<Icon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{commandTooltip(tool.command.id)}</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{/each}
		</nav>
		{#if !focusedCanvas}
			<aside class="relative hidden min-h-0 min-w-0 border-r bg-background lg:block">
				<div class="size-full min-h-0 overflow-hidden"><AssetPanel {guestMode} /></div>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- focusable ARIA Window Splitter -->
				<div
					aria-label={m.image_editor_resize_asset_panel()}
					title={m.image_editor_resize_asset_panel()}
					role="separator"
					tabindex="0"
					aria-orientation="vertical"
					aria-valuemin="220"
					aria-valuemax={panelMaximum('assets')}
					aria-valuenow={Math.round(assetPanelWidth)}
					class="image-editor-resize-handle absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 [@media(pointer:coarse)]:top-1/2 [@media(pointer:coarse)]:-right-5 [@media(pointer:coarse)]:bottom-auto [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-y-1/2"
					onpointerdown={(event) => startPanelResize(event, 'assets')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'assets')}
					ondblclick={() => {
						assetPanelWidth = clampPanelSize(260, 220, panelMaximum('assets'), 260);
						storePanelLayout();
					}}
				></div>
			</aside>
		{/if}
		<main
			class="relative min-h-0 min-w-0"
			style:--image-editor-pages-height={`${pagesPanelHeight}px`}
		>
			<div
				class="absolute inset-0 {focusedCanvas
					? 'bottom-0'
					: editor.pagesExpanded
						? 'bottom-[8.75rem] lg:bottom-[var(--image-editor-pages-height)]'
						: 'bottom-11 lg:bottom-9'}"
			>
				<ImageEditorCanvas
					onExternalFiles={placeExternalFiles}
					onMissingMedia={reportMissingMedia}
					registerPixelSelectionActions={(actions) => (pixelSelectionActions = actions)}
				/>
			</div>
			<div
				class="absolute right-3 {focusedCanvas
					? 'bottom-3'
					: editor.pagesExpanded
						? 'bottom-[9.5rem] lg:bottom-[calc(var(--image-editor-pages-height)_+_0.75rem)]'
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
					onclick={() => editor.fitZoom()}
					aria-label={`${m.image_editor_zoom()} ${Math.round(editor.zoom * 100)}%`}
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
				<div
					class="absolute inset-x-0 bottom-0 {editor.pagesExpanded
						? 'lg:h-[var(--image-editor-pages-height)]'
						: 'lg:h-9'}"
				>
					{#if editor.pagesExpanded}
						<PanelResizeHandle
							edge="top"
							value={pagesPanelHeight}
							minimum={120}
							maximum={320}
							defaultValue={132}
							label={m.image_editor_pages()}
							onresize={(value) => (pagesPanelHeight = value)}
							oncommit={storePanelLayout}
						/>
					{/if}
					<PageStrip onExternalFiles={placeExternalFiles} />
				</div>
			{/if}
		</main>
		{#if editor.rightPanelVisible && !focusedCanvas}
			<aside
				bind:this={inspectorElement}
				class="image-editor-inspector relative hidden min-h-0 min-w-0 border-l bg-background lg:grid"
				style:--image-editor-layers-height={`${layersPanelHeight}px`}
			>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- focusable ARIA Window Splitter -->
				<div
					aria-label={m.image_editor_resize_inspector_panel()}
					title={m.image_editor_resize_inspector_panel()}
					role="separator"
					tabindex="0"
					aria-orientation="vertical"
					aria-valuemin="280"
					aria-valuemax={panelMaximum('inspector')}
					aria-valuenow={Math.round(inspectorPanelWidth)}
					class="image-editor-resize-handle absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 [@media(pointer:coarse)]:top-1/2 [@media(pointer:coarse)]:bottom-auto [@media(pointer:coarse)]:-left-5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-y-1/2"
					onpointerdown={(event) => startPanelResize(event, 'inspector')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'inspector')}
					ondblclick={() => {
						inspectorPanelWidth = clampPanelSize(320, 280, panelMaximum('inspector'), 320);
						storePanelLayout();
					}}
				></div>
				<div class="min-h-0 min-w-0 overflow-hidden"><LayerTree /></div>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- focusable ARIA Window Splitter -->
				<div
					aria-label={m.image_editor_resize_layers_properties()}
					title={m.image_editor_resize_layers_properties()}
					role="separator"
					tabindex="0"
					aria-orientation="horizontal"
					aria-valuemin="120"
					aria-valuemax={layersPanelMaximum()}
					aria-valuenow={Math.round(layersPanelHeight)}
					class="image-editor-resize-handle relative z-10 cursor-row-resize touch-none border-x-0 border-y bg-background p-0"
					onpointerdown={(event) => startPanelResize(event, 'layers')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'layers')}
					ondblclick={() => {
						layersPanelHeight = clampPanelSize(280, 120, layersPanelMaximum(), 280);
						storePanelLayout();
					}}
				></div>
				<div class="min-h-0 min-w-0 overflow-hidden">
					<PropertiesPanel onOpenMedia={openBackgroundMediaPicker} />
				</div>
			</aside>
		{/if}
	</div>

	<nav
		class="flex h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 border-t bg-background px-1 pt-1 pb-[env(safe-area-inset-bottom)] sm:hidden"
		aria-label={m.image_editor_tools()}
	>
		<Button
			variant="ghost"
			class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-[10px]"
			onclick={() => (mobileSheet = 'assets')}
		>
			<PanelLeftIcon />
			<span class="max-w-full truncate">{m.image_editor_add()}</span>
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="contents">
				{#snippet child({ props })}
					<Button
						{...props}
						variant={[
							'select',
							'marquee',
							'ellipse_marquee',
							'lasso',
							'magic_wand',
							'eyedropper',
							'hand'
						].includes(editor.activeTool)
							? 'secondary'
							: 'ghost'}
						class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-[10px]"
						onclick={() => setTool(mobileSelectTool)}
						aria-label={m.image_editor_select()}
					>
						<MousePointerIcon />
						<span class="max-w-full truncate">{m.image_editor_select()}</span>
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="start" class="min-w-52">
				{#each mobileToolCommands('select') as command (command.id)}
					{@const Icon = commandIcons.get(command.id) ?? MousePointerIcon}
					<DropdownMenu.Item
						onclick={() => executeEditorCommand(command.id)}
						disabled={!commandEnabled(command.id)}
						title={commandDisabledReason(command.id) || undefined}
					>
						<Icon />{commandLabel(command.id)}
						<span class="ml-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="contents">
				{#snippet child({ props })}
					<Button
						{...props}
						variant={['text', 'pencil', 'bucket', 'gradient'].includes(editor.activeTool)
							? 'secondary'
							: 'ghost'}
						class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-[10px]"
						onclick={() => setTool(mobileDrawTool)}
						aria-label={m.image_editor_draw()}
					>
						<PencilIcon />
						<span class="max-w-full truncate">{m.image_editor_draw()}</span>
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="start" class="min-w-44">
				{#each mobileToolCommands('draw') as command (command.id)}
					{@const Icon = commandIcons.get(command.id) ?? PencilIcon}
					<DropdownMenu.Item
						onclick={() => executeEditorCommand(command.id)}
						disabled={!commandEnabled(command.id)}
						title={commandDisabledReason(command.id) || undefined}
					>
						<Icon />{commandLabel(command.id)}
						<span class="ml-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="contents">
				{#snippet child({ props })}
					<Button
						{...props}
						variant={['crop', 'eraser', 'magic_eraser'].includes(editor.activeTool)
							? 'secondary'
							: 'ghost'}
						class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-[10px]"
						onclick={() => setTool(mobileRetouchTool)}
						aria-label={m.image_editor_retouch()}
						disabled={!editor.canEdit}
					>
						<EraserIcon />
						<span class="max-w-full truncate">{m.image_editor_retouch()}</span>
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="start" class="min-w-48">
				{#each mobileToolCommands('retouch') as command (command.id)}
					{@const Icon = commandIcons.get(command.id) ?? EraserIcon}
					<DropdownMenu.Item
						onclick={() => executeEditorCommand(command.id)}
						disabled={!commandEnabled(command.id)}
						title={commandDisabledReason(command.id) || undefined}
					>
						<Icon />{commandLabel(command.id)}
						<span class="ml-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Item
					onclick={() => removeBackground()}
					disabled={!editor.selectedLayers[0]?.image}
					><WandIcon />{m.image_editor_remove_background()}</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button
			variant={mobileSheet === 'layers' ? 'secondary' : 'ghost'}
			class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-[10px]"
			onclick={() => (mobileSheet = 'layers')}
		>
			<LayersIcon />
			<span class="max-w-full truncate">{m.image_editor_layers()}</span>
		</Button>
		<Button
			variant={mobileSheet === 'properties' ? 'secondary' : 'ghost'}
			class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-[10px]"
			onclick={() => (mobileSheet = 'properties')}
		>
			<SlidersIcon />
			<span class="max-w-full truncate">{m.image_editor_properties()}</span>
		</Button>
	</nav>

	<nav
		class="hidden h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain border-t bg-background px-1 pt-1 pb-[env(safe-area-inset-bottom)] sm:flex lg:hidden"
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
		{#each tools.filter( (tool) => ['select', 'marquee', 'lasso', 'magic_wand', 'crop', 'eyedropper', 'text', 'pencil', 'bucket', 'eraser', 'hand'].includes(tool.key) ) as tool (tool.key)}
			{@const Icon = tool.icon}
			{#if tool.key === 'select'}
				<Button
					variant={editor.activeTool === 'select' ? 'secondary' : 'ghost'}
					class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
					onclick={() => executeEditorCommand(tool.command.id)}
					aria-label={commandLabel(tool.command.id)}
					aria-pressed={editor.activeTool === 'select'}
					disabled={!commandEnabled(tool.command.id)}
					title={commandDisabledReason(tool.command.id) || undefined}
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
						{#each railSlotCommands('pixel_select') as command (command.id)}
							{@const CommandIcon = commandIcons.get(command.id) ?? RectangleSelectIcon}
							<DropdownMenu.Item
								onclick={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								<CommandIcon />
								{commandLabel(command.id)}
							</DropdownMenu.Item>
						{/each}
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
						{#each railSlotCommands('fill') as command (command.id)}
							{@const CommandIcon = commandIcons.get(command.id) ?? PaintBucketIcon}
							<DropdownMenu.Item
								onclick={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								<CommandIcon />
								{commandLabel(command.id)}
							</DropdownMenu.Item>
						{/each}
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
						{#each railSlotCommands('erase') as command (command.id)}
							{@const CommandIcon = commandIcons.get(command.id) ?? EraserIcon}
							<DropdownMenu.Item
								onclick={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								<CommandIcon />
								{commandLabel(command.id)}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<Button
					variant={editor.activeTool === tool.key ? 'secondary' : 'ghost'}
					class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
					onclick={() => executeEditorCommand(tool.command.id)}
					disabled={!commandEnabled(tool.command.id)}
					title={commandDisabledReason(tool.command.id) || undefined}
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

<Dialog.Root open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
	<Dialog.Content class="max-h-[90dvh] overflow-hidden sm:max-w-4xl">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_version_history()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_history_body()}</Dialog.Description>
		</Dialog.Header>
		<div
			class="grid max-h-[65dvh] min-h-72 gap-4 overflow-hidden sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
		>
			<div class="space-y-2 overflow-y-auto pr-1">
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
						<Button
							variant={revisionPreview?.summary.id === revision.id ? 'secondary' : 'outline'}
							class="h-auto min-h-16 w-full justify-start p-3 text-left whitespace-normal"
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
							{#if historyPageBusy}<LoaderIcon class="mr-2 size-4 animate-spin" />{/if}
							{m.notifications_load_more()}
						</Button>
					{/if}
				{/if}
				{#if historyError}
					<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
						{historyError}
					</p>
				{/if}
			</div>
			<section class="min-h-0 overflow-y-auto rounded-lg border bg-muted/20 p-3" aria-live="polite">
				{#if revisionPreviewBusy}
					<div class="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
						<LoaderIcon class="mr-2 size-4 animate-spin" />
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
					checkpointDialogOpen = true;
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
				{#if historyBusy}<LoaderIcon class="animate-spin" />{/if}
				{m.version_restore_confirm()}
			</Button>
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

<Dialog.Root bind:open={guideDialogOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_add_guide()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_guide_position()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<RadioGroup.Root bind:value={guideAxis} class="grid grid-cols-2 gap-2">
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="horizontal" aria-label={m.image_editor_horizontal()} />
					{m.image_editor_horizontal()}
				</label>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="vertical" aria-label={m.image_editor_vertical()} />
					{m.image_editor_vertical()}
				</label>
			</RadioGroup.Root>
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.image_editor_guide_position()}</span>
				<Input
					type="number"
					min="0"
					max={guideAxis === 'horizontal' ? editor.document?.height_px : editor.document?.width_px}
					bind:value={guidePosition}
					onkeydown={(event) => {
						if (event.key === 'Enter') addNumericGuide();
					}}
				/>
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (guideDialogOpen = false)}>{m.common_cancel()}</Button>
			<Button onclick={addNumericGuide}>{m.image_editor_add_guide()}</Button>
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
			<Button
				variant="ghost"
				onclick={() => (exportBusy ? cancelExport() : (exportDialogOpen = false))}
			>
				{m.common_cancel()}
			</Button>
			<Button
				onclick={exportDesign}
				disabled={exportBusy || !editor.document || !exportBudget?.allowed}
			>
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

{#if exportToastVisible}
	<AppToast
		message={m.image_editor_export_downloaded()}
		tone="success"
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (exportToastVisible = false)}
		actionLabel={guestMode ? m.image_editor_public_save_openpost() : undefined}
		onAction={guestMode ? saveToOpenPost : undefined}
	/>
{/if}

{#if firstEditHintVisible}
	<AppToast
		message={m.image_editor_first_edit_hint()}
		dismissLabel={m.common_dismiss()}
		onDismiss={dismissFirstEditHint}
		actionLabel={firstEditActionLabel}
		onAction={firstEditActionLabel ? openFirstEditProperties : undefined}
	/>
{/if}

<Dialog.Root bind:open={helpDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_help_title()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_help_description()}</Dialog.Description>
		</Dialog.Header>
		<ol class="grid gap-3 text-sm">
			<li class="rounded-lg border p-3"><strong>1.</strong> {m.image_editor_help_select()}</li>
			<li class="rounded-lg border p-3"><strong>2.</strong> {m.image_editor_help_add()}</li>
			<li class="rounded-lg border p-3"><strong>3.</strong> {m.image_editor_help_export()}</li>
		</ol>
		<div class="rounded-lg bg-muted p-3 text-sm">
			<p class="font-medium">{m.image_editor_shortcuts()}</p>
			<dl class="mt-2 grid max-h-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 overflow-y-auto">
				{#each IMAGE_EDITOR_COMMANDS as command (command.id)}
					<dt class="text-muted-foreground">{commandLabel(command.id)}</dt>
					<dd class="text-right font-mono text-xs">{commandShortcut(command.id)}</dd>
				{/each}
			</dl>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={conflictDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_conflict_title()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_conflict_body()}</Dialog.Description>
		</Dialog.Header>
		<p class="text-sm text-muted-foreground">
			{conflictServerRevision === null
				? m.image_editor_conflict_versions_unknown({ local: editor.revision })
				: m.image_editor_conflict_versions({
						local: editor.revision,
						server: conflictServerRevision
					})}
		</p>
		<p class="text-sm text-muted-foreground">
			{m.image_editor_conflict_reload_preserves_copy()}
		</p>
		{#if conflictError}
			<p class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
				{conflictError}
			</p>
		{/if}
		<div class="grid gap-2">
			<Button onclick={reloadServerVersion} disabled={conflictBusy}
				>{conflictBusy
					? m.image_editor_conflict_preserving()
					: m.image_editor_reload_server()}</Button
			>
			<Button variant="outline" onclick={saveConflictAsCopy} disabled={conflictBusy}
				>{m.image_editor_save_copy()}</Button
			>
			<Button variant="ghost" disabled={conflictBusy} onclick={() => (conflictDialogOpen = false)}
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

	@media (hover: hover) and (pointer: fine) {
		.image-editor-resize-handle:hover::after {
			background: var(--primary);
		}
	}

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

	@media (min-width: 64rem) and (pointer: coarse) {
		.image-editor-inspector > .image-editor-resize-handle.relative {
			height: 44px;
			width: 44px;
			align-self: center;
			justify-self: center;
		}
	}
</style>
