import {
	cloneImageEditorDocument,
	defaultImageAdjustments,
	defaultTransform,
	imageEditorID
} from './document';
import type { ImageEditorDocument, ImageEditorLayer } from './types';
import { defaultLayerEffects } from './effects';

export type ImageEditorRasterOperation =
	| 'rasterize'
	| 'merge_down'
	| 'merge_selected'
	| 'flatten_page';

export interface ImageEditorRasterPlan {
	sourceDocument: ImageEditorDocument;
	pageID: string;
	kind: ImageEditorRasterOperation;
	sourceIDs: string[];
	anchorID: string;
	parentID?: string;
	name: string;
}

/** An isolated bake cannot reproduce blends that depend on an unselected backdrop. */
export function prepareRasterOperation(
	document: ImageEditorDocument,
	pageID: string,
	selectedIDs: readonly string[],
	kind: ImageEditorRasterOperation
): ImageEditorRasterPlan | null {
	const page = document.pages.find((page) => page.id === pageID);
	if (!page || page.layers.length === 0) return null;
	const selected = new Set(selectedIDs);
	const byID = new Map(page.layers.map((layer) => [layer.id, layer]));
	function ancestors(layer: ImageEditorLayer): ImageEditorLayer[] {
		const result: ImageEditorLayer[] = [];
		const visited = new Set<string>([layer.id]);
		let parent = layer.parent_id ? byID.get(layer.parent_id) : undefined;
		while (parent && !visited.has(parent.id)) {
			visited.add(parent.id);
			result.push(parent);
			parent = parent.parent_id ? byID.get(parent.parent_id) : undefined;
		}
		return result;
	}
	let roots = page.layers.filter(
		(layer) => selected.has(layer.id) && !ancestors(layer).some((parent) => selected.has(parent.id))
	);
	if (kind === 'flatten_page') roots = page.layers.filter((layer) => !layer.parent_id);
	else {
		if (roots.length === 0 || roots.some((layer) => layer.parent_id !== roots[0].parent_id))
			return null;
		if ((kind === 'rasterize' || kind === 'merge_down') && roots.length !== 1) return null;
		const siblings = page.layers.filter((layer) => layer.parent_id === roots[0].parent_id);
		if (kind === 'merge_down') {
			const index = siblings.indexOf(roots[0]);
			if (index < 1) return null;
			roots = [siblings[index - 1], roots[0]];
		}
		if (kind === 'merge_selected' && roots.length < 2) return null;
		const first = siblings.indexOf(roots[0]);
		if (roots.some((layer, index) => siblings[first + index] !== layer)) return null;
	}
	const rootIDs = new Set(roots.map((layer) => layer.id));
	const sourceLayers =
		kind === 'flatten_page'
			? page.layers
			: page.layers.filter(
					(layer) =>
						rootIDs.has(layer.id) || ancestors(layer).some((parent) => rootIDs.has(parent.id))
				);
	if (
		sourceLayers.some((layer) => layer.locked || ancestors(layer).some((parent) => parent.locked))
	)
		return null;
	if (
		kind !== 'flatten_page' &&
		sourceLayers.some(
			(layer) =>
				!layer.visible ||
				ancestors(layer).some((parent) => !parent.visible) ||
				(layer.effects?.blend_mode ?? 'normal') !== 'normal'
		)
	)
		return null;
	if (!sourceLayers.some((layer) => layer.type !== 'group')) return null;
	const sourceIDs = sourceLayers.map((layer) => layer.id);
	return {
		sourceDocument: document,
		pageID,
		kind,
		sourceIDs,
		anchorID: roots.at(-1)!.id,
		parentID: kind === 'flatten_page' ? undefined : roots[0].parent_id,
		name: kind === 'flatten_page' ? page.name : roots.at(-1)!.name
	};
}

export function rasterRenderDocument(plan: ImageEditorRasterPlan): ImageEditorDocument {
	const sourceSet = new Set(plan.sourceIDs);
	const renderDocument = cloneImageEditorDocument(plan.sourceDocument);
	const renderPage = renderDocument.pages.find((page) => page.id === plan.pageID)!;
	renderDocument.pages = [renderPage];
	renderDocument.export_defaults = { format: 'png', quality: 1, matte_color: '#ffffff' };
	if (plan.kind !== 'flatten_page') {
		renderPage.layers = renderPage.layers.filter((layer) => sourceSet.has(layer.id));
		for (const layer of renderPage.layers) {
			if (layer.parent_id && !sourceSet.has(layer.parent_id)) delete layer.parent_id;
		}
		renderPage.background = { type: 'transparent', opacity: 1 };
		renderPage.background_color = '#00000000';
		delete renderPage.color_grade;
		delete renderPage.color_grade_version;
	}
	return renderDocument;
}

export function rasterResultLayer(plan: ImageEditorRasterPlan, mediaID: string): ImageEditorLayer {
	const { width_px: width, height_px: height } = plan.sourceDocument;
	return {
		id: imageEditorID('layer'),
		type: 'image',
		name: plan.name,
		parent_id: plan.parentID,
		visible: true,
		locked: false,
		opacity: 1,
		effects: defaultLayerEffects(),
		transform: defaultTransform(width, height),
		image: {
			media_id: mediaID,
			source_width: width,
			source_height: height,
			fit: 'stretch',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: defaultImageAdjustments(),
			color_grade_version: 1
		}
	};
}
