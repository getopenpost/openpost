<script lang="ts">
	import { imageEditorErrorMessage } from '$lib/image-editor/animation-error-message';
	import { onMount, tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { replaceEqualDeep } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Menubar from '$lib/components/ui/menubar';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import {
		prepareRasterOperation,
		rasterPlanIsCurrent,
		rasterRenderDocument,
		type ImageEditorRasterOperation
	} from '../raster-operations';
	import { renderImageEditorPage } from '../static-renderer';
	import { cropRasterResult } from '../raster-result';
	import EditorMenubar from '$lib/components/editor-menubar.svelte';
	import EditorHeader from '$lib/components/editor-header.svelte';
	import EditorTitleInput from '$lib/components/editor-title-input.svelte';
	import EditorWorkspaceTabs from '$lib/components/editor-workspace-tabs.svelte';
	import FeedbackDialog from '$lib/components/feedback-dialog.svelte';
	import ImageEditorGuideDialog from './image-editor-guide-dialog.svelte';
	import ImageEditorAssistant from './image-editor-assistant.svelte';
	import ImageAIStudio from './image-ai-studio.svelte';
	let imageAIStudioOpen = $state(false);
	let imageAIStudio = $state<{ openFor: (operation: 'generate' | 'edit' | 'fill') => void }>();
	import ImageEditorVersionsDialogs from './image-editor-versions-dialogs.svelte';
	import ImageEditorExportDialog from './image-editor-export-dialog.svelte';
	import {
		apiErrorStatus,
		imageEditorImportErrorMessage,
		isAbortError
	} from './image-editor-errors';
	import ImageEditorResizeDialog from './image-editor-resize-dialog.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { auth } from '$lib/stores/auth';
	import { Input } from '$lib/components/ui/input';
	import ImageEditorCanvas from './image-editor-canvas.svelte';
	import AssetPanel from './asset-panel.svelte';
	import LayerTree from './layer-tree.svelte';
	import PropertiesPanel from './properties-panel.svelte';
	import PageStrip from './page-strip.svelte';
	import ToolFamilyButton from './tool-family-button.svelte';
	import { provideImageEditor, ImageEditorController } from '../editor.svelte';
	import { connectEditorAgent } from '$lib/editor-agent/browser-relay';
	import { handleImageAgentRequest } from '$lib/editor-agent/image-executor';
	import { createImageEditorDesign, saveImageEditorDesign } from '../api';
	import { queryImageEditorDesign, refreshImageEditorDesign } from '$lib/query/image-editor';
	import {
		clearLocalImageEditorRecovery,
		loadLocalImageEditorRecovery,
		storeLocalImageEditorRecovery
	} from '../recovery';
	import {
		saveGuestImageEditorDesign,
		storeGuestImageEditorMedia,
		storeGuestImageEditorProjectMedia
	} from '../local-persistence';
	import {
		releaseLocalImageEditorMediaForDesign,
		retainLocalImageEditorMediaForDesign
	} from '../local-media-url';
	import {
		createGuestImageEditorDesignFromDocument,
		getGuestImageEditorMediaForMigration,
		replaceGuestImageEditorMediaIDs
	} from '../local-persistence';
	import { trackPublicImageEditorEvent } from '../public-telemetry';
	import {
		cloneImageEditorDocument,
		cloneImageEditorLayer,
		validateImageEditorDocument
	} from '../document';
	import { renderImageEditorPreview } from '../static-renderer';
	import { canAttachImageEditorPreview } from '../preview-generation';
	import { saveImageEditorConflictCopy } from '../conflict-recovery';
	import {
		parseImageEditorClipboardLayers,
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
		ImageEditorTool
	} from '../types';
	import type { SelectionPoint } from '../selection';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { editorHandoffReturnURL, loadEditorHandoff } from '$lib/editor-handoff';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes/contracts.js';
	import type { ProtectedIconRole } from '$lib/themes/icons/protected-icon.js';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '../telemetry';
	import {
		imageEditorCommand,
		imageEditorCommandForKeyboardEvent,
		imageEditorCommandsForCategory,
		imageEditorCommandsForCompactMenu,
		imageEditorCommandsForMobileGroup,
		imageEditorCommandsForRail,
		imageEditorCommandsForRailSlot,
		imageEditorShortcutLabel,
		IMAGE_EDITOR_COMPACT_MENU_CATEGORIES,
		IMAGE_EDITOR_COMMANDS,
		type ImageEditorCompactMenuCategory,
		type ImageEditorCommandDescriptor,
		type ImageEditorCommandID,
		type ImageEditorCommandRailSlot
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

	const coverHandoff = $derived(
		Boolean(returnToken && loadEditorHandoff(returnToken, 'image')?.purpose === 'destination_cover')
	);
	const attachLabel = $derived(
		coverHandoff ? m.compose_cover_use_design() : m.image_editor_attach()
	);

	const editor = provideImageEditor(
		new ImageEditorController({
			textAppearance: () => (coverHandoff ? 'over-image' : 'standard')
		})
	);
	let agentConnectionStatus = $state<'connected' | 'disconnected' | 'working'>('disconnected');
	let agentSessionID = $state<string | null>(null);
	$effect(() => {
		const workspaceID = editor.workspaceID;
		const projectID = editor.id;
		if (guestMode || !editor.canEdit || !workspaceID || !projectID) return;
		return connectEditorAgent({
			workspaceID,
			projectID,
			kind: 'image',
			handle: (request) => handleImageAgentRequest(editor, request),
			onStatus: (status) => (agentConnectionStatus = status),
			onSession: (session) => (agentSessionID = session)
		});
	});
	$effect(() => {
		editor.setBrandKit(initialBrandKit);
	});
	const backgroundRemoval = new ImageEditorBackgroundRemoval();
	const editorTabID = crypto.randomUUID();
	const DESKTOP_TOOL_RAIL_WIDTH = 56;
	const MINIMUM_CANVAS_WIDTH = 320;
	const LEGACY_DEFAULT_LAYERS_HEIGHT = 280;
	const EDIT_LAYERS_USER_SIZED_KEY = 'openpost-image-editor-edit-layers-user-sized-v2';
	const COLOR_LAYERS_HEIGHT_KEY = 'openpost-image-editor-color-layers-height-v1';
	type SaveRequest = {
		coverPreviewMediaID?: string;
		recoveryReason: 'idle' | 'export' | 'close';
	};
	type SaveAttemptResult = 'saved' | 'retry' | 'blocked';
	type EditorMutationView = {
		readonly session: QueryMutationSession;
		readonly workspaceID: string;
		readonly designID: string;
	};
	type PixelSelectionActions = {
		copy(): ImageEditorLayer[];
		begin(mode: 'promote' | 'cut'): boolean;
		delete(): boolean;
		loadLayerAlpha(): boolean;
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
	let editorViewActive = true;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let previewPending = false;
	let previewBusy = false;
	let previewTask: Promise<void> | null = null;
	let previewGeneration = 0;
	let lastPreviewAt = 0;
	let coverPreviewMediaID = '';
	let exportDialogOpen = $state(false);
	let exportDialog = $state<{ openExport: (mode: 'download' | 'media' | 'attach') => void }>();
	let helpDialogOpen = $state(false);
	type CompactMenuSection = ImageEditorCompactMenuCategory | 'file' | 'view' | 'help';
	const compactMenuSections: readonly CompactMenuSection[] = [
		'file',
		...IMAGE_EDITOR_COMPACT_MENU_CATEGORIES,
		'view',
		'help'
	];
	let compactMenuSection = $state<CompactMenuSection | null>(null);
	let compactMenuBack = $state<HTMLDivElement | null>(null);
	let compactMenuItems = $state<Record<CompactMenuSection, HTMLDivElement | null>>({
		file: null,
		edit: null,
		layer: null,
		select: null,
		tools: null,
		view: null,
		help: null
	});
	let compactMenuContent = $state<HTMLDivElement | null>(null);

	async function openCompactMenuSection(section: CompactMenuSection): Promise<void> {
		compactMenuSection = section;
		await tick();
		compactMenuContent?.scrollTo(0, 0);
		compactMenuBack?.focus();
	}

	async function backToCompactMenu(): Promise<void> {
		const section = compactMenuSection;
		compactMenuSection = null;
		await tick();
		compactMenuContent?.scrollTo(0, 0);
		if (section) compactMenuItems[section]?.focus();
	}
	let conflictDialogOpen = $state(false);
	let conflictBusy = $state(false);
	let conflictOperationSequence = 0;
	let conflictError = $state('');
	let conflictServerRevision = $state<number | null>(null);
	let conflictPreservedCopy = $state.raw<ImageEditorDocumentResponse | null>(null);
	let recoveryError = $state('');
	let recoveredDocument: ImageEditorDocumentResponse['document'] | null = null;
	let concurrentTabWarning = $state('');
	let missingMedia = $state.raw<Array<{ mediaID: string; layerID?: string }>>([]);
	let initialMissingMediaLoaded = false;
	let historyDialogOpen = $state(false);
	let versionsDialogs = $state<{
		openHistory: () => Promise<void>;
		openTemplateDialog: () => Promise<void>;
	}>();
	let checkpointDialogOpen = $state(false);
	let templateDialogOpen = $state(false);
	let resizeDialogOpen = $state(false);
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

	function captureEditorMutationView(): EditorMutationView {
		return {
			session: captureQueryMutationSession(),
			workspaceID: editor.workspaceID,
			designID: editor.id
		};
	}

	function editorMutationViewIsCurrent(view: EditorMutationView): boolean {
		return (
			editorViewActive &&
			view.workspaceID === editor.workspaceID &&
			view.designID === editor.id &&
			(guestMode || queryMutationSessionIsCurrent(view.session))
		);
	}
	let projectFileInput = $state<HTMLInputElement | null>(null);
	let toolPreferencesReady = $state(false);
	let guideDialogOpen = $state(false);
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
	let backgroundBusy = $state(false);
	let backgroundProgress = $state('');
	let backgroundError = $state('');
	let rasterBusy = $state(false);
	let rasterError = $state('');
	let rasterAbort: AbortController | null = null;
	let backgroundOptimizeDialogOpen = $state(false);
	let mobileSheet = $state<'assets' | 'layers' | 'properties' | null>(null);
	let assetOverlayOpen = $state(false);
	let assetOverlayTrigger = $state<HTMLButtonElement | null>(null);

	function closeAssetOverlay(): void {
		assetOverlayOpen = false;
		editor.backgroundImagePickerActive = false;
		assetOverlayTrigger?.focus();
	}
	let activeEditorWorkspace = $state<'edit' | 'color'>('edit');
	const desktopViewport = new MediaQuery('(min-width: 1024px)');
	const shortViewport = new MediaQuery('(max-width: 1023px) and (max-height: 520px)');
	const compactPages = $derived(activeEditorWorkspace === 'color' && shortViewport.current);
	const pagesExpanded = $derived(editor.pagesExpanded && !compactPages);
	let focusedCanvas = $state(false);
	$effect(() => {
		if (
			activeEditorWorkspace === 'color' &&
			!focusedCanvas &&
			(!desktopViewport.current || editor.rightPanelVisible)
		)
			return;
		editor.colorComparisonBefore = false;
		editor.colorComparisonPage = false;
		editor.colorComparisonLayerIDs = [];
	});
	let copiedLayers = $state.raw<ImageEditorLayer[]>([]);
	let pixelSelectionActions = $state.raw<PixelSelectionActions | null>(null);
	let statusAnnouncement = $state('');
	let suppressSavedAnnouncementUntil = 0;
	type SelectSlotTool = Extract<
		ImageEditorTool,
		'select' | 'marquee' | 'ellipse_marquee' | 'lasso' | 'polygonal_lasso' | 'magic_wand'
	>;
	type DrawSlotTool = Extract<
		ImageEditorTool,
		'pencil' | 'eraser' | 'magic_eraser' | 'bucket' | 'gradient'
	>;
	type ViewSlotTool = Extract<ImageEditorTool, 'hand' | 'zoom'>;
	let selectSlotTool = $state<SelectSlotTool>('select');
	let drawSlotTool = $state<DrawSlotTool>('pencil');
	let viewSlotTool = $state<ViewSlotTool>('hand');
	let shapeSlotKind = $state<'rectangle' | 'rounded_rectangle' | 'ellipse' | 'line'>('rectangle');
	let mobileSelectTool = $state<ImageEditorTool>('select');
	let mobileDrawTool = $state<ImageEditorTool>('pencil');
	let mobileRetouchTool = $state<ImageEditorTool>('eraser');
	let inspectorPanelWidth = $state(320);
	let layersPanelHeight = $state(160);
	let layersPanelUserSized = $state(false);
	let colorLayersPanelHeight = $state(120);
	let colorLayersPanelUserSized = $state(false);
	let pagesPanelHeight = $state(132);
	let inspectorElement = $state<HTMLElement>();
	let desktopViewportWidth = $state(1280);
	let inspectorPanelHeight = $state(680);
	let naturalLayersPanelHeight = $derived(
		Math.min(
			layersPanelMaximum(),
			Math.max(120, Math.min(280, 48 + (editor.activePage?.layers.length ?? 0) * 32))
		)
	);
	let effectiveLayersPanelHeight = $derived(
		activeEditorWorkspace === 'color'
			? colorLayersPanelUserSized
				? colorLayersPanelHeight
				: 120
			: layersPanelUserSized
				? layersPanelHeight
				: naturalLayersPanelHeight
	);
	let shortcutModifier = $state('Ctrl');
	let meaningfulEditTracked = false;
	let panelResize:
		| {
				panel: 'inspector' | 'layers' | 'pages';
				startX: number;
				startY: number;
				startSize: number;
		  }
		| undefined;

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
			editor.pagesExpanded = initial.document.pages.length > 1;
			coverPreviewMediaID = initial.cover_preview_media_id ?? '';
		}
	}

	async function saveToOpenPost(): Promise<void> {
		if (guestMode && !(await saveNow(undefined, 'close'))) return;
		await onSaveToOpenPost?.();
	}

	onMount(() => {
		if (guestMode) retainLocalImageEditorMediaForDesign(editor.id);
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
			inspectorPanelWidth = clampPanelSize(stored.inspector, 280, 480, inspectorPanelWidth);
			const editLayersWereUserSized =
				localStorage.getItem(EDIT_LAYERS_USER_SIZED_KEY) === '1' ||
				(stored.layers !== undefined && stored.layers !== LEGACY_DEFAULT_LAYERS_HEIGHT);
			if (stored.layers !== undefined && editLayersWereUserSized) {
				layersPanelHeight = clampPanelSize(stored.layers, 120, 520, layersPanelHeight);
				layersPanelUserSized = true;
			}
			const storedColorLayers = Number(localStorage.getItem(COLOR_LAYERS_HEIGHT_KEY));
			if (Number.isFinite(storedColorLayers) && storedColorLayers > 0) {
				colorLayersPanelHeight = clampPanelSize(storedColorLayers, 120, 520, 120);
				colorLayersPanelUserSized = true;
			}
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
				const recoveryDocument = editor.document;
				void storeLocalImageEditorRecovery({
					design_id: editor.id,
					workspace_id: editor.workspaceID,
					revision: editor.revision,
					document: recoveryDocument
				})
					.then(() => {
						if (!editorViewActive || editor.document !== recoveryDocument) return;
						recoveredDocument = recoveryDocument;
						recoveryError = '';
						if (editor.saveState === 'idle') {
							editor.saveState = 'local';
							editor.saveMessage = m.image_editor_saved_locally();
						}
					})
					.catch((cause) => {
						if (!editorViewActive || editor.document !== recoveryDocument) return;
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
			if (editor.canEdit && editor.saveState !== 'saved') {
				event.preventDefault();
			}
		};
		window.addEventListener('beforeunload', beforeUnload);
		return () => {
			editorViewActive = false;
			if (guestMode) releaseLocalImageEditorMediaForDesign(editor.id);
			rasterAbort?.abort();
			unsubscribe();
			clearTimeout(saveTimer);
			clearTimeout(previewTimer);
			backgroundRemoval.dispose();
			designChannel?.close();
			window.removeEventListener('beforeunload', beforeUnload);
		};
	});

	function openProperties(): void {
		if (activeEditorWorkspace !== 'color') {
			mobileSheet = 'properties';
			return;
		}
		editor.rightPanelVisible = true;
		focusedCanvas = false;
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLElement>(
					'[data-image-color-workspace] [role="tab"][aria-selected="true"]'
				)
				?.focus();
		});
	}

	function saveStateIconLabel(): string {
		if (editor.saveState === 'saving') return m.common_saving();
		if (editor.saveState === 'saved')
			return guestMode ? m.image_editor_public_saved_device() : m.video_editor_saved_cloud();
		if (editor.saveState === 'idle') return m.image_editor_autosave();
		return editor.saveMessage;
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

	function panelMaximum(): number {
		const available = desktopViewportWidth - DESKTOP_TOOL_RAIL_WIDTH - MINIMUM_CANVAS_WIDTH;
		return Math.max(280, Math.min(480, available));
	}

	function layersPanelMaximum(): number {
		return Math.max(120, inspectorPanelHeight - 166);
	}

	function activeLayersPanelHeight(): number {
		return activeEditorWorkspace === 'color' ? colorLayersPanelHeight : layersPanelHeight;
	}

	function activeLayersPanelIsUserSized(): boolean {
		return activeEditorWorkspace === 'color' ? colorLayersPanelUserSized : layersPanelUserSized;
	}

	function setActiveLayersPanelHeight(height: number, userSized = true): void {
		if (activeEditorWorkspace === 'color') {
			colorLayersPanelHeight = height;
			colorLayersPanelUserSized = userSized;
			return;
		}
		layersPanelHeight = height;
		layersPanelUserSized = userSized;
	}

	function constrainLayersPanelHeightFromDom(): void {
		if (window.innerWidth < 1024 || !editor.rightPanelVisible || !inspectorElement) return;
		const measuredHeight = inspectorElement.clientHeight;
		if (measuredHeight <= 0) return;
		inspectorPanelHeight = measuredHeight;
		if (layersPanelUserSized) {
			layersPanelHeight = clampPanelSize(
				layersPanelHeight,
				120,
				layersPanelMaximum(),
				layersPanelHeight
			);
		}
		if (colorLayersPanelUserSized) {
			colorLayersPanelHeight = clampPanelSize(
				colorLayersPanelHeight,
				120,
				layersPanelMaximum(),
				colorLayersPanelHeight
			);
		}
	}

	function constrainDesktopPanelWidths(): void {
		if (window.innerWidth < 1024) return;
		const maximumCombinedWidth =
			desktopViewportWidth - DESKTOP_TOOL_RAIL_WIDTH - MINIMUM_CANVAS_WIDTH;
		const overflow = inspectorPanelWidth - maximumCombinedWidth;
		if (overflow <= 0) return;
		inspectorPanelWidth -= Math.min(inspectorPanelWidth - 280, overflow);
	}

	function handleWindowResize(): void {
		desktopViewportWidth = window.innerWidth;
		constrainDesktopPanelWidths();
		constrainLayersPanelHeightFromDom();
		requestAnimationFrame(() => {
			constrainLayersPanelHeightFromDom();
		});
	}

	function startPanelResize(event: PointerEvent, panel: 'inspector' | 'layers' | 'pages'): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) return;
		handle.focus();
		event.preventDefault();
		if (panel === 'layers' && !activeLayersPanelIsUserSized()) {
			setActiveLayersPanelHeight(effectiveLayersPanelHeight);
		}
		panelResize = {
			panel,
			startX: event.clientX,
			startY: event.clientY,
			startSize:
				panel === 'inspector'
					? inspectorPanelWidth
					: panel === 'pages'
						? pagesPanelHeight
						: activeLayersPanelHeight()
		};
	}

	function resizePanels(event: PointerEvent): void {
		if (!panelResize) return;
		if (panelResize.panel === 'inspector') {
			inspectorPanelWidth = clampPanelSize(
				panelResize.startSize - (event.clientX - panelResize.startX),
				280,
				panelMaximum(),
				inspectorPanelWidth
			);
		} else if (panelResize.panel === 'pages') {
			pagesPanelHeight = clampPanelSize(
				panelResize.startSize + (panelResize.startY - event.clientY),
				88,
				480,
				pagesPanelHeight
			);
		} else {
			setActiveLayersPanelHeight(
				clampPanelSize(
					panelResize.startSize + event.clientY - panelResize.startY,
					120,
					layersPanelMaximum(),
					activeLayersPanelHeight()
				)
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
					inspector: Math.round(inspectorPanelWidth),
					layers: layersPanelUserSized ? Math.round(layersPanelHeight) : undefined,
					pages: Math.round(pagesPanelHeight)
				})
			);
			if (layersPanelUserSized) localStorage.setItem(EDIT_LAYERS_USER_SIZED_KEY, '1');
			else localStorage.removeItem(EDIT_LAYERS_USER_SIZED_KEY);
			if (colorLayersPanelUserSized) {
				localStorage.setItem(COLOR_LAYERS_HEIGHT_KEY, String(Math.round(colorLayersPanelHeight)));
			} else {
				localStorage.removeItem(COLOR_LAYERS_HEIGHT_KEY);
			}
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

	function resizePanelWithKeyboard(
		event: KeyboardEvent,
		panel: 'inspector' | 'layers' | 'pages'
	): void {
		const verticalSeparator = panel === 'inspector';
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
		if (panel === 'inspector') {
			inspectorPanelWidth = clampPanelSize(
				inspectorPanelWidth - direction * step,
				280,
				panelMaximum(),
				inspectorPanelWidth
			);
		} else if (panel === 'pages') {
			pagesPanelHeight = clampPanelSize(
				pagesPanelHeight - direction * step,
				88,
				480,
				pagesPanelHeight
			);
		} else {
			if (!activeLayersPanelIsUserSized()) {
				setActiveLayersPanelHeight(effectiveLayersPanelHeight);
			}
			setActiveLayersPanelHeight(
				clampPanelSize(
					activeLayersPanelHeight() + direction * step,
					120,
					layersPanelMaximum(),
					activeLayersPanelHeight()
				)
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
		recoveredDocument = local.document;
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
		void refreshImageEditorDesign(editor.workspaceID, editor.id)
			.then((latest) => {
				if (conflictDialogOpen && latest.revision > editor.revision) {
					conflictServerRevision = latest.revision;
				}
			})
			.catch(() => undefined);
	}

	async function performSave(request: SaveRequest): Promise<SaveAttemptResult> {
		if (!editor.document || !editor.canEdit) return 'saved';
		const view = captureEditorMutationView();
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
						editor.workspaceID,
						editor.id,
						editor.revision,
						submittedDocument,
						request.coverPreviewMediaID ?? coverPreviewMediaID,
						request.recoveryReason
					);
			if (!editorMutationViewIsCurrent(view)) {
				finishMetric();
				return 'blocked';
			}
			editor.revision = response.revision;
			if (!guestMode && typeof BroadcastChannel !== 'undefined') {
				const channel = new BroadcastChannel(`openpost-image-editor:${editor.id}`);
				channel.postMessage({ type: 'saved', tabID: editorTabID, revision: response.revision });
				channel.close();
			}
			coverPreviewMediaID = response.cover_preview_media_id ?? '';
			if (editor.document === submittedDocument) {
				// The server omits default fields and reorders JSON keys. Normalize its
				// reply and retain unchanged layers so autosave cannot end canvas typing.
				editor.document = replaceEqualDeep(
					submittedDocument,
					cloneImageEditorDocument(response.document)
				);
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
			if (!editorMutationViewIsCurrent(view)) return 'blocked';
			const status = apiErrorStatus(cause);
			const retryable = !navigator.onLine || !status || status === 429 || status >= 500;
			if (status === 409) {
				openConflictRecovery();
			} else if (!navigator.onLine) {
				editor.saveState = 'offline';
				editor.saveMessage =
					recoveredDocument === submittedDocument
						? m.image_editor_saved_locally()
						: m.image_editor_unsaved_changes();
				statusAnnouncement = editor.saveMessage;
			} else {
				editor.saveState = 'error';
				editor.saveMessage = imageEditorErrorMessage(cause) ?? m.image_editor_save_failed();
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
			const nextDocument = {
				...editor.document,
				pages: editor.document.pages.map((item) =>
					item.id === page.id ? { ...item, preview_media_id: uploaded.id } : item
				)
			};
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
		const view = captureEditorMutationView();
		const operationSequence = ++conflictOperationSequence;
		conflictBusy = true;
		conflictError = '';
		try {
			conflictPreservedCopy ??= await saveImageEditorConflictCopy(
				editor.workspaceID,
				editor.id,
				editor.document
			);
			const response = await refreshImageEditorDesign(editor.workspaceID, editor.id);
			if (!editorMutationViewIsCurrent(view)) return;
			editor.replaceFromServer(response);
			coverPreviewMediaID = response.cover_preview_media_id ?? '';
			await clearLocalImageEditorRecovery(editor.id);
			conflictDialogOpen = false;
			conflictServerRevision = null;
			conflictPreservedCopy = null;
			statusAnnouncement = m.image_editor_conflict_reloaded_with_copy();
		} catch (cause) {
			if (!editorMutationViewIsCurrent(view)) return;
			conflictError = imageEditorErrorMessage(cause) ?? m.image_editor_conflict_preserve_failed();
			statusAnnouncement = conflictError;
		} finally {
			if (operationSequence === conflictOperationSequence) conflictBusy = false;
		}
	}

	async function saveConflictAsCopy(): Promise<void> {
		if (!editor.document || conflictBusy) return;
		const view = captureEditorMutationView();
		const operationSequence = ++conflictOperationSequence;
		conflictBusy = true;
		conflictError = '';
		try {
			const saved =
				conflictPreservedCopy ??
				(await saveImageEditorConflictCopy(editor.workspaceID, editor.id, editor.document));
			if (!editorMutationViewIsCurrent(view)) return;
			editor.load(saved);
			conflictDialogOpen = false;
			conflictServerRevision = null;
			conflictPreservedCopy = null;
			await clearLocalImageEditorRecovery(editor.id);
			await goto(resolveAppPath(`/image-editor/${saved.id}`));
		} catch (cause) {
			if (!editorMutationViewIsCurrent(view)) return;
			conflictError = imageEditorErrorMessage(cause) ?? m.image_editor_conflict_preserve_failed();
			statusAnnouncement = conflictError;
		} finally {
			if (operationSequence === conflictOperationSequence) conflictBusy = false;
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
		const view = captureEditorMutationView();
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
		projectBusy = true;
		projectError = '';
		try {
			const blob = await createImageEditorProjectArchive(editor.document, projectMediaSource);
			if (!editorMutationViewIsCurrent(view)) return;
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = safeImageEditorProjectFilename(editor.document.title);
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 0);
			statusAnnouncement = m.image_editor_project_exported();
		} catch (cause) {
			projectError = imageEditorErrorMessage(cause) ?? m.image_editor_project_export_failed();
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
		const view = captureEditorMutationView();
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
					const uploaded = await storeGuestImageEditorProjectMedia(
						recovery.guestDesignID,
						parsed.document,
						entry
					);
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
				? await queryImageEditorDesign(editor.workspaceID, recovery.cloudDesignID)
				: await createImageEditorDesign(editor.workspaceID, {
						title: imported.title,
						preset_key: 'custom',
						width_px: imported.width_px,
						height_px: imported.height_px
					});
			if (!editorMutationViewIsCurrent(view)) return;
			recovery.cloudDesignID = created.id;
			await saveImageEditorDesign(editor.workspaceID, created.id, created.revision, imported);
			if (!editorMutationViewIsCurrent(view)) return;
			projectImportRecovery = null;
			await goto(resolveAppPath(`/image-editor/${created.id}`));
		} catch (cause) {
			if (!editorMutationViewIsCurrent(view)) return;
			projectError =
				cause instanceof DOMException && cause.name === 'AbortError'
					? m.image_editor_project_import_cancelled_recoverable({
							count: recovery.replacements.size
						})
					: m.image_editor_project_import_partial_recoverable({
							count: recovery.replacements.size,
							error: imageEditorErrorMessage(cause) ?? m.image_editor_project_import_failed()
						});
			statusAnnouncement = projectError;
		} finally {
			if (projectAbort === controller) {
				projectBusy = false;
				projectProgress = '';
				projectAbort = null;
			}
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
		await goto(resolveAppPath(guestMode ? '/image-editor' : '/media'));
	}

	function setTool(tool: ImageEditorTool): void {
		if (editor.floatingPixelSelection) editor.commitFloatingPixelSelection();
		if (tool === 'shape') {
			insertShape(shapeSlotKind);
			return;
		}
		if (
			tool === 'crop' &&
			!editor.selectedLayers.some(
				(layer) => layer.type === 'image' && !editor.isLayerLocked(layer.id)
			)
		)
			return;
		assetOverlayOpen = false;
		editor.activeTool = tool;
		editor.backgroundImagePickerActive = false;
		if (
			[
				'select',
				'marquee',
				'ellipse_marquee',
				'lasso',
				'polygonal_lasso',
				'magic_wand',
				'eyedropper',
				'hand'
			].includes(tool)
		) {
			mobileSelectTool = tool;
		}
		if (['text', 'pencil', 'bucket', 'gradient'].includes(tool)) mobileDrawTool = tool;
		if (['crop', 'eraser', 'magic_eraser'].includes(tool)) mobileRetouchTool = tool;
		if (isSelectSlotTool(tool)) selectSlotTool = tool;
		if (isDrawSlotTool(tool)) drawSlotTool = tool;
		if (isViewSlotTool(tool)) viewSlotTool = tool;
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
		assetOverlayOpen = false;
		editor.backgroundImagePickerActive = false;
		shapeSlotKind = kind;
		editor.addShape(kind);
		editor.activeTool = 'select';
	}

	function openBackgroundMediaPicker(): void {
		editor.backgroundImagePickerActive = true;
		editor.leftPanel = 'media';
		if (window.innerWidth < 1024) mobileSheet = 'assets';
		else assetOverlayOpen = true;
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
		const view = captureEditorMutationView();
		externalDropBusy = true;
		externalDropError = '';
		externalDropRetry = null;
		externalDropAbort = new AbortController();
		externalImportItems = requests.map((request) => ({ ...request, status: 'waiting' }));
		const signal = externalDropAbort.signal;
		const targetPage = editor.document?.pages.find((page) => page.id === pageID);
		const availableSlots = availableImageEditorImportSlots(targetPage?.layers.length ?? 0);
		const prepared: Array<
			ExternalImportRequest & {
				preparedFile: File;
				width: number;
				height: number;
				animation?: import('../types').ImageEditorAnimation;
			}
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
					const result = await prepareImageEditorImport(request.file, { guestMode, signal });
					decodedBytes = assertImageEditorBatchMemory(decodedBytes, result.decodedBytes);
					prepared.push({
						...request,
						preparedFile: result.file,
						width: result.width,
						height: result.height,
						animation: result.animation
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
						? await storeGuestImageEditorMedia(view.designID, request.preparedFile, { signal })
						: await uploadMediaFile({
								workspaceId: view.workspaceID,
								file: request.preparedFile,
								source: 'upload',
								retentionClass: 'library',
								signal
							});
					signal.throwIfAborted();
					if (!editorMutationViewIsCurrent(view)) break;
					const offset = request.offset * 24;
					editor.addImage(
						{
							id: media.id,
							name: media.original_filename,
							width: request.width,
							height: request.height,
							animation: request.animation
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

	function editableTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function handleShortcut(event: KeyboardEvent): void {
		if (event.defaultPrevented || overlayWasOpen || editableTarget(event.target)) return;
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
		version_history: () => void versionsDialogs?.openHistory(),
		create_checkpoint: () => (checkpointDialogOpen = true),
		save_template: () => void versionsDialogs?.openTemplateDialog(),
		resize_design: () => (resizeDialogOpen = true),
		export_project: () => void exportProject(),
		import_project: () => projectFileInput?.click(),
		export_design: () => exportDialog?.openExport('download'),
		undo: undoEditor,
		redo: redoEditor,
		duplicate: () =>
			editor.floatingPixelSelection
				? editor.duplicateFloatingPixelSelection()
				: editor.duplicateSelected(),
		group: () => editor.groupSelected(),
		ungroup: () => editor.ungroupSelected(),
		rasterize: () => void bakeLayers('rasterize'),
		merge_down: () => void bakeLayers('merge_down'),
		merge_selected: () => void bakeLayers('merge_selected'),
		flatten_page: () => void bakeLayers('flatten_page'),
		remove_background: () => void removeBackground(),
		select_all: () => editor.selectAll(),
		deselect: () => (editor.pixelSelection ? editor.clearPixelSelection() : editor.selectLayer('')),
		selection_invert: () => editor.refinePixelSelection('invert'),
		selection_expand: () => editor.refinePixelSelection('expand'),
		selection_contract: () => editor.refinePixelSelection('contract'),
		selection_from_layer_alpha: () => pixelSelectionActions?.loadLayerAlpha(),
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
		add_guide: () => (guideDialogOpen = true),
		open_help: () => (helpDialogOpen = true),
		tool_select: () => setTool('select'),
		tool_marquee: () => setTool('marquee'),
		tool_ellipse_marquee: () => setTool('ellipse_marquee'),
		tool_lasso: () => setTool('lasso'),
		tool_polygonal_lasso: () => setTool('polygonal_lasso'),
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
		if (isRasterCommand(id))
			return Boolean(
				editor.canEdit &&
				!rasterBusy &&
				!editor.floatingPixelSelection &&
				!editor.colorPreviewActive &&
				editor.document &&
				prepareRasterOperation(
					editor.document,
					editor.activePageID,
					editor.selectedLayerIDs,
					id,
					editor.id
				)
			);
		if (id === 'delete' || id === 'cut') {
			const targets = editor.pixelSelection?.targetLayerIDs ?? editor.selectedLayerIDs;
			if (targets.length && targets.every((layerID) => editor.isLayerLocked(layerID))) return false;
		}
		const availability = imageEditorCommand(id).availability;
		if (availability === 'always') return true;
		if (availability === 'editable') return editor.canEdit;
		if (availability === 'undo') return editor.canUndo;
		if (availability === 'redo') return editor.canRedo;
		if (availability === 'selection') {
			return Boolean(editor.pixelSelection || editor.selectedLayerIDs.length > 0);
		}
		if (availability === 'pixel_selection') {
			return Boolean(editor.pixelSelection && !editor.floatingPixelSelection);
		}
		if (availability === 'layer_selection') {
			return (
				editor.selectedLayers.length === 1 && !editor.isLayerLocked(editor.selectedLayers[0].id)
			);
		}
		if (availability === 'multi_selection')
			return (
				editor.selectedLayers.length >= 2 &&
				editor.selectedLayers.every((layer) => !editor.isLayerLocked(layer.id))
			);
		if (availability === 'group_selection') {
			return (
				editor.selectedLayers.some((layer) => layer.type === 'group') &&
				editor.selectedLayers
					.filter((layer) => layer.type === 'group')
					.every((layer) => !editor.isLayerLocked(layer.id))
			);
		}
		if (availability === 'clipboard') return copiedLayers.length > 0 || editor.canEdit;
		if (availability === 'crop_target') {
			return (
				editor.canEdit &&
				editor.selectedLayers.some(
					(layer) => layer.type === 'image' && !editor.isLayerLocked(layer.id)
				)
			);
		}
		if (availability === 'image_selection') {
			return Boolean(
				editor.selectedLayers.some((layer) => layer.image && !editor.isLayerLocked(layer.id))
			);
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
		if (isRasterCommand(id))
			return commandEnabled(id)
				? m.image_editor_raster_help()
				: rasterBusy
					? m.image_editor_raster_busy()
					: m.image_editor_raster_requirements();
		const availability = imageEditorCommand(id).availability;
		if (availability === 'undo') return m.image_editor_nothing_to_undo();
		if (availability === 'redo') return m.image_editor_nothing_to_redo();
		if (availability === 'selection') return m.image_editor_command_requires_selection();
		if (availability === 'pixel_selection')
			return m.image_editor_command_requires_pixel_selection();
		if (availability === 'layer_selection')
			return m.image_editor_command_requires_layer_selection();
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
			rasterize: m.image_editor_rasterize(),
			merge_down: m.image_editor_merge_down(),
			merge_selected: m.image_editor_merge_selected(),
			flatten_page: m.image_editor_flatten_page(),
			remove_background: m.image_editor_remove_background(),
			select_all: m.image_editor_select_all(),
			deselect: m.image_editor_deselect(),
			selection_invert: m.image_editor_selection_invert(),
			selection_expand: m.image_editor_selection_expand(),
			selection_contract: m.image_editor_selection_contract(),
			selection_from_layer_alpha: m.image_editor_selection_from_layer_alpha(),
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
			tool_polygonal_lasso: m.image_editor_polygonal_lasso_select(),
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

	function compactCommandCategoryLabel(category: CompactMenuSection): string {
		if (category === 'file') return m.image_editor_file();
		if (category === 'view') return m.image_editor_view();
		if (category === 'help') return m.image_editor_help();
		if (category === 'edit') return m.image_editor_edit();
		if (category === 'layer') return m.image_editor_layer();
		if (category === 'select') return m.image_editor_select();
		return m.image_editor_tools_menu();
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
				{ x: editor.activePageDimensions.width / 2, y: editor.activePageDimensions.height / 2 },
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

	function isRasterCommand(id: ImageEditorCommandID): id is ImageEditorRasterOperation {
		return (
			id === 'rasterize' || id === 'merge_down' || id === 'merge_selected' || id === 'flatten_page'
		);
	}

	async function bakeLayers(kind: ImageEditorRasterOperation): Promise<void> {
		if (!editor.document || !commandEnabled(kind)) return;
		const plan = prepareRasterOperation(
			editor.document,
			editor.activePageID,
			editor.selectedLayerIDs,
			kind,
			editor.id
		);
		if (!plan) return;
		const designID = editor.id;
		const workspaceID = editor.workspaceID;
		const abort = new AbortController();
		rasterAbort = abort;
		rasterBusy = true;
		rasterError = '';
		try {
			const snapshot = rasterRenderDocument(plan);
			const rendered = await renderImageEditorPage(snapshot, snapshot.pages[0], 0, abort.signal);
			const raster = await cropRasterResult(plan, rendered.blob, abort.signal);
			if (
				!editorViewActive ||
				editor.id !== designID ||
				!rasterPlanIsCurrent(plan, editor.document)
			)
				throw new Error(m.image_editor_raster_stale());
			const file = new File([raster.blob], rendered.filename, { type: 'image/png' });
			const media = guestMode
				? await storeGuestImageEditorMedia(designID, file)
				: await uploadMediaFile({
						workspaceId: workspaceID,
						file,
						source: 'image_editor_edit',
						designDocumentId: designID,
						designPageId: plan.pageID,
						retentionClass: 'library',
						signal: abort.signal
					});
			abort.signal.throwIfAborted();
			if (
				!editorViewActive ||
				editor.id !== designID ||
				!editor.commitRasterOperation(plan, media.id, commandLabel(kind), raster.bounds)
			)
				throw new Error(m.image_editor_raster_stale());
			editor.refreshMediaLibrary();
			statusAnnouncement = m.image_editor_raster_done();
		} catch (cause) {
			if (!abort.signal.aborted)
				rasterError = imageEditorErrorMessage(cause) ?? m.image_editor_page_render_failed();
		} finally {
			rasterBusy = false;
			rasterAbort = null;
		}
	}

	async function removeBackground(optimizeLarge = false): Promise<void> {
		const layer = editor.selectedLayers.find(
			(candidate) => candidate.image && !editor.isLayerLocked(candidate.id)
		);
		if (!layer?.image || backgroundBusy) return;
		if (layer.image.animation) {
			backgroundError = m.image_editor_animation_still_only();
			statusAnnouncement = backgroundError;
			return;
		}
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
				const phase = progress.stage.startsWith('fetch:')
					? m.video_editor_transcribe_downloading()
					: m.image_editor_background_removing();
				backgroundProgress = `${phase} ${Math.round(progress.progress * 100)}%`;
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
			backgroundError = imageEditorErrorMessage(cause) ?? m.image_editor_background_failed();
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

	type ToolGlyph =
		| { kind: 'theme'; role: ThemeIconRole }
		| { kind: 'protected'; role: ProtectedIconRole };

	const commandIcons = new Map<ImageEditorCommandID, ToolGlyph>([
		['tool_select', { kind: 'protected', role: 'editor-select' }],
		['tool_marquee', { kind: 'protected', role: 'editor-marquee' }],
		['tool_ellipse_marquee', { kind: 'protected', role: 'editor-marquee-ellipse' }],
		['tool_lasso', { kind: 'protected', role: 'editor-lasso' }],
		['tool_polygonal_lasso', { kind: 'protected', role: 'editor-lasso' }],
		['tool_magic_wand', { kind: 'protected', role: 'editor-effects' }],
		['tool_crop', { kind: 'protected', role: 'editor-crop' }],
		['tool_eyedropper', { kind: 'protected', role: 'editor-eyedropper' }],
		['tool_text', { kind: 'protected', role: 'editor-text' }],
		// Vector shape tool glyph (see icons/MIGRATION.md).
		['tool_shape', { kind: 'protected', role: 'editor-shapes' }],
		['tool_pencil', { kind: 'theme', role: 'edit' }],
		['tool_bucket', { kind: 'protected', role: 'editor-fill' }],
		['tool_gradient', { kind: 'protected', role: 'editor-blend' }],
		['tool_eraser', { kind: 'protected', role: 'editor-erase' }],
		['tool_magic_eraser', { kind: 'protected', role: 'editor-effects' }],
		['tool_hand', { kind: 'protected', role: 'editor-pan' }],
		['tool_zoom', { kind: 'theme', role: 'layout' }]
	]);
	const fallbackToolGlyph: ToolGlyph = { kind: 'protected', role: 'editor-select' };
	const railSlots = imageEditorCommandsForRail().map((command) => ({
		slot: command.railSlot!,
		command
	}));

	function mobileToolCommands(group: 'select' | 'draw' | 'retouch') {
		return imageEditorCommandsForMobileGroup(group);
	}

	function railSlotCommands(slot: ImageEditorCommandRailSlot) {
		return imageEditorCommandsForRailSlot(slot);
	}

	type RailFamilySlot = 'select' | 'draw' | 'view';

	function railSlotTool(slot: RailFamilySlot): ImageEditorTool {
		if (slot === 'select') return selectSlotTool;
		if (slot === 'draw') return drawSlotTool;
		return viewSlotTool;
	}

	function railSlotActive(slot: RailFamilySlot, tool: ImageEditorTool): boolean {
		return railSlotCommands(slot).some((command) => command.tool === tool);
	}

	function commandTool(command: ImageEditorCommandDescriptor): ImageEditorTool {
		return command.tool ?? 'select';
	}

	function isSelectSlotTool(tool: ImageEditorTool): tool is SelectSlotTool {
		return [
			'select',
			'marquee',
			'ellipse_marquee',
			'lasso',
			'polygonal_lasso',
			'magic_wand'
		].includes(tool);
	}

	function isDrawSlotTool(tool: ImageEditorTool): tool is DrawSlotTool {
		return ['pencil', 'eraser', 'magic_eraser', 'bucket', 'gradient'].includes(tool);
	}

	function isViewSlotTool(tool: ImageEditorTool): tool is ViewSlotTool {
		return tool === 'hand' || tool === 'zoom';
	}
</script>

<svelte:head><title>{editor.document?.title ?? initial.document.title}</title></svelte:head>

{#snippet toolGlyph(glyph: ToolGlyph)}
	{#if glyph.kind === 'theme'}
		<ThemeIcon role={glyph.role} />
	{:else}
		<ProtectedIcon icon={glyph.role} />
	{/if}
{/snippet}

{#snippet railSlotFamily(slot: RailFamilySlot, layout: 'rail' | 'bottom')}
	{@const commands = railSlotCommands(slot)}
	{@const current = commands.find((command) => command.tool === railSlotTool(slot)) ?? commands[0]!}
	{@const CurrentIcon = commandIcons.get(current.id) ?? fallbackToolGlyph}
	<ToolFamilyButton
		label={commandLabel(current.id)}
		active={railSlotActive(slot, editor.activeTool)}
		disabled={!commandEnabled(current.id)}
		shortcut={layout === 'rail' ? commandShortcut(current.id) : ''}
		{layout}
		onclick={() => executeEditorCommand(current.id)}
	>
		{#snippet icon()}
			{@render toolGlyph(CurrentIcon)}
			{#if layout === 'bottom'}
				<span class="max-w-full truncate">{commandLabel(current.id)}</span>
			{/if}
		{/snippet}
		{#snippet menu()}
			{#each commands as command (command.id)}
				{@const CommandIcon = commandIcons.get(command.id) ?? fallbackToolGlyph}
				<DropdownMenu.Item
					onclick={() => executeEditorCommand(command.id)}
					disabled={!commandEnabled(command.id)}
				>
					{@render toolGlyph(CommandIcon)}{commandLabel(command.id)}
					<span class="ms-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
				</DropdownMenu.Item>
			{/each}
		{/snippet}
	</ToolFamilyButton>
{/snippet}

<svelte:window
	onkeydown={handleShortcut}
	onresize={handleWindowResize}
	onpointermove={resizePanels}
	onpointerup={stopPanelResize}
	onpointercancel={stopPanelResize}
/>

<div
	dir="ltr"
	class="image-editor-theme fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground {imageAIStudioOpen
		? 'pb-[50dvh] lg:pb-0'
		: ''}"
	data-testid="image-editor-shell"
	data-agent-status={agentConnectionStatus}
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
	<EditorHeader>
		{#snippet identity()}
			<Button
				variant="ghost"
				size="icon-sm"
				class="size-11 shrink-0 md:size-8 [@media(pointer:coarse)]:size-11"
				onclick={goBack}
				aria-label={returnToken ? m.editor_back_to_post() : m.image_editor_title()}
			>
				<ThemeIcon role="chevron-left" class="size-5" />
			</Button>
			<EditorTitleInput
				value={editor.document?.title ?? ''}
				class="hidden h-8 w-full max-w-48 min-w-0 text-sm md:block"
				ariaLabel={m.image_editor_design_title()}
				disabled={!editor.canEdit}
				onchange={(value) =>
					editor.mutate('Rename design', (document) => (document.title = value), 'document-title')}
			/>
			<EditorMenubar class="hidden min-w-0 shrink-0 lg:flex" ariaLabel={m.image_editor_menus()}>
				<Menubar.Menu value="file">
					<Menubar.Trigger>{m.image_editor_file()}</Menubar.Trigger>
					<Menubar.Content class="min-w-48 data-[state=closed]:hidden">
						{#each imageEditorCommandsForCategory('file').filter(commandVisible) as command (command.id)}
							{#if command.separatorBefore}<Menubar.Separator />{/if}
							<Menubar.Item
								onSelect={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								{#if command.id === 'save'}<ThemeIcon role="save" />{/if}
								{#if command.id === 'export_design'}<ThemeIcon role="download" />{/if}
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
								onSelect={() => executeEditorCommand(command.id)}
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
								onSelect={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								{#if command.id === 'group'}<ProtectedIcon icon="editor-group" />{/if}
								{#if command.id === 'ungroup'}<ProtectedIcon icon="editor-ungroup" />{/if}
								{#if command.id === 'remove_background'}<ProtectedIcon icon="editor-effects" />{/if}
								{commandLabel(command.id)}
								<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
							</Menubar.Item>
						{/each}
						<Menubar.Separator />
						<p class="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">
							{m.image_editor_raster_help()}
						</p>
					</Menubar.Content>
				</Menubar.Menu>
				<Menubar.Menu value="select">
					<Menubar.Trigger>{m.image_editor_select()}</Menubar.Trigger>
					<Menubar.Content class="min-w-48">
						{#each imageEditorCommandsForCategory('select') as command (command.id)}
							{#if command.separatorBefore}<Menubar.Separator />{/if}
							<Menubar.Item
								onSelect={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
								{commandLabel(command.id)}
								<Menubar.Shortcut>{commandShortcut(command.id)}</Menubar.Shortcut>
							</Menubar.Item>
						{/each}
					</Menubar.Content>
				</Menubar.Menu>
				<Menubar.Menu value="tools">
					<Menubar.Trigger>{m.image_editor_tools_menu()}</Menubar.Trigger>
					<Menubar.Content class="min-w-52">
						{#each imageEditorCommandsForCategory('tools') as command (command.id)}
							<Menubar.Item
								onSelect={() => executeEditorCommand(command.id)}
								disabled={!commandEnabled(command.id)}
								title={commandDisabledReason(command.id) || undefined}
							>
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
									onSelect={() => executeEditorCommand(command.id)}
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
							<Menubar.Item onSelect={() => executeEditorCommand(command.id)}>
								<ThemeIcon role="help" />
								{commandLabel(command.id)}
							</Menubar.Item>
						{/each}
					</Menubar.Content>
				</Menubar.Menu>
			</EditorMenubar>
		{/snippet}
		{#snippet workspaces()}
			<EditorWorkspaceTabs
				value={activeEditorWorkspace}
				options={[
					{
						id: 'edit',
						label: m.image_editor_edit(),
						emblem: { kind: 'theme', role: 'edit' }
					},
					{
						id: 'color',
						label: m.image_editor_color(),
						emblem: { kind: 'theme', role: 'appearance' }
					}
				]}
				ariaLabel={m.editor_workspaces()}
				idPrefix="image-editor-workspace-tab"
				panelId="image-editor-workspace-panel"
				onvaluechange={(workspace) => {
					activeEditorWorkspace = workspace === 'color' ? 'color' : 'edit';
					if (activeEditorWorkspace === 'color') {
						setTool('select');
						editor.rightPanelVisible = true;
						if (window.innerWidth < 1024) mobileSheet = null;
						requestAnimationFrame(() => {
							constrainLayersPanelHeightFromDom();
							storePanelLayout();
						});
					}
				}}
			/>
		{/snippet}
		{#snippet actions()}
			{#if $auth.user && editor.canEdit}
				<ImageAIStudio
					bind:this={imageAIStudio}
					bind:open={imageAIStudioOpen}
					{guestMode}
					onSaveToOpenPost={saveToOpenPost}
				/>
			{/if}
			{#if !guestMode && editor.canEdit}
				<ImageEditorAssistant
					workspaceId={editor.workspaceID}
					projectId={editor.id}
					sessionId={agentSessionID}
					status={agentConnectionStatus}
				/>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				class="relative size-8 shrink-0 [@media(pointer:coarse)]:size-11"
				title={editor.saveMessage || saveStateIconLabel()}
				aria-label={editor.saveMessage || saveStateIconLabel()}
				data-testid="image-editor-save-indicator"
				data-state={editor.saveState}
				role="status"
			>
				{#if editor.saveState === 'saving'}
					<ThemeIcon role="refresh" class="motion-safe:animate-spin" />
				{:else if editor.saveState === 'saved'}
					<ThemeIcon role="check" class="text-success-foreground" />
				{:else if editor.saveState === 'error' || editor.saveState === 'conflict'}
					<ThemeIcon role="save" class="text-destructive" />
				{:else}
					<ThemeIcon role="save" class="text-warning-foreground" />
				{/if}
			</Button>

			<div class="flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon-sm"
					class="hidden size-8 xl:inline-flex [@media(pointer:coarse)]:size-11"
					onclick={undoEditor}
					disabled={!editor.canUndo}
					title={commandMenuLabel('undo')}
					aria-label={editor.undoLabel
						? m.image_editor_undo_named({ name: editor.undoLabel })
						: m.image_editor_undo()}><ThemeIcon role="undo" /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					class="hidden size-8 xl:inline-flex [@media(pointer:coarse)]:size-11"
					onclick={redoEditor}
					disabled={!editor.canRedo}
					title={commandMenuLabel('redo')}
					aria-label={editor.redoLabel
						? m.image_editor_redo_named({ name: editor.redoLabel })
						: m.image_editor_redo()}><ThemeIcon role="redo" /></Button
				>
				{#if !guestMode}
					<Button
						variant="ghost"
						size="icon-sm"
						class="hidden size-11 sm:inline-flex md:size-8 [@media(pointer:coarse)]:size-11"
						aria-label={m.feedback_open()}
						title={m.feedback_open()}
						onclick={() => ui.openFeedback()}
					>
						<ThemeIcon role="feedback" />
					</Button>
				{/if}
				<DropdownMenu.Root onOpenChange={() => (compactMenuSection = null)}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-sm"
								class="size-11 md:size-8 [@media(pointer:coarse)]:size-11"
								aria-label={m.image_editor_more_actions()}
							>
								<ThemeIcon role="more-horizontal" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						align="end"
						bind:ref={compactMenuContent}
						class="max-h-[calc(100dvh-1rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto"
					>
						{#if compactMenuSection}
							<DropdownMenu.Item
								bind:ref={compactMenuBack}
								closeOnSelect={false}
								onSelect={backToCompactMenu}
								class="[@media(pointer:coarse)]:min-h-11"
							>
								<ThemeIcon role="chevron-left" />{m.common_back()}
							</DropdownMenu.Item>
							<DropdownMenu.Label
								>{compactCommandCategoryLabel(compactMenuSection)}</DropdownMenu.Label
							>
							{#each (compactMenuSection === 'file' || compactMenuSection === 'view' || compactMenuSection === 'help' ? imageEditorCommandsForCategory(compactMenuSection) : imageEditorCommandsForCompactMenu().filter((command) => command.category === compactMenuSection))
								.filter(commandVisible)
								.filter((command) => command.id !== 'version_history') as command (command.id)}
								{#if command.separatorBefore}<DropdownMenu.Separator />{/if}
								{#if command.menuKind === 'checkbox' || command.id === 'focus_canvas'}
									<DropdownMenu.CheckboxItem
										class="[@media(pointer:coarse)]:min-h-11"
										checked={commandChecked(command.id)}
										onCheckedChange={(checked) => setCommandChecked(command.id, checked)}
										>{commandLabel(command.id)}</DropdownMenu.CheckboxItem
									>
								{:else}
									<DropdownMenu.Item
										class="[@media(pointer:coarse)]:min-h-11"
										onSelect={() => executeEditorCommand(command.id)}
										disabled={!commandEnabled(command.id)}
										title={commandDisabledReason(command.id) || undefined}
									>
										{commandMenuLabel(command.id)}
										{#if commandShortcut(command.id)}<span
												class="ms-auto text-xs text-muted-foreground"
												>{commandShortcut(command.id)}</span
											>{/if}
									</DropdownMenu.Item>
								{/if}
							{/each}
							{#if compactMenuSection === 'layer'}<p
									class="max-w-64 px-2 py-1.5 text-xs text-muted-foreground"
								>
									{m.image_editor_raster_help()}
								</p>{/if}
						{:else}
							<div class="w-64 p-1 md:hidden">
								<EditorTitleInput
									value={editor.document?.title ?? ''}
									class="h-11 w-full"
									ariaLabel={m.image_editor_design_title()}
									disabled={!editor.canEdit}
									onkeydown={(event) => {
										if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
									}}
									onchange={(value) =>
										editor.mutate(
											'Rename design',
											(document) => (document.title = value),
											'document-title'
										)}
								/>
							</div>
							<DropdownMenu.Separator class="md:hidden" />
							{#if commandVisible(imageEditorCommand('version_history'))}
								<DropdownMenu.Item
									class="[@media(pointer:coarse)]:min-h-11"
									onSelect={() => executeEditorCommand('version_history')}
									>{commandLabel('version_history')}</DropdownMenu.Item
								>
							{/if}
							{#each compactMenuSections as category (category)}
								<DropdownMenu.Item
									class="[@media(pointer:coarse)]:min-h-11"
									bind:ref={compactMenuItems[category]}
									closeOnSelect={false}
									onSelect={() => openCompactMenuSection(category)}
								>
									{compactCommandCategoryLabel(category)}<ThemeIcon
										role="chevron-right"
										class="ms-auto"
									/>
								</DropdownMenu.Item>
							{/each}
							<DropdownMenu.Item
								class="lg:hidden [@media(pointer:coarse)]:min-h-11"
								onSelect={() => (mobileSheet = 'layers')}
								>{m.image_editor_layers()}</DropdownMenu.Item
							>
							<DropdownMenu.Item
								class="lg:hidden [@media(pointer:coarse)]:min-h-11"
								onSelect={openProperties}>{m.image_editor_properties()}</DropdownMenu.Item
							>
							{#if !guestMode}
								<DropdownMenu.Item
									class="sm:hidden [@media(pointer:coarse)]:min-h-11"
									onSelect={() => ui.openFeedback()}
								>
									<ThemeIcon role="feedback" />
									{m.feedback_open()}
								</DropdownMenu.Item>
							{/if}
							<DropdownMenu.Separator />
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				{#if guestMode}
					<Button
						variant="outline"
						size="sm"
						class="hidden h-8 2xl:inline-flex"
						onclick={saveToOpenPost}
					>
						{m.image_editor_public_save_openpost()}
					</Button>
				{/if}
				<Button
					variant="default"
					size="sm"
					class="size-11 px-0 sm:h-8 sm:w-auto sm:px-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
					aria-label={returnToken ? attachLabel : m.image_editor_export()}
					onclick={() =>
						exportDialog?.openExport(returnToken && editor.canEdit ? 'attach' : 'download')}
				>
					<ThemeIcon role="download" class="size-3.5" />
					<span class="hidden sm:inline"
						>{#if returnToken}{attachLabel}{:else}{m.image_editor_export()}{/if}</span
					>
				</Button>
			</div>
		{/snippet}
	</EditorHeader>
	{#if ['local', 'offline', 'conflict', 'error'].includes(editor.saveState)}
		<div
			class="flex shrink-0 items-center gap-2 border-b bg-muted px-3 py-2 text-xs sm:hidden"
			role="status"
		>
			<span class="size-1.5 shrink-0 rounded-full bg-warning-foreground"></span>
			<span>{editor.saveMessage}</span>
		</div>
	{/if}

	{#if !editor.canEdit}
		<div class="border-b bg-muted px-3 py-2 text-center text-xs">
			{readOnlyReason || m.image_editor_read_only()}
		</div>
	{/if}
	{#if recoveryError || concurrentTabWarning}
		<div
			class="flex flex-wrap items-center justify-center gap-2 border-b bg-warning px-3 py-2 text-xs text-warning-foreground"
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
			<Button variant="ghost" size="xs" class="ms-2" onclick={() => backgroundRemoval.cancel()}
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
	{#if rasterBusy}
		<InlineNotice message={m.image_editor_raster_busy()} class="rounded-none border-x-0 border-t-0">
			{#snippet actions()}<Button variant="ghost" size="xs" onclick={() => rasterAbort?.abort()}
					>{m.common_cancel()}</Button
				>{/snippet}
		</InlineNotice>
	{/if}
	{#if rasterError}
		<InlineNotice
			tone="error"
			message={rasterError}
			onDismiss={() => (rasterError = '')}
			dismissLabel={m.common_dismiss()}
			class="rounded-none border-x-0 border-t-0"
		/>
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
				<ul class="mt-1 max-h-24 max-w-[min(32rem,85vw)] space-y-0.5 overflow-auto text-start">
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
		id="image-editor-workspace-panel"
		role="tabpanel"
		aria-labelledby={`image-editor-workspace-tab-${activeEditorWorkspace}`}
		class="image-editor-workspace grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]"
		data-focused={focusedCanvas}
		data-inspector={editor.rightPanelVisible}
		data-workspace={activeEditorWorkspace}
		style:--image-editor-inspector-width={`${inspectorPanelWidth}px`}
		style:--image-editor-mobile-pages-height={pagesExpanded ? '8.75rem' : '2.75rem'}
	>
		<nav
			class="no-scrollbar hidden min-h-0 flex-col items-center gap-1 overflow-y-auto border-e bg-card py-2 lg:flex"
			aria-label={m.image_editor_tools()}
		>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							bind:ref={assetOverlayTrigger}
							variant={assetOverlayOpen ? 'secondary' : 'ghost'}
							size="icon-sm"
							onclick={() => {
								if (assetOverlayOpen) closeAssetOverlay();
								else assetOverlayOpen = true;
							}}
							aria-label={m.image_editor_add()}
							aria-pressed={assetOverlayOpen}
							title={m.image_editor_add()}
						>
							<ThemeIcon role="add" class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="right">{m.image_editor_add()}</Tooltip.Content>
			</Tooltip.Root>
			{#each railSlots as railSlot (railSlot.slot)}
				{#if railSlot.slot === 'select' || railSlot.slot === 'draw' || railSlot.slot === 'view'}
					{@render railSlotFamily(railSlot.slot, 'rail')}
				{:else if railSlot.slot === 'shape'}
					<ToolFamilyButton
						label={commandLabel(railSlot.command.id)}
						active={editor.activeTool === 'shape'}
						disabled={!commandEnabled(railSlot.command.id)}
						shortcut={commandShortcut(railSlot.command.id)}
						onclick={() => executeEditorCommand(railSlot.command.id)}
					>
						{#snippet icon()}
							{#if shapeSlotKind === 'line'}
								<ProtectedIcon icon="editor-path" />
							{:else if shapeSlotKind === 'rounded_rectangle'}
								<ProtectedIcon icon="editor-shape-rounded-rectangle" />
							{:else if shapeSlotKind === 'ellipse'}
								<ProtectedIcon icon="editor-shape-ellipse" />
							{:else}
								<ProtectedIcon icon="editor-shape-rectangle" />
							{/if}
						{/snippet}
						{#snippet menu()}
							<DropdownMenu.Item onclick={() => insertShape('rectangle')}>
								<ProtectedIcon icon="editor-shape-rectangle" />
								{m.image_editor_rectangle()}
								<span class="ms-auto text-xs text-muted-foreground">U</span>
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => insertShape('rounded_rectangle')}>
								<ProtectedIcon icon="editor-shape-rounded-rectangle" />
								{m.image_editor_rounded_rectangle()}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => insertShape('ellipse')}>
								<ProtectedIcon icon="editor-shape-ellipse" />
								{m.image_editor_ellipse()}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => insertShape('line')}>
								<ProtectedIcon icon="editor-path" />
								{m.image_editor_line()}
							</DropdownMenu.Item>
						{/snippet}
					</ToolFamilyButton>
				{:else}
					{@const ToolIcon = commandIcons.get(railSlot.command.id) ?? fallbackToolGlyph}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant={editor.activeTool === commandTool(railSlot.command)
										? 'secondary'
										: 'ghost'}
									size="icon-sm"
									onclick={() => executeEditorCommand(railSlot.command.id)}
									aria-label={commandLabel(railSlot.command.id)}
									aria-pressed={editor.activeTool === commandTool(railSlot.command)}
									disabled={!commandEnabled(railSlot.command.id)}
									title={commandDisabledReason(railSlot.command.id) || undefined}
								>
									{@render toolGlyph(ToolIcon)}
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">
							{commandTooltip(railSlot.command.id)}
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{/each}
		</nav>
		<main
			class="relative min-h-0 min-w-0"
			style:--image-editor-pages-height={`${pagesPanelHeight}px`}
		>
			{#if assetOverlayOpen && !focusedCanvas && activeEditorWorkspace === 'edit'}
				<div class="absolute start-2 top-2 z-40 hidden lg:block">
					<AssetPanel {guestMode} mode="overlay" onclose={closeAssetOverlay} />
				</div>
			{/if}
			<div
				class="absolute inset-0 {focusedCanvas
					? 'bottom-0'
					: pagesExpanded
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
				class="absolute end-3 {focusedCanvas
					? 'bottom-3'
					: pagesExpanded
						? 'bottom-[9.5rem] lg:bottom-[calc(var(--image-editor-pages-height)_+_0.75rem)]'
						: 'bottom-14 lg:bottom-12'} z-10 flex items-center gap-1 rounded-lg bg-background/90 p-1 shadow ring-1 ring-black/10"
			>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-8 md:size-8 lg:size-7 [@media(pointer:coarse)]:size-11"
					onclick={() => (editor.zoom = Math.max(0.1, editor.zoom - 0.1))}
					aria-label={m.image_editor_zoom_out()}><ThemeIcon role="remove" /></Button
				>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-8 min-w-12 px-2 text-xs md:size-8 lg:size-7 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:min-w-11"
					onclick={() => editor.fitZoom()}
					aria-label={`${m.image_editor_zoom()} ${Math.round(editor.zoom * 100)}%`}
				>
					{Math.round(editor.zoom * 100)}%
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-8 md:size-8 lg:size-7 [@media(pointer:coarse)]:size-11"
					onclick={() => (editor.zoom = Math.min(4, editor.zoom + 0.1))}
					aria-label={m.image_editor_zoom_in()}><ThemeIcon role="add" /></Button
				>
			</div>
			{#if !focusedCanvas}
				<div
					class="absolute inset-x-0 bottom-0 flex flex-col {pagesExpanded
						? 'h-[8.75rem] lg:h-[var(--image-editor-pages-height)]'
						: 'h-11 lg:h-9'}"
				>
					{#if pagesExpanded}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- focusable ARIA Window Splitter -->
						<div
							aria-label={`${m.image_editor_resize()} ${m.image_editor_pages()}`}
							title={`${m.image_editor_resize()} ${m.image_editor_pages()}`}
							role="separator"
							tabindex="0"
							aria-orientation="horizontal"
							aria-valuemin="88"
							aria-valuemax="480"
							aria-valuenow={Math.round(pagesPanelHeight)}
							class="image-editor-resize-handle hidden h-2 shrink-0 cursor-row-resize touch-none border-0 bg-transparent p-0 lg:block [@media(pointer:coarse)]:h-11"
							onpointerdown={(event) => startPanelResize(event, 'pages')}
							onkeydown={(event) => resizePanelWithKeyboard(event, 'pages')}
							ondblclick={() => {
								pagesPanelHeight = clampPanelSize(132, 88, 480, 132);
								storePanelLayout();
							}}
						></div>
					{/if}
					<div class="min-h-0 flex-1">
						<PageStrip onExternalFiles={placeExternalFiles} compact={compactPages} />
					</div>
				</div>
			{/if}
		</main>
		{#if desktopViewport.current && editor.rightPanelVisible && !focusedCanvas}
			<aside
				bind:this={inspectorElement}
				class="image-editor-inspector relative hidden min-h-0 min-w-0 border-s bg-card lg:grid"
				style:--image-editor-layers-height={`${effectiveLayersPanelHeight}px`}
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
					aria-valuemax={panelMaximum()}
					aria-valuenow={Math.round(inspectorPanelWidth)}
					class="image-editor-resize-handle absolute inset-y-0 start-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 [@media(pointer:coarse)]:-start-5 [@media(pointer:coarse)]:top-1/2 [@media(pointer:coarse)]:bottom-auto [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-y-1/2"
					onpointerdown={(event) => startPanelResize(event, 'inspector')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'inspector')}
					ondblclick={() => {
						inspectorPanelWidth = clampPanelSize(320, 280, panelMaximum(), 320);
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
					aria-valuenow={Math.round(effectiveLayersPanelHeight)}
					class="image-editor-resize-handle relative z-10 cursor-row-resize touch-none border-x-0 border-y bg-background p-0"
					onpointerdown={(event) => startPanelResize(event, 'layers')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'layers')}
					ondblclick={() => {
						setActiveLayersPanelHeight(activeEditorWorkspace === 'color' ? 120 : 160, false);
						storePanelLayout();
					}}
				></div>
				<div class="min-h-0 min-w-0 overflow-hidden">
					<PropertiesPanel
						onAIEdit={$auth.user && editor.canEdit
							? () => {
									mobileSheet = null;
									imageAIStudio?.openFor('edit');
								}
							: undefined}
						onOpenMedia={openBackgroundMediaPicker}
						colorWorkspace={activeEditorWorkspace === 'color'}
					/>
				</div>
			</aside>
		{/if}
		{#if !desktopViewport.current && activeEditorWorkspace === 'color' && !focusedCanvas && !imageAIStudioOpen}
			<aside
				class="image-editor-mobile-color min-h-0 min-w-0 overflow-hidden border-t bg-card lg:hidden"
			>
				<PropertiesPanel
					onAIEdit={$auth.user && editor.canEdit
						? () => {
								mobileSheet = null;
								imageAIStudio?.openFor('edit');
							}
						: undefined}
					onOpenMedia={openBackgroundMediaPicker}
					onOpenLayers={() => (mobileSheet = 'layers')}
					colorWorkspace
				/>
			</aside>
		{/if}
	</div>

	<nav
		class="flex h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 border-t bg-background px-1 pt-1 pb-[env(safe-area-inset-bottom)] sm:hidden"
		hidden={activeEditorWorkspace !== 'edit' || imageAIStudioOpen}
		aria-label={m.image_editor_tools()}
	>
		<Button
			variant="ghost"
			class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-xs"
			onclick={() => (mobileSheet = 'assets')}
		>
			<ThemeIcon role="layout" />
			<span class="max-w-full truncate">{m.image_editor_add()}</span>
		</Button>
		<ToolFamilyButton
			label={m.image_editor_select()}
			active={[
				'select',
				'marquee',
				'ellipse_marquee',
				'lasso',
				'polygonal_lasso',
				'magic_wand',
				'eyedropper',
				'hand'
			].includes(editor.activeTool)}
			layout="bottom"
			onclick={() => setTool(mobileSelectTool)}
		>
			{#snippet icon()}
				<ProtectedIcon icon="editor-select" />
				<span class="max-w-full truncate">{m.image_editor_select()}</span>
			{/snippet}
			{#snippet menu()}
				{#each mobileToolCommands('select') as command (command.id)}
					{@const Icon = commandIcons.get(command.id) ?? fallbackToolGlyph}
					<DropdownMenu.Item
						onclick={() => executeEditorCommand(command.id)}
						disabled={!commandEnabled(command.id)}
						title={commandDisabledReason(command.id) || undefined}
					>
						{@render toolGlyph(Icon)}{commandLabel(command.id)}
						<span class="ms-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
					</DropdownMenu.Item>
				{/each}
			{/snippet}
		</ToolFamilyButton>
		<ToolFamilyButton
			label={m.image_editor_draw()}
			active={['text', 'pencil', 'bucket', 'gradient'].includes(editor.activeTool)}
			layout="bottom"
			onclick={() => setTool(mobileDrawTool)}
		>
			{#snippet icon()}
				<ThemeIcon role="edit" />
				<span class="max-w-full truncate">{m.image_editor_draw()}</span>
			{/snippet}
			{#snippet menu()}
				{#each mobileToolCommands('draw') as command (command.id)}
					{@const Icon = commandIcons.get(command.id) ?? fallbackToolGlyph}
					<DropdownMenu.Item
						onclick={() => executeEditorCommand(command.id)}
						disabled={!commandEnabled(command.id)}
						title={commandDisabledReason(command.id) || undefined}
					>
						{@render toolGlyph(Icon)}{commandLabel(command.id)}
						<span class="ms-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
					</DropdownMenu.Item>
				{/each}
			{/snippet}
		</ToolFamilyButton>
		<ToolFamilyButton
			label={m.image_editor_retouch()}
			active={['crop', 'eraser', 'magic_eraser'].includes(editor.activeTool)}
			disabled={!editor.canEdit}
			layout="bottom"
			onclick={() => setTool(mobileRetouchTool)}
		>
			{#snippet icon()}
				<ProtectedIcon icon="editor-erase" />
				<span class="max-w-full truncate">{m.image_editor_retouch()}</span>
			{/snippet}
			{#snippet menu()}
				{#each mobileToolCommands('retouch') as command (command.id)}
					{@const Icon = commandIcons.get(command.id) ?? fallbackToolGlyph}
					<DropdownMenu.Item
						onclick={() => executeEditorCommand(command.id)}
						disabled={!commandEnabled(command.id)}
						title={commandDisabledReason(command.id) || undefined}
					>
						{@render toolGlyph(Icon)}{commandLabel(command.id)}
						<span class="ms-auto text-xs text-muted-foreground">{commandShortcut(command.id)}</span>
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Item
					onclick={() => removeBackground()}
					disabled={!editor.selectedLayers[0]?.image}
					><ProtectedIcon
						icon="editor-effects"
					/>{m.image_editor_remove_background()}</DropdownMenu.Item
				>
			{/snippet}
		</ToolFamilyButton>
		<Button
			variant={mobileSheet === 'layers' ? 'secondary' : 'ghost'}
			class="h-12 min-w-0 flex-1 flex-col gap-0 px-0 text-xs"
			onclick={() => (mobileSheet = 'layers')}
		>
			<ProtectedIcon icon="editor-layers" />
			<span class="max-w-full truncate">{m.image_editor_layers()}</span>
		</Button>
		<Button
			variant={mobileSheet === 'properties' ? 'secondary' : 'ghost'}
			class="h-12 min-w-0 flex-[1.4] flex-col gap-0 px-0 text-xs"
			onclick={() => (mobileSheet = 'properties')}
		>
			<ThemeIcon role="controls" />
			<span class="max-w-full truncate">{m.image_editor_properties()}</span>
		</Button>
	</nav>

	<nav
		class="hidden h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain border-t bg-background px-1 pt-1 pb-[env(safe-area-inset-bottom)] sm:flex lg:hidden"
		hidden={activeEditorWorkspace !== 'edit'}
		aria-label={m.image_editor_tools()}
	>
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-xs md:h-12"
			onclick={() => (mobileSheet = 'assets')}
		>
			<ThemeIcon role="layout" />
			{m.image_editor_add()}
		</Button>
		{#each railSlots as railSlot (railSlot.slot)}
			{#if railSlot.slot === 'select' || railSlot.slot === 'draw' || railSlot.slot === 'view'}
				{@render railSlotFamily(railSlot.slot, 'bottom')}
			{:else if railSlot.slot === 'shape'}
				<ToolFamilyButton
					label={commandLabel(railSlot.command.id)}
					active={editor.activeTool === 'shape'}
					disabled={!commandEnabled(railSlot.command.id)}
					layout="bottom"
					onclick={() => executeEditorCommand(railSlot.command.id)}
				>
					{#snippet icon()}
						{#if shapeSlotKind === 'line'}
							<ProtectedIcon icon="editor-path" />
						{:else if shapeSlotKind === 'rounded_rectangle'}
							<ProtectedIcon icon="editor-shape-rounded-rectangle" />
						{:else if shapeSlotKind === 'ellipse'}
							<ProtectedIcon icon="editor-shape-ellipse" />
						{:else}
							<ProtectedIcon icon="editor-shape-rectangle" />
						{/if}
						<span class="max-w-full truncate">{commandLabel(railSlot.command.id)}</span>
					{/snippet}
					{#snippet menu()}
						<DropdownMenu.Item onclick={() => insertShape('rectangle')}>
							<ProtectedIcon icon="editor-shape-rectangle" />
							{m.image_editor_rectangle()}
							<span class="ms-auto text-xs text-muted-foreground">U</span>
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertShape('rounded_rectangle')}>
							<ProtectedIcon icon="editor-shape-rounded-rectangle" />
							{m.image_editor_rounded_rectangle()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertShape('ellipse')}>
							<ProtectedIcon icon="editor-shape-ellipse" />
							{m.image_editor_ellipse()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertShape('line')}>
							<ProtectedIcon icon="editor-path" />
							{m.image_editor_line()}
						</DropdownMenu.Item>
					{/snippet}
				</ToolFamilyButton>
			{:else}
				{@const ToolIcon = commandIcons.get(railSlot.command.id) ?? fallbackToolGlyph}
				<Button
					variant={editor.activeTool === commandTool(railSlot.command) ? 'secondary' : 'ghost'}
					class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-xs md:h-12"
					onclick={() => executeEditorCommand(railSlot.command.id)}
					disabled={!commandEnabled(railSlot.command.id)}
					title={commandDisabledReason(railSlot.command.id) || undefined}
				>
					{@render toolGlyph(ToolIcon)}
					{commandLabel(railSlot.command.id)}
				</Button>
			{/if}
		{/each}
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-xs md:h-12"
			onclick={() => (mobileSheet = 'layers')}
		>
			<ProtectedIcon icon="editor-layers" />
			{m.image_editor_layers()}
		</Button>
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-xs md:h-12"
			onclick={() => (mobileSheet = 'properties')}
		>
			<ThemeIcon role="controls" />
			{m.image_editor_properties()}
		</Button>
	</nav>
</div>

<Sheet.Root
	open={mobileSheet === 'properties'}
	onOpenChange={(open) => {
		if (open) return;
		mobileSheet = null;
	}}
>
	<Sheet.Content
		side="bottom"
		modal={false}
		showCloseButton={false}
		class="max-h-[62dvh] w-full! rounded-t-2xl p-0"
	>
		<Sheet.Header class="sr-only">
			<Sheet.Title>{m.image_editor_properties()}</Sheet.Title>
			<Sheet.Description>{m.image_editor_editing_controls()}</Sheet.Description>
		</Sheet.Header>
		<div class="relative max-h-[62dvh] overflow-y-auto">
			<Sheet.Close>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class="absolute end-1 top-0 z-20 [@media(pointer:coarse)]:size-11"
						aria-label={m.common_close()}
					>
						<ThemeIcon role="close" />
					</Button>
				{/snippet}
			</Sheet.Close>
			<PropertiesPanel
				onAIEdit={$auth.user && editor.canEdit
					? () => {
							mobileSheet = null;
							imageAIStudio?.openFor('edit');
						}
					: undefined}
				onOpenMedia={openBackgroundMediaPicker}
				colorWorkspace={activeEditorWorkspace === 'color'}
			/>
		</div>
	</Sheet.Content>
</Sheet.Root>
<Sheet.Root
	open={mobileSheet === 'assets' || mobileSheet === 'layers'}
	onOpenChange={(open) => {
		if (open) return;
		mobileSheet = null;
		editor.backgroundImagePickerActive = false;
	}}
>
	<Sheet.Content
		side={mobileSheet === 'layers' ? 'right' : 'bottom'}
		showCloseButton={mobileSheet === 'layers'}
		class={mobileSheet === 'layers'
			? 'h-dvh! w-full! p-0 sm:max-w-sm!'
			: 'max-h-[62dvh] w-full! rounded-t-2xl p-0'}
	>
		<Sheet.Header class="sr-only">
			<Sheet.Title
				>{mobileSheet === 'assets' ? m.image_editor_add() : m.image_editor_layers()}</Sheet.Title
			>
			<Sheet.Description>{m.image_editor_editing_controls()}</Sheet.Description>
		</Sheet.Header>
		<div
			class={mobileSheet === 'layers' ? 'h-full pt-14' : 'relative max-h-[62dvh] overflow-y-auto'}
		>
			{#if mobileSheet !== 'layers'}
				<Sheet.Close>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="absolute end-1 top-0 z-20 [@media(pointer:coarse)]:size-11"
							aria-label={m.common_close()}
						>
							<ThemeIcon role="close" />
						</Button>
					{/snippet}
				</Sheet.Close>
			{/if}
			{#if mobileSheet === 'assets'}
				<div class="h-[70dvh]">
					<AssetPanel
						{guestMode}
						onclose={() => {
							mobileSheet = null;
							editor.backgroundImagePickerActive = false;
						}}
					/>
				</div>
			{:else if mobileSheet === 'layers'}
				<LayerTree />
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

<ImageEditorVersionsDialogs
	bind:this={versionsDialogs}
	{guestMode}
	bind:historyOpen={historyDialogOpen}
	bind:checkpointOpen={checkpointDialogOpen}
	bind:templateOpen={templateDialogOpen}
	coverPreviewMediaID={() => coverPreviewMediaID}
	saveNow={() => saveNow()}
	captureMutationView={captureEditorMutationView}
	mutationViewIsCurrent={editorMutationViewIsCurrent}
	onconflict={openConflictRecovery}
	onrestored={(response) => (coverPreviewMediaID = response.cover_preview_media_id ?? '')}
	onannounce={(message) => (statusAnnouncement = message)}
/>

<ImageEditorResizeDialog bind:open={resizeDialogOpen} />

<ImageEditorGuideDialog bind:open={guideDialogOpen} />

<ImageEditorExportDialog
	bind:this={exportDialog}
	bind:open={exportDialogOpen}
	{guestMode}
	{returnToken}
	{coverHandoff}
	{attachLabel}
	isViewActive={() => editorViewActive}
	{saveNow}
	captureMutationView={captureEditorMutationView}
	mutationViewIsCurrent={editorMutationViewIsCurrent}
	onexported={(message) => {
		suppressSavedAnnouncementUntil = Date.now() + 5_000;
		statusAnnouncement = message;
	}}
	onannounce={(message) => (statusAnnouncement = message)}
	onsaveguest={saveToOpenPost}
/>

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
					<dd class="text-end font-mono text-xs">{commandShortcut(command.id)}</dd>
				{/each}
			</dl>
		</div>
	</Dialog.Content>
</Dialog.Root>
{#if !guestMode}
	<FeedbackDialog />
{/if}

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
		--image-editor-accent: var(--primary);
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
		.image-editor-workspace[data-workspace='color'] {
			grid-template-rows:
				minmax(0, min(60%, calc(42% + var(--image-editor-mobile-pages-height))))
				minmax(0, 1fr);
		}

		.image-editor-theme :global(button) {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}

	@media (min-width: 40rem) and (max-width: 63.999rem) and (max-height: 32rem) {
		.image-editor-workspace[data-workspace='color'] {
			grid-template-columns: minmax(0, 1fr) minmax(280px, 45%);
			grid-template-rows: minmax(0, 1fr);
		}

		.image-editor-mobile-color {
			border-top: 0;
			border-left-width: 1px;
		}
	}

	@media (min-width: 64rem) {
		.image-editor-workspace {
			grid-template-columns:
				44px
				minmax(0, 1fr)
				var(--image-editor-inspector-width);
		}

		.image-editor-workspace[data-inspector='false'] {
			grid-template-columns: 44px minmax(0, 1fr);
		}

		.image-editor-workspace[data-workspace='color'] {
			grid-template-columns: 44px minmax(0, 1fr) var(--image-editor-inspector-width);
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
