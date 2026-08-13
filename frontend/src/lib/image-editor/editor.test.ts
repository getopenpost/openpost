import { describe, expect, it } from 'vitest';
import { defaultImageAdjustments } from './document';
import { ImageEditorController } from './editor.svelte';
import type { ImageEditorDocumentResponse, ImageEditorLayer } from './types';

function layer(id: string, x: number): ImageEditorLayer {
	return {
		id,
		type: 'shape',
		name: id,
		visible: true,
		locked: false,
		opacity: 1,
		transform: {
			x,
			y: 10,
			width: 80,
			height: 80,
			rotation: 0,
			flip_x: false,
			flip_y: false
		},
		shape: {
			kind: 'rectangle',
			fill: '#f97316',
			stroke: '#000000',
			stroke_width: 0,
			radius: 0
		}
	};
}

function response(): ImageEditorDocumentResponse {
	return {
		id: 'design',
		workspace_id: 'workspace',
		created_by_id: 'user',
		revision: 1,
		can_edit: true,
		created_at: '2026-07-25T00:00:00Z',
		updated_at: '2026-07-25T00:00:00Z',
		document: {
			schema_version: 1,
			title: 'Selection test',
			preset_key: 'custom',
			width_px: 1080,
			height_px: 1080,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 0.92, matte_color: '#ffffff' },
			pages: [
				{
					id: 'page',
					name: 'Page 1',
					background_color: '#ffffff',
					layers: [layer('back', 10), layer('middle', 110), layer('front', 210)]
				}
			]
		}
	};
}

describe('OpenPost Image Editor editor layer interactions', () => {
	it('adds, moves, removes, and undoes page guides as document mutations', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addGuide('vertical', 120);
		expect(editor.activePage?.guides?.vertical).toEqual([120]);
		editor.updateGuide('vertical', 0, 180);
		expect(editor.activePage?.guides?.vertical).toEqual([180]);
		editor.removeGuide('vertical', 0);
		expect(editor.activePage?.guides?.vertical).toEqual([]);

		editor.undo();
		expect(editor.activePage?.guides?.vertical).toEqual([180]);
	});

	it('restores the active page, selection, tool, zoom, and pan with history', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');
		editor.activeTool = 'pencil';
		editor.zoom = 0.75;
		editor.panX = 42;
		editor.panY = -18;

		editor.addPage();
		const addedPageID = editor.activePageID;
		editor.activeTool = 'gradient';
		editor.zoom = 0.5;
		editor.panX = 8;
		editor.panY = 12;

		editor.undo();
		expect(editor.activePageID).toBe('page');
		expect(editor.selectedLayerIDs).toEqual(['front']);
		expect(editor.activeTool).toBe('pencil');
		expect(editor.zoom).toBe(0.75);
		expect(editor.panX).toBe(42);
		expect(editor.panY).toBe(-18);

		editor.redo();
		expect(editor.activePageID).toBe(addedPageID);
		expect(editor.selectedLayerIDs).toEqual([]);
		expect(editor.activeTool).toBe('gradient');
		expect(editor.zoom).toBe(0.5);
		expect(editor.panX).toBe(8);
		expect(editor.panY).toBe(12);
	});

	it('does not dirty history or emit changes for a no-op mutation', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		let changes = 0;
		editor.onChange(() => changes++);

		editor.mutate('No-op', () => undefined);

		expect(changes).toBe(0);
		expect(editor.canUndo).toBe(false);
		expect(editor.saveState).toBe('saved');
	});

	it('keeps locked layers and selects the nearest editable sibling after deletion', () => {
		const editor = new ImageEditorController();
		const initial = response();
		initial.document.pages[0].layers[1].locked = true;
		editor.load(initial);

		editor.selectLayer('middle');
		editor.deleteSelected();
		expect(editor.activePage?.layers.map((item) => item.id)).toContain('middle');

		editor.selectLayer('front');
		editor.deleteSelected();
		expect(editor.activePage?.layers.map((item) => item.id)).toEqual(['back', 'middle']);
		expect(editor.selectedLayerIDs).toEqual(['back']);
	});

	it('applies sampled colors to transient paint state or selected layer properties', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.applySampledColor('#0ea5e9', 128);
		expect(editor.paintColor).toBe('#0ea5e9');
		expect(editor.paintOpacity).toBeCloseTo(128 / 255);
		expect(editor.canUndo).toBe(false);

		editor.selectLayer('front');
		editor.eyedropperTarget = 'selected_fill';
		editor.applySampledColor('#dc2626', 128);
		expect(editor.selectedLayers[0].shape?.fill).toBe('#dc262680');
		expect(editor.canUndo).toBe(true);

		editor.undo();
		expect(editor.selectedLayers[0].shape?.fill).toBe('#f97316');
	});

	it('applies a brand text style snapshot to every selected compatible layer', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addText();
		const first = editor.selectedLayers[0];
		editor.addText();
		const second = editor.selectedLayers[0];
		editor.selectLayer(first.id);
		editor.selectLayer(second.id, 'toggle');

		editor.applyBrandTextStyle({
			id: 'heading',
			name: 'Heading',
			font_family: 'Brand Sans',
			font_asset_id: 'font-1',
			font_weight: 800,
			font_style: 'italic',
			font_size: 72,
			color: '#7c3aed',
			line_height: 1.2,
			letter_spacing: 2
		});

		for (const layer of editor.selectedLayers) {
			expect(layer.text).toMatchObject({
				font_family: 'Brand Sans',
				font_asset_id: 'font-1',
				font_weight: 800,
				font_style: 'italic',
				font_size: 72,
				color: '#7c3aed',
				line_height: 1.2,
				letter_spacing: 2
			});
		}
		expect(editor.canUndo).toBe(true);
	});

	it('supports native range selection in visual layer order', () => {
		const editor = new ImageEditorController();
		editor.load(response());

		editor.selectLayer('front');
		editor.selectLayer('back', 'range');

		expect(new Set(editor.selectedLayerIDs)).toEqual(new Set(['front', 'middle', 'back']));
	});

	it('keeps grouped children nested and deletes a selected group as one unit', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');
		editor.selectLayer('middle', 'toggle');

		editor.groupSelected();

		const group = editor.selectedLayers[0];
		expect(group.type).toBe('group');
		expect(
			editor.activePage?.layers
				.filter((candidate) => candidate.parent_id === group.id)
				.map((candidate) => candidate.id)
		).toEqual(expect.arrayContaining(['front', 'middle']));

		editor.deleteSelected();

		expect(editor.activePage?.layers.map((candidate) => candidate.id)).toEqual(['back']);
	});

	it('preserves nested group ownership and flipped descendants through transforms and duplication', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');
		editor.selectLayer('middle', 'toggle');
		editor.groupSelected();
		const innerID = editor.selectedLayerIDs[0];
		editor.selectLayer('back', 'toggle');
		editor.groupSelected();
		const outerID = editor.selectedLayerIDs[0];
		const outer = editor.selectedLayers[0];

		editor.updateTransform(outerID, {
			width: outer.transform.width * 1.5,
			flip_x: true,
			rotation: 15
		});

		const transformed = editor.activePage?.layers ?? [];
		expect(transformed.find((item) => item.id === innerID)?.parent_id).toBe(outerID);
		expect(transformed.find((item) => item.id === 'front')?.parent_id).toBe(innerID);
		expect(transformed.find((item) => item.id === 'front')?.transform.flip_x).toBe(true);
		expect(transformed.find((item) => item.id === 'middle')?.transform.rotation).toBe(15);

		editor.duplicateSelected();
		const duplicateOuterID = editor.selectedLayerIDs[0];
		const duplicateIDs = new Set(
			(editor.activePage?.layers ?? [])
				.filter((item) => item.id === duplicateOuterID || item.parent_id === duplicateOuterID)
				.map((item) => item.id)
		);
		const duplicateInner = (editor.activePage?.layers ?? []).find(
			(item) => item.parent_id === duplicateOuterID && item.type === 'group'
		);
		expect(duplicateInner).toBeTruthy();
		expect(
			(editor.activePage?.layers ?? []).filter((item) => item.parent_id === duplicateInner?.id)
		).toHaveLength(2);
		expect(duplicateIDs.has(innerID)).toBe(false);
	});

	it('reparents nested layers without cycles and restores the move through history', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');
		editor.selectLayer('middle', 'toggle');
		editor.groupSelected();
		const groupID = editor.selectedLayerIDs[0];

		expect(editor.groupDestinationsForLayer('back').map((layer) => layer.id)).toContain(groupID);
		expect(editor.moveLayerToGroup('back', groupID)).toBe(true);
		expect(editor.activePage?.layers.find((layer) => layer.id === 'back')?.parent_id).toBe(groupID);
		expect(editor.moveLayerToGroup(groupID, 'back')).toBe(false);

		editor.updateLayer(groupID, { locked: true });
		expect(editor.moveLayerOutOfGroup('back')).toBe(false);
		editor.updateLayer(groupID, { locked: false });
		expect(editor.moveLayerOutOfGroup('back')).toBe(true);
		expect(
			editor.activePage?.layers.find((layer) => layer.id === 'back')?.parent_id
		).toBeUndefined();

		editor.undo();
		expect(editor.activePage?.layers.find((layer) => layer.id === 'back')?.parent_id).toBe(groupID);
		expect(editor.selectedLayerIDs).toEqual(['back']);
	});

	it('applies absolute mixed transforms to unlocked selected roots with partial feedback', () => {
		const editor = new ImageEditorController();
		const initial = response();
		initial.document.pages[0].layers[1].locked = true;
		editor.load(initial);
		editor.selectLayer('back');
		editor.selectLayer('middle', 'toggle');
		editor.selectLayer('front', 'toggle');

		const result = editor.updateSelectedTransform('width', 160, true);

		expect(result).toEqual({ applied: 2, skippedLocked: 1, skippedUnsupported: 0 });
		expect(editor.activePage?.layers.find((item) => item.id === 'back')?.transform).toMatchObject({
			width: 160,
			height: 160
		});
		expect(editor.activePage?.layers.find((item) => item.id === 'middle')?.transform.width).toBe(
			80
		);
		expect(editor.activePage?.layers.find((item) => item.id === 'front')?.transform.width).toBe(
			160
		);
		expect(editor.undoLabel).toBe('Transform layers');
	});

	it('adds persistent pencil and bucket paint layers above the active layer', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');
		editor.paintColor = '#0ea5e9';
		editor.pencilSize = 8;

		editor.addPencilStroke([
			{ x: 220, y: 30 },
			{ x: 280, y: 70 }
		]);

		const pencil = editor.activePage?.layers.at(-1);
		expect(pencil?.type).toBe('paint');
		expect(pencil?.paint?.kind).toBe('fill');
		expect(pencil?.paint?.color).toBe('#0ea5e9');

		const mask = new Uint8Array(1080 * 1080);
		mask.fill(1, 10 * 1080 + 20, 10 * 1080 + 40);
		editor.addPaintFill(mask);

		const bucket = editor.activePage?.layers.at(-1);
		expect(bucket?.type).toBe('paint');
		expect(bucket?.paint?.kind).toBe('fill');
		expect(bucket?.paint?.spans).toEqual([{ x: 0, y: 0, width: 20 }]);
	});

	it('restores a non-destructively erased image in one undoable command', () => {
		const editor = new ImageEditorController();
		const initial = response();
		initial.document.pages[0].layers.push({
			id: 'image',
			type: 'image',
			name: 'Image',
			visible: true,
			locked: false,
			opacity: 1,
			transform: {
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				rotation: 0,
				flip_x: false,
				flip_y: false
			},
			image: {
				media_id: 'media',
				source_width: 100,
				source_height: 100,
				fit: 'cover',
				crop: { x: 0, y: 0, width: 1, height: 1 },
				adjustments: defaultImageAdjustments()
			},
			erase_mask: {
				source_width: 100,
				source_height: 100,
				strokes: [{ size: 12, points: [{ x: 20, y: 20 }] }],
				spans: []
			}
		});
		editor.load(initial);

		editor.restoreImageEraseMask('image');

		expect(editor.activePage?.layers.at(-1)?.erase_mask).toBeUndefined();
		expect(editor.undoLabel).toBe('Restore erased image areas');
		editor.undo();
		expect(editor.activePage?.layers.at(-1)?.erase_mask?.strokes).toHaveLength(1);
	});

	it('promotes and deletes selected paint pixels without flattening the source layer', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		const mask = new Uint8Array(1080 * 1080);
		mask.fill(1, 10 * 1080 + 20, 10 * 1080 + 40);
		editor.addPaintFill(mask);
		const paint = editor.selectedLayers[0];
		editor.pixelSelection = {
			width: 1080,
			height: 1080,
			data: mask,
			targetLayerIDs: [paint.id]
		};

		expect(
			editor.commitPixelSelectionContent('promote', [
				{ id: paint.id, width: 20, height: 1, data: new Uint8Array(20).fill(1, 0, 10) }
			])
		).toBe(true);
		expect(editor.selectedLayers[0].paint?.spans).toEqual([{ x: 0, y: 0, width: 10 }]);
		expect(editor.activePage?.layers.find((layer) => layer.id === paint.id)?.paint?.spans).toEqual([
			{ x: 0, y: 0, width: 20 }
		]);

		editor.undo();
		editor.selectLayer(paint.id);
		editor.pixelSelection = {
			width: 1080,
			height: 1080,
			data: mask,
			targetLayerIDs: [paint.id]
		};
		editor.commitPixelSelectionContent('delete', [
			{ id: paint.id, width: 20, height: 1, data: new Uint8Array(20).fill(1, 0, 10) }
		]);
		expect(editor.selectedLayers[0].paint?.spans).toEqual([{ x: 10, y: 0, width: 10 }]);
	});

	it('moves cut pixels as a floating selection and commits one undoable command', () => {
		const editor = new ImageEditorController();
		const initial = response();
		initial.document.pages[0].layers = [
			{
				id: 'paint',
				type: 'paint',
				name: 'Paint',
				visible: true,
				locked: false,
				opacity: 1,
				transform: {
					x: 20,
					y: 10,
					width: 20,
					height: 1,
					rotation: 0,
					flip_x: false,
					flip_y: false
				},
				paint: {
					kind: 'fill',
					color: '#f97316',
					size: 1,
					opacity: 1,
					source_width: 20,
					source_height: 1,
					points: [],
					spans: [{ x: 0, y: 0, width: 20 }]
				}
			}
		];
		editor.load(initial);
		editor.selectLayer('paint');
		const mask = new Uint8Array(1080 * 1080);
		mask.fill(1, 10 * 1080 + 20, 10 * 1080 + 30);
		editor.pixelSelection = {
			width: 1080,
			height: 1080,
			data: mask,
			targetLayerIDs: ['paint']
		};

		expect(
			editor.beginFloatingPixelSelection('cut', [
				{ id: 'paint', width: 20, height: 1, data: new Uint8Array(20).fill(1, 0, 10) }
			])
		).toBe(true);
		expect(editor.floatingPixelSelection?.mode).toBe('cut');
		expect(editor.activePage?.layers.find((layer) => layer.id === 'paint')?.paint?.spans).toEqual([
			{ x: 10, y: 0, width: 10 }
		]);
		const floatingID = editor.floatingPixelSelection?.layerIDs[0] ?? '';
		expect(
			editor.activePage?.layers.find((layer) => layer.id === floatingID)?.transform
		).toMatchObject({
			x: 20,
			y: 10
		});

		editor.translateFloatingPixelSelection(7, 4);
		editor.finishFloatingPixelSelectionMove();
		expect(
			editor.activePage?.layers.find((layer) => layer.id === floatingID)?.transform
		).toMatchObject({
			x: 27,
			y: 14
		});
		expect(editor.commitFloatingPixelSelection()).toBe(true);
		expect(editor.pixelSelection).toBeNull();
		expect(editor.undoLabel).toBe('Cut selected pixels');

		editor.undo();
		expect(editor.activePage?.layers).toHaveLength(1);
		expect(editor.activePage?.layers[0].paint?.spans).toEqual([{ x: 0, y: 0, width: 20 }]);
		expect(editor.canUndo).toBe(false);
		editor.redo();
		expect(editor.activePage?.layers).toHaveLength(2);
		expect(
			editor.activePage?.layers.find((layer) => layer.id === floatingID)?.transform
		).toMatchObject({
			x: 27,
			y: 14
		});
	});

	it('cancels a floating copy exactly and extracts selected pixels without mutating', () => {
		const editor = new ImageEditorController();
		const initial = response();
		const paint: ImageEditorLayer = {
			id: 'paint',
			type: 'paint',
			name: 'Paint',
			visible: true,
			locked: false,
			opacity: 1,
			transform: {
				x: 20,
				y: 10,
				width: 20,
				height: 1,
				rotation: 0,
				flip_x: false,
				flip_y: false
			},
			paint: {
				kind: 'fill',
				color: '#f97316',
				size: 1,
				opacity: 1,
				source_width: 20,
				source_height: 1,
				points: [],
				spans: [{ x: 0, y: 0, width: 20 }]
			}
		};
		initial.document.pages[0].layers = [paint];
		editor.load(initial);
		editor.selectLayer('paint');
		const mask = new Uint8Array(1080 * 1080);
		mask.fill(1, 10 * 1080 + 20, 10 * 1080 + 30);
		editor.pixelSelection = {
			width: 1080,
			height: 1080,
			data: mask,
			targetLayerIDs: ['paint']
		};
		const projection = {
			id: 'paint',
			width: 20,
			height: 1,
			data: new Uint8Array(20).fill(1, 0, 10)
		};
		const before = structuredClone(editor.document);

		const copied = editor.extractPixelSelectionLayers([projection]);
		expect(copied).toHaveLength(1);
		expect(copied[0].paint?.spans).toEqual([{ x: 0, y: 0, width: 10 }]);
		expect(editor.document).toEqual(before);

		editor.beginFloatingPixelSelection('promote', [projection]);
		editor.translateFloatingPixelSelection(8, 3);
		expect(editor.cancelFloatingPixelSelection()).toBe(true);
		expect(editor.document).toEqual(before);
		expect(editor.pixelSelection?.data.byteLength).toBe(mask.byteLength);
		expect(editor.pixelSelection?.data.some((value, index) => value !== mask[index])).toBe(false);
		expect(editor.selectedLayerIDs).toEqual(['paint']);
		expect(editor.canUndo).toBe(false);
	});

	it('resizes, rotates, and duplicates floating pixels before one commit', () => {
		const editor = new ImageEditorController();
		const initial = response();
		const paint: ImageEditorLayer = {
			...layer('paint', 20),
			type: 'paint',
			transform: { ...layer('paint', 20).transform, y: 10, width: 20, height: 10 },
			shape: undefined,
			paint: {
				kind: 'fill',
				color: '#f97316',
				size: 1,
				opacity: 1,
				source_width: 20,
				source_height: 10,
				points: [],
				spans: Array.from({ length: 10 }, (_, y) => ({ x: 0, y, width: 20 }))
			}
		};
		initial.document.pages[0].layers = [paint];
		editor.load(initial);
		editor.selectLayer('paint');
		const mask = new Uint8Array(1080 * 1080);
		for (let y = 10; y < 20; y++) mask.fill(1, y * 1080 + 20, y * 1080 + 40);
		editor.pixelSelection = {
			width: 1080,
			height: 1080,
			data: mask,
			targetLayerIDs: ['paint']
		};
		expect(
			editor.beginFloatingPixelSelection('promote', [
				{ id: 'paint', width: 20, height: 10, data: new Uint8Array(200).fill(1) }
			])
		).toBe(true);
		const floatingID = editor.floatingPixelSelection?.layerIDs[0] ?? '';

		expect(editor.transformFloatingPixelSelection({ x: 20, y: 10 }, 2, 2)).toBe(true);
		expect(
			editor.activePage?.layers.find((item) => item.id === floatingID)?.transform
		).toMatchObject({
			x: 20,
			y: 10,
			width: 40,
			height: 20
		});
		expect(editor.transformFloatingPixelSelection({ x: 40, y: 20 }, 1, 1, 90)).toBe(true);
		expect(
			editor.activePage?.layers.find((item) => item.id === floatingID)?.transform.rotation
		).toBe(90);
		expect(editor.duplicateFloatingPixelSelection(5)).toBe(true);
		expect(editor.floatingPixelSelection?.layerIDs).toHaveLength(1);
		expect(editor.selectedLayerIDs).not.toContain(floatingID);
		expect(editor.commitFloatingPixelSelection()).toBe(true);
		expect(editor.activePage?.layers).toHaveLength(3);

		editor.undo();
		expect(editor.activePage?.layers).toHaveLength(1);
	});

	it('creates generic empty layers and paints into the selected empty layer', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('middle');

		editor.addEmptyLayer();

		const empty = editor.selectedLayers[0];
		expect(empty.name).toBe('Layer 1');
		expect(empty.type).toBe('paint');
		expect(empty.paint?.spans).toEqual([]);
		expect(editor.activePage?.layers.map((candidate) => candidate.name)).toEqual([
			'back',
			'middle',
			'Layer 1',
			'front'
		]);

		const mask = new Uint8Array(1080 * 1080);
		mask.fill(1, 10 * 1080 + 20, 10 * 1080 + 40);
		editor.addPaintFill(mask);

		expect(editor.activePage?.layers).toHaveLength(4);
		expect(editor.selectedLayers[0].name).toBe('Layer 1');
		expect(editor.selectedLayers[0].paint?.spans).toEqual([{ x: 0, y: 0, width: 20 }]);

		editor.addEmptyLayer();
		expect(editor.selectedLayers[0].name).toBe('Layer 2');
	});

	it('moves layers precisely above or below a sibling', () => {
		const editor = new ImageEditorController();
		editor.load(response());

		editor.moveLayerRelative('back', 'front', 'above');
		expect(editor.activePage?.layers.map((candidate) => candidate.id)).toEqual([
			'middle',
			'front',
			'back'
		]);

		editor.moveLayerRelative('back', 'middle', 'below');
		expect(editor.activePage?.layers.map((candidate) => candidate.id)).toEqual([
			'back',
			'middle',
			'front'
		]);
	});

	it('preserves imported image aspect ratio and defaults to stretch', () => {
		const editor = new ImageEditorController();
		editor.load(response());

		editor.addImage({ id: 'media', width: 1600, height: 900, name: 'Wide image' });

		const image = editor.selectedLayers[0];
		expect(image.image?.fit).toBe('stretch');
		expect(image.transform.width / image.transform.height).toBeCloseTo(16 / 9);
		expect(image.image?.intrinsic_pending).toBe(false);
	});

	it('keeps asynchronous image imports on their captured target page', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addPage();
		const targetPageID = editor.activePageID;
		editor.activePageID = 'page';
		editor.selectedLayerIDs = ['back'];

		editor.addImage(
			{ id: 'media', width: 640, height: 360, name: 'Delayed image' },
			{ x: 200, y: 240 },
			targetPageID
		);

		expect(editor.document?.pages.find((page) => page.id === targetPageID)?.layers).toHaveLength(1);
		expect(editor.activePage?.layers).toHaveLength(3);
		expect(editor.selectedLayerIDs).toEqual(['back']);
	});

	it('applies and resets an image crop as one undoable transform', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addImage({ id: 'media', width: 800, height: 400, name: 'Wide image' });
		const image = editor.selectedLayers[0];
		const original = structuredClone(image.transform);

		editor.applyImageCrop(image.id, { x: 0.25, y: 0, width: 0.5, height: 1 });

		expect(editor.selectedLayers[0].image?.crop).toEqual({
			x: 0.25,
			y: 0,
			width: 0.5,
			height: 1
		});
		expect(editor.selectedLayers[0].transform.width).toBeCloseTo(original.width / 2);

		editor.undo();
		expect(editor.selectedLayers[0].image?.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(editor.selectedLayers[0].transform).toEqual(original);

		editor.redo();
		editor.resetImageCrop(image.id);
		expect(editor.selectedLayers[0].image?.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(editor.selectedLayers[0].transform).toMatchObject({
			rotation: original.rotation,
			flip_x: original.flip_x,
			flip_y: original.flip_y
		});
		expect(editor.selectedLayers[0].transform.x).toBeCloseTo(original.x);
		expect(editor.selectedLayers[0].transform.y).toBeCloseTo(original.y);
		expect(editor.selectedLayers[0].transform.width).toBeCloseTo(original.width);
		expect(editor.selectedLayers[0].transform.height).toBeCloseTo(original.height);
	});

	it('commits crop source placement and orientation as one history entry', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addImage({ id: 'media', width: 800, height: 400, name: 'Wide image' });
		const image = editor.selectedLayers[0];
		const original = structuredClone(image);

		editor.applyImageCropState(image.id, {
			transform: {
				...image.transform,
				x: image.transform.x + 40,
				width: image.transform.width / 2,
				rotation: 90,
				flip_x: true
			},
			crop: { x: 0.4, y: 0, width: 0.5, height: 1 }
		});

		expect(editor.selectedLayers[0]).toMatchObject({
			transform: { x: original.transform.x + 40, rotation: 90, flip_x: true },
			image: { crop: { x: 0.4, y: 0, width: 0.5, height: 1 } }
		});
		expect(editor.undoLabel).toBe('Crop');
		editor.undo();
		expect(editor.selectedLayers[0]).toEqual(original);
		editor.redo();
		expect(editor.selectedLayers[0].transform.rotation).toBe(90);
		expect(editor.selectedLayers[0].image?.crop.x).toBe(0.4);
	});

	it('fits the whole canvas inside the latest measured viewport', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.setViewportSize(656, 540);

		editor.fitZoom();

		expect(editor.zoom).toBeCloseTo(460 / 1080);
		expect(1080 * editor.zoom).toBeLessThanOrEqual(656 - 80);
		expect(1080 * editor.zoom).toBeLessThanOrEqual(540 - 80);
		expect(editor.panX).toBe(0);
		expect(editor.panY).toBe(0);
	});

	it('nudges selected layers by one pixel or a larger keyboard step', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');

		editor.nudgeSelected(1, 0);
		expect(editor.activePage?.layers.find((item) => item.id === 'front')?.transform.x).toBe(211);

		editor.nudgeSelected(0, -10);
		expect(editor.activePage?.layers.find((item) => item.id === 'front')?.transform.y).toBe(0);

		editor.undo();
		expect(editor.activePage?.layers.find((item) => item.id === 'front')?.transform).toMatchObject({
			x: 210,
			y: 10
		});
	});

	it('resolves an image aspect ratio when media dimensions arrive after insertion', () => {
		const editor = new ImageEditorController();
		editor.load(response());

		editor.addImage({ id: 'media', name: 'Deferred image' });
		const pending = editor.selectedLayers[0];
		expect(pending.image?.intrinsic_pending).toBe(true);

		editor.resolveImageDimensions(pending.id, 1200, 800);

		const image = editor.selectedLayers[0];
		expect(image.transform.width / image.transform.height).toBeCloseTo(3 / 2);
		expect(image.image?.source_width).toBe(1200);
		expect(image.image?.source_height).toBe(800);
		expect(image.image?.intrinsic_pending).toBe(false);
	});

	it('adds gradients as selection-clipped paint layers', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		const mask = new Uint8Array(1080 * 1080);
		mask.fill(1, 20 * 1080 + 30, 20 * 1080 + 50);

		editor.addGradientFill(mask, { x: 30, y: 20 }, { x: 50, y: 20 });

		const layer = editor.selectedLayers[0];
		expect(layer.paint?.kind).toBe('gradient');
		expect(layer.paint?.gradient?.type).toBe('linear');
		expect(layer.paint?.gradient?.start).toEqual({ x: 0, y: 0 });
		expect(layer.paint?.gradient?.end).toEqual({ x: 20, y: 0 });
		expect(layer.paint?.spans).toEqual([{ x: 0, y: 0, width: 20 }]);
	});

	it('records a completed rotation as its own undoable history entry', () => {
		const editor = new ImageEditorController();
		editor.load(response());

		editor.updateTransform('front', { rotation: 45 }, '');

		expect(
			editor.activePage?.layers.find((candidate) => candidate.id === 'front')?.transform.rotation
		).toBe(45);
		expect(editor.canUndo).toBe(true);

		editor.undo();
		expect(
			editor.activePage?.layers.find((candidate) => candidate.id === 'front')?.transform.rotation
		).toBe(0);

		editor.redo();
		expect(
			editor.activePage?.layers.find((candidate) => candidate.id === 'front')?.transform.rotation
		).toBe(45);
	});

	it('duplicates dragged layers at the final Alt-drag transform without moving the originals', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.selectLayer('front');
		const original = structuredClone(editor.selectedLayers[0].transform);

		editor.duplicateSelectedAtTransforms([
			{
				id: 'front',
				transform: { ...original, x: 360, y: 240 }
			}
		]);

		const layers = editor.activePage?.layers ?? [];
		expect(layers).toHaveLength(4);
		expect(layers.find((candidate) => candidate.id === 'front')?.transform).toEqual(original);
		expect(editor.selectedLayers[0].transform).toMatchObject({ x: 360, y: 240 });

		editor.undo();
		expect(editor.activePage?.layers).toHaveLength(3);
	});

	it('stores regular and magic erasing non-destructively and restores both with undo', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addImage({ id: 'media', width: 100, height: 100, name: 'Logo' });
		const imageID = editor.selectedLayers[0].id;

		editor.addEraseStroke(
			imageID,
			100,
			100,
			[
				{ x: 12, y: 14 },
				{ x: 40, y: 42 }
			],
			18
		);
		const mask = new Uint8Array(100 * 100);
		mask.fill(1, 20 * 100 + 30, 20 * 100 + 38);
		editor.addMagicErase(imageID, 100, 100, mask);

		const erased = editor.activePage?.layers.find((candidate) => candidate.id === imageID);
		expect(erased?.erase_mask?.strokes).toEqual([
			{
				size: 18,
				points: [
					{ x: 12, y: 14 },
					{ x: 40, y: 42 }
				]
			}
		]);
		expect(erased?.erase_mask?.spans).toEqual([{ x: 30, y: 20, width: 8 }]);

		editor.undo();
		expect(
			editor.activePage?.layers.find((candidate) => candidate.id === imageID)?.erase_mask?.spans
		).toEqual([]);
		editor.undo();
		expect(
			editor.activePage?.layers.find((candidate) => candidate.id === imageID)?.erase_mask
		).toBeUndefined();
	});

	it('subtracts magic erase pixels directly from paint spans', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		const paintMask = new Uint8Array(1080 * 1080);
		paintMask.fill(1, 40 * 1080 + 20, 40 * 1080 + 30);
		editor.addPaintFill(paintMask);
		const paint = editor.selectedLayers[0];
		const eraseMask = new Uint8Array(10);
		eraseMask.fill(1, 3, 7);

		editor.addMagicErase(paint.id, 10, 1, eraseMask);

		expect(editor.selectedLayers[0].paint?.spans).toEqual([
			{ x: 0, y: 0, width: 3 },
			{ x: 7, y: 0, width: 3 }
		]);
		expect(editor.selectedLayers[0].erase_mask).toBeUndefined();
	});
});
