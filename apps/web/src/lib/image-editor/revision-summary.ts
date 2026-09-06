import type { ImageEditorDocument, ImageEditorLayer, ImageEditorPage } from './types';
import {
	changedRevisionOrderIDs,
	compareRevisionItems,
	sameRevisionValue,
	type RevisionCollectionChanges
} from '$lib/revision-comparison';

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
		if (!sameRevisionValue(currentPage.guides, targetPage.guides)) guidePagesChanged += 1;
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
	for (const pageID of changedRevisionOrderIDs(current.pages, target.pages)) {
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
		exportSettingsChanged: !sameRevisionValue(current.export_defaults, target.export_defaults),
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
	if (!imageEditorRevisionHasChanges(changes) && !sameRevisionValue(current, target)) {
		changes.pagesChanged = 1;
	}
	return changes;
}

export function imageEditorRevisionHasChanges(changes: ImageEditorRevisionChanges): boolean {
	return Object.values(changes).some((value) => value === true || Number(value) > 0);
}

function compareLayers(
	current: ImageEditorLayer[],
	target: ImageEditorLayer[]
): RevisionCollectionChanges {
	return compareRevisionItems(current, target);
}

function samePageProperties(current: ImageEditorPage, target: ImageEditorPage): boolean {
	return sameRevisionValue(
		{
			name: current.name,
			background_color: current.background_color,
			background: current.background,
			color_grade_version: current.color_grade_version,
			color_grade: current.color_grade,
			preview_media_id: current.preview_media_id,
			latest_export_media_id: current.latest_export_media_id
		},
		{
			name: target.name,
			background_color: target.background_color,
			background: target.background,
			color_grade_version: target.color_grade_version,
			color_grade: target.color_grade,
			preview_media_id: target.preview_media_id,
			latest_export_media_id: target.latest_export_media_id
		}
	);
}

function hasGuides(page: ImageEditorPage): boolean {
	return Boolean(page.guides?.horizontal.length || page.guides?.vertical.length);
}

function normalizeReference(value: string | undefined): string {
	return value?.trim() ?? '';
}
