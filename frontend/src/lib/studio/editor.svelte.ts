import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { m } from '$lib/paraglide/messages';
import {
	blankStudioPage,
	cloneStudioDocument,
	cloneStudioPage,
	defaultImageAdjustments,
	defaultTransform,
	studioID
} from './document';
import { defaultLayerEffects, defaultTextCurve } from './effects';
import { StudioHistory } from './history';
import { mergeSelectionIDs } from './selection';
import type {
	StudioDocument,
	StudioDocumentResponse,
	StudioBrandKit,
	StudioLayer,
	StudioPage,
	StudioSelectionMode,
	StudioSaveState,
	StudioTool
} from './types';

const STUDIO_EDITOR_CONTEXT = Symbol('openpost-studio-editor');

export class StudioEditor {
	id = $state('');
	workspaceID = $state('');
	revision = $state(0);
	canEdit = $state(false);
	document = $state.raw<StudioDocument | null>(null);
	activePageID = $state('');
	selectedLayerIDs = $state.raw<string[]>([]);
	activeTool = $state<StudioTool>('select');
	selectionMode = $state<StudioSelectionMode>('replace');
	magicSelectTolerance = $state(12);
	saveState = $state<StudioSaveState>('idle');
	saveMessage = $state('');
	zoom = $state(1);
	panX = $state(0);
	panY = $state(0);
	leftPanel = $state<'media' | null>('media');
	rightPanelVisible = $state(true);
	layersPanelOpen = $state(false);
	pagesExpanded = $state(true);
	brandKit = $state.raw<StudioBrandKit | null>(null);
	recentColors = $state.raw<string[]>([]);
	private history = new StudioHistory<StudioDocument>(cloneStudioDocument);
	private historyRevision = $state(0);
	private changeListeners = new SvelteSet<() => void>();
	private selectionAnchorID = '';

	get activePage(): StudioPage | null {
		return this.document?.pages.find((page) => page.id === this.activePageID) ?? null;
	}

	get selectedLayers(): StudioLayer[] {
		const selected = new SvelteSet(this.selectedLayerIDs);
		return this.activePage?.layers.filter((layer) => selected.has(layer.id)) ?? [];
	}

	get canUndo(): boolean {
		return this.historyRevision >= 0 && this.history.canUndo;
	}

	get canRedo(): boolean {
		return this.historyRevision >= 0 && this.history.canRedo;
	}

	load(response: StudioDocumentResponse): void {
		this.id = response.id;
		this.workspaceID = response.workspace_id;
		this.revision = response.revision;
		this.canEdit = response.can_edit;
		this.document = cloneStudioDocument(response.document);
		this.activePageID = response.document.pages[0]?.id ?? '';
		this.selectedLayerIDs = [];
		this.selectionAnchorID = '';
		this.saveState = 'saved';
		this.saveMessage = m.studio_saved();
		this.history.clear();
		this.historyRevision++;
	}

	replaceFromServer(response: StudioDocumentResponse): void {
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
		this.saveMessage = m.studio_unsaved_changes();
		for (const listener of this.changeListeners) listener();
	}

	mutate(label: string, mutation: (document: StudioDocument) => void, coalesceKey?: string): void {
		if (!this.document || !this.canEdit) return;
		this.document = this.history.execute(this.document, {
			label,
			coalesceKey,
			apply(document) {
				mutation(document);
				return document;
			},
			revert(document) {
				return document;
			}
		});
		this.historyRevision++;
		this.emitChange();
	}

	undo(): void {
		if (!this.document || !this.canUndo || !this.canEdit) return;
		this.document = this.history.undo(this.document);
		this.historyRevision++;
		this.reconcileSelection();
		this.emitChange();
	}

	redo(): void {
		if (!this.document || !this.canRedo || !this.canEdit) return;
		this.document = this.history.redo(this.document);
		this.historyRevision++;
		this.reconcileSelection();
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

	applyLayerSelection(ids: string[], mode: StudioSelectionMode = 'replace'): void {
		const available = new SvelteSet(this.activePage?.layers.map((layer) => layer.id) ?? []);
		const candidates = ids.filter((id) => available.has(id));
		this.selectedLayerIDs = mergeSelectionIDs(this.selectedLayerIDs, candidates, mode);
		this.selectionAnchorID = this.selectedLayerIDs.at(-1) ?? '';
	}

	selectAll(): void {
		this.selectedLayerIDs = this.layerSelectionOrder().filter(
			(id) => !this.activePage?.layers.find((layer) => layer.id === id)?.locked
		);
		this.selectionAnchorID = this.selectedLayerIDs.at(-1) ?? '';
	}

	addText(): void {
		if (!this.document) return;
		const layer: StudioLayer = {
			id: studioID('layer'),
			type: 'text',
			name: 'Text',
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
				text: 'Add your text',
				font_family: 'Geist Variable',
				font_weight: 700,
				font_style: 'normal',
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

	addShape(kind: NonNullable<StudioLayer['shape']>['kind'] = 'rectangle'): void {
		if (!this.document) return;
		const size = Math.min(this.document.width_px, this.document.height_px) * 0.28;
		const layer: StudioLayer = {
			id: studioID('layer'),
			type: 'shape',
			name:
				kind === 'ellipse'
					? m.studio_ellipse()
					: kind === 'rounded_rectangle'
						? m.studio_rounded_rectangle()
						: kind === 'line'
							? m.studio_line()
							: m.studio_rectangle(),
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

	addImage(media: { id: string; width?: number; height?: number; name?: string }): void {
		if (!this.document) return;
		const sourceWidth = media.width || this.document.width_px;
		const sourceHeight = media.height || this.document.height_px;
		const maxWidth = this.document.width_px * 0.72;
		const maxHeight = this.document.height_px * 0.72;
		const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
		const width = Math.max(80, sourceWidth * scale);
		const height = Math.max(80, sourceHeight * scale);
		const layer: StudioLayer = {
			id: studioID('layer'),
			type: 'image',
			name: media.name || 'Image',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(
				width,
				height,
				(this.document.width_px - width) / 2,
				(this.document.height_px - height) / 2
			),
			image: {
				media_id: media.id,
				source_width: sourceWidth,
				source_height: sourceHeight,
				fit: 'cover',
				crop: { x: 0, y: 0, width: 1, height: 1 },
				adjustments: defaultImageAdjustments()
			},
			effects: defaultLayerEffects()
		};
		this.addLayer(layer);
	}

	addLayer(layer: StudioLayer): void {
		this.mutate(`Add ${layer.name}`, (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			page?.layers.push(layer);
		});
		this.selectedLayerIDs = [layer.id];
	}

	updateLayer(id: string, updates: Partial<StudioLayer>, coalesceKey?: string): void {
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

	updateTransform(
		id: string,
		updates: Partial<StudioLayer['transform']>,
		coalesceKey = `transform:${id}`
	): void {
		this.mutate(
			'Transform layer',
			(document) => {
				const layer = document.pages
					.find((page) => page.id === this.activePageID)
					?.layers.find((item) => item.id === id);
				if (!layer) return;
				const page = document.pages.find((item) => item.id === this.activePageID);
				if (!page) return;
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
					child.transform.x =
						next.x + relativeX * Math.cos(radians) - relativeY * Math.sin(radians);
					child.transform.y =
						next.y + relativeX * Math.sin(radians) + relativeY * Math.cos(radians);
					child.transform.width *= scaleX;
					child.transform.height *= scaleY;
					child.transform.rotation += rotationDelta;
					if (updates.flip_x !== undefined && updates.flip_x !== previous.flip_x) {
						child.transform.flip_x = !child.transform.flip_x;
					}
					if (updates.flip_y !== undefined && updates.flip_y !== previous.flip_y) {
						child.transform.flip_y = !child.transform.flip_y;
					}
				}
				Object.assign(layer.transform, next);
				this.recalculateAncestorBounds(page, layer.parent_id);
			},
			coalesceKey
		);
	}

	deleteSelected(): void {
		if (this.selectedLayerIDs.length === 0) return;
		const ids = this.selectedWithDescendants();
		this.mutate('Delete layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			page.layers = page.layers.filter((layer) => !ids.has(layer.id));
			this.recalculateAllGroupBounds(page);
		});
		this.selectedLayerIDs = [];
		this.selectionAnchorID = '';
	}

	duplicateSelected(): void {
		const page = this.activePage;
		const roots = this.selectedRootLayers();
		if (!page || roots.length === 0) return;
		const included = this.idsWithDescendants(roots.map((layer) => layer.id));
		const idMap = new Map<string, string>();
		for (const layer of page.layers) {
			if (included.has(layer.id)) idMap.set(layer.id, studioID('layer'));
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
				name: rootIDs.has(layer.id) ? m.studio_layer_copy_name({ name: layer.name }) : layer.name,
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

	groupSelected(): void {
		const roots = this.selectedRootLayers();
		if (roots.length < 2) return;
		const groupID = studioID('layer');
		const selected = new SvelteSet(roots.map((layer) => layer.id));
		const bounds = this.selectionBounds(roots);
		const parentIDs = new SvelteSet(roots.map((layer) => layer.parent_id ?? ''));
		const commonParentID = parentIDs.size === 1 ? roots[0]?.parent_id : undefined;
		const group: StudioLayer = {
			id: groupID,
			type: 'group',
			name: m.studio_group(),
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
		const page = blankStudioPage(`Page ${this.document.pages.length + 1}`);
		this.mutate('Add page', (document) => document.pages.push(page));
		this.activePageID = page.id;
		this.selectedLayerIDs = [];
	}

	duplicatePage(): void {
		if (!this.activePage || !this.document || this.document.pages.length >= 35) return;
		const activeIndex = this.document.pages.findIndex((page) => page.id === this.activePageID);
		const displayName = /^Page \d+$/.test(this.activePage.name)
			? m.studio_default_page_name({ number: activeIndex + 1 })
			: this.activePage.name;
		const page = cloneStudioPage(this.activePage, m.studio_page_copy_name({ name: displayName }));
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

	fitZoom(containerWidth: number, containerHeight: number): void {
		if (!this.document) return;
		this.zoom = Math.min(
			1,
			(containerWidth - 80) / this.document.width_px,
			(containerHeight - 80) / this.document.height_px
		);
		this.panX = 0;
		this.panY = 0;
	}

	setBrandKit(brandKit: StudioBrandKit | null): void {
		this.brandKit = brandKit;
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
			localStorage.setItem('openpost-studio-recent-colors-v1', JSON.stringify(this.recentColors));
		} catch {
			// Recent colors are a convenience when browser storage is unavailable.
		}
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

	private layerSelectionOrder(): string[] {
		const page = this.activePage;
		if (!page) return [];
		const byParent = new Map<string, StudioLayer[]>();
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

	private selectedRootLayers(): StudioLayer[] {
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

	private recalculateAncestorBounds(page: StudioPage, parentID?: string): void {
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

	private recalculateAllGroupBounds(page: StudioPage): void {
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
	layers: StudioLayer[]
): Pick<StudioLayer['transform'], 'x' | 'y' | 'width' | 'height'> {
	const x = Math.min(...layers.map((layer) => layer.transform.x));
	const y = Math.min(...layers.map((layer) => layer.transform.y));
	const right = Math.max(...layers.map((layer) => layer.transform.x + layer.transform.width));
	const bottom = Math.max(...layers.map((layer) => layer.transform.y + layer.transform.height));
	return { x, y, width: right - x, height: bottom - y };
}

export function provideStudioEditor(editor: StudioEditor): StudioEditor {
	setContext(STUDIO_EDITOR_CONTEXT, editor);
	return editor;
}

export function useStudioEditor(): StudioEditor {
	const editor = getContext<StudioEditor>(STUDIO_EDITOR_CONTEXT);
	if (!editor) throw new Error('Studio editor context is missing.');
	return editor;
}
