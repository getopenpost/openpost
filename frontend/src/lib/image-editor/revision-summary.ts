import type { ImageEditorDocument, ImageEditorLayer, ImageEditorPage } from './types';

export interface ImageEditorRevisionChanges {
	titleChanged: boolean;
	coverChanged: boolean;
	canvasChanged: boolean;
	exportSettingsChanged: boolean;
	brandKitChanged: boolean;
	pagesAdded: number;
	pagesRemoved: number;
	pagesChanged: number;
	layersAdded: number;
	layersRemoved: number;
	layersChanged: number;
	guidePagesChanged: number;
}

export interface ImageEditorRevisionContext {
	currentCoverPreviewMediaID?: string;
	targetCoverPreviewMediaID?: string;
}

export function summarizeImageEditorRevision(
	current: ImageEditorDocument,
	target: ImageEditorDocument,
	context: ImageEditorRevisionContext = {}
): ImageEditorRevisionChanges {
	const currentPages = new Map(current.pages.map((page) => [page.id, page]));
	const targetPages = new Map(target.pages.map((page) => [page.id, page]));
	const changedPageIDs = new Set<string>();
	let layersAdded = 0;
	let layersRemoved = 0;
	let layersChanged = 0;
	let guidePagesChanged = 0;

	for (const [pageID, targetPage] of targetPages) {
		const currentPage = currentPages.get(pageID);
		if (!currentPage) {
			layersAdded += targetPage.layers.length;
			if (hasGuides(targetPage)) guidePagesChanged += 1;
			continue;
		}
		if (!samePageProperties(currentPage, targetPage)) changedPageIDs.add(pageID);
		if (!same(currentPage.guides, targetPage.guides)) guidePagesChanged += 1;
		const layerChanges = compareLayers(currentPage.layers, targetPage.layers);
		layersAdded += layerChanges.added;
		layersRemoved += layerChanges.removed;
		layersChanged += layerChanges.changed;
	}
	for (const [pageID, currentPage] of currentPages) {
		if (targetPages.has(pageID)) continue;
		layersRemoved += currentPage.layers.length;
		if (hasGuides(currentPage)) guidePagesChanged += 1;
	}
	for (const pageID of changedOrderIDs(current.pages, target.pages)) {
		changedPageIDs.add(pageID);
	}

	const changes: ImageEditorRevisionChanges = {
		titleChanged: current.title !== target.title,
		coverChanged:
			normalizeReference(context.currentCoverPreviewMediaID) !==
			normalizeReference(context.targetCoverPreviewMediaID),
		canvasChanged:
			current.width_px !== target.width_px ||
			current.height_px !== target.height_px ||
			current.preset_key !== target.preset_key,
		exportSettingsChanged: !same(current.export_defaults, target.export_defaults),
		brandKitChanged:
			current.brand_kit_id !== target.brand_kit_id ||
			current.brand_kit_revision !== target.brand_kit_revision,
		pagesAdded: [...targetPages.keys()].filter((pageID) => !currentPages.has(pageID)).length,
		pagesRemoved: [...currentPages.keys()].filter((pageID) => !targetPages.has(pageID)).length,
		pagesChanged: changedPageIDs.size,
		layersAdded,
		layersRemoved,
		layersChanged,
		guidePagesChanged
	};
	// Fail open for a future valid document member that this focused summary does
	// not yet classify. A version must never become unrestorable merely because
	// its semantic change predates a matching detail row in this UI.
	if (!imageEditorRevisionHasChanges(changes) && !same(current, target)) {
		changes.pagesChanged = 1;
	}
	return changes;
}

export function imageEditorRevisionHasChanges(changes: ImageEditorRevisionChanges): boolean {
	return Object.values(changes).some(
		(value) => value === true || (typeof value === 'number' && value > 0)
	);
}

function compareLayers(
	current: ImageEditorLayer[],
	target: ImageEditorLayer[]
): { added: number; removed: number; changed: number } {
	const currentLayers = new Map(current.map((layer) => [layer.id, layer]));
	const targetLayers = new Map(target.map((layer) => [layer.id, layer]));
	const changedIDs = new Set<string>();
	for (const [layerID, targetLayer] of targetLayers) {
		const currentLayer = currentLayers.get(layerID);
		if (currentLayer && !same(currentLayer, targetLayer)) changedIDs.add(layerID);
	}
	for (const layerID of changedOrderIDs(current, target)) {
		changedIDs.add(layerID);
	}
	return {
		added: [...targetLayers.keys()].filter((layerID) => !currentLayers.has(layerID)).length,
		removed: [...currentLayers.keys()].filter((layerID) => !targetLayers.has(layerID)).length,
		changed: changedIDs.size
	};
}

function changedOrderIDs<T extends { id: string }>(
	current: readonly T[],
	target: readonly T[]
): Set<string> {
	const currentIDs = new Set(current.map((item) => item.id));
	const targetIDs = new Set(target.map((item) => item.id));
	const currentCommon = current.map((item) => item.id).filter((id) => targetIDs.has(id));
	const targetCommon = target.map((item) => item.id).filter((id) => currentIDs.has(id));
	const changed = new Set<string>();
	for (let index = 0; index < currentCommon.length; index += 1) {
		if (currentCommon[index] !== targetCommon[index]) {
			changed.add(currentCommon[index]!);
			changed.add(targetCommon[index]!);
		}
	}
	return changed;
}

function samePageProperties(current: ImageEditorPage, target: ImageEditorPage): boolean {
	return same(
		{
			name: current.name,
			background_color: current.background_color,
			background: current.background,
			preview_media_id: current.preview_media_id,
			latest_export_media_id: current.latest_export_media_id
		},
		{
			name: target.name,
			background_color: target.background_color,
			background: target.background,
			preview_media_id: target.preview_media_id,
			latest_export_media_id: target.latest_export_media_id
		}
	);
}

function hasGuides(page: ImageEditorPage): boolean {
	return Boolean(page.guides?.horizontal.length || page.guides?.vertical.length);
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, member]) => [key, canonicalValue(member)])
		);
	}
	return value;
}

function normalizeReference(value: string | undefined): string {
	return value?.trim() ?? '';
}
