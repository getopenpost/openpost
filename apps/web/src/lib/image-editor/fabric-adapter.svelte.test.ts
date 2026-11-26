import { describe, expect, it } from 'vitest';
import type { IText } from 'fabric';
import { renderImageEditorPage } from './static-renderer';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { ImageEditorController } from './editor.svelte';
import { editTextWithRuns, type ImageEditorTextEdit } from './text-runs';
import type {
	ImageEditorDocument,
	ImageEditorLayer,
	ImageEditorPage,
	ImageEditorTextValue
} from './types';

function adapterInternals<T extends object>(adapter: OpenPostFabricAdapter): T {
	// SAFETY: named test contracts expose only the adapter members exercised by each focused test.
	return adapter as T;
}

function renderLayer(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	kind: NonNullable<ImageEditorLayer['shape']>['kind'] = 'rectangle',
	strokeWidth = 0
): ImageEditorLayer {
	return {
		id,
		type: 'shape',
		name: id,
		visible: true,
		locked: false,
		opacity: 1,
		transform: {
			x,
			y,
			width,
			height,
			rotation: 0,
			flip_x: false,
			flip_y: false
		},
		shape: {
			kind,
			fill: kind === 'line' ? '#00000000' : '#f97316',
			stroke: '#111827',
			stroke_width: strokeWidth,
			radius: 0
		}
	};
}

function pageFixture(layers: ImageEditorLayer[] = []): ImageEditorPage {
	return {
		id: 'page',
		name: 'Page 1',
		background_color: '#ffffff',
		background: { type: 'solid', color: '#ffffff', opacity: 1 },
		layers
	};
}

function documentFixture(page: ImageEditorPage, width = 360, height = 240): ImageEditorDocument {
	return {
		schema_version: 1,
		title: 'Fabric regression',
		preset_key: 'custom',
		width_px: width,
		height_px: height,
		brand_kit_revision: 0,
		export_defaults: { format: 'png', quality: 0.92, matte_color: '#ffffff' },
		pages: [page]
	};
}

async function mountAdapter(
	document: ImageEditorDocument,
	page: ImageEditorPage,
	options: {
		staticCanvas?: boolean;
		renderScale?: number;
		onTextChange?: (
			id: string,
			text: string,
			edit?: ImageEditorTextEdit
		) => ImageEditorTextValue | void;
	} = {}
) {
	const canvas = window.document.createElement('canvas');
	window.document.body.append(canvas);
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document,
		page,
		readOnly: Boolean(options.staticCanvas),
		staticCanvas: options.staticCanvas,
		renderScale: options.renderScale,
		onSelection: () => undefined,
		onTransform: () => undefined,
		onTextChange: options.onTextChange ?? (() => undefined)
	});
	await adapter.mount();
	return { adapter, canvas };
}

async function settleCanvas(): Promise<void> {
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);
}

it('resolves selection against current ancestors after sync, canvas edits, and page changes', async () => {
	const root: ImageEditorLayer = {
		...renderLayer('root', 0, 0, 100, 100),
		type: 'group'
	};
	const nested: ImageEditorLayer = {
		...renderLayer('nested', 0, 0, 100, 100),
		type: 'group',
		parent_id: root.id
	};
	const child = {
		...renderLayer('child', 0, 0, 100, 100),
		parent_id: nested.id
	};
	const cover = renderLayer('cover', 0, 0, 100, 100);
	let page = pageFixture([child, nested, root, cover]);
	let document = documentFixture(page);
	const { adapter, canvas } = await mountAdapter(document, page);
	const point = { x: 25, y: 25 };
	try {
		expect(adapter.layerIDsAtPoint(point)).toEqual(['cover', 'root']);
		expect(adapter.topmostLayerIDAtPoint(point)).toBe('cover');
		expect(adapter.magicLayerIDsAtPoint(point, 0)).toEqual(['root', 'cover']);
		page = {
			...page,
			layers: [child, nested, { ...root, locked: true }, cover]
		};
		document = { ...document, pages: [page] };
		await adapter.sync(document, page);
		expect(adapter.layerIDsAtPoint(point)).toEqual(['cover']);
		expect(adapter.lockedLayerIDAtPoint(point)).toBe('root');
		expect(adapter.magicLayerIDsAtPoint(point, 0)).toEqual(['cover']);

		page = {
			...page,
			layers: [child, nested, { ...root, visible: false }, cover]
		};
		document = { ...document, pages: [page] };
		await adapter.sync(document, page);
		expect(adapter.layerIDsAtPoint(point)).toEqual(['cover']);
		expect(adapter.lockedLayerIDAtPoint(point)).toBeNull();

		const replacementRoot = { ...root, id: 'replacement' };
		page = {
			...page,
			layers: [child, { ...nested, parent_id: replacementRoot.id }, replacementRoot, cover]
		};
		document = { ...document, pages: [page] };
		await adapter.sync(document, page);
		expect(adapter.layerIDsAtPoint(point)).toEqual(['cover', 'replacement']);

		page = {
			...page,
			layers: page.layers.map((layer) =>
				layer.id === replacementRoot.id ? { ...layer, locked: true } : layer
			)
		};
		document = { ...document, pages: [page] };
		adapter.accept(document, page);
		expect(adapter.layerIDsAtPoint(point)).toEqual(['cover']);
		expect(adapter.lockedLayerIDAtPoint(point)).toBe('replacement');

		page = {
			...pageFixture([renderLayer('child', 0, 0, 100, 100)]),
			id: 'second-page'
		};
		document = { ...document, pages: [page] };
		await adapter.sync(document, page);
		expect(adapter.layerIDsAtPoint(point)).toEqual(['child']);
		expect(adapter.topmostLayerIDAtPoint(point)).toBe('child');
		expect(adapter.lockedLayerIDAtPoint(point)).toBeNull();
	} finally {
		adapter.dispose();
		canvas.remove();
	}
});

it.each([true, false])(
	'keeps grouped paint and its stroke correct across ancestor visibility, locking, and later edits (initially visible: %s)',
	async (initiallyVisible) => {
		const root: ImageEditorLayer = {
			...renderLayer('root', 0, 0, 64, 64),
			type: 'group'
		};
		let paint: ImageEditorLayer = {
			...renderLayer('paint', 0, 0, 64, 64),
			type: 'paint',
			parent_id: root.id,
			paint: {
				kind: 'fill',
				color: '#ff0000',
				size: 1,
				opacity: 1,
				source_width: 64,
				source_height: 64,
				points: [],
				spans: Array.from({ length: 20 }, (_, y) => ({
					x: 20,
					y: 20 + y,
					width: 20
				}))
			},
			effects: {
				blend_mode: 'normal',
				stroke: { color: '#000000', width: 2, opacity: 1, position: 'outside' }
			}
		};
		let page = pageFixture([paint, { ...root, visible: initiallyVisible }]);
		const live = await mountAdapter(documentFixture(page, 64, 64), page);
		try {
			for (const state of [
				{ visible: false, locked: false },
				{ visible: true, locked: true },
				{ visible: false, locked: true },
				{ visible: true, locked: false }
			]) {
				page = { ...page, layers: [paint, { ...root, ...state }] };
				await live.adapter.sync(documentFixture(page, 64, 64), page);
				await settleCanvas();
				const fresh = await mountAdapter(documentFixture(page, 64, 64), page, {
					staticCanvas: true
				});
				try {
					expect(pixelDigest(live.canvas)).toBe(pixelDigest(fresh.canvas));
					const context = live.canvas.getContext('2d')!;
					expect([...context.getImageData(30, 30, 1, 1).data]).toEqual(
						state.visible ? [255, 0, 0, 255] : [255, 255, 255, 255]
					);
					expect([...context.getImageData(19, 30, 1, 1).data]).toEqual(
						state.visible ? [0, 0, 0, 255] : [255, 255, 255, 255]
					);
					expect(live.adapter.layerIDsAtPoint({ x: 30, y: 30 })).toEqual(
						state.visible && !state.locked ? ['root'] : []
					);
				} finally {
					fresh.adapter.dispose();
					fresh.canvas.remove();
				}
			}
			paint = { ...paint, paint: { ...paint.paint!, color: '#00ff00' } };
			page = { ...page, layers: [paint, root] };
			await live.adapter.sync(documentFixture(page, 64, 64), page);
			await settleCanvas();
			expect([...live.canvas.getContext('2d')!.getImageData(30, 30, 1, 1).data]).toEqual([
				0, 255, 0, 255
			]);
			expect([...live.canvas.getContext('2d')!.getImageData(19, 30, 1, 1).data]).toEqual([
				0, 0, 0, 255
			]);
		} finally {
			live.adapter.dispose();
			live.canvas.remove();
		}
	}
);

function pixelDigest(canvas: HTMLCanvasElement): number {
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas context is unavailable.');
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	let hash = 2166136261;
	for (const value of pixels) {
		hash ^= value;
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

it('renders saved grapheme emphasis in the live canvas and static export', async () => {
	const layer: ImageEditorLayer = {
		id: 'headline',
		type: 'text',
		name: 'Headline',
		visible: true,
		locked: false,
		opacity: 1,
		transform: {
			x: 20,
			y: 20,
			width: 300,
			height: 100,
			rotation: 0,
			flip_x: false,
			flip_y: false
		},
		text: {
			text: 'A👩🏽‍🚀B',
			runs: [{ start: 2, end: 3, font_weight: 700, color: '#ff0000' }],
			font_family: 'Arial',
			font_weight: 400,
			font_style: 'normal',
			font_size: 52,
			color: '#000000',
			align: 'left',
			line_height: 1,
			letter_spacing: 0,
			stroke_width: 0,
			shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
		}
	};
	const page = pageFixture([layer]);
	const document = documentFixture(page);
	const live = await mountAdapter(document, page);
	const exported = await mountAdapter(document, page, { staticCanvas: true });
	try {
		const objects = adapterInternals<{ objectByLayerID: Map<string, IText> }>(live.adapter);
		const glyph = objects.objectByLayerID.get('headline');
		expect(glyph?.styles[0]?.[2]).toMatchObject({
			fontWeight: 700,
			fill: '#ff0000'
		});
		expect(glyph?.styles[0]?.[1]).toBeUndefined();
		await settleCanvas();
		expect(pixelDigest(live.canvas)).toBe(pixelDigest(exported.canvas));

		// Two canvases produced by the same adapter can agree while both miss the
		// artwork. The red run belongs to B, so B must paint red pixels to the right
		// of the non-red A glyph in each canvas.
		const emphasisBounds = (canvas: HTMLCanvasElement) => {
			const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
			const bounds = {
				reds: 0,
				darks: 0,
				redLeft: Number.POSITIVE_INFINITY,
				redTop: Number.POSITIVE_INFINITY,
				darkLeft: Number.POSITIVE_INFINITY
			};
			for (let index = 0; index < data.length; index += 4) {
				const red = data[index]! > 200 && data[index + 1]! < 60 && data[index + 2]! < 60;
				const dark = data[index]! < 60 && data[index + 1]! < 60 && data[index + 2]! < 60;
				if (!red && !dark) continue;
				const pixel = index / 4;
				const x = pixel % canvas.width;
				if (red) {
					bounds.reds += 1;
					bounds.redLeft = Math.min(bounds.redLeft, x);
					bounds.redTop = Math.min(bounds.redTop, Math.floor(pixel / canvas.width));
				} else {
					bounds.darks += 1;
					bounds.darkLeft = Math.min(bounds.darkLeft, x);
				}
			}
			return bounds;
		};
		const liveEmphasis = emphasisBounds(live.canvas);
		for (const probe of [liveEmphasis, emphasisBounds(exported.canvas)]) {
			expect(probe.reds).toBeGreaterThan(0);
			expect(probe.darks).toBeGreaterThan(0);
			expect(probe.darkLeft).toBeLessThan(probe.redLeft);
		}

		const changedLayer: ImageEditorLayer = {
			...layer,
			text: {
				...layer.text!,
				text: 'A\n👩🏽‍🚀B',
				runs: [{ start: 3, end: 4, font_weight: 700, color: '#ff0000' }]
			}
		};
		const changedPage = pageFixture([changedLayer]);
		await live.adapter.sync(documentFixture(changedPage), changedPage);
		expect(objects.objectByLayerID.get('headline')?.styles[1]?.[1]).toMatchObject({
			fontWeight: 700,
			fill: '#ff0000'
		});
		await settleCanvas();
		const movedEmphasis = emphasisBounds(live.canvas);
		expect(movedEmphasis.reds).toBeGreaterThan(0);
		// The authored newline moves the emphasized B down by one 52px line.
		expect(movedEmphasis.redTop).toBeGreaterThan(liveEmphasis.redTop + 30);
	} finally {
		live.adapter.dispose();
		exported.adapter.dispose();
		live.canvas.remove();
		exported.canvas.remove();
	}
});

it('uses the Fabric textarea edit position for repeated text', async () => {
	const layer: ImageEditorLayer = {
		...renderLayer('text', 40, 40, 260, 100),
		type: 'text',
		shape: undefined,
		text: {
			text: 'aaaa',
			runs: [{ start: 3, end: 4, font_weight: 700 }],
			font_family: 'Arial',
			font_weight: 400,
			font_style: 'normal',
			font_size: 80,
			color: '#000000',
			align: 'left',
			line_height: 1.1,
			letter_spacing: 0,
			stroke_width: 0,
			shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
		}
	};
	const page = pageFixture([layer]);
	let updated: ImageEditorTextValue | undefined;
	const mounted = await mountAdapter(documentFixture(page), page, {
		onTextChange(_id, text, edit) {
			updated = editTextWithRuns(layer.text!, text, edit);
			return updated;
		}
	});
	try {
		const { objectByLayerID } = adapterInternals<{
			objectByLayerID: Map<string, IText>;
		}>(mounted.adapter);
		const target = objectByLayerID.get(layer.id)!;
		target.enterEditing();
		const textarea = target.hiddenTextarea!;
		textarea.setSelectionRange(0, 0);
		textarea.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				inputType: 'deleteContentForward'
			})
		);
		textarea.value = 'aaa';
		textarea.setSelectionRange(0, 0);
		textarea.dispatchEvent(
			new InputEvent('input', {
				bubbles: true,
				inputType: 'deleteContentForward'
			})
		);
		expect(updated?.runs).toEqual([{ start: 2, end: 3, font_weight: 700 }]);
		target.exitEditing();
	} finally {
		mounted.adapter.dispose();
	}
});

async function freshRenderDigest(page: ImageEditorPage, selectedIDs: string[]): Promise<number> {
	const document = documentFixture(page);
	const mounted = await mountAdapter(document, page);
	try {
		mounted.adapter.setSelection(selectedIDs);
		await settleCanvas();
		return pixelDigest(mounted.canvas);
	} finally {
		mounted.adapter.dispose();
	}
}

describe('OpenPost Image Editor Fabric reconciliation', () => {
	it('persists a rotated mixed selection without changing its rendered pixels', async () => {
		interface ActiveSelectionFixture {
			set(updates: { angle: number }): void;
			setCoords(): void;
		}
		interface PersistenceAdapterInternals {
			canvas: {
				getActiveObject(): ActiveSelectionFixture;
				discardActiveObject(): void;
				requestRenderAll(): void;
			};
			transformEntries(target: ActiveSelectionFixture): Array<{
				id: string;
				transform: ImageEditorLayer['transform'];
			}>;
		}
		const page = pageFixture([
			{
				...renderLayer('one', 10, 20, 80, 40, 'rectangle', 6),
				transform: {
					x: 10,
					y: 20,
					width: 80,
					height: 40,
					rotation: 30,
					flip_x: false,
					flip_y: true
				}
			},
			{
				...renderLayer('two', 200, 100, 120, 60, 'ellipse'),
				transform: {
					x: 200,
					y: 100,
					width: 120,
					height: 60,
					rotation: -15,
					flip_x: true,
					flip_y: false
				}
			}
		]);
		const mounted = await mountAdapter(documentFixture(page), page);
		try {
			mounted.adapter.setSelection(['one', 'two']);
			await settleCanvas();
			const internals = adapterInternals<PersistenceAdapterInternals>(mounted.adapter);
			const activeSelection = internals.canvas.getActiveObject();
			activeSelection.set({ angle: 27 });
			activeSelection.setCoords();
			const entries = internals.transformEntries(activeSelection);
			const nextPage = structuredClone(page);
			for (const entry of entries) {
				const layer = nextPage.layers.find((candidate) => candidate.id === entry.id);
				if (layer) layer.transform = entry.transform;
			}

			internals.canvas.discardActiveObject();
			internals.canvas.requestRenderAll();
			await settleCanvas();
			const liveDigest = pixelDigest(mounted.canvas);

			expect(await freshRenderDigest(nextPage, [])).toBe(liveDigest);
		} finally {
			mounted.adapter.dispose();
		}
	});
});

describe('OpenPost Image Editor text layer outlines', () => {
	function textLayer(): ImageEditorLayer {
		return {
			...renderLayer('text', 40, 40, 260, 100),
			type: 'text',
			shape: undefined,
			text: {
				text: 'HI',
				font_family: 'Arial',
				font_weight: 700,
				font_style: 'normal',
				font_size: 80,
				color: '#000000',
				align: 'left',
				line_height: 1.1,
				letter_spacing: 0,
				stroke_width: 0,
				shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
			},
			effects: {
				blend_mode: 'normal',
				stroke: { color: '#ff0000', opacity: 1, width: 4, position: 'outside' }
			}
		};
	}

	it.each(['inside', 'center', 'outside'] as const)(
		'outlines glyphs, not the text box, with a %s stroke',
		async (position) => {
			const layer = textLayer();
			layer.effects!.stroke!.position = position;
			const page = pageFixture([layer]);
			const document = documentFixture(page);
			const mounted = await mountAdapter(document, page, {
				staticCanvas: true
			});
			try {
				await settleCanvas();
				const pixels = mounted.canvas.getContext('2d')!.getImageData(0, 0, 360, 240).data;
				let glyphOutline = 0;
				let emptyBoxOutline = 0;
				for (let y = 0; y < 240; y++)
					for (let x = 0; x < 360; x++) {
						const index = (y * 360 + x) * 4;
						if (pixels[index] > 150 && pixels[index + 1] < 100 && pixels[index + 2] < 100) {
							if (x < 180) glyphOutline++;
							if (x > 220) emptyBoxOutline++;
						}
					}
				expect(emptyBoxOutline).toBe(0);
				expect(glyphOutline).toBeGreaterThan(100);
				const exported = await renderImageEditorPage(document, page, 0);
				const bitmap = await createImageBitmap(exported.blob);
				try {
					const decoded = window.document.createElement('canvas');
					decoded.width = bitmap.width;
					decoded.height = bitmap.height;
					decoded.getContext('2d')!.drawImage(bitmap, 0, 0);
					expect(pixelDigest(decoded)).toBe(pixelDigest(mounted.canvas));
				} finally {
					bitmap.close();
				}
			} finally {
				mounted.adapter.dispose();
			}
		}
	);
});

it('scales nested mixed selection glyphs with geometry, history and export', async () => {
	const headline: ImageEditorLayer = {
		...renderLayer('headline', 20, 20, 300, 70),
		type: 'text',
		shape: undefined,
		text: {
			text: 'AUDIT café',
			runs: [{ start: 0, end: 5, font_weight: 700 }],
			font_family: 'Arial',
			font_weight: 400,
			font_style: 'normal',
			underline: false,
			strike: false,
			wrap: 'word',
			font_size: 48,
			color: '#000000',
			align: 'left',
			line_height: 1,
			letter_spacing: 0,
			stroke_width: 0,
			shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
		}
	};
	const rectangle = renderLayer('rectangle', 200, 140, 60, 60);
	const outside = renderLayer('outside', 20, 210, 30, 20);
	const document = documentFixture(pageFixture([headline, rectangle, outside]));
	const initial = {
		id: 'design',
		workspace_id: 'workspace',
		created_by_id: 'user',
		revision: 1,
		can_edit: true,
		created_at: '2026-07-25T00:00:00Z',
		updated_at: '2026-07-25T00:00:00Z',
		document
	};
	const editor = new ImageEditorController();
	editor.load(initial);
	editor.selectLayer('headline');
	editor.selectLayer('rectangle', 'toggle');
	editor.groupSelected();
	editor.selectLayer('outside', 'toggle');
	// SAFETY: serialization clones the loaded, JSON-compatible document without changing its schema.
	const before = JSON.parse(JSON.stringify(editor.document)) as ImageEditorDocument;
	editor.updateSelectedTransform('width', 150, true);
	// SAFETY: the transform mutation preserves the loaded document schema across this JSON clone.
	const scaled = JSON.parse(JSON.stringify(editor.document)) as ImageEditorDocument;
	const expectedHeadline: ImageEditorLayer = {
		...headline,
		transform: { ...headline.transform, width: 150, height: 35 },
		text: { ...headline.text!, font_size: 24 }
	};
	const expectedRectangle = renderLayer('rectangle', 110, 80, 30, 30);
	const expectedOutside = renderLayer('outside', 20, 115, 15, 10);
	const expectedPage = pageFixture([expectedHeadline, expectedRectangle, expectedOutside]);
	const expected = await mountAdapter(documentFixture(expectedPage), expectedPage, {
		staticCanvas: true
	});
	const live = await mountAdapter(scaled, scaled.pages[0]);
	try {
		await settleCanvas();

		const exported = await renderImageEditorPage(scaled, scaled.pages[0], 0);
		const bitmap = await createImageBitmap(exported.blob);
		const decoded = window.document.createElement('canvas');
		decoded.width = bitmap.width;
		decoded.height = bitmap.height;
		decoded.getContext('2d')!.drawImage(bitmap, 0, 0);
		bitmap.close();

		expect(pixelDigest(decoded)).toBe(pixelDigest(expected.canvas));
		expect(pixelDigest(live.canvas)).toBe(pixelDigest(expected.canvas));
		expect(scaled.pages[0].layers.find((layer) => layer.id === 'headline')?.text?.font_size).toBe(
			24
		);
		editor.undo();
		expect(JSON.parse(JSON.stringify(editor.document))).toEqual(before);
		editor.redo();
		expect(JSON.parse(JSON.stringify(editor.document))).toEqual(scaled);
		const cold = new ImageEditorController();
		cold.load({ ...initial, document: scaled });
		expect(cold.activePage?.layers.find((layer) => layer.id === 'headline')?.text).toEqual(
			expectedHeadline.text
		);
	} finally {
		live.adapter.dispose();
		live.canvas.remove();
		expected.adapter.dispose();
		expected.canvas.remove();
	}
});
