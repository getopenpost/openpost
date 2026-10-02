/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- This browser executor validates MCP JSON fields before applying typed Image Editor controller actions. */
import { IMAGE_EDITOR_LIMITS, type ImageEditorTransform } from '$lib/image-editor/types';
import type { ImageEditorController } from '$lib/image-editor/editor.svelte';
import {
	EditorAgentOperationError,
	editorAuthoredRevision,
	editorCanonicalJSON,
	type EditorAgentRequest
} from './browser-relay';
import { renderImageEditorPage } from '$lib/image-editor/static-renderer';
import { encodeEditorPreview } from './preview';
import { queryMediaMetadata } from '$lib/query/media';
import type { MediaMetadataItem } from '@openpost/query-catalog';
import { getAuthenticatedMediaURL } from '$lib/media-url';
import { uploadMediaFile } from '$lib/media-upload-client';
import { cancelEditorExport, editorExportStatus, startEditorExport } from './export-jobs';
import { EDITOR_COLOR_ADJUSTMENT_RANGES } from '$lib/editor-color-grade/controls';
import {
	defaultEditorColorGradeAdjustments,
	IMAGE_COLOR_GRADE_VERSION
} from '$lib/editor-color-grade/model';
import type { ImageEditorImageAdjustments } from '$lib/image-editor/types';
import { cloneImageEditorDocument } from '$lib/image-editor/document';

interface ImageAction {
	kind: string;
	target_id?: string;
	value?: Record<string, unknown>;
}

interface ImageAgentChange {
	before: string;
	after: string;
	undone: boolean;
}

const latestAgentChanges = new WeakMap<ImageEditorController, ImageAgentChange>();

function authoredImageJSON(editor: ImageEditorController): string {
	if (!editor.document) return 'null';
	const document = cloneImageEditorDocument(editor.document);
	for (const page of document.pages) {
		delete page.preview_media_id;
		delete page.latest_export_media_id;
		for (const layer of page.layers) {
			if (layer.image && !layer.image.intrinsic_pending) delete layer.image.intrinsic_pending;
		}
	}
	return editorCanonicalJSON(document);
}

function invalid(message: string): never {
	throw new EditorAgentOperationError('invalid_operation', message);
}

function stringValue(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) invalid(`${name} is required`);
	return value;
}

function valueObject(action: ImageAction): Record<string, unknown> {
	if (!action.value || typeof action.value !== 'object' || Array.isArray(action.value))
		invalid(`${action.kind} requires a value object`);
	return action.value;
}

function activePage(editor: ImageEditorController, pageID: unknown) {
	const id = stringValue(pageID, 'page_id');
	if (id !== editor.activePageID || !editor.activePage)
		throw new EditorAgentOperationError(
			'wrong_page',
			'The requested page is not active in the editor'
		);
	return editor.activePage;
}

function activeLayer(editor: ImageEditorController, pageID: unknown, layerID: unknown) {
	const page = activePage(editor, pageID);
	const id = stringValue(layerID, 'target_id');
	const layer = page.layers.find((entry) => entry.id === id);
	if (!layer)
		throw new EditorAgentOperationError('missing_target', `Layer ${id} is not on page ${page.id}`);
	if (editor.isLayerLocked(id))
		throw new EditorAgentOperationError('locked', `Layer ${id} is locked`);
	return layer;
}

function pageLayer(editor: ImageEditorController, pageID: unknown, layerID: unknown) {
	const page = activePage(editor, pageID);
	const id = stringValue(layerID, 'target_id');
	const layer = page.layers.find((entry) => entry.id === id);
	if (!layer)
		throw new EditorAgentOperationError('missing_target', `Layer ${id} is not on page ${page.id}`);
	return layer;
}

function hexColor(value: unknown, name: string): string {
	const color = stringValue(value, name);
	if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)) invalid(`${name} must be a hex color`);
	return color;
}

function effectivelyLocked(
	layerID: string,
	layers: Array<{ id: string; parent_id?: string; locked: boolean }>
): boolean {
	let current = layers.find((layer) => layer.id === layerID);
	const visited = new Set<string>();
	while (current) {
		if (current.locked) return true;
		if (!current.parent_id || visited.has(current.parent_id)) return false;
		visited.add(current.parent_id);
		current = layers.find((layer) => layer.id === current?.parent_id);
	}
	return false;
}

function applyImageAction(
	editor: ImageEditorController,
	action: ImageAction,
	sourceMedia: Map<string, MediaMetadataItem>
): string[] {
	const value = valueObject(action);
	switch (action.kind) {
		case 'image.add': {
			activePage(editor, value.page_id);
			const mediaID = stringValue(value.media_id, 'media_id');
			const media = sourceMedia.get(mediaID);
			if (!media)
				throw new EditorAgentOperationError(
					'missing_source',
					`Media ${mediaID} was not admitted for this Workspace`
				);
			const before = new Set(editor.activePage?.layers.map((layer) => layer.id));
			editor.addImage({ id: mediaID, width: media.width, height: media.height, name: 'Image' });
			return (
				editor.activePage?.layers
					.filter((layer) => !before.has(layer.id))
					.map((layer) => layer.id) ?? []
			);
		}
		case 'text.add': {
			activePage(editor, value.page_id);
			const text = stringValue(value.text, 'text');
			const before = new Set(editor.activePage?.layers.map((layer) => layer.id));
			editor.addText(text);
			return (
				editor.activePage?.layers
					.filter((layer) => !before.has(layer.id))
					.map((layer) => layer.id) ?? []
			);
		}
		case 'shape.add': {
			activePage(editor, value.page_id);
			if (
				value.kind !== 'rectangle' &&
				value.kind !== 'rounded_rectangle' &&
				value.kind !== 'ellipse' &&
				value.kind !== 'line'
			)
				invalid('Unsupported shape kind');
			const before = new Set(editor.activePage?.layers.map((layer) => layer.id));
			editor.addShape(value.kind);
			return (
				editor.activePage?.layers
					.filter((layer) => !before.has(layer.id))
					.map((layer) => layer.id) ?? []
			);
		}
		case 'text.set': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (layer.type !== 'text') invalid(`${layer.id} is not a text layer`);
			editor.updateTextContent(layer.id, stringValue(value.text, 'text'));
			return [layer.id];
		}
		case 'text.style': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (!layer.text) invalid(`${layer.id} is not a text layer`);
			const style = { ...layer.text };
			let changes = 0;
			if (value.color !== undefined) {
				style.color = hexColor(value.color, 'color');
				if (style.runs) style.runs = style.runs.map((run) => ({ ...run, color: style.color }));
				changes++;
			}
			if (value.font_size !== undefined) {
				if (
					typeof value.font_size !== 'number' ||
					!Number.isFinite(value.font_size) ||
					value.font_size < 1 ||
					value.font_size > 1000
				)
					invalid('font_size must be from 1 to 1000');
				style.font_size = value.font_size;
				changes++;
			}
			if (value.align !== undefined) {
				if (value.align !== 'left' && value.align !== 'center' && value.align !== 'right')
					invalid('align must be left, center, or right');
				style.align = value.align;
				changes++;
			}
			if (!changes) invalid('No text style fields were provided');
			editor.updateLayer(layer.id, { text: style });
			return [layer.id];
		}
		case 'shape.style': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (!layer.shape) invalid(`${layer.id} is not a shape layer`);
			const style = { ...layer.shape };
			let changes = 0;
			if (value.fill !== undefined) {
				style.fill = hexColor(value.fill, 'fill');
				changes++;
			}
			if (value.stroke !== undefined) {
				style.stroke = hexColor(value.stroke, 'stroke');
				changes++;
			}
			if (value.stroke_width !== undefined) {
				if (
					typeof value.stroke_width !== 'number' ||
					!Number.isFinite(value.stroke_width) ||
					value.stroke_width < 0 ||
					value.stroke_width > 1000
				)
					invalid('stroke_width must be from 0 to 1000');
				style.stroke_width = value.stroke_width;
				changes++;
			}
			if (!changes) invalid('No shape style fields were provided');
			editor.updateLayer(layer.id, { shape: style });
			return [layer.id];
		}
		case 'layer.rename': {
			const layer = pageLayer(editor, value.page_id, action.target_id);
			editor.updateLayer(layer.id, { name: stringValue(value.name, 'name') });
			return [layer.id];
		}
		case 'layer.visible': {
			const layer = pageLayer(editor, value.page_id, action.target_id);
			if (typeof value.visible !== 'boolean') invalid('visible must be boolean');
			editor.updateLayer(layer.id, { visible: value.visible });
			return [layer.id];
		}
		case 'layer.duplicate': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			const before = new Set(editor.activePage?.layers.map((entry) => entry.id));
			editor.selectLayer(layer.id);
			editor.duplicateSelected();
			return (
				editor.activePage?.layers
					.filter((entry) => !before.has(entry.id))
					.map((entry) => entry.id) ?? []
			);
		}
		case 'layer.group': {
			activePage(editor, value.page_id);
			const ids = value.layer_ids;
			if (
				!Array.isArray(ids) ||
				ids.length < 2 ||
				ids.length > 20 ||
				new Set(ids).size !== ids.length
			)
				invalid('layer_ids must contain 2 to 20 distinct layers');
			for (const id of ids) activeLayer(editor, value.page_id, id);
			const before = new Set(editor.activePage?.layers.map((entry) => entry.id));
			editor.selectedLayerIDs = ids as string[];
			editor.groupSelected();
			const created =
				editor.activePage?.layers
					.filter((entry) => !before.has(entry.id))
					.map((entry) => entry.id) ?? [];
			if (created.length !== 1) invalid('Could not group the requested layers');
			return created;
		}
		case 'layer.ungroup': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (layer.type !== 'group') invalid(`${layer.id} is not a group`);
			const children =
				editor.activePage?.layers
					.filter((entry) => entry.parent_id === layer.id)
					.map((entry) => entry.id) ?? [];
			editor.selectLayer(layer.id);
			editor.ungroupSelected();
			return [layer.id, ...children];
		}
		case 'layer.align': {
			activePage(editor, value.page_id);
			const ids = value.layer_ids;
			if (
				!Array.isArray(ids) ||
				ids.length < 1 ||
				ids.length > 20 ||
				new Set(ids).size !== ids.length
			)
				invalid('layer_ids must contain 1 to 20 distinct layers');
			for (const id of ids) activeLayer(editor, value.page_id, id);
			const alignment = value.alignment;
			if (
				alignment !== 'left' &&
				alignment !== 'center_x' &&
				alignment !== 'right' &&
				alignment !== 'top' &&
				alignment !== 'center_y' &&
				alignment !== 'bottom'
			)
				invalid('Unsupported alignment');
			editor.selectedLayerIDs = ids as string[];
			editor.alignSelected(alignment);
			return ids as string[];
		}
		case 'image.crop_reset': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (!layer.image) invalid(`${layer.id} is not an image layer`);
			editor.resetImageCrop(layer.id);
			return [layer.id];
		}
		case 'grade.set': {
			const scope = stringValue(value.scope, 'scope');
			const field = stringValue(value.field, 'field');
			const range =
				field === 'blur'
					? { min: 0, max: 1 }
					: EDITOR_COLOR_ADJUSTMENT_RANGES[field as keyof typeof EDITOR_COLOR_ADJUSTMENT_RANGES];
			if (
				!range ||
				typeof value.amount !== 'number' ||
				!Number.isFinite(value.amount) ||
				value.amount < range.min ||
				value.amount > range.max
			)
				invalid('Unsupported grade field or amount outside the editor range');
			if (scope === 'layer') {
				const layer = activeLayer(editor, value.page_id, action.target_id);
				if (!layer.image || layer.image.color_grade_version !== IMAGE_COLOR_GRADE_VERSION)
					throw new EditorAgentOperationError(
						'unsupported',
						'Legacy image grades are not migrated automatically'
					);
				if (layer.image.adjustments[field as keyof ImageEditorImageAdjustments] === value.amount)
					return [layer.id];
				editor.updateLayer(layer.id, {
					image: {
						...layer.image,
						adjustments: {
							...layer.image.adjustments,
							[field]: value.amount
						}
					}
				});
				return [layer.id];
			}
			if (scope === 'page') {
				if (field === 'blur') invalid('Page grade does not support blur');
				const page = activePage(editor, value.page_id);
				if (action.target_id !== page.id) invalid('target_id must be the page ID for a page grade');
				if (
					page.color_grade?.[field as keyof typeof EDITOR_COLOR_ADJUSTMENT_RANGES] === value.amount
				)
					return [page.id];
				editor.mutate('Set page grade', (document) => {
					const target = document.pages.find((entry) => entry.id === page.id);
					if (!target) return;
					target.color_grade_version = IMAGE_COLOR_GRADE_VERSION;
					target.color_grade = {
						...defaultEditorColorGradeAdjustments(),
						...target.color_grade,
						[field]: value.amount
					};
				});
				return [page.id];
			}
			return invalid('scope must be layer or page');
		}
		case 'image.crop': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (!layer.image) invalid(`${layer.id} is not an image layer`);
			const x = value.x,
				y = value.y,
				width = value.width,
				height = value.height;
			if (
				[x, y, width, height].some(
					(amount) => typeof amount !== 'number' || !Number.isFinite(amount)
				) ||
				(x as number) < 0 ||
				(y as number) < 0 ||
				(width as number) < 0.005 ||
				(height as number) < 0.005 ||
				(x as number) + (width as number) > 1 ||
				(y as number) + (height as number) > 1
			)
				invalid(
					'Crop window must fit within the current image, using normalized values from 0 to 1'
				);
			editor.applyImageCrop(layer.id, {
				x: x as number,
				y: y as number,
				width: width as number,
				height: height as number
			});
			return [layer.id];
		}
		case 'layer.delete': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			const selected = [...editor.selectedLayerIDs];
			editor.selectLayer(layer.id);
			editor.deleteSelected();
			editor.selectedLayerIDs = selected.filter((id) =>
				editor.activePage?.layers.some((entry) => entry.id === id)
			);
			return [layer.id];
		}
		case 'layer.transform': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			const update: Partial<ImageEditorTransform> = {};
			for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
				const amount = value[key];
				if (amount === undefined) continue;
				if (typeof amount !== 'number' || !Number.isFinite(amount))
					invalid(`${key} must be a finite number`);
				if ((key === 'width' || key === 'height') && amount <= 0)
					invalid(`${key} must be positive`);
				update[key] = amount;
			}
			if (Object.keys(update).length === 0) invalid('No transform fields were provided');
			editor.updateTransform(layer.id, update);
			return [layer.id];
		}
		case 'layer.opacity': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (
				typeof value.opacity !== 'number' ||
				!Number.isFinite(value.opacity) ||
				value.opacity < 0 ||
				value.opacity > 1
			)
				invalid('opacity must be from 0 to 1');
			editor.updateLayer(layer.id, { opacity: value.opacity });
			return [layer.id];
		}
		case 'layer.reorder': {
			const layer = activeLayer(editor, value.page_id, action.target_id);
			if (
				value.direction !== 'front' &&
				value.direction !== 'forward' &&
				value.direction !== 'backward' &&
				value.direction !== 'back'
			)
				invalid('direction must be front, forward, backward, or back');
			editor.reorderLayer(layer.id, value.direction);
			return [layer.id];
		}
		case 'page.resize': {
			const page = activePage(editor, action.target_id);
			const width = value.width_px;
			const height = value.height_px;
			if (
				typeof width !== 'number' ||
				typeof height !== 'number' ||
				!Number.isInteger(width) ||
				!Number.isInteger(height) ||
				width < IMAGE_EDITOR_LIMITS.minDimension ||
				height < IMAGE_EDITOR_LIMITS.minDimension ||
				width > IMAGE_EDITOR_LIMITS.maxDimension ||
				height > IMAGE_EDITOR_LIMITS.maxDimension ||
				width * height > IMAGE_EDITOR_LIMITS.maxPixels
			)
				invalid('Page dimensions exceed editor limits');
			editor.mutate('Resize page', (document) => {
				const target = document.pages.find((candidate) => candidate.id === page.id);
				if (!target) return;
				target.width_px = width;
				target.height_px = height;
			});
			return [page.id];
		}
		case 'page.background': {
			const page = activePage(editor, action.target_id);
			const color = stringValue(value.color, 'color');
			if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)) invalid('color must be a hex color');
			editor.setPageBackground({ type: 'solid', color, opacity: 1 });
			return [page.id];
		}
		case 'page.add': {
			activePage(editor, action.target_id);
			if (editor.document?.pages.length === 35)
				invalid('The design already has the maximum number of pages');
			editor.addPage();
			return editor.activePageID ? [editor.activePageID] : [];
		}
		case 'page.duplicate': {
			activePage(editor, action.target_id);
			if (editor.document?.pages.length === 35)
				invalid('The design already has the maximum number of pages');
			editor.duplicatePage();
			return editor.activePageID ? [editor.activePageID] : [];
		}
		case 'page.delete': {
			const page = activePage(editor, action.target_id);
			if ((editor.document?.pages.length ?? 0) <= 1) invalid('Cannot delete the last page');
			editor.deletePage();
			return [page.id];
		}
		case 'page.reorder': {
			const page = activePage(editor, action.target_id);
			const index = value.index;
			if (
				typeof index !== 'number' ||
				!Number.isSafeInteger(index) ||
				index < 0 ||
				index >= (editor.document?.pages.length ?? 0)
			)
				invalid('index must name an existing zero-based page position');
			editor.reorderPage(page.id, index);
			return [page.id];
		}
		default:
			throw new EditorAgentOperationError('unsupported', `Unsupported image action ${action.kind}`);
	}
}

export async function handleImageAgentRequest(
	editor: ImageEditorController,
	request: EditorAgentRequest
): Promise<Record<string, unknown>> {
	if (!editor.document || !editor.canEdit)
		throw new EditorAgentOperationError('editor_unavailable', 'Image design is not editable');
	const startingJSON = authoredImageJSON(editor);
	const revision = await editorAuthoredRevision(JSON.parse(startingJSON));
	switch (request.operation) {
		case 'editor_context':
			return {
				project_id: editor.id,
				editor_kind: 'image',
				revision,
				active_page_id: editor.activePageID,
				selected_layer_ids: editor.selectedLayerIDs,
				save_state: editor.saveState
			};
		case 'editor_reveal': {
			const args = request.arguments;
			if (args.project_id !== editor.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError('stale_revision', 'Reveal target or revision changed');
			const pageID = stringValue(args.page_id, 'page_id');
			const page = editor.document.pages.find((entry) => entry.id === pageID);
			if (!page)
				throw new EditorAgentOperationError('missing_target', `Page ${pageID} does not exist`);
			if (args.layer_id !== undefined && !page.layers.some((entry) => entry.id === args.layer_id))
				throw new EditorAgentOperationError(
					'missing_target',
					`Layer ${args.layer_id} does not exist on page ${pageID}`
				);
			editor.activePageID = pageID;
			editor.selectedLayerIDs = [];
			if (typeof args.layer_id === 'string') editor.selectLayer(args.layer_id);
			editor.fitZoom();
			return {
				project_id: editor.id,
				revision,
				active_page_id: pageID,
				selected_layer_id: args.layer_id ?? null,
				view_state_only: true
			};
		}
		case 'editor_history_inspect': {
			const change = latestAgentChanges.get(editor);
			return {
				project_id: editor.id,
				revision,
				can_undo_agent_change: Boolean(
					change && !change.undone && change.after === revision && editor.canUndo
				),
				can_redo_agent_change: Boolean(
					change && change.undone && change.before === revision && editor.canRedo
				),
				latest_agent_change: change
					? { before_revision: change.before, after_revision: change.after, undone: change.undone }
					: null
			};
		}
		case 'preview_render': {
			const args = request.arguments;
			if (args.project_id !== editor.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError('stale_revision', 'Preview target or revision changed');
			const pageID = stringValue(args.page_id, 'page_id');
			const pageIndex = editor.document.pages.findIndex((entry) => entry.id === pageID);
			if (pageIndex < 0)
				throw new EditorAgentOperationError('missing_target', `Page ${pageID} does not exist`);
			const document = JSON.parse(startingJSON) as NonNullable<typeof editor.document>;
			const rendered = await renderImageEditorPage(document, document.pages[pageIndex]!, pageIndex);
			if (authoredImageJSON(editor) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Design changed while rendering the preview'
				);
			return {
				project_id: editor.id,
				page_id: pageID,
				revision,
				provenance: 'static export renderer at preview resolution',
				...(await encodeEditorPreview(rendered.blob))
			};
		}
		case 'export_start': {
			const args = request.arguments;
			if (args.project_id !== editor.id || args.expected_revision !== revision)
				throw new EditorAgentOperationError('stale_revision', 'Export target or revision changed');
			if (args.format !== 'png' && args.format !== 'jpeg' && args.format !== 'webp')
				invalid('Image export format must be png, jpeg, or webp');
			const pageID = stringValue(args.page_id, 'page_id');
			const pageIndex = editor.document.pages.findIndex((page) => page.id === pageID);
			if (pageIndex < 0)
				throw new EditorAgentOperationError('missing_target', `Page ${pageID} does not exist`);
			const document = JSON.parse(startingJSON) as NonNullable<typeof editor.document>;
			document.export_defaults.format = args.format;
			const projectID = editor.id;
			const workspaceID = editor.workspaceID;
			return startEditorExport(projectID, revision, async (signal, progress) => {
				const rendered = await renderImageEditorPage(
					document,
					document.pages[pageIndex]!,
					pageIndex,
					signal
				);
				progress(0.75, 'uploading');
				const uploaded = await uploadMediaFile({
					workspaceId: workspaceID,
					file: new File([rendered.blob], rendered.filename, { type: rendered.blob.type }),
					source: 'image_editor_export',
					designDocumentId: projectID,
					designPageId: pageID,
					retentionClass: 'library',
					signal
				});
				return {
					project_id: projectID,
					page_id: pageID,
					revision,
					media_id: uploaded.id,
					file_name: rendered.filename,
					file_size: rendered.blob.size,
					storage: 'workspace_media'
				};
			});
		}
		case 'export_status':
		case 'export_cancel': {
			const args = request.arguments;
			if (args.project_id !== editor.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Export design differs from the connected editor'
				);
			const exportID = stringValue(args.export_id, 'export_id');
			const job =
				request.operation === 'export_cancel'
					? cancelEditorExport(editor.id, exportID)
					: editorExportStatus(editor.id, exportID);
			if (!job)
				throw new EditorAgentOperationError(
					'missing_job',
					'Export job is unavailable in this browser session'
				);
			return { ...job };
		}
		case 'editor_history_undo':
		case 'editor_history_redo': {
			const args = request.arguments;
			if (args.project_id !== editor.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Design changed while request was in flight'
				);
			if (args.expected_revision !== revision || authoredImageJSON(editor) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Design changed before history operation'
				);
			const change = latestAgentChanges.get(editor);
			const undo = request.operation === 'editor_history_undo';
			if (
				!change ||
				(undo && (change.undone || change.after !== revision || !editor.canUndo)) ||
				(!undo && (!change.undone || change.before !== revision || !editor.canRedo))
			)
				throw new EditorAgentOperationError(
					'history_conflict',
					'A later change prevents this agent history operation'
				);
			if (undo) editor.undo();
			else editor.redo();
			change.undone = undo;
			const nextRevision = await editorAuthoredRevision(JSON.parse(authoredImageJSON(editor)));
			return {
				status: undo ? 'undone' : 'redone',
				project_id: editor.id,
				before_revision: revision,
				after_revision: nextRevision,
				persistence_state: editor.saveState
			};
		}
		case 'image_inspect': {
			const pageID = request.arguments.page_id ?? editor.activePageID;
			if (typeof pageID !== 'string' || !pageID) invalid('page_id is required');
			const page = editor.document.pages.find((entry) => entry.id === pageID);
			if (!page)
				throw new EditorAgentOperationError('missing_target', `Page ${pageID} does not exist`);
			const layerID = request.arguments.layer_id;
			if (layerID !== undefined && (typeof layerID !== 'string' || !layerID))
				invalid('layer_id must be a stable layer ID');
			const selected = layerID ? page.layers.filter((layer) => layer.id === layerID) : page.layers;
			if (layerID && selected.length === 0)
				throw new EditorAgentOperationError(
					'missing_target',
					`Layer ${layerID} does not exist on page ${pageID}`
				);
			const offset = request.arguments.offset === undefined ? 0 : Number(request.arguments.offset);
			const limit = request.arguments.limit === undefined ? 100 : Number(request.arguments.limit);
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				!Number.isSafeInteger(limit) ||
				limit < 1 ||
				limit > 100
			)
				invalid('offset and limit must describe a page of at most 100 layers');
			return {
				project_id: editor.id,
				revision,
				title: editor.document.title,
				page_summaries: editor.document.pages.map((entry) => ({
					id: entry.id,
					name: entry.name,
					layer_count: entry.layers.length
				})),
				pages: [
					{
						id: page.id,
						name: page.name,
						width_px: page.width_px ?? editor.document?.width_px,
						height_px: page.height_px ?? editor.document?.height_px,
						background_color: page.background_color,
						layer_count: selected.length,
						offset,
						has_more: offset + limit < selected.length,
						layers: selected.slice(offset, offset + limit).map((layer) =>
							layerID && JSON.stringify(layer).length <= 128_000
								? layer
								: {
										id: layer.id,
										name: layer.name,
										type: layer.type,
										parent_id: layer.parent_id,
										visible: layer.visible,
										locked: effectivelyLocked(layer.id, page.layers),
										opacity: layer.opacity,
										transform: layer.transform,
										text: layer.text?.text,
										media_id: layer.image?.media_id
									}
						),
						effective_lock: layerID ? effectivelyLocked(layerID, page.layers) : undefined,
						full_layer_truncated: layerID ? JSON.stringify(selected[0]).length > 128_000 : undefined
					}
				]
			};
		}
		case 'image_edit': {
			const args = request.arguments;
			if (args.project_id !== editor.id)
				throw new EditorAgentOperationError(
					'wrong_project',
					'Design changed while request was in flight'
				);
			if (args.expected_revision !== revision)
				throw new EditorAgentOperationError(
					'stale_revision',
					`Expected ${args.expected_revision}, current revision is ${revision}`
				);
			if (authoredImageJSON(editor) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'The design changed while checking the revision'
				);
			if (!Array.isArray(args.actions) || args.actions.length < 1 || args.actions.length > 10)
				invalid('Image edits accept 1 to 10 actions per request');
			const sourceMedia = new Map<string, MediaMetadataItem>();
			const mediaIDs = [
				...new Set(
					(args.actions as ImageAction[])
						.filter((action) => action.kind === 'image.add')
						.map((action) => stringValue(action.value?.media_id, 'media_id'))
				)
			];
			if (mediaIDs.length) {
				const available = await queryMediaMetadata(editor.workspaceID, mediaIDs, { force: true });
				for (const media of available.media) {
					if (!media.mime_type?.startsWith('image/')) continue;
					if (media.width && media.height) {
						sourceMedia.set(media.id, media);
						continue;
					}
					const response = await fetch(getAuthenticatedMediaURL(`/media/${media.id}`), {
						credentials: 'include'
					});
					if (!response.ok)
						throw new EditorAgentOperationError(
							'missing_source',
							`Image media ${media.id} cannot be decoded`
						);
					const bitmap = await createImageBitmap(await response.blob());
					try {
						sourceMedia.set(media.id, { ...media, width: bitmap.width, height: bitmap.height });
					} finally {
						bitmap.close();
					}
				}
				for (const mediaID of mediaIDs) {
					if (!sourceMedia.has(mediaID))
						throw new EditorAgentOperationError(
							'missing_source',
							`Image media ${mediaID} is unavailable in this Workspace`
						);
				}
			}
			if (authoredImageJSON(editor) !== startingJSON)
				throw new EditorAgentOperationError(
					'stale_revision',
					'Design changed while resolving media'
				);
			let changedIDs: string[];
			try {
				changedIDs = editor.runAtomicEdits('Editor agent edit', () =>
					(args.actions as ImageAction[]).flatMap((action) =>
						applyImageAction(editor, action, sourceMedia)
					)
				);
			} catch (error) {
				if (error instanceof EditorAgentOperationError) throw error;
				throw new EditorAgentOperationError(
					'editor_busy',
					error instanceof Error ? error.message : 'Image Editor is busy'
				);
			}
			const nextRevision = await editorAuthoredRevision(JSON.parse(authoredImageJSON(editor)));
			if (nextRevision !== revision)
				latestAgentChanges.set(editor, { before: revision, after: nextRevision, undone: false });
			return {
				status: nextRevision === revision ? 'no_change' : 'committed',
				project_id: editor.id,
				before_revision: revision,
				after_revision: nextRevision,
				changed_ids: changedIDs,
				preview_state: 'pending',
				persistence_state: nextRevision === revision ? editor.saveState : 'pending'
			};
		}
		default:
			throw new EditorAgentOperationError(
				'unsupported',
				`Unsupported image request ${request.operation}`
			);
	}
}
