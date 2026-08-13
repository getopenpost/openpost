import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { m } from '$lib/paraglide/messages';
import {
	blankImageEditorPage,
	cloneImageEditorLayer,
	cloneImageEditorDocument,
	cloneImageEditorPage,
	defaultImageAdjustments,
	defaultTransform,
	isEmptyImageEditorPaintLayer,
	imageEditorID
} from './document';
import { defaultLayerEffects, defaultTextCurve } from './effects';
import {
	applyImageEditorCropWindow,
	resetImageEditorCrop,
	type ImageEditorCropWindow
} from './crop';
import { ImageEditorHistory } from './history';
import {
	combinePixelMasks,
	intersectPixelMasks,
	pixelMaskBounds,
	pixelMaskTransformAround,
	pixelSpansToMask,
	pixelMaskToSpans,
	strokePixelMask,
	smoothSelectionPoints,
	subtractPixelMasks,
	translatePixelMask,
	transformPixelMask,
	mergeSelectionIDs,
	type SelectionPoint,
	type ImageEditorPixelSelection
} from './selection';
import type {
	ImageEditorDocument,
	ImageEditorDocumentResponse,
	ImageEditorGradientType,
	ImageEditorColorTarget,
	ImageEditorBrandKit,
	ImageEditorBrandTextStyle,
	ImageEditorLayer,
	ImageEditorPage,
	ImageEditorPageBackground,
	ImageEditorSelectionMode,
	ImageEditorSaveState,
	ImageEditorTool
} from './types';

const IMAGE_EDITOR_CONTEXT = Symbol('openpost-image-editor-editor');

function normalizeEditorRotation(value: number): number {
	return ((((value + 180) % 360) + 360) % 360) - 180;
}

interface FloatingPixelSelectionState {
	mode: 'promote' | 'cut';
	label: string;
	beforeDocument: ImageEditorDocument;
	originalSelection: ImageEditorPixelSelection;
	selectedLayerIDs: string[];
	selectionAnchorID: string;
	layerIDs: string[];
	beforeContext: ImageEditorHistoryContext;
}

interface ImageEditorHistoryContext {
	activePageID: string;
	selectedLayerIDs: string[];
	selectionAnchorID: string;
	activeTool: ImageEditorTool;
	selectionMode: ImageEditorSelectionMode;
	pixelSelection: ImageEditorPixelSelection | null;
	zoom: number;
	panX: number;
	panY: number;
}

export interface ImageEditorPartialApplicationResult {
	applied: number;
	skippedLocked: number;
	skippedUnsupported: number;
}

export function imageEditorMixedValue<T>(values: readonly T[]): {
	value: T | undefined;
	mixed: boolean;
} {
	if (values.length === 0) return { value: undefined, mixed: false };
	const first = values[0];
	return { value: first, mixed: values.some((value) => !Object.is(value, first)) };
}

export class ImageEditorController {
	id = $state('');
	workspaceID = $state('');
	revision = $state(0);
	canEdit = $state(false);
	document = $state.raw<ImageEditorDocument | null>(null);
	activePageID = $state('');
	selectedLayerIDs = $state.raw<string[]>([]);
	activeTool = $state<ImageEditorTool>('select');
	selectionMode = $state<ImageEditorSelectionMode>('replace');
	magicSelectTolerance = $state(32);
	magicSelectContiguous = $state(true);
	sampleAllLayers = $state(false);
	eyedropperTarget = $state<ImageEditorColorTarget>('foreground');
	pixelSelection = $state.raw<ImageEditorPixelSelection | null>(null);
	floatingPixelSelection = $state.raw<FloatingPixelSelectionState | null>(null);
	paintColor = $state('#f97316');
	gradientEndColor = $state('#7c3aed');
	gradientType = $state<ImageEditorGradientType>('linear');
	gradientReverse = $state(false);
	pencilSize = $state(12);
	pencilRoughness = $state(0);
	pencilSmoothing = $state(0.35);
	pencilPressure = $state(true);
	eraserSize = $state(32);
	magicEraserTolerance = $state(32);
	magicEraserContiguous = $state(true);
	paintOpacity = $state(1);
	bucketTolerance = $state(32);
	bucketContiguous = $state(true);
	saveState = $state<ImageEditorSaveState>('idle');
	saveMessage = $state('');
	zoom = $state(1);
	panX = $state(0);
	panY = $state(0);
	snappingEnabled = $state(true);
	showRulers = $state(true);
	showGuides = $state(true);
	showGrid = $state(false);
	snapToGrid = $state(false);
	gridSize = $state(50);
	leftPanel = $state<'media' | null>('media');
	backgroundImagePickerActive = $state(false);
	rightPanelVisible = $state(true);
	layersPanelOpen = $state(false);
	pagesExpanded = $state(true);
	brandKit = $state.raw<ImageEditorBrandKit | null>(null);
	recentColors = $state.raw<string[]>([]);
	mediaLibraryRevision = $state(0);
	private history = new ImageEditorHistory<ImageEditorDocument, ImageEditorHistoryContext>(
		cloneImageEditorDocument
	);
	private historyRevision = $state(0);
	private changeListeners = new SvelteSet<() => void>();
	private selectionAnchorID = '';
	private viewportWidth = 0;
	private viewportHeight = 0;

	get activePage(): ImageEditorPage | null {
		return this.document?.pages.find((page) => page.id === this.activePageID) ?? null;
	}

	refreshMediaLibrary(): void {
		this.mediaLibraryRevision += 1;
	}

	addGuide(axis: 'horizontal' | 'vertical', value: number): void {
		const page = this.activePage;
		if (!page || !this.document) return;
		const limit = axis === 'horizontal' ? this.document.height_px : this.document.width_px;
		const next = Math.max(0, Math.min(limit, value));
		this.mutate(m.image_editor_add_guide(), (document) => {
			const target = document.pages.find((candidate) => candidate.id === this.activePageID);
			if (!target) return;
			target.guides ??= { horizontal: [], vertical: [] };
			if (target.guides[axis].length >= 100) return;
			target.guides[axis].push(next);
		});
	}

	updateGuide(axis: 'horizontal' | 'vertical', index: number, value: number): void {
		if (!this.document) return;
		const limit = axis === 'horizontal' ? this.document.height_px : this.document.width_px;
		this.mutate(
			m.image_editor_move_guide(),
			(document) => {
				const guides = document.pages.find((page) => page.id === this.activePageID)?.guides;
				if (!guides || index < 0 || index >= guides[axis].length) return;
				guides[axis][index] = Math.max(0, Math.min(limit, value));
			},
			`guide-${this.activePageID}-${axis}-${index}`
		);
	}

	removeGuide(axis: 'horizontal' | 'vertical', index: number): void {
		this.mutate(m.image_editor_remove_guide(), (document) => {
			const guides = document.pages.find((page) => page.id === this.activePageID)?.guides;
			if (!guides || index < 0 || index >= guides[axis].length) return;
			guides[axis].splice(index, 1);
		});
	}

	clearGuides(): void {
		this.mutate(m.image_editor_clear_guides(), (document) => {
			const page = document.pages.find((candidate) => candidate.id === this.activePageID);
			if (!page) return;
			page.guides = { horizontal: [], vertical: [] };
		});
	}

	get selectedLayers(): ImageEditorLayer[] {
		const selected = new SvelteSet(this.selectedLayerIDs);
		return this.activePage?.layers.filter((layer) => selected.has(layer.id)) ?? [];
	}

	get canUndo(): boolean {
		return (
			Boolean(this.floatingPixelSelection) || (this.historyRevision >= 0 && this.history.canUndo)
		);
	}

	get canRedo(): boolean {
		return !this.floatingPixelSelection && this.historyRevision >= 0 && this.history.canRedo;
	}

	get undoLabel(): string {
		return this.floatingPixelSelection?.label ?? this.history.undoLabel;
	}

	get redoLabel(): string {
		return this.history.redoLabel;
	}

	get floatingPixelSelectionBounds(): {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null {
		const selection = this.pixelSelection;
		return selection ? pixelMaskBounds(selection.data, selection.width, selection.height) : null;
	}

	load(response: ImageEditorDocumentResponse): void {
		this.id = response.id;
		this.workspaceID = response.workspace_id;
		this.revision = response.revision;
		this.canEdit = response.can_edit;
		this.document = cloneImageEditorDocument(response.document);
		this.activePageID = response.document.pages[0]?.id ?? '';
		this.selectedLayerIDs = [];
		this.pixelSelection = null;
		this.floatingPixelSelection = null;
		this.selectionAnchorID = '';
		this.saveState = 'saved';
		this.saveMessage = m.image_editor_saved();
		this.history.clear();
		this.historyRevision++;
	}

	replaceFromServer(response: ImageEditorDocumentResponse): void {
		const pageID = this.activePageID;
		this.load(response);
		if (response.document.pages.some((page) => page.id === pageID)) this.activePageID = pageID;
	}

	onChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private emitChange(): void {
		this.saveState = 'idle';
		this.saveMessage = m.image_editor_unsaved_changes();
		for (const listener of this.changeListeners) listener();
	}

	mutate(
		label: string,
		mutation: (document: ImageEditorDocument) => void,
		coalesceKey?: string
	): void {
		if (!this.document || !this.canEdit) return;
		if (this.floatingPixelSelection) this.commitFloatingPixelSelection();
		this.history.updateCurrentContext(this.historyContext());
		const next = this.history.execute(this.document, {
			label,
			coalesceKey,
			context: this.historyContext(),
			apply(document) {
				mutation(document);
				return document;
			},
			revert(document) {
				return document;
			}
		});
		if (!this.history.lastExecutionChanged) return;
		this.document = next;
		this.historyRevision++;
		this.emitChange();
	}

	undo(): void {
		if (this.floatingPixelSelection) {
			this.cancelFloatingPixelSelection();
			return;
		}
		if (!this.document || !this.canUndo || !this.canEdit) return;
		this.history.updateCurrentContext(this.historyContext());
		this.document = this.history.undo(this.document);
		this.historyRevision++;
		const context = this.history.restoredContext;
		if (context) this.restoreHistoryContext(context);
		else this.reconcileSelection();
		this.emitChange();
	}

	redo(): void {
		if (this.floatingPixelSelection) return;
		if (!this.document || !this.canRedo || !this.canEdit) return;
		this.document = this.history.redo(this.document);
		this.historyRevision++;
		const context = this.history.restoredContext;
		if (context) this.restoreHistoryContext(context);
		else this.reconcileSelection();
		this.emitChange();
	}

	selectLayer(id: string, mode: boolean | 'replace' | 'toggle' | 'range' = 'replace'): void {
		if (!id) {
			this.selectedLayerIDs = [];
			this.selectionAnchorID = '';
			return;
		}
		const selectionMode = typeof mode === 'boolean' ? (mode ? 'toggle' : 'replace') : mode;
		if (selectionMode === 'range' && this.selectionAnchorID) {
			const order = this.layerSelectionOrder();
			const anchorIndex = order.indexOf(this.selectionAnchorID);
			const targetIndex = order.indexOf(id);
			if (anchorIndex >= 0 && targetIndex >= 0) {
				const start = Math.min(anchorIndex, targetIndex);
				const end = Math.max(anchorIndex, targetIndex);
				this.selectedLayerIDs = order.slice(start, end + 1);
				return;
			}
		}
		if (selectionMode === 'toggle') {
			this.selectedLayerIDs = this.selectedLayerIDs.includes(id)
				? this.selectedLayerIDs.filter((item) => item !== id)
				: [...this.selectedLayerIDs, id];
		} else {
			this.selectedLayerIDs = [id];
		}
		this.selectionAnchorID = id;
	}

	applyLayerSelection(ids: string[], mode: ImageEditorSelectionMode = 'replace'): void {
		const available = new SvelteSet(this.activePage?.layers.map((layer) => layer.id) ?? []);
		const candidates = ids.filter((id) => available.has(id));
		this.selectedLayerIDs = mergeSelectionIDs(this.selectedLayerIDs, candidates, mode);
		this.selectionAnchorID = this.selectedLayerIDs.at(-1) ?? '';
	}

	applyPixelSelection(
		data: Uint8Array,
		targetLayerIDs: string[],
		mode: ImageEditorSelectionMode = 'replace'
	): void {
		if (!this.document) return;
		if (this.floatingPixelSelection) this.commitFloatingPixelSelection();
		const current =
			this.pixelSelection?.width === this.document.width_px &&
			this.pixelSelection.height === this.document.height_px
				? this.pixelSelection.data
				: null;
		const combined = combinePixelMasks(current, data, mode);
		this.pixelSelection = pixelMaskBounds(combined, this.document.width_px, this.document.height_px)
			? {
					width: this.document.width_px,
					height: this.document.height_px,
					data: combined,
					targetLayerIDs: [
						...new SvelteSet([...(this.pixelSelection?.targetLayerIDs ?? []), ...targetLayerIDs])
					]
				}
			: null;
	}

	clearPixelSelection(): void {
		if (this.floatingPixelSelection) this.commitFloatingPixelSelection();
		this.pixelSelection = null;
	}

	beginFloatingPixelSelection(
		mode: 'promote' | 'cut',
		projections: Array<{ id: string; width: number; height: number; data: Uint8Array }>
	): boolean {
		if (!this.document || !this.pixelSelection || projections.length === 0) return false;
		if (this.floatingPixelSelection) this.commitFloatingPixelSelection();
		const beforeDocument = cloneImageEditorDocument(this.document);
		const nextDocument = cloneImageEditorDocument(this.document);
		const label =
			mode === 'promote' ? m.image_editor_promote_pixels() : m.image_editor_cut_pixels();
		const layerIDs = this.applyPixelSelectionContent(nextDocument, mode, projections);
		if (layerIDs.length === 0) return false;
		this.floatingPixelSelection = {
			mode,
			label,
			beforeDocument,
			originalSelection: {
				...this.pixelSelection,
				data: this.pixelSelection.data.slice(),
				targetLayerIDs: [...this.pixelSelection.targetLayerIDs]
			},
			selectedLayerIDs: [...this.selectedLayerIDs],
			selectionAnchorID: this.selectionAnchorID,
			layerIDs,
			beforeContext: this.historyContext()
		};
		this.document = nextDocument;
		this.selectedLayerIDs = layerIDs;
		this.selectionAnchorID = layerIDs.at(-1) ?? '';
		this.historyRevision++;
		this.emitChange();
		return true;
	}

	extractPixelSelectionLayers(
		projections: Array<{ id: string; width: number; height: number; data: Uint8Array }>
	): ImageEditorLayer[] {
		if (!this.document || !this.pixelSelection || projections.length === 0) return [];
		const document = cloneImageEditorDocument(this.document);
		const layerIDs = new Set(this.applyPixelSelectionContent(document, 'promote', projections));
		return (
			document.pages
				.find((page) => page.id === this.activePageID)
				?.layers.filter((layer) => layerIDs.has(layer.id))
				.map((layer) => structuredClone(layer)) ?? []
		);
	}

	translateFloatingPixelSelection(deltaX: number, deltaY: number): void {
		const floating = this.floatingPixelSelection;
		const selection = this.pixelSelection;
		if (!floating || !selection || !this.document) return;
		const bounds = pixelMaskBounds(selection.data, selection.width, selection.height);
		if (!bounds) return;
		const offsetX = Math.round(
			Math.max(-bounds.x, Math.min(selection.width - bounds.x - bounds.width, deltaX))
		);
		const offsetY = Math.round(
			Math.max(-bounds.y, Math.min(selection.height - bounds.y - bounds.height, deltaY))
		);
		if (!offsetX && !offsetY) return;
		const nextDocument = cloneImageEditorDocument(this.document);
		const page = nextDocument.pages.find((candidate) => candidate.id === this.activePageID);
		if (!page) return;
		const floatingIDs = new Set(floating.layerIDs);
		for (const layer of page.layers) {
			if (!floatingIDs.has(layer.id)) continue;
			layer.transform.x += offsetX;
			layer.transform.y += offsetY;
		}
		this.recalculateAllGroupBounds(page);
		this.document = nextDocument;
		this.pixelSelection = {
			...selection,
			data: translatePixelMask(selection.data, selection.width, selection.height, offsetX, offsetY)
		};
	}

	finishFloatingPixelSelectionMove(): void {
		if (!this.floatingPixelSelection) return;
		this.emitChange();
	}

	transformFloatingPixelSelection(
		center: { x: number; y: number },
		scaleX: number,
		scaleY: number,
		rotationDegrees = 0
	): boolean {
		const floating = this.floatingPixelSelection;
		const selection = this.pixelSelection;
		if (!floating || !selection || !this.document) return false;
		const safeScaleX = Math.max(0.02, Math.min(50, scaleX));
		const safeScaleY = Math.max(0.02, Math.min(50, scaleY));
		const transform = pixelMaskTransformAround(center, safeScaleX, safeScaleY, rotationDegrees);
		const nextDocument = cloneImageEditorDocument(this.document);
		const page = nextDocument.pages.find((candidate) => candidate.id === this.activePageID);
		if (!page) return false;
		const floatingIDs = new Set(floating.layerIDs);
		for (const layer of page.layers) {
			if (!floatingIDs.has(layer.id)) continue;
			const x = layer.transform.x;
			const y = layer.transform.y;
			layer.transform.x = transform.a * x + transform.c * y + transform.e;
			layer.transform.y = transform.b * x + transform.d * y + transform.f;
			layer.transform.width = Math.max(1, layer.transform.width * safeScaleX);
			layer.transform.height = Math.max(1, layer.transform.height * safeScaleY);
			layer.transform.rotation = normalizeEditorRotation(
				layer.transform.rotation + rotationDegrees
			);
		}
		this.recalculateAllGroupBounds(page);
		this.document = nextDocument;
		this.pixelSelection = {
			...selection,
			data: transformPixelMask(selection.data, selection.width, selection.height, transform)
		};
		this.historyRevision++;
		return true;
	}

	duplicateFloatingPixelSelection(offset = 10): boolean {
		const floating = this.floatingPixelSelection;
		const selection = this.pixelSelection;
		if (!floating || !selection || !this.document) return false;
		const nextDocument = cloneImageEditorDocument(this.document);
		const page = nextDocument.pages.find((candidate) => candidate.id === this.activePageID);
		if (!page) return false;
		const duplicateIDs: string[] = [];
		for (const id of floating.layerIDs) {
			const index = page.layers.findIndex((layer) => layer.id === id);
			const source = page.layers[index];
			if (!source) continue;
			const duplicate = cloneImageEditorLayer(
				source,
				m.image_editor_layer_copy_name({ name: source.name })
			);
			duplicate.transform.x += offset;
			duplicate.transform.y += offset;
			page.layers.splice(index + 1, 0, duplicate);
			duplicateIDs.push(duplicate.id);
		}
		if (duplicateIDs.length === 0) return false;
		this.document = nextDocument;
		this.pixelSelection = {
			...selection,
			data: translatePixelMask(selection.data, selection.width, selection.height, offset, offset),
			targetLayerIDs: duplicateIDs
		};
		this.floatingPixelSelection = { ...floating, layerIDs: duplicateIDs };
		this.selectedLayerIDs = duplicateIDs;
		this.selectionAnchorID = duplicateIDs.at(-1) ?? '';
		this.historyRevision++;
		this.emitChange();
		return true;
	}

	commitFloatingPixelSelection(): boolean {
		const floating = this.floatingPixelSelection;
		if (!floating || !this.document) return false;
		this.floatingPixelSelection = null;
		this.pixelSelection = null;
		const afterContext = this.historyContext();
		this.history.updateCurrentContext(floating.beforeContext);
		this.history.checkpoint(
			floating.label,
			floating.beforeDocument,
			this.document,
			undefined,
			floating.beforeContext,
			afterContext
		);
		this.historyRevision++;
		this.emitChange();
		return true;
	}

	cancelFloatingPixelSelection(): boolean {
		const floating = this.floatingPixelSelection;
		if (!floating) return false;
		this.document = cloneImageEditorDocument(floating.beforeDocument);
		this.pixelSelection = {
			...floating.originalSelection,
			data: floating.originalSelection.data.slice(),
			targetLayerIDs: [...floating.originalSelection.targetLayerIDs]
		};
		this.selectedLayerIDs = [...floating.selectedLayerIDs];
		this.selectionAnchorID = floating.selectionAnchorID;
		this.floatingPixelSelection = null;
		this.restoreHistoryContext(floating.beforeContext);
		this.historyRevision++;
		this.emitChange();
		return true;
	}

	deleteFloatingPixelSelection(): boolean {
		const floating = this.floatingPixelSelection;
		if (!floating || !this.document) return false;
		const nextDocument = cloneImageEditorDocument(this.document);
		const page = nextDocument.pages.find((candidate) => candidate.id === this.activePageID);
		if (!page) return false;
		const floatingIDs = new Set(floating.layerIDs);
		page.layers = page.layers.filter((layer) => !floatingIDs.has(layer.id));
		this.recalculateAllGroupBounds(page);
		this.document = nextDocument;
		this.floatingPixelSelection = null;
		this.pixelSelection = null;
		this.selectedLayerIDs = [...floating.selectedLayerIDs];
		this.selectionAnchorID = floating.selectionAnchorID;
		this.history.checkpoint(
			m.image_editor_delete_pixels(),
			floating.beforeDocument,
			nextDocument,
			undefined,
			floating.beforeContext,
			this.historyContext()
		);
		this.historyRevision++;
		this.emitChange();
		return true;
	}

	commitPixelSelectionContent(
		mode: 'promote' | 'cut' | 'delete',
		projections: Array<{ id: string; width: number; height: number; data: Uint8Array }>
	): boolean {
		if (!this.document || !this.pixelSelection || projections.length === 0) return false;
		if (this.floatingPixelSelection) this.commitFloatingPixelSelection();
		const before = this.document;
		let promotedIDs: string[] = [];
		this.mutate(
			mode === 'promote'
				? m.image_editor_promote_pixels()
				: mode === 'cut'
					? m.image_editor_cut_pixels()
					: m.image_editor_delete_pixels(),
			(document) => (promotedIDs = this.applyPixelSelectionContent(document, mode, projections))
		);
		if (this.document === before) return false;
		this.pixelSelection = null;
		if (promotedIDs.length > 0) {
			this.selectedLayerIDs = promotedIDs;
			this.selectionAnchorID = promotedIDs.at(-1) ?? '';
		}
		return true;
	}

	private applyPixelSelectionContent(
		document: ImageEditorDocument,
		mode: 'promote' | 'cut' | 'delete',
		projections: Array<{ id: string; width: number; height: number; data: Uint8Array }>
	): string[] {
		const page = document.pages.find((candidate) => candidate.id === this.activePageID);
		if (!page) return [];
		const promotedIDs: string[] = [];
		for (const projection of projections) {
			const targetIndex = page.layers.findIndex((layer) => layer.id === projection.id);
			const target = page.layers[targetIndex];
			if (!target || target.locked || !['image', 'paint'].includes(target.type)) continue;
			let selected = projection.data;
			if (target.paint) {
				const paint = pixelSpansToMask(target.paint.spans, projection.width, projection.height);
				selected = intersectPixelMasks(selected, paint);
			} else if (target.erase_mask) {
				let erased = pixelSpansToMask(target.erase_mask.spans, projection.width, projection.height);
				for (const stroke of target.erase_mask.strokes) {
					erased = combinePixelMasks(
						erased,
						strokePixelMask(projection.width, projection.height, stroke.points, stroke.size),
						'add'
					);
				}
				selected = subtractPixelMasks(selected, erased);
			}
			if (!pixelMaskBounds(selected, projection.width, projection.height)) continue;

			if (mode === 'promote' || mode === 'cut') {
				const copy = cloneImageEditorLayer(
					target,
					m.image_editor_selection_layer_name({ name: target.name })
				);
				copy.transform = structuredClone(target.transform);
				if (copy.paint) {
					copy.paint.spans = pixelMaskToSpans(selected, projection.width, projection.height);
					copy.erase_mask = undefined;
				} else if (copy.image) {
					const all = new Uint8Array(projection.width * projection.height);
					all.fill(1);
					copy.erase_mask = {
						source_width: projection.width,
						source_height: projection.height,
						strokes: [],
						spans: pixelMaskToSpans(
							subtractPixelMasks(all, selected),
							projection.width,
							projection.height
						)
					};
				}
				page.layers.splice(targetIndex + 1, 0, copy);
				promotedIDs.push(copy.id);
			}

			if (mode === 'cut' || mode === 'delete') {
				if (target.paint) {
					const paint = pixelSpansToMask(target.paint.spans, projection.width, projection.height);
					target.paint.spans = pixelMaskToSpans(
						subtractPixelMasks(paint, selected),
						projection.width,
						projection.height
					);
				} else {
					const eraseMask =
						target.erase_mask?.source_width === projection.width &&
						target.erase_mask.source_height === projection.height
							? target.erase_mask
							: {
									source_width: projection.width,
									source_height: projection.height,
									strokes: [],
									spans: []
								};
					target.erase_mask = {
						...eraseMask,
						spans: [
							...eraseMask.spans,
							...pixelMaskToSpans(selected, projection.width, projection.height)
						]
					};
				}
			}
		}
		this.recalculateAllGroupBounds(page);
		return promotedIDs;
	}

	movePixelSelection(data: Uint8Array, deltaX: number, deltaY: number): void {
		if (!this.pixelSelection) return;
		const translated = translatePixelMask(
			data,
			this.pixelSelection.width,
			this.pixelSelection.height,
			deltaX,
			deltaY
		);
		this.pixelSelection = pixelMaskBounds(
			translated,
			this.pixelSelection.width,
			this.pixelSelection.height
		)
			? { ...this.pixelSelection, data: translated }
			: null;
	}

	selectAll(): void {
		if (
			this.document &&
			[
				'marquee',
				'ellipse_marquee',
				'lasso',
				'magic_wand',
				'pencil',
				'eraser',
				'magic_eraser',
				'bucket',
				'gradient'
			].includes(this.activeTool)
		) {
			const mask = new Uint8Array(this.document.width_px * this.document.height_px);
			mask.fill(1);
			this.applyPixelSelection(mask, this.selectedLayerIDs.slice(-1), 'replace');
			return;
		}
		this.selectedLayerIDs = this.layerSelectionOrder().filter(
			(id) => !this.activePage?.layers.find((layer) => layer.id === id)?.locked
		);
		this.selectionAnchorID = this.selectedLayerIDs.at(-1) ?? '';
	}

	addText(): void {
		if (!this.document) return;
		const layer: ImageEditorLayer = {
			id: imageEditorID('layer'),
			type: 'text',
			name: m.image_editor_new_text(),
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(
				Math.min(600, this.document.width_px * 0.7),
				Math.max(96, this.document.height_px * 0.12),
				this.document.width_px * 0.15,
				this.document.height_px * 0.42
			),
			text: {
				text: m.image_editor_new_text(),
				font_family: 'Geist Variable',
				font_weight: 700,
				font_style: 'normal',
				underline: false,
				strike: false,
				wrap: 'word',
				font_size: Math.max(32, Math.round(this.document.width_px / 12)),
				color: '#1c1917',
				align: 'center',
				line_height: 1.1,
				letter_spacing: 0,
				stroke_width: 0,
				shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 },
				curve: defaultTextCurve()
			},
			effects: defaultLayerEffects()
		};
		this.addLayer(layer);
	}

	addShape(kind: NonNullable<ImageEditorLayer['shape']>['kind'] = 'rectangle'): void {
		if (!this.document) return;
		const size = Math.min(this.document.width_px, this.document.height_px) * 0.28;
		const layer: ImageEditorLayer = {
			id: imageEditorID('layer'),
			type: 'shape',
			name:
				kind === 'ellipse'
					? m.image_editor_ellipse()
					: kind === 'rounded_rectangle'
						? m.image_editor_rounded_rectangle()
						: kind === 'line'
							? m.image_editor_line()
							: m.image_editor_rectangle(),
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(
				size,
				kind === 'line' ? 8 : size,
				(this.document.width_px - size) / 2,
				(this.document.height_px - size) / 2
			),
			shape: {
				kind,
				fill: '#f97316',
				stroke: '#c2410c',
				stroke_width: 0,
				radius: kind === 'rounded_rectangle' ? 32 : 0
			},
			effects: defaultLayerEffects()
		};
		this.addLayer(layer);
	}

	addEmptyLayer(): void {
		if (!this.document) return;
		const baseName = m.image_editor_layer();
		const names = new Set(this.activePage?.layers.map((layer) => layer.name) ?? []);
		let number = 1;
		while (names.has(`${baseName} ${number}`)) number++;
		const name = `${baseName} ${number}`;
		const selectedID = this.selectedLayerIDs.at(-1);
		const layer: ImageEditorLayer = {
			id: imageEditorID('layer'),
			type: 'paint',
			name,
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(this.document.width_px, this.document.height_px),
			paint: {
				kind: 'fill',
				color: this.paintColor,
				size: 1,
				opacity: 1,
				source_width: this.document.width_px,
				source_height: this.document.height_px,
				points: [],
				spans: []
			},
			effects: defaultLayerEffects()
		};
		this.mutate(`Add ${name}`, (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			const selectedIndex = selectedID
				? page.layers.findIndex((candidate) => candidate.id === selectedID)
				: -1;
			page.layers.splice(selectedIndex >= 0 ? selectedIndex + 1 : page.layers.length, 0, layer);
		});
		this.selectedLayerIDs = [layer.id];
	}

	addPencilStroke(points: SelectionPoint[]): void {
		if (!this.document || points.length === 0) return;
		const samples = smoothSelectionPoints(
			points.map((point) => ({
				...point,
				pressure: this.pencilPressure ? point.pressure : 1
			})),
			this.pencilSmoothing
		);
		const stroke = strokePixelMask(
			this.document.width_px,
			this.document.height_px,
			samples,
			this.pencilSize,
			this.pencilRoughness
		);
		this.addPaintFill(
			this.pixelSelection ? intersectPixelMasks(stroke, this.pixelSelection.data) : stroke,
			m.image_editor_pencil()
		);
	}

	addEraseStroke(
		id: string,
		sourceWidth: number,
		sourceHeight: number,
		points: SelectionPoint[],
		size: number
	): void {
		if (points.length === 0) return;
		const layer = this.activePage?.layers.find((candidate) => candidate.id === id);
		if (!layer || !['image', 'paint'].includes(layer.type) || layer.locked) return;
		this.mutate(m.image_editor_erase(), (document) => {
			const target = document.pages
				.find((page) => page.id === this.activePageID)
				?.layers.find((candidate) => candidate.id === id);
			if (!target) return;
			if (target.type === 'paint' && target.paint) {
				const width = Math.max(1, Math.round(target.paint.source_width));
				const height = Math.max(1, Math.round(target.paint.source_height));
				const paintMask = pixelSpansToMask(target.paint.spans, width, height);
				const eraseMask = strokePixelMask(width, height, points, size);
				target.paint.spans = pixelMaskToSpans(
					subtractPixelMasks(paintMask, eraseMask),
					width,
					height
				);
				target.erase_mask = undefined;
				return;
			}
			const mask =
				target.erase_mask?.source_width === sourceWidth &&
				target.erase_mask.source_height === sourceHeight
					? target.erase_mask
					: {
							source_width: sourceWidth,
							source_height: sourceHeight,
							strokes: [],
							spans: []
						};
			target.erase_mask = {
				...mask,
				strokes: [
					...mask.strokes,
					{
						size: Math.max(1, Math.min(512, size)),
						points: points.map((point) => ({ ...point }))
					}
				]
			};
		});
	}

	restoreImageEraseMask(id: string): void {
		const layer = this.activePage?.layers.find((candidate) => candidate.id === id);
		if (layer?.type !== 'image' || layer.locked || !layer.erase_mask) return;
		this.mutate(m.image_editor_restore_erased_image(), (document) => {
			const target = document.pages
				.find((page) => page.id === this.activePageID)
				?.layers.find((candidate) => candidate.id === id);
			if (target?.type === 'image') target.erase_mask = undefined;
		});
	}

	addMagicErase(id: string, sourceWidth: number, sourceHeight: number, maskData: Uint8Array): void {
		const layer = this.activePage?.layers.find((candidate) => candidate.id === id);
		if (!layer || !['image', 'paint'].includes(layer.type) || layer.locked) return;
		const spans = pixelMaskToSpans(maskData, sourceWidth, sourceHeight);
		if (spans.length === 0) return;
		this.mutate(m.image_editor_magic_erase(), (document) => {
			const target = document.pages
				.find((page) => page.id === this.activePageID)
				?.layers.find((candidate) => candidate.id === id);
			if (!target) return;
			if (target.type === 'paint' && target.paint) {
				const width = Math.max(1, Math.round(target.paint.source_width));
				const height = Math.max(1, Math.round(target.paint.source_height));
				const paintMask = pixelSpansToMask(target.paint.spans, width, height);
				target.paint.spans = pixelMaskToSpans(
					subtractPixelMasks(paintMask, maskData),
					width,
					height
				);
				target.erase_mask = undefined;
				return;
			}
			const eraseMask =
				target.erase_mask?.source_width === sourceWidth &&
				target.erase_mask.source_height === sourceHeight
					? target.erase_mask
					: {
							source_width: sourceWidth,
							source_height: sourceHeight,
							strokes: [],
							spans: []
						};
			target.erase_mask = {
				...eraseMask,
				spans: [...eraseMask.spans, ...spans]
			};
		});
	}

	addPaintFill(mask: Uint8Array, name = m.image_editor_paint_bucket()): void {
		if (!this.document) return;
		const bounds = pixelMaskBounds(mask, this.document.width_px, this.document.height_px);
		if (!bounds) return;
		const spans = pixelMaskToSpans(
			mask,
			this.document.width_px,
			this.document.height_px,
			bounds.x,
			bounds.y
		);
		this.addPaintLayer({
			name,
			transform: defaultTransform(bounds.width, bounds.height, bounds.x, bounds.y),
			paint: {
				kind: 'fill',
				color: this.paintColor,
				size: 1,
				opacity: this.paintOpacity,
				source_width: bounds.width,
				source_height: bounds.height,
				points: [],
				spans
			}
		});
	}

	addGradientFill(
		mask: Uint8Array,
		start: SelectionPoint,
		end: SelectionPoint,
		name = m.image_editor_gradient()
	): void {
		if (!this.document) return;
		const bounds = pixelMaskBounds(mask, this.document.width_px, this.document.height_px);
		if (!bounds) return;
		const spans = pixelMaskToSpans(
			mask,
			this.document.width_px,
			this.document.height_px,
			bounds.x,
			bounds.y
		);
		this.addPaintLayer({
			name,
			transform: defaultTransform(bounds.width, bounds.height, bounds.x, bounds.y),
			paint: {
				kind: 'gradient',
				color: this.paintColor,
				size: 1,
				opacity: this.paintOpacity,
				source_width: bounds.width,
				source_height: bounds.height,
				points: [],
				spans,
				gradient: {
					type: this.gradientType,
					start: { x: start.x - bounds.x, y: start.y - bounds.y },
					end: { x: end.x - bounds.x, y: end.y - bounds.y },
					stops: [
						{ offset: 0, color: this.paintColor },
						{ offset: 1, color: this.gradientEndColor }
					],
					reverse: this.gradientReverse
				}
			}
		});
	}

	private addPaintLayer({
		name,
		transform,
		paint
	}: Pick<ImageEditorLayer, 'name' | 'transform'> & {
		paint: NonNullable<ImageEditorLayer['paint']>;
	}): void {
		const selectedID = this.selectedLayerIDs.at(-1);
		const selectedLayer = selectedID
			? this.activePage?.layers.find((layer) => layer.id === selectedID)
			: undefined;
		if (selectedLayer && isEmptyImageEditorPaintLayer(selectedLayer)) {
			this.mutate(`Paint ${selectedLayer.name}`, (document) => {
				const target = document.pages
					.find((page) => page.id === this.activePageID)
					?.layers.find((layer) => layer.id === selectedLayer.id);
				if (!target) return;
				target.transform = structuredClone(transform);
				target.paint = structuredClone(paint);
				target.erase_mask = undefined;
			});
			return;
		}
		const layer: ImageEditorLayer = {
			id: imageEditorID('layer'),
			type: 'paint',
			name,
			visible: true,
			locked: false,
			opacity: 1,
			transform,
			paint,
			effects: defaultLayerEffects()
		};
		this.mutate(`Add ${name}`, (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			const selectedIndex = selectedID
				? page.layers.findIndex((candidate) => candidate.id === selectedID)
				: -1;
			page.layers.splice(selectedIndex >= 0 ? selectedIndex + 1 : page.layers.length, 0, layer);
		});
		this.selectedLayerIDs = [layer.id];
	}

	addImage(
		media: { id: string; width?: number; height?: number; name?: string },
		center?: SelectionPoint,
		pageID = this.activePageID
	): void {
		if (!this.document) return;
		const hasIntrinsicSize = Boolean(media.width && media.height);
		const sourceWidth = hasIntrinsicSize ? media.width! : 1;
		const sourceHeight = hasIntrinsicSize ? media.height! : 1;
		const maxWidth = this.document.width_px * 0.72;
		const maxHeight = this.document.height_px * 0.72;
		const { width, height } = hasIntrinsicSize
			? fitImageSize(sourceWidth, sourceHeight, maxWidth, maxHeight)
			: {
					width: Math.min(320, maxWidth),
					height: Math.min(320, maxHeight)
				};
		const layer: ImageEditorLayer = {
			id: imageEditorID('layer'),
			type: 'image',
			name: media.name || 'Image',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(
				width,
				height,
				Math.max(
					-width * 0.5,
					Math.min(
						this.document.width_px - width * 0.5,
						(center?.x ?? this.document.width_px / 2) - width / 2
					)
				),
				Math.max(
					-height * 0.5,
					Math.min(
						this.document.height_px - height * 0.5,
						(center?.y ?? this.document.height_px / 2) - height / 2
					)
				)
			),
			image: {
				media_id: media.id,
				source_width: sourceWidth,
				source_height: sourceHeight,
				intrinsic_pending: !hasIntrinsicSize,
				fit: 'stretch',
				crop: { x: 0, y: 0, width: 1, height: 1 },
				adjustments: defaultImageAdjustments()
			},
			effects: defaultLayerEffects()
		};
		this.addLayer(layer, pageID);
	}

	setPageBackground(background: ImageEditorPageBackground): void {
		this.mutate('Change page background', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			page.background = structuredClone(background);
			if (background.type === 'solid' && background.color) {
				page.background_color = background.color;
			}
		});
	}

	setPageBackgroundImage(mediaID: string): void {
		this.setPageBackground({
			type: 'image',
			opacity: 1,
			image: { media_id: mediaID, fit: 'cover' }
		});
		this.backgroundImagePickerActive = false;
	}

	resolveImageDimensions(id: string, sourceWidth: number, sourceHeight: number): void {
		if (!this.document || sourceWidth <= 0 || sourceHeight <= 0) return;
		const layer = this.activePage?.layers.find((candidate) => candidate.id === id);
		if (!layer?.image?.intrinsic_pending) return;
		const maxWidth = this.document.width_px * 0.72;
		const maxHeight = this.document.height_px * 0.72;
		const { width, height } = fitImageSize(sourceWidth, sourceHeight, maxWidth, maxHeight);
		this.updateLayer(id, {
			transform: {
				...layer.transform,
				x: (this.document.width_px - width) / 2,
				y: (this.document.height_px - height) / 2,
				width,
				height
			},
			image: {
				...layer.image,
				source_width: sourceWidth,
				source_height: sourceHeight,
				intrinsic_pending: false
			}
		});
	}

	addLayer(layer: ImageEditorLayer, pageID = this.activePageID): void {
		this.mutate(`Add ${layer.name}`, (document) => {
			const page = document.pages.find((item) => item.id === pageID);
			page?.layers.push(layer);
		});
		if (pageID === this.activePageID) this.selectedLayerIDs = [layer.id];
	}

	updateLayer(id: string, updates: Partial<ImageEditorLayer>, coalesceKey?: string): void {
		this.mutate(
			'Change layer',
			(document) => {
				const layer = document.pages
					.find((page) => page.id === this.activePageID)
					?.layers.find((item) => item.id === id);
				if (!layer) return;
				Object.assign(layer, updates);
			},
			coalesceKey
		);
	}

	applyImageCrop(id: string, window: ImageEditorCropWindow): void {
		const layer = this.activePage?.layers.find((candidate) => candidate.id === id);
		if (!layer?.image || layer.locked) return;
		const result = applyImageEditorCropWindow(layer, window);
		this.applyImageCropState(id, result);
	}

	applyImageCropState(
		id: string,
		result: {
			transform: ImageEditorLayer['transform'];
			crop: NonNullable<ImageEditorLayer['image']>['crop'];
		}
	): void {
		this.mutate(m.image_editor_crop(), (document) => {
			const page = document.pages.find((candidate) => candidate.id === this.activePageID);
			const target = page?.layers.find((candidate) => candidate.id === id);
			if (!page || !target?.image || target.locked) return;
			target.transform = structuredClone(result.transform);
			target.image.crop = result.crop;
			this.recalculateAncestorBounds(page, target.parent_id);
		});
	}

	resetImageCrop(id: string): void {
		const layer = this.activePage?.layers.find((candidate) => candidate.id === id);
		if (!layer?.image || layer.locked) return;
		const result = resetImageEditorCrop(layer);
		this.mutate(m.image_editor_reset_crop(), (document) => {
			const page = document.pages.find((candidate) => candidate.id === this.activePageID);
			const target = page?.layers.find((candidate) => candidate.id === id);
			if (!page || !target?.image) return;
			target.transform = result.transform;
			target.image.crop = result.crop;
			this.recalculateAncestorBounds(page, target.parent_id);
		});
	}

	updateTransform(
		id: string,
		updates: Partial<ImageEditorLayer['transform']>,
		coalesceKey = `transform:${id}`
	): void {
		this.mutate(
			'Transform layer',
			(document) => {
				const page = document.pages.find((item) => item.id === this.activePageID);
				if (!page) return;
				const layer = page.layers.find((item) => item.id === id);
				if (!layer || layer.locked) return;
				this.applyTransformToLayer(page, layer, updates);
			},
			coalesceKey
		);
	}

	updateSelectedTransform(
		key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'flip_x' | 'flip_y',
		value: number | boolean,
		preserveAspect = false
	): ImageEditorPartialApplicationResult {
		const roots = this.selectedRootLayers();
		const result: ImageEditorPartialApplicationResult = {
			applied: roots.filter((layer) => !layer.locked).length,
			skippedLocked: roots.filter((layer) => layer.locked).length,
			skippedUnsupported: 0
		};
		const ids = new SvelteSet(roots.filter((layer) => !layer.locked).map((layer) => layer.id));
		this.mutate(
			m.image_editor_transform_layers(),
			(document) => {
				const page = document.pages.find((candidate) => candidate.id === this.activePageID);
				if (!page) return;
				for (const layer of page.layers.filter((candidate) => ids.has(candidate.id))) {
					let updates: Partial<ImageEditorLayer['transform']> = { [key]: value };
					if (typeof value === 'number' && (key === 'width' || key === 'height')) {
						const nextValue = Math.max(1, value);
						const ratio = layer.transform.width / Math.max(1, layer.transform.height);
						updates =
							key === 'width'
								? {
										width: nextValue,
										...(preserveAspect
											? { height: Math.max(1, nextValue / Math.max(0.0001, ratio)) }
											: {})
									}
								: {
										height: nextValue,
										...(preserveAspect ? { width: Math.max(1, nextValue * ratio) } : {})
									};
					}
					this.applyTransformToLayer(page, layer, updates);
				}
				this.recalculateAllGroupBounds(page);
			},
			`multi-transform:${key}:${[...ids].sort().join(',')}`
		);
		return result;
	}

	nudgeSelected(deltaX: number, deltaY: number): void {
		if (!deltaX && !deltaY) return;
		const movableRoots = this.selectedRootLayers().filter((layer) => !layer.locked);
		if (movableRoots.length === 0) return;
		const movableIDs = this.idsWithDescendants(movableRoots.map((layer) => layer.id));
		this.mutate(
			m.image_editor_move_layers(),
			(document) => {
				const page = document.pages.find((item) => item.id === this.activePageID);
				if (!page) return;
				for (const layer of page.layers) {
					if (!movableIDs.has(layer.id)) continue;
					layer.transform.x += deltaX;
					layer.transform.y += deltaY;
				}
				this.recalculateAllGroupBounds(page);
			},
			`nudge:${[...movableIDs].sort().join(',')}`
		);
	}

	deleteSelected(): void {
		const page = this.activePage;
		const roots = this.selectedRootLayers().filter((layer) => !layer.locked);
		if (!page || roots.length === 0) return;
		const ids = this.idsWithDescendants(roots.map((layer) => layer.id));
		const nearestIndex = Math.min(
			...page.layers.filter((layer) => ids.has(layer.id)).map((layer) => page.layers.indexOf(layer))
		);
		const before = this.document;
		this.mutate('Delete layers', (document) => {
			const target = document.pages.find((item) => item.id === this.activePageID);
			if (!target) return;
			target.layers = target.layers.filter((layer) => !ids.has(layer.id));
			this.recalculateAllGroupBounds(target);
		});
		if (this.document === before) return;
		const remaining = this.activePage?.layers ?? [];
		const start = Math.min(nearestIndex, remaining.length - 1);
		const candidate = [
			...(start >= 0 ? [remaining[start]] : []),
			...remaining.slice(0, Math.max(0, start)).reverse(),
			...remaining.slice(start + 1)
		].find((layer) => !layer.locked && layer.visible);
		this.selectedLayerIDs = candidate ? [candidate.id] : [];
		this.selectionAnchorID = candidate?.id ?? '';
	}

	duplicateSelected(): void {
		const page = this.activePage;
		const roots = this.selectedRootLayers();
		if (!page || roots.length === 0) return;
		const included = this.idsWithDescendants(roots.map((layer) => layer.id));
		const idMap = new Map<string, string>();
		for (const layer of page.layers) {
			if (included.has(layer.id)) idMap.set(layer.id, imageEditorID('layer'));
		}
		const rootIDs = new SvelteSet(roots.map((layer) => layer.id));
		const copies = page.layers
			.filter((layer) => included.has(layer.id))
			.map((layer) => ({
				...structuredClone(layer),
				id: idMap.get(layer.id)!,
				parent_id: layer.parent_id
					? (idMap.get(layer.parent_id) ?? (rootIDs.has(layer.id) ? layer.parent_id : undefined))
					: undefined,
				name: rootIDs.has(layer.id)
					? m.image_editor_layer_copy_name({ name: layer.name })
					: layer.name,
				transform: {
					...layer.transform,
					x: layer.transform.x + 24,
					y: layer.transform.y + 24
				}
			}));
		this.mutate('Duplicate layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			page?.layers.push(...copies);
		});
		this.selectedLayerIDs = roots.map((layer) => idMap.get(layer.id)!).filter(Boolean);
		this.selectionAnchorID = this.selectedLayerIDs.at(-1) ?? '';
	}

	duplicateSelectedAtTransforms(
		entries: Array<{ id: string; transform: ImageEditorLayer['transform'] }>
	): void {
		const page = this.activePage;
		if (!page || entries.length === 0) return;
		const transforms = new Map(entries.map((entry) => [entry.id, entry.transform] as const));
		const roots = page.layers.filter((layer) => transforms.has(layer.id));
		if (roots.length === 0) return;
		const rootIDs = new SvelteSet(roots.map((layer) => layer.id));
		const included = this.idsWithDescendants([...rootIDs]);
		const idMap = new Map<string, string>();
		for (const layer of page.layers) {
			if (included.has(layer.id)) idMap.set(layer.id, imageEditorID('layer'));
		}
		const rootForLayer = (layer: ImageEditorLayer): ImageEditorLayer | null => {
			let current = layer;
			const visited = new SvelteSet<string>();
			while (!rootIDs.has(current.id) && current.parent_id && !visited.has(current.parent_id)) {
				visited.add(current.parent_id);
				const parent = page.layers.find((candidate) => candidate.id === current.parent_id);
				if (!parent) break;
				current = parent;
			}
			return rootIDs.has(current.id) ? current : null;
		};
		const copies = page.layers
			.filter((layer) => included.has(layer.id))
			.map((layer) => {
				const root = rootForLayer(layer);
				const rootTransform = root ? transforms.get(root.id) : undefined;
				const transform =
					root && rootTransform
						? root.id === layer.id
							? { ...rootTransform }
							: {
									...layer.transform,
									x: layer.transform.x + rootTransform.x - root.transform.x,
									y: layer.transform.y + rootTransform.y - root.transform.y
								}
						: { ...layer.transform };
				return {
					...structuredClone(layer),
					id: idMap.get(layer.id)!,
					parent_id: layer.parent_id ? idMap.get(layer.parent_id) : undefined,
					name: rootIDs.has(layer.id)
						? m.image_editor_layer_copy_name({ name: layer.name })
						: layer.name,
					transform
				};
			});
		this.mutate('Duplicate layers', (document) => {
			const targetPage = document.pages.find((item) => item.id === this.activePageID);
			targetPage?.layers.push(...copies);
		});
		this.selectedLayerIDs = roots.map((layer) => idMap.get(layer.id)!).filter(Boolean);
		this.selectionAnchorID = this.selectedLayerIDs.at(-1) ?? '';
	}

	groupSelected(): void {
		const roots = this.selectedRootLayers();
		if (roots.length < 2) return;
		const groupID = imageEditorID('layer');
		const selected = new SvelteSet(roots.map((layer) => layer.id));
		const bounds = this.selectionBounds(roots);
		const parentIDs = new SvelteSet(roots.map((layer) => layer.parent_id ?? ''));
		const commonParentID = parentIDs.size === 1 ? roots[0]?.parent_id : undefined;
		const group: ImageEditorLayer = {
			id: groupID,
			type: 'group',
			name: m.image_editor_group(),
			parent_id: commonParentID,
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(bounds.width, bounds.height, bounds.x, bounds.y)
		};
		this.mutate('Group layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			for (const layer of page.layers) {
				if (selected.has(layer.id)) layer.parent_id = groupID;
			}
			page.layers.push(group);
		});
		this.selectedLayerIDs = [groupID];
		this.selectionAnchorID = groupID;
	}

	ungroupSelected(): void {
		const groupIDs = new SvelteSet(
			this.selectedLayers.filter((layer) => layer.type === 'group').map((l) => l.id)
		);
		if (groupIDs.size === 0) return;
		const childIDs =
			this.activePage?.layers
				.filter((layer) => layer.parent_id && groupIDs.has(layer.parent_id))
				.map((layer) => layer.id) ?? [];
		this.mutate('Ungroup layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			const groupParents = new Map(
				page.layers
					.filter((layer) => groupIDs.has(layer.id))
					.map((layer) => [layer.id, layer.parent_id] as const)
			);
			for (const layer of page.layers) {
				if (layer.parent_id && groupIDs.has(layer.parent_id)) {
					layer.parent_id = groupParents.get(layer.parent_id);
				}
			}
			page.layers = page.layers.filter((layer) => !groupIDs.has(layer.id));
			this.recalculateAllGroupBounds(page);
		});
		this.selectedLayerIDs = childIDs;
		this.selectionAnchorID = childIDs.at(-1) ?? '';
	}

	groupDestinationsForLayer(id: string): ImageEditorLayer[] {
		const page = this.activePage;
		const source = page?.layers.find((layer) => layer.id === id);
		if (!page || !source) return [];
		const blocked = this.idsWithDescendants([id]);
		return page.layers.filter(
			(layer) =>
				layer.type === 'group' &&
				!blocked.has(layer.id) &&
				!this.layerIsEffectivelyLocked(layer, page.layers)
		);
	}

	moveLayerToGroup(id: string, parentID?: string): boolean {
		const page = this.activePage;
		const source = page?.layers.find((layer) => layer.id === id);
		if (!page || !source || this.layerIsEffectivelyLocked(source, page.layers)) return false;
		const nextParentID = parentID || undefined;
		if (source.parent_id === nextParentID) return false;
		if (nextParentID) {
			const destination = this.groupDestinationsForLayer(id).find(
				(layer) => layer.id === nextParentID
			);
			if (!destination) return false;
		}
		const previousParentID = source.parent_id;
		this.mutate(
			nextParentID ? m.image_editor_move_into_group() : m.image_editor_move_out_of_group(),
			(document) => {
				const activePage = document.pages.find((candidate) => candidate.id === this.activePageID);
				const target = activePage?.layers.find((layer) => layer.id === id);
				if (!activePage || !target) return;
				target.parent_id = nextParentID;
				this.recalculateAncestorBounds(activePage, previousParentID);
				this.recalculateAncestorBounds(activePage, nextParentID);
			}
		);
		this.selectedLayerIDs = [id];
		this.selectionAnchorID = id;
		return true;
	}

	moveLayerOutOfGroup(id: string): boolean {
		const page = this.activePage;
		const layer = page?.layers.find((candidate) => candidate.id === id);
		if (!page || !layer?.parent_id) return false;
		const parent = page.layers.find((candidate) => candidate.id === layer.parent_id);
		return this.moveLayerToGroup(id, parent?.parent_id);
	}

	reorderLayer(id: string, direction: 'front' | 'forward' | 'backward' | 'back'): void {
		this.mutate('Reorder layer', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			const index = page.layers.findIndex((layer) => layer.id === id);
			if (index < 0) return;
			const [layer] = page.layers.splice(index, 1);
			const nextIndex =
				direction === 'front'
					? page.layers.length
					: direction === 'back'
						? 0
						: direction === 'forward'
							? Math.min(page.layers.length, index + 1)
							: Math.max(0, index - 1);
			page.layers.splice(nextIndex, 0, layer);
		});
	}

	moveLayerRelative(id: string, targetID: string, position: 'above' | 'below'): void {
		if (id === targetID) return;
		const page = this.activePage;
		const source = page?.layers.find((layer) => layer.id === id);
		const target = page?.layers.find((layer) => layer.id === targetID);
		if (!source || !target || source.parent_id !== target.parent_id) return;
		this.mutate('Reorder layer', (document) => {
			const activePage = document.pages.find((item) => item.id === this.activePageID);
			if (!activePage) return;
			const sourceIndex = activePage.layers.findIndex((layer) => layer.id === id);
			if (sourceIndex < 0) return;
			const [layer] = activePage.layers.splice(sourceIndex, 1);
			const targetIndex = activePage.layers.findIndex((candidate) => candidate.id === targetID);
			if (targetIndex < 0) return;
			activePage.layers.splice(position === 'above' ? targetIndex + 1 : targetIndex, 0, layer);
		});
	}

	alignSelected(alignment: 'left' | 'center_x' | 'right' | 'top' | 'center_y' | 'bottom'): void {
		if (this.selectedLayers.length < 2) return;
		const bounds = this.selectionBounds();
		const ids = new SvelteSet(this.selectedLayerIDs);
		this.mutate('Align layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			for (const layer of page?.layers ?? []) {
				if (!ids.has(layer.id)) continue;
				if (alignment === 'left') layer.transform.x = bounds.x;
				if (alignment === 'center_x') {
					layer.transform.x = bounds.x + (bounds.width - layer.transform.width) / 2;
				}
				if (alignment === 'right') {
					layer.transform.x = bounds.x + bounds.width - layer.transform.width;
				}
				if (alignment === 'top') layer.transform.y = bounds.y;
				if (alignment === 'center_y') {
					layer.transform.y = bounds.y + (bounds.height - layer.transform.height) / 2;
				}
				if (alignment === 'bottom') {
					layer.transform.y = bounds.y + bounds.height - layer.transform.height;
				}
			}
		});
	}

	distributeSelected(axis: 'horizontal' | 'vertical'): void {
		const selected = [...this.selectedLayers];
		if (selected.length < 3) return;
		selected.sort((a, b) =>
			axis === 'horizontal'
				? a.transform.x + a.transform.width / 2 - (b.transform.x + b.transform.width / 2)
				: a.transform.y + a.transform.height / 2 - (b.transform.y + b.transform.height / 2)
		);
		const first = selected[0];
		const last = selected[selected.length - 1];
		const firstCenter =
			axis === 'horizontal'
				? first.transform.x + first.transform.width / 2
				: first.transform.y + first.transform.height / 2;
		const lastCenter =
			axis === 'horizontal'
				? last.transform.x + last.transform.width / 2
				: last.transform.y + last.transform.height / 2;
		const gap = (lastCenter - firstCenter) / (selected.length - 1);
		const ids = selected.map((layer) => layer.id);
		this.mutate('Distribute layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			for (let index = 1; index < ids.length - 1; index++) {
				const layer = page?.layers.find((item) => item.id === ids[index]);
				if (!layer) continue;
				const center = firstCenter + gap * index;
				if (axis === 'horizontal') layer.transform.x = center - layer.transform.width / 2;
				else layer.transform.y = center - layer.transform.height / 2;
			}
		});
	}

	addPage(): void {
		if (!this.document || this.document.pages.length >= 35) return;
		const page = blankImageEditorPage(`Page ${this.document.pages.length + 1}`);
		this.mutate('Add page', (document) => document.pages.push(page));
		this.activePageID = page.id;
		this.selectedLayerIDs = [];
	}

	duplicatePage(): void {
		if (!this.activePage || !this.document || this.document.pages.length >= 35) return;
		const activeIndex = this.document.pages.findIndex((page) => page.id === this.activePageID);
		const displayName = /^Page \d+$/.test(this.activePage.name)
			? m.image_editor_default_page_name({ number: activeIndex + 1 })
			: this.activePage.name;
		const page = cloneImageEditorPage(
			this.activePage,
			m.image_editor_page_copy_name({ name: displayName })
		);
		this.mutate('Duplicate page', (document) => {
			const index = document.pages.findIndex((item) => item.id === this.activePageID);
			document.pages.splice(index + 1, 0, page);
		});
		this.activePageID = page.id;
		this.selectedLayerIDs = [];
	}

	deletePage(): void {
		if (!this.document || this.document.pages.length <= 1) return;
		const index = this.document.pages.findIndex((page) => page.id === this.activePageID);
		this.mutate('Delete page', (document) => {
			document.pages.splice(index, 1);
		});
		this.activePageID =
			this.document.pages[Math.min(index, this.document.pages.length - 1)]?.id ?? '';
		this.selectedLayerIDs = [];
	}

	reorderPage(pageID: string, targetIndex: number): void {
		this.mutate('Reorder page', (document) => {
			const index = document.pages.findIndex((page) => page.id === pageID);
			if (index < 0) return;
			const [page] = document.pages.splice(index, 1);
			document.pages.splice(Math.max(0, Math.min(targetIndex, document.pages.length)), 0, page);
		});
	}

	setViewportSize(containerWidth: number, containerHeight: number): void {
		if (containerWidth > 0) this.viewportWidth = containerWidth;
		if (containerHeight > 0) this.viewportHeight = containerHeight;
	}

	fitZoom(containerWidth = this.viewportWidth, containerHeight = this.viewportHeight): void {
		if (!this.document || containerWidth <= 0 || containerHeight <= 0) return;
		this.setViewportSize(containerWidth, containerHeight);
		this.zoom = Math.min(
			1,
			Math.max(0.1, (containerWidth - 80) / this.document.width_px),
			Math.max(0.1, (containerHeight - 80) / this.document.height_px)
		);
		this.panX = 0;
		this.panY = 0;
	}

	setBrandKit(brandKit: ImageEditorBrandKit | null): void {
		this.brandKit = brandKit;
	}

	applyBrandTextStyle(style: ImageEditorBrandTextStyle): ImageEditorPartialApplicationResult {
		const ids = new SvelteSet(this.selectedLayerIDs);
		const result: ImageEditorPartialApplicationResult = {
			applied: 0,
			skippedLocked: 0,
			skippedUnsupported: 0
		};
		for (const layer of this.selectedLayers) {
			if (layer.locked) result.skippedLocked += 1;
			else if (!layer.text) result.skippedUnsupported += 1;
			else result.applied += 1;
		}
		this.mutate(m.image_editor_apply_text_style(), (document) => {
			const page = document.pages.find((candidate) => candidate.id === this.activePageID);
			if (!page) return;
			for (const layer of page.layers) {
				if (!ids.has(layer.id) || layer.locked || !layer.text) continue;
				layer.text = {
					...layer.text,
					font_family: style.font_family,
					font_asset_id: style.font_asset_id,
					font_weight: style.font_weight,
					font_style: style.font_style === 'italic' ? 'italic' : 'normal',
					font_size: style.font_size,
					color: style.color,
					line_height: style.line_height,
					letter_spacing: style.letter_spacing
				};
			}
		});
		return result;
	}

	updateSelectedOpacity(opacity: number): ImageEditorPartialApplicationResult {
		const ids = new SvelteSet(this.selectedLayerIDs);
		const result: ImageEditorPartialApplicationResult = {
			applied: 0,
			skippedLocked: 0,
			skippedUnsupported: 0
		};
		for (const layer of this.selectedLayers) {
			if (layer.locked) result.skippedLocked += 1;
			else result.applied += 1;
		}
		this.mutate(
			m.image_editor_change_opacity(),
			(document) => {
				const page = document.pages.find((candidate) => candidate.id === this.activePageID);
				for (const layer of page?.layers ?? []) {
					if (ids.has(layer.id) && !layer.locked) layer.opacity = Math.max(0, Math.min(1, opacity));
				}
			},
			`opacity:${[...ids].sort().join(',')}`
		);
		return result;
	}

	setRecentColors(colors: string[]): void {
		this.recentColors = [
			...new Set(
				colors.map((color) => color.toLowerCase()).filter((color) => /^#[0-9a-f]{6}$/.test(color))
			)
		].slice(0, 8);
	}

	rememberColor(color: string): void {
		if (!/^#[0-9a-f]{6}$/i.test(color)) return;
		this.setRecentColors([color, ...this.recentColors]);
		try {
			localStorage.setItem(
				'openpost-image-editor-recent-colors-v1',
				JSON.stringify(this.recentColors)
			);
		} catch {
			// Recent colors are a convenience when browser storage is unavailable.
		}
	}

	applySampledColor(color: string, alpha: number): void {
		const opacity = Math.max(0, Math.min(1, alpha / 255));
		this.paintColor = color;
		this.paintOpacity = opacity;
		this.rememberColor(color);
		if (this.eyedropperTarget === 'foreground') return;
		const colorWithAlpha = `${color}${Math.round(opacity * 255)
			.toString(16)
			.padStart(2, '0')}`;
		if (this.eyedropperTarget === 'page_background') {
			this.setPageBackground({ type: 'solid', color, opacity });
			return;
		}
		const ids = new SvelteSet(this.selectedLayerIDs);
		this.mutate(m.image_editor_apply_sampled_color(), (document) => {
			const page = document.pages.find((candidate) => candidate.id === this.activePageID);
			if (!page) return;
			for (const layer of page.layers) {
				if (!ids.has(layer.id) || layer.locked) continue;
				if (this.eyedropperTarget === 'selected_fill') {
					if (layer.shape) layer.shape.fill = colorWithAlpha;
					else if (layer.text) layer.text.color = colorWithAlpha;
					else if (layer.paint) {
						layer.paint.color = color;
						layer.paint.opacity = opacity;
					}
				} else if (this.eyedropperTarget === 'selected_stroke') {
					if (layer.shape) layer.shape.stroke = colorWithAlpha;
					else if (layer.text) layer.text.stroke_color = colorWithAlpha;
				}
			}
		});
	}

	private selectionBounds(layers = this.selectedLayers): {
		x: number;
		y: number;
		width: number;
		height: number;
	} {
		const x = Math.min(...layers.map((layer) => layer.transform.x));
		const y = Math.min(...layers.map((layer) => layer.transform.y));
		const right = Math.max(...layers.map((layer) => layer.transform.x + layer.transform.width));
		const bottom = Math.max(...layers.map((layer) => layer.transform.y + layer.transform.height));
		return { x, y, width: right - x, height: bottom - y };
	}

	private reconcileSelection(): void {
		const ids = new SvelteSet(this.activePage?.layers.map((layer) => layer.id) ?? []);
		this.selectedLayerIDs = this.selectedLayerIDs.filter((id) => ids.has(id));
		if (!ids.has(this.selectionAnchorID)) this.selectionAnchorID = '';
	}

	private historyContext(): ImageEditorHistoryContext {
		return {
			activePageID: this.activePageID,
			selectedLayerIDs: [...this.selectedLayerIDs],
			selectionAnchorID: this.selectionAnchorID,
			activeTool: this.activeTool,
			selectionMode: this.selectionMode,
			pixelSelection: this.pixelSelection
				? {
						...this.pixelSelection,
						data: this.pixelSelection.data.slice(),
						targetLayerIDs: [...this.pixelSelection.targetLayerIDs]
					}
				: null,
			zoom: this.zoom,
			panX: this.panX,
			panY: this.panY
		};
	}

	private restoreHistoryContext(context: ImageEditorHistoryContext): void {
		this.activePageID = this.document?.pages.some((page) => page.id === context.activePageID)
			? context.activePageID
			: (this.document?.pages[0]?.id ?? '');
		this.selectedLayerIDs = [...context.selectedLayerIDs];
		this.selectionAnchorID = context.selectionAnchorID;
		this.activeTool = context.activeTool;
		this.selectionMode = context.selectionMode;
		this.pixelSelection = context.pixelSelection
			? {
					...context.pixelSelection,
					data: context.pixelSelection.data.slice(),
					targetLayerIDs: [...context.pixelSelection.targetLayerIDs]
				}
			: null;
		this.zoom = context.zoom;
		this.panX = context.panX;
		this.panY = context.panY;
		this.reconcileSelection();
	}

	private layerSelectionOrder(): string[] {
		const page = this.activePage;
		if (!page) return [];
		const byParent = new Map<string, ImageEditorLayer[]>();
		for (const layer of page.layers) {
			const parent = layer.parent_id ?? '';
			const children = byParent.get(parent) ?? [];
			children.push(layer);
			byParent.set(parent, children);
		}
		const ordered: string[] = [];
		const append = (parentID: string): void => {
			for (const layer of [...(byParent.get(parentID) ?? [])].reverse()) {
				ordered.push(layer.id);
				append(layer.id);
			}
		};
		append('');
		return ordered;
	}

	private selectedRootLayers(): ImageEditorLayer[] {
		const selected = new SvelteSet(this.selectedLayerIDs);
		return this.selectedLayers.filter((layer) => {
			let parentID = layer.parent_id;
			while (parentID) {
				if (selected.has(parentID)) return false;
				parentID = this.activePage?.layers.find(
					(candidate) => candidate.id === parentID
				)?.parent_id;
			}
			return true;
		});
	}

	private idsWithDescendants(rootIDs: string[]): SvelteSet<string> {
		const ids = new SvelteSet(rootIDs);
		const layers = this.activePage?.layers ?? [];
		let changed = true;
		while (changed) {
			changed = false;
			for (const layer of layers) {
				if (layer.parent_id && ids.has(layer.parent_id) && !ids.has(layer.id)) {
					ids.add(layer.id);
					changed = true;
				}
			}
		}
		return ids;
	}

	private selectedWithDescendants(): SvelteSet<string> {
		return this.idsWithDescendants(this.selectedRootLayers().map((layer) => layer.id));
	}

	private layerIsEffectivelyLocked(
		layer: ImageEditorLayer,
		layers: readonly ImageEditorLayer[]
	): boolean {
		let current: ImageEditorLayer | undefined = layer;
		const visited = new Set<string>();
		while (current) {
			if (current.locked) return true;
			if (!current.parent_id || visited.has(current.parent_id)) break;
			visited.add(current.parent_id);
			current = layers.find((candidate) => candidate.id === current?.parent_id);
		}
		return false;
	}

	private applyTransformToLayer(
		page: ImageEditorPage,
		layer: ImageEditorLayer,
		updates: Partial<ImageEditorLayer['transform']>
	): void {
		if (layer.type !== 'group') {
			Object.assign(layer.transform, updates);
			this.recalculateAncestorBounds(page, layer.parent_id);
			return;
		}
		const previous = { ...layer.transform };
		const next = { ...previous, ...updates };
		const scaleX = previous.width > 0 ? next.width / previous.width : 1;
		const scaleY = previous.height > 0 ? next.height / previous.height : 1;
		const rotationDelta = next.rotation - previous.rotation;
		const radians = (rotationDelta * Math.PI) / 180;
		const descendants = new SvelteSet<string>();
		let changed = true;
		while (changed) {
			changed = false;
			for (const candidate of page.layers) {
				if (
					candidate.parent_id &&
					(candidate.parent_id === layer.id || descendants.has(candidate.parent_id)) &&
					!descendants.has(candidate.id)
				) {
					descendants.add(candidate.id);
					changed = true;
				}
			}
		}
		for (const child of page.layers) {
			if (!descendants.has(child.id)) continue;
			const relativeX = (child.transform.x - previous.x) * scaleX;
			const relativeY = (child.transform.y - previous.y) * scaleY;
			child.transform.x = next.x + relativeX * Math.cos(radians) - relativeY * Math.sin(radians);
			child.transform.y = next.y + relativeX * Math.sin(radians) + relativeY * Math.cos(radians);
			child.transform.width *= scaleX;
			child.transform.height *= scaleY;
			child.transform.rotation = normalizeEditorRotation(child.transform.rotation + rotationDelta);
			if (updates.flip_x !== undefined && updates.flip_x !== previous.flip_x) {
				child.transform.flip_x = !child.transform.flip_x;
			}
			if (updates.flip_y !== undefined && updates.flip_y !== previous.flip_y) {
				child.transform.flip_y = !child.transform.flip_y;
			}
		}
		Object.assign(layer.transform, next);
		this.recalculateAncestorBounds(page, layer.parent_id);
	}

	private recalculateAncestorBounds(page: ImageEditorPage, parentID?: string): void {
		const visited = new Set<string>();
		let currentID = parentID;
		while (currentID && !visited.has(currentID)) {
			visited.add(currentID);
			const group = page.layers.find((layer) => layer.id === currentID && layer.type === 'group');
			if (!group) break;
			const children = page.layers.filter((layer) => layer.parent_id === group.id);
			if (children.length > 0) {
				Object.assign(group.transform, boundsForLayers(children));
			}
			currentID = group.parent_id;
		}
	}

	private recalculateAllGroupBounds(page: ImageEditorPage): void {
		for (let pass = 0; pass < page.layers.length; pass++) {
			for (const group of page.layers) {
				if (group.type !== 'group') continue;
				const children = page.layers.filter((layer) => layer.parent_id === group.id);
				if (children.length > 0) Object.assign(group.transform, boundsForLayers(children));
			}
		}
	}
}

function boundsForLayers(
	layers: ImageEditorLayer[]
): Pick<ImageEditorLayer['transform'], 'x' | 'y' | 'width' | 'height'> {
	const x = Math.min(...layers.map((layer) => layer.transform.x));
	const y = Math.min(...layers.map((layer) => layer.transform.y));
	const right = Math.max(...layers.map((layer) => layer.transform.x + layer.transform.width));
	const bottom = Math.max(...layers.map((layer) => layer.transform.y + layer.transform.height));
	return { x, y, width: right - x, height: bottom - y };
}

function fitImageSize(
	sourceWidth: number,
	sourceHeight: number,
	maxWidth: number,
	maxHeight: number
): { width: number; height: number } {
	const fitScale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
	const minimumScale = 80 / Math.min(sourceWidth, sourceHeight);
	const scale = Math.min(fitScale, Math.max(1, minimumScale));
	return {
		width: Math.max(1, sourceWidth * scale),
		height: Math.max(1, sourceHeight * scale)
	};
}

export function provideImageEditor(editor: ImageEditorController): ImageEditorController {
	setContext(IMAGE_EDITOR_CONTEXT, editor);
	return editor;
}

export function useImageEditor(): ImageEditorController {
	const editor = getContext<ImageEditorController>(IMAGE_EDITOR_CONTEXT);
	if (!editor) throw new Error('OpenPost Image Editor editor context is missing.');
	return editor;
}
