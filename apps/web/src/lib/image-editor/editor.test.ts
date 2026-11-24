import { describe, expect, it } from 'vitest';
import { themeColorContrastRatio } from '@openpost/ui/themes/validation';
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
	it('keeps new cover text readable over light and dark frames without restyling other designs', () => {
		const editor = new ImageEditorController({
			textAppearance: () => 'over-image'
		});
		const initial = response();
		editor.load(initial);
		editor.addText('A product update');
		const text = editor.selectedLayers[0].text!;
		for (const frameColor of ['#000000', '#ffffff']) {
			expect(
				themeColorContrastRatio(text.color, text.highlight_color ?? 'transparent', frameColor)
			).toBeGreaterThanOrEqual(4.5);
		}
		const authored = editor.document!;
		editor.undo();
		expect(editor.document!.pages[0].layers).toEqual(initial.document.pages[0].layers);
		const reopened = new ImageEditorController();
		reopened.load({ ...initial, document: authored });
		expect(reopened.document!.pages[0].layers.at(-1)!.text).toEqual(text);
		reopened.addText('Ordinary text');
		expect(reopened.selectedLayers[0].text).toMatchObject({ color: '#1c1917' });
		expect(reopened.selectedLayers[0].text!.highlight_color).toBeUndefined();
	});

	it('drops an old text range when direct page or layer selection changes', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addText();
		const id = editor.selectedLayers[0].id;
		editor.updateTextContent(id, 'abcd');
		editor.setTextRange(id, 1, 3);
		editor.selectedLayerIDs = [];
		editor.selectedLayerIDs = [id];
		editor.updateTextStyle(id, 'font_weight', 700);
		expect(editor.selectedLayers[0].text?.runs).toBeUndefined();
		expect(editor.selectedLayers[0].text?.font_weight).toBe(700);
		editor.setTextRange(id, 1, 3);
		const pageID = editor.activePageID;
		editor.activePageID = 'another-page';
		editor.activePageID = pageID;
		editor.updateTextStyle(id, 'font_style', 'italic');
		expect(editor.selectedLayers[0].text?.runs).toBeUndefined();
		expect(editor.selectedLayers[0].text?.font_style).toBe('italic');
	});

	it.each(['image', 'page'] as const)(
		'undoes an active %s color preview before earlier edits and preserves redo after late gesture callbacks',
		(target) => {
			const editor = new ImageEditorController();
			editor.load(response());
			editor.addImage({ id: 'image', width: 100, height: 100, name: 'Image' });
			const imageID = editor.selectedLayers[0].id;
			const before = structuredClone(editor.document);
			if (target === 'image') editor.previewImageAdjustment([imageID], 'contrast', 0.4);
			else editor.previewPageColorGrade(editor.activePageID, 'contrast', 0.4);
			const preview = structuredClone(editor.document);
			editor.undo();
			expect(editor.document).toEqual(before);
			editor.commitImageAdjustmentGesture();
			editor.cancelImageAdjustmentGesture();
			editor.commitPageColorGradeGesture();
			editor.cancelPageColorGradeGesture();
			expect(editor.canRedo).toBe(true);
			editor.redo();
			expect(editor.document).toEqual(preview);
			editor.undo();
			editor.undo();
			expect(editor.activePage?.layers.some((item) => item.id === imageID)).toBe(false);
		}
	);

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
	it('commits a multi-layer image adjustment gesture as one undo step', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addImage({ id: 'image-one', width: 100, height: 100, name: 'One' });
		const firstID = editor.selectedLayers[0]?.id ?? '';
		editor.addImage({ id: 'image-two', width: 100, height: 100, name: 'Two' });
		const secondID = editor.selectedLayers[0]?.id ?? '';
		const undoBeforeGesture = editor.undoLabel;

		editor.beginImageAdjustmentGesture([firstID, secondID], 'contrast');
		editor.previewImageAdjustment([firstID, secondID], 'contrast', 0.1);
		editor.previewImageAdjustment([firstID, secondID], 'contrast', 0.35);
		editor.commitImageAdjustmentGesture();

		const images = editor.activePage?.layers.filter((item) => item.image) ?? [];
		expect(images.map((item) => item.image?.adjustments.contrast)).toEqual([0.35, 0.35]);
		expect(editor.undoLabel).not.toBe(undoBeforeGesture);

		editor.undo();
		expect(
			editor.activePage?.layers
				.filter((item) => item.image)
				.map((item) => item.image?.adjustments.contrast)
		).toEqual([0, 0]);
	});

	it('keeps an unrelated page and layer stable across a committed transform', () => {
		const editor = new ImageEditorController();
		editor.load(response());
		editor.addPage();
		const otherPage = editor.document!.pages[1];
		const untouchedLayer = editor.document!.pages[0].layers[0];
		editor.activePageID = 'page';

		editor.updateTransform('front', { x: 260 });
		editor.updateTransform('front', { x: 280 });

		expect(editor.document?.pages[1]).toBe(otherPage);
		expect(editor.document?.pages[0].layers[0]).toBe(untouchedLayer);
		expect(editor.document?.pages[0].layers[2].transform.x).toBe(280);
		editor.undo();
		expect(editor.document?.pages[0].layers[2].transform.x).toBe(210);
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

	it('resizes unlocked selected roots as one bounding box with partial feedback', () => {
		const editor = new ImageEditorController();
		const initial = response();
		initial.document.pages[0].layers[1].locked = true;
		editor.load(initial);
		editor.selectLayer('back');
		editor.selectLayer('middle', 'toggle');
		editor.selectLayer('front', 'toggle');

		const result = editor.updateSelectedTransform('width', 560, true);

		expect(result).toEqual({
			applied: 2,
			skippedLocked: 1,
			skippedUnsupported: 0
		});
		expect(editor.activePage?.layers.find((item) => item.id === 'back')?.transform).toMatchObject({
			width: 160,
			height: 160
		});
		expect(editor.activePage?.layers.find((item) => item.id === 'middle')?.transform.width).toBe(
			80
		);
		expect(editor.activePage?.layers.find((item) => item.id === 'front')?.transform).toMatchObject({
			x: 410,
			width: 160,
			height: 160
		});
		expect(editor.undoLabel).toBe('Transform layers');

		editor.undo();
		expect(editor.activePage?.layers.find((item) => item.id === 'back')?.transform).toMatchObject({
			x: 10,
			width: 80,
			height: 80
		});
		expect(editor.activePage?.layers.find((item) => item.id === 'front')?.transform).toMatchObject({
			x: 210,
			width: 80,
			height: 80
		});
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
				{
					id: 'paint',
					width: 20,
					height: 1,
					data: new Uint8Array(20).fill(1, 0, 10)
				}
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
		expect(editor.selectedLayers[0].transform).toMatchObject({
			x: 360,
			y: 240
		});

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
});

it('protects locked authored properties while allowing layer management and unlock recovery', () => {
	const editor = new ImageEditorController();
	const initial = response();
	const locked = initial.document.pages[0].layers[0];
	locked.locked = true;
	locked.shape!.radius = 32;
	editor.load(initial);
	editor.selectLayer(locked.id);
	const baseline = JSON.stringify(editor.document);
	editor.updateLayer(locked.id, { shape: { ...locked.shape!, radius: 80 } });
	editor.updateLayer(locked.id, { locked: false, opacity: 0.2 });
	expect(JSON.stringify(editor.document)).toBe(baseline);
	expect(editor.canUndo).toBe(false);
	editor.updateLayer(locked.id, { name: 'Renamed', visible: false });
	expect(editor.selectedLayers[0]).toMatchObject({
		name: 'Renamed',
		visible: false,
		locked: true
	});
	editor.updateLayer(locked.id, { locked: false });
	editor.updateLayer(locked.id, { shape: { ...locked.shape!, radius: 80 } });
	expect(editor.selectedLayers[0].shape?.radius).toBe(80);
	editor.undo();
	expect(editor.selectedLayers[0].shape?.radius).toBe(32);
	editor.redo();
	expect(editor.selectedLayers[0].shape?.radius).toBe(80);

	editor.addText();
	const textID = editor.selectedLayers[0].id;
	editor.selectLayer(locked.id, 'toggle');
	editor.groupSelected();
	const groupID = editor.selectedLayers[0].id;
	editor.updateLayer(groupID, { locked: true });
	const grouped = JSON.stringify(editor.document);
	const originalText = editor.activePage!.layers.find((layer) => layer.id === textID)!.text!;
	expect(editor.updateTextContent(textID, 'Rejected')).toEqual(originalText);
	editor.updateTextStyle(textID, 'font_weight', 400);
	editor.updateTransform(textID, { x: 0 });
	editor.updateLayer(locked.id, { shape: { ...locked.shape!, radius: 99 } });
	expect(JSON.stringify(editor.document)).toBe(grouped);
});

function nestedLockedResponse(): ImageEditorDocumentResponse {
	const initial = response();
	const outer = { ...layer('outer', 0), type: 'group' as const, locked: true };
	const inner = {
		...layer('inner', 0),
		type: 'group' as const,
		parent_id: outer.id
	};
	const child = { ...layer('child', 10), parent_id: inner.id };
	const sibling = { ...layer('sibling', 110), parent_id: inner.id };
	initial.document.pages[0].layers = [child, sibling, inner, outer, layer('outside', 210)];
	return initial;
}

it.each([
	['nudge', (editor: ImageEditorController) => editor.nudgeSelected(1, 0)],
	['delete', (editor: ImageEditorController) => editor.deleteSelected()],
	['reorder', (editor: ImageEditorController) => editor.reorderLayer('child', 'front')],
	[
		'relative reorder',
		(editor: ImageEditorController) => editor.moveLayerRelative('child', 'sibling', 'above')
	],
	[
		'ungroup',
		(editor: ImageEditorController) => {
			editor.selectLayer('inner');
			editor.ungroupSelected();
		}
	],
	[
		'group',
		(editor: ImageEditorController) => {
			editor.selectLayer('sibling', 'toggle');
			editor.groupSelected();
		}
	],
	[
		'align',
		(editor: ImageEditorController) => {
			editor.selectLayer('sibling', 'toggle');
			editor.alignSelected('left');
		}
	]
] as const)('rejects %s beneath a locked ancestor without authoring history', (_, action) => {
	const editor = new ImageEditorController();
	editor.load(nestedLockedResponse());
	editor.selectLayer('child');
	const baseline = JSON.stringify(editor.document);
	action(editor);
	expect(JSON.stringify(editor.document)).toBe(baseline);
	expect(editor.canUndo).toBe(false);
	expect(editor.selectedLayerIDs.length).toBeGreaterThan(0);
});

it.each(['erase', 'magic erase', 'restore', 'cut', 'delete', 'promote'] as const)(
	'rejects pixel %s beneath a locked ancestor, preserving the selection and pixels',
	(action) => {
		const editor = new ImageEditorController();
		const initial = nestedLockedResponse();
		const child = initial.document.pages[0].layers[0];
		child.type = 'image';
		child.shape = undefined;
		child.image = {
			media_id: 'image',
			source_width: 2,
			source_height: 2,
			fit: 'cover',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: defaultImageAdjustments()
		};
		child.erase_mask = {
			source_width: 2,
			source_height: 2,
			spans: [{ x: 0, y: 0, width: 1 }],
			strokes: []
		};
		editor.load(initial);
		editor.selectLayer('child');
		const mask = new Uint8Array([0, 1, 1, 1]);
		editor.applyPixelSelection(mask, ['child'], 'replace');
		const baseline = JSON.stringify(editor.document);
		const selection = editor.pixelSelection;
		if (action === 'erase') editor.addEraseStroke('child', 2, 2, [{ x: 1, y: 1 }], 1);
		else if (action === 'magic erase') editor.addMagicErase('child', 2, 2, mask);
		else if (action === 'restore') editor.restoreImageEraseMask('child');
		else
			expect(
				editor.commitPixelSelectionContent(action, [
					{ id: 'child', width: 2, height: 2, data: mask }
				])
			).toBe(false);
		expect(JSON.stringify(editor.document)).toBe(baseline);
		expect(editor.pixelSelection).toBe(selection);
		expect(editor.selectedLayerIDs).toEqual(['child']);
		expect(editor.canUndo).toBe(false);
	}
);

it('protects locked descendant colors and adjustment gestures without blocking unlocked groups', () => {
	const editor = new ImageEditorController();
	editor.load(nestedLockedResponse());
	editor.selectLayer('child');
	editor.eyedropperTarget = 'selected_fill';
	const baseline = JSON.stringify(editor.document);
	editor.applySampledColor('#ffffff', 255);
	expect(JSON.stringify(editor.document)).toBe(baseline);
	expect(editor.canUndo).toBe(false);
	editor.updateLayer('outer', { locked: false });
	editor.selectLayer('inner');
	editor.nudgeSelected(5, 0);
	expect(editor.activePage?.layers.find((item) => item.id === 'child')?.transform.x).toBe(15);
	expect(editor.activePage?.layers.find((item) => item.id === 'sibling')?.transform.x).toBe(115);
	editor.undo();
	expect(editor.activePage?.layers.find((item) => item.id === 'child')?.transform.x).toBe(10);
	editor.redo();
	expect(editor.activePage?.layers.find((item) => item.id === 'child')?.transform.x).toBe(15);

	editor.addImage({ id: 'image', name: 'Photo', width: 2, height: 2 });
	const imageID = editor.selectedLayers[0].id;
	editor.moveLayerToGroup(imageID, 'inner');
	editor.updateLayer('outer', { locked: true });
	const imageBaseline = JSON.stringify(editor.document);
	editor.previewImageAdjustment([imageID], 'contrast', 0.3);
	editor.commitImageAdjustmentGesture();
	expect(JSON.stringify(editor.document)).toBe(imageBaseline);
	editor.updateLayer('outer', { locked: false });
	editor.previewImageAdjustment([imageID], 'contrast', 0.3);
	editor.previewImageAdjustment([imageID], 'contrast', 0.5);
	editor.commitImageAdjustmentGesture();
	expect(
		editor.activePage?.layers.find((item) => item.id === imageID)?.image?.adjustments.contrast
	).toBe(0.5);
	editor.undo();
	expect(
		editor.activePage?.layers.find((item) => item.id === imageID)?.image?.adjustments.contrast
	).toBe(0);
});

it('bounds authored mask radius without rounding valid fractions', () => {
	const editor = new ImageEditorController();
	const initial = response();
	const target = initial.document.pages[0].layers[0];
	target.transform.width = 381.75;
	target.transform.height = 214.875;
	target.mask = { shape: 'rounded_rectangle', inset: 0, radius: 32.25 };
	editor.load(initial);
	editor.updateLayer(target.id, { mask: { ...target.mask, radius: 108 } });
	expect(editor.activePage!.layers[0].mask!.radius).toBe(107.4375);
	editor.updateLayer(target.id, { mask: { ...target.mask, radius: 108 } });
	editor.undo();
	expect(editor.activePage!.layers[0].mask!.radius).toBe(32.25);
	editor.redo();
	expect(editor.activePage!.layers[0].mask!.radius).toBe(107.4375);
	editor.updateLayer(target.id, { mask: { ...target.mask, radius: 101.75 } });
	expect(editor.activePage!.layers[0].mask!.radius).toBe(101.75);
	editor.updateLayer(target.id, { mask: { ...target.mask, radius: -1 } });
	expect(editor.activePage!.layers[0].mask!.radius).toBe(0);
	expect(editor.activePage!.layers[0].transform).toEqual(target.transform);
});
