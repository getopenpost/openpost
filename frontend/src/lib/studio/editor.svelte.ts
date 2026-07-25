import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { m } from '$lib/paraglide/messages';
import {
	blankStudioPage,
	cloneStudioDocument,
	cloneStudioLayer,
	cloneStudioPage,
	defaultImageAdjustments,
	defaultTransform,
	studioID
} from './document';
import { StudioHistory } from './history';
import type {
	StudioDocument,
	StudioDocumentResponse,
	StudioLayer,
	StudioPage,
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
	saveState = $state<StudioSaveState>('idle');
	saveMessage = $state('');
	zoom = $state(1);
	panX = $state(0);
	panY = $state(0);
	leftPanel = $state<'media' | 'templates' | 'brand' | null>('media');
	rightPanelVisible = $state(true);
	layersPanelOpen = $state(false);
	pagesExpanded = $state(true);
	private history = new StudioHistory<StudioDocument>(cloneStudioDocument);
	private historyRevision = $state(0);
	private changeListeners = new SvelteSet<() => void>();

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

	selectLayer(id: string, additive = false): void {
		if (!id) {
			this.selectedLayerIDs = [];
			return;
		}
		if (additive) {
			this.selectedLayerIDs = this.selectedLayerIDs.includes(id)
				? this.selectedLayerIDs.filter((item) => item !== id)
				: [...this.selectedLayerIDs, id];
		} else {
			this.selectedLayerIDs = [id];
		}
	}

	selectAll(): void {
		this.selectedLayerIDs =
			this.activePage?.layers.filter((layer) => !layer.locked).map((layer) => layer.id) ?? [];
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
				shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
			}
		};
		this.addLayer(layer);
	}

	addShape(kind: NonNullable<StudioLayer['shape']>['kind'] = 'rectangle'): void {
		if (!this.document) return;
		const size = Math.min(this.document.width_px, this.document.height_px) * 0.28;
		const layer: StudioLayer = {
			id: studioID('layer'),
			type: 'shape',
			name: kind === 'ellipse' ? 'Ellipse' : 'Shape',
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
			}
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
			}
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
				if (layer.type !== 'group') {
					Object.assign(layer.transform, updates);
					return;
				}
				const page = document.pages.find((item) => item.id === this.activePageID);
				if (!page) return;
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
			},
			coalesceKey
		);
	}

	deleteSelected(): void {
		if (this.selectedLayerIDs.length === 0) return;
		const ids = new SvelteSet(this.selectedLayerIDs);
		this.mutate('Delete layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			page.layers = page.layers.filter((layer) => !ids.has(layer.id));
			for (const layer of page.layers) {
				if (layer.parent_id && ids.has(layer.parent_id)) layer.parent_id = undefined;
			}
		});
		this.selectedLayerIDs = [];
	}

	duplicateSelected(): void {
		const source = this.selectedLayers;
		if (source.length === 0) return;
		const copies = source.map((layer) =>
			cloneStudioLayer(layer, m.studio_layer_copy_name({ name: layer.name }))
		);
		this.mutate('Duplicate layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			page?.layers.push(...copies);
		});
		this.selectedLayerIDs = copies.map((layer) => layer.id);
	}

	groupSelected(): void {
		if (this.selectedLayers.length < 2) return;
		const groupID = studioID('layer');
		const selected = new SvelteSet(this.selectedLayerIDs);
		const bounds = this.selectionBounds();
		const group: StudioLayer = {
			id: groupID,
			type: 'group',
			name: m.studio_group(),
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
	}

	ungroupSelected(): void {
		const groupIDs = new SvelteSet(
			this.selectedLayers.filter((layer) => layer.type === 'group').map((l) => l.id)
		);
		if (groupIDs.size === 0) return;
		this.mutate('Ungroup layers', (document) => {
			const page = document.pages.find((item) => item.id === this.activePageID);
			if (!page) return;
			for (const layer of page.layers) {
				if (layer.parent_id && groupIDs.has(layer.parent_id)) layer.parent_id = undefined;
			}
			page.layers = page.layers.filter((layer) => !groupIDs.has(layer.id));
		});
		this.selectedLayerIDs = [];
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

	private selectionBounds(): { x: number; y: number; width: number; height: number } {
		const layers = this.selectedLayers;
		const x = Math.min(...layers.map((layer) => layer.transform.x));
		const y = Math.min(...layers.map((layer) => layer.transform.y));
		const right = Math.max(...layers.map((layer) => layer.transform.x + layer.transform.width));
		const bottom = Math.max(...layers.map((layer) => layer.transform.y + layer.transform.height));
		return { x, y, width: right - x, height: bottom - y };
	}

	private reconcileSelection(): void {
		const ids = new SvelteSet(this.activePage?.layers.map((layer) => layer.id) ?? []);
		this.selectedLayerIDs = this.selectedLayerIDs.filter((id) => ids.has(id));
	}
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
