<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ContextMenu, Menubar } from 'bits-ui';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import StudioCanvas from './studio-canvas.svelte';
	import AssetPanel from './asset-panel.svelte';
	import LayerTree from './layer-tree.svelte';
	import PropertiesPanel from './properties-panel.svelte';
	import PageStrip from './page-strip.svelte';
	import StudioColorPicker from './studio-color-picker.svelte';
	import { provideStudioEditor, StudioEditor } from '../editor.svelte';
	import {
		completeStudioReturnToken,
		createStudioCheckpoint,
		createStudioTemplate,
		duplicateStudioDesign,
		loadStudioDesign,
		listStudioRevisions,
		listStudioTemplates,
		restoreStudioRevision,
		saveStudioDesign,
		updateStudioTemplate
	} from '../api';
	import {
		clearLocalStudioRecovery,
		loadLocalStudioRecovery,
		storeLocalStudioRecovery
	} from '../recovery';
	import { saveGuestStudioDesign, storeGuestStudioMedia } from '../local-persistence';
	import { publicStudioPageCountBucket, trackPublicStudioEvent } from '../public-telemetry';
	import { cloneStudioLayer, studioPageHasTransparency, validateStudioDocument } from '../document';
	import {
		downloadRenderedPages,
		renderStudioPages,
		renderStudioPreview
	} from '../static-renderer';
	import { StudioBackgroundRemoval } from '../background-removal';
	import type {
		StudioBrandKit,
		StudioDocumentResponse,
		StudioLayer,
		StudioRevisionSummary,
		StudioTemplate,
		StudioTool
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
	import CheckIcon from 'lucide-svelte/icons/check';
	import SquareIcon from 'lucide-svelte/icons/square';
	import CircleIcon from 'lucide-svelte/icons/circle';
	import MinusIcon from 'lucide-svelte/icons/minus';
	import { m } from '$lib/paraglide/messages';
	import { startStudioMetric } from '../telemetry';

	let {
		initial,
		returnToken = '',
		backgroundModelBaseURL = '/studio-models',
		initialAction = '',
		readOnlyReason = '',
		initialBrandKit = null,
		guestMode = false,
		onSaveToOpenPost
	}: {
		initial: StudioDocumentResponse;
		returnToken?: string;
		backgroundModelBaseURL?: string;
		initialAction?: string;
		readOnlyReason?: string;
		initialBrandKit?: StudioBrandKit | null;
		guestMode?: boolean;
		onSaveToOpenPost?: () => void | Promise<void>;
	} = $props();

	const editor = provideStudioEditor(new StudioEditor());
	const backgroundRemoval = new StudioBackgroundRemoval();
	const DESKTOP_TOOL_RAIL_WIDTH = 44;
	const MINIMUM_CANVAS_WIDTH = 320;
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
	let studioMenuValue = $state('');
	let pendingSave: SaveRequest | null = null;
	let saveDrain: Promise<boolean> | null = null;
	let saveRetryDelay = INITIAL_SAVE_RETRY_DELAY;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let previewPending = false;
	let previewBusy = false;
	let previewTask: Promise<void> | null = null;
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
	let copiedLayers = $state.raw<StudioLayer[]>([]);
	let statusAnnouncement = $state('');
	let suppressSavedAnnouncementUntil = 0;
	let revisions = $state<StudioRevisionSummary[]>([]);
	let historyBusy = $state(false);
	let historyError = $state('');
	let checkpointName = $state('');
	let templateName = $state('');
	let templateCategory = $state<string>(m.studio_workspace_category());
	let templateTargetID = $state('new');
	let workspaceTemplates = $state<StudioTemplate[]>([]);
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
	let exportHasTransparency = $derived(exportPages.some(studioPageHasTransparency));
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
				JSON.parse(localStorage.getItem('openpost-studio-recent-colors-v1') || '[]') as string[]
			);
		} catch {
			editor.setRecentColors([]);
		}
		try {
			const stored = JSON.parse(localStorage.getItem('openpost-studio-layout-v1') || '{}') as {
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
			previewPending = !guestMode;
			if (guestMode && !meaningfulEditTracked) {
				meaningfulEditTracked = true;
				trackPublicStudioEvent('studio_meaningful_edit', { source: 'editor' });
			}
			if (editor.document && !guestMode) {
				void storeLocalStudioRecovery({
					design_id: editor.id,
					workspace_id: editor.workspaceID,
					revision: editor.revision,
					document: editor.document
				}).then(() => {
					if (editor.saveState === 'idle') {
						editor.saveState = 'local';
						editor.saveMessage = m.studio_saved_locally();
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

	function openStudioMenu(event: PointerEvent, value: string): void {
		if (event.button !== 0 || event.ctrlKey) return;
		event.preventDefault();
		studioMenuValue = value;
		(event.currentTarget as HTMLElement).focus();
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
				'openpost-studio-layout-v1',
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
		const local = await loadLocalStudioRecovery(editor.id);
		if (!local || local.revision < editor.revision) return;
		if (local.updated_at <= initial.updated_at) return;
		editor.document = local.document;
		editor.saveState = 'local';
		editor.saveMessage = m.studio_recovered_local();
		statusAnnouncement = m.studio_recovered_announcement();
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
		const errors = validateStudioDocument(submittedDocument);
		if (errors.length > 0) {
			editor.saveState = 'error';
			editor.saveMessage = errors[0];
			statusAnnouncement = errors[0];
			return 'blocked';
		}
		editor.saveState = 'saving';
		editor.saveMessage = m.common_saving();
		const finishMetric = startStudioMetric('autosave');
		try {
			const response = guestMode
				? await saveGuestStudioDesign(editor.id, submittedDocument)
				: await saveStudioDesign(
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
				editor.saveMessage = guestMode ? m.studio_public_saved_device() : m.studio_saved();
				showSavedIndicator();
				if (!guestMode) await clearLocalStudioRecovery(editor.id);
				if (Date.now() >= suppressSavedAnnouncementUntil) {
					statusAnnouncement = guestMode
						? m.studio_public_saved_device()
						: m.studio_saved_announcement();
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
				editor.saveMessage = m.studio_save_conflict();
				conflictDialogOpen = true;
				statusAnnouncement = m.studio_conflict_title();
			} else if (!navigator.onLine) {
				editor.saveState = 'offline';
				editor.saveMessage = m.studio_saved_locally();
				statusAnnouncement = m.studio_offline_saved();
			} else {
				editor.saveState = 'error';
				editor.saveMessage = cause instanceof Error ? cause.message : m.studio_save_failed();
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
		const finishMetric = startStudioMetric('preview_generation');
		let metricOutcome: 'success' | 'error' = 'success';
		const documentSnapshot = structuredClone(editor.document);
		const pageSnapshot = structuredClone(page);
		try {
			const blob = await renderStudioPreview(documentSnapshot, pageSnapshot);
			const uploaded = await uploadMediaFile({
				workspaceId: editor.workspaceID,
				file: new File([blob], `${editor.id}-${page.id}-preview.webp`, {
					type: 'image/webp'
				}),
				source: 'studio_edit',
				assetKind: 'design_preview',
				designDocumentId: editor.id,
				designPageId: page.id
			});
			if (!editor.document?.pages.some((item) => item.id === page.id)) return;
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
		}
	}

	async function reloadServerVersion(): Promise<void> {
		const response = await loadStudioDesign(editor.id);
		editor.replaceFromServer(response);
		coverPreviewMediaID = response.cover_preview_media_id ?? '';
		await clearLocalStudioRecovery(editor.id);
		conflictDialogOpen = false;
	}

	async function saveConflictAsCopy(): Promise<void> {
		if (!editor.document) return;
		const localDocument = structuredClone(editor.document);
		const duplicate = await duplicateStudioDesign(editor.id);
		const saved = await saveStudioDesign(duplicate.id, duplicate.revision, localDocument);
		editor.load(saved);
		conflictDialogOpen = false;
		await goto(resolve(`/studio/${duplicate.id}` as '/'));
	}

	async function goBack(): Promise<void> {
		if (editor.canEdit) {
			const saved = editor.saveState === 'saved' ? true : await saveNow(undefined, 'close');
			if (previewTask) await previewTask;
			if (!guestMode && saved && previewPending) await runPreview('close');
		}
		if (history.length > 1) history.back();
		else void goto(resolve((guestMode ? '/studio' : '/media') as '/'));
	}

	async function openHistory(): Promise<void> {
		if (guestMode) return;
		historyDialogOpen = true;
		historyBusy = true;
		historyError = '';
		try {
			revisions = await listStudioRevisions(editor.id);
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.studio_history_load_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function createCheckpoint(): Promise<void> {
		if (!checkpointName.trim()) return;
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.studio_checkpoint_save_first());
			await createStudioCheckpoint(editor.id, checkpointName.trim());
			checkpointName = '';
			checkpointDialogOpen = false;
			await openHistory();
			statusAnnouncement = m.studio_checkpoint_created();
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.studio_checkpoint_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function restoreRevision(revision: StudioRevisionSummary): Promise<void> {
		historyBusy = true;
		historyError = '';
		try {
			const response = await restoreStudioRevision(editor.id, revision.id, editor.revision);
			editor.load(response);
			await clearLocalStudioRecovery(editor.id);
			historyDialogOpen = false;
			statusAnnouncement = m.studio_version_restored();
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.studio_restore_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function saveAsTemplate(): Promise<void> {
		if (!editor.document || !templateName.trim()) return;
		historyBusy = true;
		historyError = '';
		try {
			if (!(await saveNow())) throw new Error(m.studio_template_save_first());
			const templateInput = {
				name: templateName.trim(),
				category: templateCategory.trim() || m.studio_workspace_category(),
				preview_media_id: editor.document.pages[0]?.latest_export_media_id,
				document: editor.document
			};
			if (templateTargetID === 'new') {
				await createStudioTemplate({ workspace_id: editor.workspaceID, ...templateInput });
			} else {
				await updateStudioTemplate(templateTargetID, templateInput);
			}
			templateDialogOpen = false;
			templateName = '';
			statusAnnouncement =
				templateTargetID === 'new' ? m.studio_template_created() : m.studio_template_replaced();
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.studio_template_save_failed();
		} finally {
			historyBusy = false;
		}
	}

	async function openTemplateDialog(): Promise<void> {
		historyError = '';
		templateTargetID = 'new';
		templateName = editor.document?.title ?? '';
		templateCategory = m.studio_workspace_category();
		templateDialogOpen = true;
		try {
			workspaceTemplates = (await listStudioTemplates(editor.workspaceID)).filter(
				(template) => !template.built_in
			);
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : m.studio_templates_load_failed();
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
			resizeError = m.studio_resize_limits();
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

	function setTool(tool: StudioTool): void {
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
		const tools: Record<string, StudioTool> = {
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
					'application/x-openpost-studio-layers+json': new Blob([payload], {
						type: 'application/x-openpost-studio-layers+json'
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
				entry.types.includes('application/x-openpost-studio-layers+json')
			);
			if (item) {
				const blob = await item.getType('application/x-openpost-studio-layers+json');
				const parsed = JSON.parse(await blob.text()) as { version: number; layers: StudioLayer[] };
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
				? await storeGuestStudioMedia(editor.id, file)
				: await uploadMediaFile({
						workspaceId: editor.workspaceID,
						file,
						source: 'upload'
					});
			editor.addImage({ id: uploaded.id, name: m.studio_pasted_image() });
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
			cloneStudioLayer(layer, m.studio_layer_copy_name({ name: layer.name }))
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
		const finishMetric = startStudioMetric('background_removal');
		backgroundError = '';
		backgroundProgress = m.studio_background_loading();
		try {
			const response = await fetch(getAuthenticatedMediaURL(`/media/${layer.image.media_id}`), {
				credentials: 'include'
			});
			if (!response.ok) throw new Error(m.studio_background_source_failed());
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
				backgroundProgress = m.studio_background_optimizing();
				source = await optimizeBackgroundSource(source);
			}
			const result = await backgroundRemoval.remove(source, backgroundModelBaseURL, (progress) => {
				backgroundProgress = `${progress.stage} ${Math.round(progress.progress * 100)}%`;
			});
			backgroundProgress = m.studio_background_saving();
			const file = new File([result], `${layer.name || 'image'}-no-background.png`, {
				type: 'image/png'
			});
			const uploaded = guestMode
				? await storeGuestStudioMedia(editor.id, file)
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
			statusAnnouncement = m.studio_background_done();
			finishMetric();
		} catch (cause) {
			finishMetric('error');
			backgroundError = cause instanceof Error ? cause.message : m.studio_background_failed();
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
			throw new Error(m.studio_background_preparation_failed());
		}
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error(m.studio_background_prepare_failed()))),
				'image/png'
			);
		});
	}

	async function exportDesign(): Promise<void> {
		if (!editor.document || exportBusy) return;
		exportBusy = true;
		const finishMetric = startStudioMetric('export');
		exportError = '';
		exportProgress = m.studio_export_saving();
		try {
			const saved = await saveNow();
			if (!saved && exportMode !== 'download') {
				throw new Error(m.studio_export_save_first());
			}
			const pageIDs = exportAllPages
				? editor.document.pages.map((page) => page.id)
				: [editor.activePageID];
			const rendered = await renderStudioPages(editor.document, pageIDs, (done, total) => {
				exportProgress = m.studio_rendering_progress({ done, total });
			});
			if (exportMode === 'download') {
				downloadRenderedPages(rendered, editor.document.title);
				exportDialogOpen = false;
				exportSuccessfulByPage = {};
				suppressSavedAnnouncementUntil = Date.now() + 5_000;
				statusAnnouncement = m.studio_export_downloaded();
				if (guestMode) {
					trackPublicStudioEvent('studio_export_completed', {
						format: exportFormat,
						pages: publicStudioPageCountBucket(rendered.length)
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
				exportProgress = m.studio_saving_media_progress({
					done: index + 1,
					total: rendered.length
				});
				const file = new File([page.blob], page.filename, { type: page.blob.type });
				const uploaded = await uploadMediaFile({
					workspaceId: editor.workspaceID,
					file,
					source: 'studio_export',
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
				if (!returnToken) throw new Error(m.studio_attach_missing());
				const returnURL = await completeStudioReturnToken(returnToken, editor.id, mediaIDs);
				await goto(
					resolve(
						`${returnURL}${returnURL.includes('?') ? '&' : '?'}studio_return=${encodeURIComponent(returnToken)}` as '/'
					)
				);
				finishMetric();
				return;
			}
			exportDialogOpen = false;
			exportSuccessfulByPage = {};
			suppressSavedAnnouncementUntil = Date.now() + 5_000;
			statusAnnouncement = m.studio_exported_pages({
				count: mediaIDs.length,
				suffix: mediaIDs.length === 1 ? '' : 's'
			});
			finishMetric();
		} catch (cause) {
			finishMetric('error');
			exportError = cause instanceof Error ? cause.message : m.studio_export_failed();
			statusAnnouncement = exportError;
		} finally {
			exportBusy = false;
			exportProgress = '';
		}
	}

	const tools: Array<{ key: StudioTool; label: string; icon: typeof MousePointerIcon }> = [
		{ key: 'select', label: m.studio_select(), icon: MousePointerIcon },
		{ key: 'marquee', label: m.studio_pixel_select(), icon: RectangleSelectIcon },
		{ key: 'lasso', label: m.studio_lasso_select(), icon: LassoSelectIcon },
		{ key: 'magic_wand', label: m.studio_magic_select(), icon: WandIcon },
		{ key: 'text', label: m.studio_text(), icon: TypeIcon },
		{ key: 'shape', label: m.studio_shape(), icon: SquareIcon },
		{ key: 'pencil', label: m.studio_pencil(), icon: PencilIcon },
		{ key: 'bucket', label: m.studio_fill(), icon: PaintBucketIcon },
		{ key: 'eraser', label: m.studio_erase(), icon: EraserIcon },
		{ key: 'hand', label: m.studio_hand(), icon: HandIcon },
		{ key: 'zoom', label: m.studio_zoom(), icon: ZoomInIcon }
	];

	function isMarqueeTool(
		tool: StudioTool
	): tool is Extract<StudioTool, 'marquee' | 'ellipse_marquee'> {
		return tool === 'marquee' || tool === 'ellipse_marquee';
	}

	function isFillTool(tool: StudioTool): tool is Extract<StudioTool, 'bucket' | 'gradient'> {
		return tool === 'bucket' || tool === 'gradient';
	}

	function isEraserTool(tool: StudioTool): tool is Extract<StudioTool, 'eraser' | 'magic_eraser'> {
		return tool === 'eraser' || tool === 'magic_eraser';
	}

	function selectionToolLabel(tool: StudioTool): string {
		if (tool === 'marquee') return m.studio_rectangle_select();
		if (tool === 'ellipse_marquee') return m.studio_ellipse_select();
		if (tool === 'lasso') return m.studio_lasso_select();
		if (tool === 'magic_wand') return m.studio_magic_select();
		return m.studio_pixel_select();
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
	class="studio-theme fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground"
	data-testid="studio-shell"
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
			bind:value={studioMenuValue}
			class="ml-1 hidden items-center gap-0.5 lg:flex"
			aria-label={m.studio_menus()}
		>
			<Menubar.Menu value="file">
				<Menubar.Trigger
					class="studio-menubar-trigger"
					onpointerdown={(event) => openStudioMenu(event, 'file')}
					>{m.studio_file()}</Menubar.Trigger
				>
				<Menubar.Portal>
					<Menubar.Content class="studio-menubar-content" onclick={() => (studioMenuValue = '')}>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => saveNow()}
							disabled={!editor.canEdit}><SaveIcon class="size-4" /> {m.common_save()}</Menubar.Item
						>
						{#if guestMode}
							<Menubar.Item class="studio-menubar-item" onclick={saveToOpenPost}
								>{m.studio_public_save_openpost()}</Menubar.Item
							>
						{:else}
							<Menubar.Item class="studio-menubar-item" onclick={openHistory}
								>{m.studio_version_history()}</Menubar.Item
							>
							<Menubar.Item
								class="studio-menubar-item"
								onclick={() => (checkpointDialogOpen = true)}
								disabled={!editor.canEdit}>{m.studio_create_checkpoint()}</Menubar.Item
							>
							<Menubar.Item
								class="studio-menubar-item"
								onclick={openTemplateDialog}
								disabled={!editor.canEdit}>{m.studio_save_template()}</Menubar.Item
							>
						{/if}
						<Menubar.Item
							class="studio-menubar-item"
							onclick={openResizeDialog}
							disabled={!editor.canEdit}>{m.studio_resize_design()}</Menubar.Item
						>
						<Menubar.Separator class="my-1 h-px bg-border" />
						<Menubar.Item class="studio-menubar-item" onclick={() => openExport('download')}
							><DownloadIcon class="size-4" /> {m.studio_export()}</Menubar.Item
						>
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
			<Menubar.Menu value="edit">
				<Menubar.Trigger
					class="studio-menubar-trigger"
					onpointerdown={(event) => openStudioMenu(event, 'edit')}
					>{m.studio_edit()}</Menubar.Trigger
				>
				<Menubar.Portal>
					<Menubar.Content class="studio-menubar-content" onclick={() => (studioMenuValue = '')}>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => editor.undo()}
							disabled={!editor.canUndo}>{m.studio_undo()}</Menubar.Item
						>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => editor.redo()}
							disabled={!editor.canRedo}>{m.studio_redo()}</Menubar.Item
						>
						<Menubar.Separator class="my-1 h-px bg-border" />
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => editor.duplicateSelected()}
							disabled={editor.selectedLayerIDs.length === 0}>{m.studio_duplicate()}</Menubar.Item
						>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => editor.deleteSelected()}
							disabled={editor.selectedLayerIDs.length === 0}>{m.common_delete()}</Menubar.Item
						>
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
			<Menubar.Menu value="layer">
				<Menubar.Trigger
					class="studio-menubar-trigger"
					onpointerdown={(event) => openStudioMenu(event, 'layer')}
					>{m.studio_layer()}</Menubar.Trigger
				>
				<Menubar.Portal>
					<Menubar.Content class="studio-menubar-content" onclick={() => (studioMenuValue = '')}>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => editor.groupSelected()}
							disabled={editor.selectedLayers.length < 2}
							><GroupIcon class="size-4" /> {m.studio_group()}</Menubar.Item
						>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => editor.ungroupSelected()}
							disabled={!editor.selectedLayers.some((layer) => layer.type === 'group')}
							><UngroupIcon class="size-4" /> {m.studio_ungroup()}</Menubar.Item
						>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => removeBackground()}
							disabled={!editor.selectedLayers[0]?.image}
							><WandIcon class="size-4" /> {m.studio_remove_background()}</Menubar.Item
						>
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
			<Menubar.Menu value="view">
				<Menubar.Trigger
					class="studio-menubar-trigger"
					onpointerdown={(event) => openStudioMenu(event, 'view')}
					>{m.studio_view()}</Menubar.Trigger
				>
				<Menubar.Portal>
					<Menubar.Content class="studio-menubar-content" onclick={() => (studioMenuValue = '')}>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => (editor.rightPanelVisible = !editor.rightPanelVisible)}
							>{m.studio_toggle_inspector()}</Menubar.Item
						>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => {
								editor.zoom = 0.75;
								editor.panX = 0;
								editor.panY = 0;
							}}>{m.studio_fit_canvas()}</Menubar.Item
						>
						<Menubar.Item class="studio-menubar-item" onclick={() => (editor.zoom = 1)}
							>{m.studio_zoom_100()}</Menubar.Item
						>
						<Menubar.Item
							class="studio-menubar-item"
							onclick={() => (focusedCanvas = !focusedCanvas)}
							>{m.studio_focused_canvas()}</Menubar.Item
						>
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
		</Menubar.Root>
		{#if editor.saveState === 'saving'}
			<div class="hidden min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground sm:flex">
				<LoaderIcon class="size-3.5 animate-spin" />
				<span>{m.common_saving()}</span>
			</div>
		{:else if savedIndicatorVisible && editor.saveState === 'saved'}
			<div
				class="hidden min-w-0 animate-in items-center gap-1.5 px-2 text-xs text-muted-foreground zoom-in-95 fade-in motion-reduce:animate-none sm:flex"
			>
				<CheckIcon class="size-3.5 text-primary" />
				<span>{guestMode ? m.studio_public_saved_device() : m.studio_saved()}</span>
			</div>
		{:else if ['local', 'offline', 'conflict', 'error'].includes(editor.saveState)}
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
			aria-label={m.studio_design_title()}
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
				aria-label={m.studio_undo()}><UndoIcon /></Button
			>
			<Button
				variant="ghost"
				size="icon-sm"
				class="size-11 max-[359px]:hidden md:size-11 lg:size-8"
				onclick={() => editor.redo()}
				disabled={!editor.canRedo}
				aria-label={m.studio_redo()}><RedoIcon /></Button
			>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="size-11 md:size-11 lg:hidden"
							aria-label={m.studio_more_actions()}
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
							>{m.studio_public_save_openpost()}</DropdownMenu.Item
						>
					{:else}
						<DropdownMenu.Item onclick={openHistory}>{m.studio_version_history()}</DropdownMenu.Item
						>
						<DropdownMenu.Item
							onclick={() => (checkpointDialogOpen = true)}
							disabled={!editor.canEdit}>{m.studio_create_checkpoint()}</DropdownMenu.Item
						>
					{/if}
					<DropdownMenu.Item onclick={() => (mobileSheet = 'layers')}
						>{m.studio_layers()}</DropdownMenu.Item
					>
					<DropdownMenu.Item onclick={() => (mobileSheet = 'properties')}
						>{m.studio_properties()}</DropdownMenu.Item
					>
					<DropdownMenu.Item
						onclick={() => removeBackground()}
						disabled={!editor.selectedLayers[0]?.image}
						>{m.studio_remove_background()}</DropdownMenu.Item
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
					{m.studio_public_save_openpost()}
				</Button>
			{/if}
			<Button
				size="sm"
				class="h-11 md:h-11 lg:h-8"
				onclick={() => openExport(returnToken && editor.canEdit ? 'attach' : 'download')}
			>
				{#if returnToken}{m.studio_attach()}{:else}{m.studio_export()}{/if}
			</Button>
		</div>
	</header>

	{#if !editor.canEdit}
		<div class="border-b bg-muted px-3 py-2 text-center text-xs">
			{readOnlyReason || m.studio_read_only()}
		</div>
	{/if}
	{#if backgroundBusy}
		<div class="border-b bg-primary/10 px-3 py-2 text-center text-xs" aria-live="polite">
			{backgroundProgress || m.studio_background_removing()}
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
		class="studio-workspace grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]"
		data-focused={focusedCanvas}
		data-inspector={editor.rightPanelVisible}
		style:--studio-assets-width={`${assetPanelWidth}px`}
		style:--studio-inspector-width={`${inspectorPanelWidth}px`}
	>
		<nav
			class="hidden min-h-0 flex-col items-center gap-1 border-r bg-background py-2 lg:flex"
			aria-label={m.studio_tools()}
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
									aria-label={m.studio_select_objects()}
									aria-pressed={editor.activeTool === 'select'}
								>
									<MousePointerIcon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{m.studio_select_objects()} · V</Tooltip.Content>
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
							<ContextMenu.Content
								class="z-50 min-w-52 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
							>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => setTool('marquee')}
								>
									<RectangleSelectIcon />
									{m.studio_rectangle_select()}
									<span class="ml-auto text-xs text-muted-foreground">M</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => setTool('ellipse_marquee')}
								>
									<CircleDashedIcon />
									{m.studio_ellipse_select()}
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
												aria-label={m.studio_add_shape()}
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
							<Tooltip.Content side="right">{m.studio_add_shape()} · U</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content
								class="z-50 min-w-52 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
							>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => insertShape('rectangle')}
								>
									<SquareIcon />
									{m.studio_rectangle()}
									<span class="ml-auto text-xs text-muted-foreground">U</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => insertShape('rounded_rectangle')}
								>
									<SquareIcon />
									{m.studio_rounded_rectangle()}
								</ContextMenu.Item>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => insertShape('ellipse')}
								>
									<CircleIcon />
									{m.studio_ellipse()}
								</ContextMenu.Item>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => insertShape('line')}
								>
									<MinusIcon />
									{m.studio_line()}
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
													? m.studio_gradient()
													: m.studio_paint_bucket()}
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
							<Tooltip.Content side="right">{m.studio_fill()}</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content
								class="z-50 min-w-44 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
							>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => setTool('bucket')}
								>
									<PaintBucketIcon />
									{m.studio_paint_bucket()}
									<span class="ml-auto text-xs text-muted-foreground">⇧G</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => setTool('gradient')}
								>
									<BlendIcon />
									{m.studio_gradient()}
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
													? m.studio_magic_erase()
													: m.studio_erase()}
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
							<Tooltip.Content side="right">{m.studio_erase()}</Tooltip.Content>
						</Tooltip.Root>
						<ContextMenu.Portal>
							<ContextMenu.Content
								class="z-50 min-w-48 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
							>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => setTool('eraser')}
								>
									<EraserIcon />
									{m.studio_erase()}
									<span class="ml-auto text-xs text-muted-foreground">E</span>
								</ContextMenu.Item>
								<ContextMenu.Item
									class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
									onclick={() => setTool('magic_eraser')}
								>
									<WandIcon />
									{m.studio_magic_erase()}
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
					aria-label={m.studio_resize_asset_panel()}
					title={m.studio_resize_asset_panel()}
					class="studio-resize-handle absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0"
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
				<StudioCanvas />
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
					aria-label={m.studio_zoom_out()}>−</Button
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
					aria-label={m.studio_zoom_in()}>+</Button
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
				class="studio-inspector relative hidden min-h-0 min-w-0 overflow-hidden border-l bg-background lg:grid"
				style:--studio-layers-height={`${layersPanelHeight}px`}
			>
				<button
					type="button"
					aria-label={m.studio_resize_inspector_panel()}
					title={m.studio_resize_inspector_panel()}
					class="studio-resize-handle absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0"
					onpointerdown={(event) => startPanelResize(event, 'inspector')}
					onkeydown={(event) => resizePanelWithKeyboard(event, 'inspector')}
				></button>
				<div class="min-h-0 min-w-0 overflow-hidden"><LayerTree /></div>
				<button
					type="button"
					aria-label={m.studio_resize_layers_properties()}
					title={m.studio_resize_layers_properties()}
					class="studio-resize-handle relative z-10 cursor-row-resize touch-none border-x-0 border-y bg-background p-0"
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
		aria-label={m.studio_tools()}
	>
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
			onclick={() => (mobileSheet = 'assets')}
		>
			<PanelLeftIcon />
			{m.studio_add()}
		</Button>
		{#each tools.filter( (tool) => ['select', 'marquee', 'lasso', 'magic_wand', 'text', 'pencil', 'bucket', 'eraser', 'hand'].includes(tool.key) ) as tool (tool.key)}
			{@const Icon = tool.icon}
			{#if tool.key === 'select'}
				<Button
					variant={editor.activeTool === 'select' ? 'secondary' : 'ghost'}
					class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
					onclick={() => setTool('select')}
					aria-label={m.studio_select_objects()}
					aria-pressed={editor.activeTool === 'select'}
				>
					<MousePointerIcon />
					{m.studio_select()}
				</Button>
			{:else if tool.key === 'marquee'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant={isMarqueeTool(editor.activeTool) ? 'secondary' : 'ghost'}
								class="relative h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
								aria-label={m.studio_pixel_select()}
							>
								{#if editor.activeTool === 'marquee'}
									<RectangleSelectIcon />
								{:else if editor.activeTool === 'ellipse_marquee'}
									<CircleDashedIcon />
								{:else}
									<RectangleSelectIcon />
								{/if}
								{m.studio_pixels()}
								{@render toolGroupIndicator()}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="min-w-52">
						<DropdownMenu.Item onclick={() => setTool('marquee')}>
							<RectangleSelectIcon />
							{m.studio_rectangle_select()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => setTool('ellipse_marquee')}>
							<CircleDashedIcon />
							{m.studio_ellipse_select()}
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
									? m.studio_gradient()
									: m.studio_paint_bucket()}
							>
								{#if editor.activeTool === 'gradient'}
									<BlendIcon />
								{:else}
									<PaintBucketIcon />
								{/if}
								{m.studio_fill()}
								{@render toolGroupIndicator()}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="min-w-44">
						<DropdownMenu.Item onclick={() => setTool('bucket')}>
							<PaintBucketIcon />
							{m.studio_paint_bucket()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => setTool('gradient')}>
							<BlendIcon />
							{m.studio_gradient()}
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
									? m.studio_magic_erase()
									: m.studio_erase()}
							>
								{#if editor.activeTool === 'magic_eraser'}
									<WandIcon />
								{:else}
									<EraserIcon />
								{/if}
								{m.studio_erase()}
								{@render toolGroupIndicator()}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="min-w-48">
						<DropdownMenu.Item onclick={() => setTool('eraser')}>
							<EraserIcon />
							{m.studio_erase()}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => setTool('magic_eraser')}>
							<WandIcon />
							{m.studio_magic_erase()}
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
			{m.studio_layers()}
		</Button>
		<Button
			variant="ghost"
			class="h-12 w-16 shrink-0 snap-start flex-col gap-0 px-0 text-[11px] md:h-12"
			onclick={() => (mobileSheet = 'properties')}
		>
			<SlidersIcon />
			{m.studio_edit()}
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
					? m.studio_add()
					: mobileSheet === 'layers'
						? m.studio_layers()
						: m.studio_properties()}</Sheet.Title
			>
			<Sheet.Description>{m.studio_editing_controls()}</Sheet.Description>
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
			<Dialog.Title>{m.studio_optimize_title()}</Dialog.Title>
			<Dialog.Description>{m.studio_optimize_body()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (backgroundOptimizeDialogOpen = false)}
				>{m.common_cancel()}</Button
			>
			<Button
				onclick={() => {
					backgroundOptimizeDialogOpen = false;
					void removeBackground(true);
				}}>{m.studio_optimize_continue()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={historyDialogOpen}>
	<Dialog.Content class="max-h-[85dvh] overflow-hidden sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.studio_version_history()}</Dialog.Title>
			<Dialog.Description>{m.studio_history_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
			{#if historyBusy}
				<div class="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
					<LoaderIcon class="mr-2 size-4 animate-spin" />
					{m.studio_loading_history()}
				</div>
			{:else if revisions.length === 0}
				<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					{m.studio_no_history()}
				</p>
			{:else}
				{#each revisions as revision (revision.id)}
					<div class="flex min-h-14 items-center gap-3 rounded-lg border p-3">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">
								{revision.kind === 'checkpoint'
									? revision.name || m.studio_checkpoint()
									: m.studio_autosave_revision({ revision: revision.revision })}
							</p>
							<p class="text-xs text-muted-foreground">
								{new Date(revision.created_at).toLocaleString()}
								{#if revision.expires_at}
									·
									{m.studio_expires({
										date: new Date(revision.expires_at).toLocaleDateString()
									})}
								{/if}
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							disabled={!editor.canEdit || historyBusy}
							onclick={() => restoreRevision(revision)}>{m.studio_restore()}</Button
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
				disabled={!editor.canEdit}>{m.studio_create_checkpoint()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={checkpointDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.studio_create_checkpoint()}</Dialog.Title>
			<Dialog.Description>{m.studio_checkpoint_body()}</Dialog.Description>
		</Dialog.Header>
		<label class="grid gap-1.5 text-sm">
			<span class="font-medium">{m.studio_checkpoint_name()}</span>
			<Input
				bind:value={checkpointName}
				maxlength={100}
				placeholder={m.studio_checkpoint_placeholder()}
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
				{m.studio_create_checkpoint()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={templateDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.studio_save_template()}</Dialog.Title>
			<Dialog.Description>{m.studio_template_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3">
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.studio_save_behavior()}</span>
				<AppSelect
					value={templateTargetID}
					ariaLabel={m.studio_save_behavior()}
					onValueChange={selectTemplateTarget}
					options={[
						{ value: 'new', label: m.studio_create_new_template() },
						...workspaceTemplates.map((template) => ({
							value: template.id,
							label: m.studio_replace_named_template({ name: template.name })
						}))
					]}
					class="h-10 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.studio_template_name()}</span>
				<Input bind:value={templateName} maxlength={120} />
			</label>
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{m.studio_category()}</span>
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
					? m.studio_save_template_action()
					: m.studio_replace_template_action()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={resizeDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.studio_resize_design()}</Dialog.Title>
			<Dialog.Description>{m.studio_resize_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.studio_width()}</span>
					<Input type="number" min="64" max="4096" bind:value={resizeWidth} />
				</label>
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.studio_height()}</span>
					<Input type="number" min="64" max="4096" bind:value={resizeHeight} />
				</label>
			</div>
			<RadioGroup.Root bind:value={resizeMode}>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="scale" aria-label={m.studio_scale_content()} />
					<span>{m.studio_scale_content()}</span>
				</label>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="preserve" aria-label={m.studio_preserve_content()} />
					<span>{m.studio_preserve_content()}</span>
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
			<Button onclick={resizeDocument}>{m.studio_resize()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={exportDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.studio_export_design()}</Dialog.Title>
			<Dialog.Description>{m.studio_export_body()}</Dialog.Description>
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
							{m.studio_export_summary({
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
							? m.studio_transparency_preserved()
							: exportHasTransparency
								? m.studio_transparency_flattened()
								: m.studio_opaque_output()}
					</span>
				</div>
			</div>

			{#if (editor.document?.pages.length ?? 0) > 1}
				<label class="flex min-h-11 items-center gap-2 rounded-lg border px-3">
					<Checkbox bind:checked={exportAllPages} />
					<span>{m.studio_export_all_pages({ count: editor.document?.pages.length ?? 0 })}</span>
				</label>
			{/if}

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.studio_format()}</span>
					<AppSelect
						value={editor.document?.export_defaults.format ?? 'png'}
						ariaLabel={m.studio_format()}
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
						{m.studio_quality({
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
						ariaLabel={m.studio_quality({
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
					<p class="text-sm leading-relaxed">{m.studio_jpeg_transparency_warning()}</p>
					<StudioColorPicker
						label={m.studio_jpeg_matte_color()}
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
					<p class="text-sm font-medium">{m.studio_export_destination()}</p>
					<RadioGroup.Root bind:value={exportMode} class="grid gap-2 sm:grid-cols-2">
						<label
							class="flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
						>
							<RadioGroup.Item value="download" aria-label={m.studio_download()} />
							<span class="grid gap-0.5">
								<span class="text-sm font-medium">{m.studio_download()}</span>
								<span class="text-xs text-muted-foreground">{m.studio_download_description()}</span>
							</span>
						</label>
						<label
							class="flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50"
						>
							<RadioGroup.Item
								value="media"
								disabled={!editor.canEdit}
								aria-label={m.studio_media()}
							/>
							<span class="grid gap-0.5">
								<span class="text-sm font-medium">{m.studio_media()}</span>
								<span class="text-xs text-muted-foreground">{m.studio_media_description()}</span>
							</span>
						</label>
						{#if returnToken}
							<label
								class="flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 sm:col-span-2"
							>
								<RadioGroup.Item
									value="attach"
									disabled={!editor.canEdit}
									aria-label={m.studio_attach()}
								/>
								<span class="grid gap-0.5">
									<span class="text-sm font-medium">{m.studio_attach()}</span>
									<span class="text-xs text-muted-foreground">{m.studio_attach_description()}</span>
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
					? m.studio_download()
					: exportMode === 'attach'
						? m.studio_export_attach()
						: m.studio_export_media()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={postExportDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.studio_public_export_title()}</Dialog.Title>
			<Dialog.Description>{m.studio_public_export_description()}</Dialog.Description>
		</Dialog.Header>
		<div class="rounded-lg border bg-muted/35 p-3 text-sm text-muted-foreground">
			{m.studio_public_cloud_value()}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (postExportDialogOpen = false)}
				>{m.studio_public_keep_editing()}</Button
			>
			<Button
				onclick={() => {
					postExportDialogOpen = false;
					void saveToOpenPost();
				}}>{m.studio_public_save_openpost()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={conflictDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.studio_conflict_title()}</Dialog.Title>
			<Dialog.Description>{m.studio_conflict_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-2">
			<Button onclick={reloadServerVersion}>{m.studio_reload_server()}</Button>
			<Button variant="outline" onclick={saveConflictAsCopy}>{m.studio_save_copy()}</Button>
			<Button variant="ghost" onclick={() => (conflictDialogOpen = false)}
				>{m.studio_continue_local()}</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.studio-theme {
		--studio-accent: oklch(0.65 0.18 48);
		--studio-panel: var(--background);
		--studio-panel-border: var(--border);
	}

	:global(.studio-menubar-trigger) {
		min-height: 1.75rem;
		border-radius: 0.375rem;
		padding-inline: 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		outline: none;
	}

	:global(.studio-menubar-trigger:hover),
	:global(.studio-menubar-trigger[data-highlighted]),
	:global(.studio-menubar-trigger[data-state='open']) {
		background: var(--muted);
	}

	:global(.studio-menubar-trigger:focus-visible) {
		box-shadow: 0 0 0 2px var(--ring);
	}

	:global(.studio-menubar-content) {
		z-index: 50;
		min-width: 12rem;
		border-radius: 0.5rem;
		background: color-mix(in oklch, var(--popover) 96%, transparent);
		padding: 0.25rem;
		color: var(--popover-foreground);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
		outline: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
		backdrop-filter: blur(16px);
	}

	:global(.studio-menubar-item) {
		display: flex;
		min-height: 2.25rem;
		cursor: default;
		align-items: center;
		gap: 0.5rem;
		border-radius: 0.375rem;
		padding-inline: 0.5rem;
		font-size: 0.875rem;
		outline: none;
	}

	:global(.studio-menubar-item[data-highlighted]) {
		background: var(--muted);
	}

	:global(.studio-menubar-item[data-disabled]) {
		opacity: 0.45;
	}

	.studio-resize-handle::after {
		position: absolute;
		content: '';
		background: var(--border);
		transition: background-color 120ms ease-out;
	}

	.studio-resize-handle.absolute::after {
		inset-block: 0;
		inset-inline-start: 50%;
		width: 1px;
	}

	.studio-inspector > .studio-resize-handle.relative::after {
		inset-inline: 0;
		inset-block-start: 50%;
		height: 1px;
	}

	.studio-resize-handle:hover::after,
	.studio-resize-handle:focus-visible::after {
		background: var(--primary);
	}

	.studio-resize-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	@media (max-width: 63.999rem) {
		.studio-theme :global(button) {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}

	@media (min-width: 64rem) {
		.studio-workspace {
			grid-template-columns:
				44px
				var(--studio-assets-width)
				minmax(0, 1fr)
				var(--studio-inspector-width);
		}

		.studio-workspace[data-inspector='false'] {
			grid-template-columns: 44px var(--studio-assets-width) minmax(0, 1fr);
		}

		.studio-workspace[data-focused='true'] {
			grid-template-columns: 44px minmax(0, 1fr);
		}

		.studio-inspector {
			grid-template-rows: minmax(120px, var(--studio-layers-height)) 6px minmax(160px, 1fr);
		}
	}
</style>
