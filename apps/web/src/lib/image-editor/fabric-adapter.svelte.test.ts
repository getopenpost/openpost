import { describe, expect, it } from 'vitest';
import type { Canvas, IText } from 'fabric';
import { page as browserPage } from 'vitest/browser';
import { renderImageEditorPage } from './static-renderer';
import { OpenPostFabricAdapter } from './fabric-adapter';
import {
	imageEditorCollectiveTransform,
	transformImageEditorCollectiveMember
} from './collective-transform';
import type {
	ImageEditorDocument,
	ImageEditorGradientType,
	ImageEditorLayer,
	ImageEditorPage
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
	options: { staticCanvas?: boolean; renderScale?: number } = {}
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
		onTextChange: () => undefined
	});
	await adapter.mount();
	return { adapter, canvas };
}

async function settleCanvas(): Promise<void> {
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);
}

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

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): number[] {
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas context is unavailable.');
	return Array.from(context.getImageData(x, y, 1, 1).data);
}

function pixelAtRatio(canvas: HTMLCanvasElement, x: number, y: number): number[] {
	return pixelAt(canvas, Math.round((canvas.width - 1) * x), Math.round((canvas.height - 1) * y));
}

function binaryAlpha(image: ImageData): Uint8Array {
	const mask = new Uint8Array(image.width * image.height);
	for (let index = 0; index < mask.length; index++) {
		if (image.data[index * 4 + 3]) mask[index] = 1;
	}
	return mask;
}

function differingPixels(left: Uint8Array, right: Uint8Array): number {
	if (left.length !== right.length) return Math.max(left.length, right.length);
	let count = 0;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) count += 1;
	}
	return count;
}

function expectPixelsClose(actual: number[], expected: number[], tolerance = 4): void {
	for (let channel = 0; channel < 4; channel++) {
		expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
	}
}

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
	it.each([
		{ key: 'rotation' as const, value: 45, selectionUpdates: { angle: 15 } },
		{ key: 'flip_x' as const, value: true, selectionUpdates: { flipX: true } }
	])('matches pointer $key geometry for unequal rotated and flipped members', async (testCase) => {
		interface ActiveSelectionFixture {
			angle: number;
			set(updates: { angle?: number; flipX?: boolean }): void;
			setCoords(): void;
		}
		interface CollectiveTransformAdapterInternals {
			canvas: { getActiveObject(): ActiveSelectionFixture };
			transformEntries(target: ActiveSelectionFixture): Array<{
				id: string;
				transform: ImageEditorLayer['transform'];
			}>;
		}
		const page = pageFixture([
			{
				...renderLayer('one', 10, 20, 80, 40),
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
		const document = documentFixture(page);
		const mounted = await mountAdapter(document, page);
		try {
			mounted.adapter.setSelection(['one', 'two']);
			await settleCanvas();
			const internals = adapterInternals<CollectiveTransformAdapterInternals>(mounted.adapter);
			const activeSelection = internals.canvas.getActiveObject();
			activeSelection.set(testCase.selectionUpdates);
			activeSelection.setCoords();
			const pointerTransforms = new Map(
				internals
					.transformEntries(activeSelection)
					.map((entry) => [entry.id, entry.transform] as const)
			);
			const selection = imageEditorCollectiveTransform(
				page.layers.map((layer) => layer.transform)
			)!;

			for (const layer of page.layers) {
				const numeric = transformImageEditorCollectiveMember(
					layer.transform,
					selection,
					testCase.key,
					testCase.value
				);
				const pointer = pointerTransforms.get(layer.id)!;
				expect(numeric.x).toBeCloseTo(pointer.x);
				expect(numeric.y).toBeCloseTo(pointer.y);
				expect(numeric.width).toBeCloseTo(pointer.width);
				expect(numeric.height).toBeCloseTo(pointer.height);
				expect(numeric.rotation).toBeCloseTo(pointer.rotation);
				expect(numeric.flip_x).toBe(pointer.flip_x);
				expect(numeric.flip_y).toBe(pointer.flip_y);
			}
		} finally {
			mounted.adapter.dispose();
		}
	});

	it('loads the exact rendered alpha of a rotated, outlined, masked layer', async () => {
		const layer = renderLayer('outlined-mask', 96, 52, 132, 88, 'rectangle', 24);
		layer.transform.rotation = 31;
		layer.mask = { shape: 'diamond', inset: 8, radius: 0 };
		layer.erase_mask = {
			source_width: 132,
			source_height: 88,
			strokes: [
				{
					size: 18,
					points: [
						{ x: 34, y: 20 },
						{ x: 98, y: 68 }
					]
				}
			],
			spans: []
		};
		const page = pageFixture([layer]);
		const document = documentFixture(page);
		const mounted = await mountAdapter(document, page);
		try {
			await settleCanvas();
			const isolated = mounted.adapter.rasterizeLayerIDs([layer.id]);
			expect(isolated).not.toBeNull();

			const selection = mounted.adapter.layerAlphaPixelMask(
				layer.id,
				document.width_px,
				document.height_px
			);
			expect(selection).not.toBeNull();
			expect(differingPixels(selection!, binaryAlpha(isolated!))).toBe(0);
		} finally {
			mounted.adapter.dispose();
		}
	});

	it('matches pointer geometry for a non-uniform numeric selection resize', async () => {
		interface ActiveSelectionFixture {
			left: number;
			top: number;
			set(updates: { left: number; top: number; scaleX: number; scaleY: number }): void;
			setCoords(): void;
			getBoundingRect(): {
				left: number;
				top: number;
				width: number;
				height: number;
			};
		}
		interface CollectiveTransformAdapterInternals {
			canvas: { getActiveObject(): ActiveSelectionFixture };
			transformEntries(target: ActiveSelectionFixture): Array<{
				id: string;
				transform: ImageEditorLayer['transform'];
			}>;
		}
		const page = pageFixture([
			{
				...renderLayer('one', 10, 20, 80, 40),
				transform: {
					x: 10,
					y: 20,
					width: 80,
					height: 40,
					rotation: 30,
					flip_x: false,
					flip_y: false
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
					flip_x: false,
					flip_y: false
				}
			}
		]);
		const mounted = await mountAdapter(documentFixture(page), page);
		try {
			mounted.adapter.setSelection(['one', 'two']);
			await settleCanvas();
			const internals = adapterInternals<CollectiveTransformAdapterInternals>(mounted.adapter);
			const activeSelection = internals.canvas.getActiveObject();
			const bounds = activeSelection.getBoundingRect();
			const scaleX = 1.4;
			activeSelection.set({
				left: bounds.left + (bounds.width * scaleX) / 2,
				top: bounds.top + bounds.height / 2,
				scaleX,
				scaleY: 1
			});
			activeSelection.setCoords();
			const pointerTransforms = new Map(
				internals
					.transformEntries(activeSelection)
					.map((entry) => [entry.id, entry.transform] as const)
			);
			const selection = imageEditorCollectiveTransform(
				page.layers.map((layer) => layer.transform)
			)!;
			for (const layer of page.layers) {
				const numeric = transformImageEditorCollectiveMember(
					layer.transform,
					selection,
					'width',
					selection.width * scaleX,
					false
				);
				const pointer = pointerTransforms.get(layer.id)!;
				expect(numeric.x).toBeCloseTo(pointer.x);
				expect(numeric.y).toBeCloseTo(pointer.y);
				expect(numeric.width).toBeCloseTo(pointer.width);
				expect(numeric.height).toBeCloseTo(pointer.height);
				expect(numeric.rotation).toBeCloseTo(pointer.rotation);
				expect(numeric.flip_x).toBe(pointer.flip_x);
				expect(numeric.flip_y).toBe(pointer.flip_y);
			}
		} finally {
			mounted.adapter.dispose();
		}
	});

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

	it('keeps rendered pixels unchanged after a zero-delta collective numeric edit', async () => {
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
		const nextPage = structuredClone(page);
		const selection = imageEditorCollectiveTransform(
			nextPage.layers.map((layer) => layer.transform)
		)!;
		for (const layer of nextPage.layers) {
			layer.transform = transformImageEditorCollectiveMember(
				layer.transform,
				selection,
				'width',
				selection.width
			);
		}

		expect(await freshRenderDigest(nextPage, [])).toBe(await freshRenderDigest(page, []));
	});

	it('matches a fresh render after aligning a live multi-layer selection', async () => {
		const previousPage = pageFixture([
			renderLayer('one', 24, 28, 80, 56),
			renderLayer('two', 120, 70, 112, 72, 'ellipse'),
			renderLayer('three', 60, 150, 128, 48)
		]);
		const nextPage = structuredClone(previousPage);
		for (const layer of nextPage.layers) {
			layer.transform = {
				...layer.transform,
				x: 336 - layer.transform.width
			};
		}
		const previousDocument = documentFixture(previousPage);
		const nextDocument = documentFixture(nextPage);
		const selectedIDs = nextPage.layers.map((layer) => layer.id);
		const mounted = await mountAdapter(previousDocument, previousPage);
		try {
			mounted.adapter.setSelection(selectedIDs);
			await settleCanvas();
			await mounted.adapter.sync(nextDocument, nextPage);
			await settleCanvas();

			expect(pixelDigest(mounted.canvas)).toBe(await freshRenderDigest(nextPage, selectedIDs));
		} finally {
			mounted.adapter.dispose();
		}
	});

	it('matches a fresh render after a collective numeric resize and rotation', async () => {
		const previousPage = pageFixture([
			renderLayer('one', 24, 28, 80, 56),
			renderLayer('two', 120, 70, 112, 72, 'ellipse')
		]);
		const nextPage = structuredClone(previousPage);
		const initialSelection = imageEditorCollectiveTransform(
			nextPage.layers.map((layer) => layer.transform)
		)!;
		for (const layer of nextPage.layers) {
			layer.transform = transformImageEditorCollectiveMember(
				layer.transform,
				initialSelection,
				'width',
				initialSelection.width * 1.5,
				true
			);
		}
		const resizedSelection = imageEditorCollectiveTransform(
			nextPage.layers.map((layer) => layer.transform)
		)!;
		for (const layer of nextPage.layers) {
			layer.transform = transformImageEditorCollectiveMember(
				layer.transform,
				resizedSelection,
				'rotation',
				30
			);
		}
		const previousDocument = documentFixture(previousPage);
		const nextDocument = documentFixture(nextPage);
		const selectedIDs = nextPage.layers.map((layer) => layer.id);
		const mounted = await mountAdapter(previousDocument, previousPage);
		try {
			mounted.adapter.setSelection(selectedIDs);
			await settleCanvas();
			await mounted.adapter.sync(nextDocument, nextPage);
			await settleCanvas();

			expect(pixelDigest(mounted.canvas)).toBe(await freshRenderDigest(nextPage, selectedIDs));
		} finally {
			mounted.adapter.dispose();
		}
	});

	it('matches a fresh render after changing a line stroke', async () => {
		const previousPage = pageFixture([renderLayer('line', 96, 112, 168, 8, 'line', 0)]);
		const nextPage = structuredClone(previousPage);
		nextPage.layers[0].shape!.stroke_width = 10;
		const previousDocument = documentFixture(previousPage);
		const nextDocument = documentFixture(nextPage);
		const mounted = await mountAdapter(previousDocument, previousPage);
		try {
			await mounted.adapter.sync(nextDocument, nextPage);
			await settleCanvas();

			expect(pixelDigest(mounted.canvas)).toBe(await freshRenderDigest(nextPage, []));
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
				await browserPage.screenshot({
					element: mounted.canvas,
					path: `../../../../../test-results/text-outline-${position}.png`
				});
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

	it('renders a zero-width outline exactly like no outline', async () => {
		const layer = textLayer();
		layer.effects!.stroke!.width = 0;
		const page = pageFixture([layer]);
		const mounted = await mountAdapter(documentFixture(page), page, {
			staticCanvas: true
		});
		const plainPage = structuredClone(page);
		delete plainPage.layers[0].effects!.stroke;
		const plain = await mountAdapter(documentFixture(plainPage), plainPage, {
			staticCanvas: true
		});
		try {
			expect(pixelDigest(mounted.canvas)).toBe(pixelDigest(plain.canvas));
		} finally {
			mounted.adapter.dispose();
			plain.adapter.dispose();
		}
	});

	it('keeps an outside outline out of translucent glyph interiors', async () => {
		const layer = textLayer();
		layer.opacity = 0.5;
		const page = pageFixture([layer]);
		const mounted = await mountAdapter(documentFixture(page), page, { staticCanvas: true });
		const plainPage = structuredClone(page);
		delete plainPage.layers[0].effects!.stroke;
		const plain = await mountAdapter(documentFixture(plainPage), plainPage, { staticCanvas: true });
		try {
			const withoutOutline = plain.canvas.getContext('2d')!.getImageData(0, 0, 360, 240).data;
			const withOutline = mounted.canvas.getContext('2d')!.getImageData(0, 0, 360, 240).data;
			await browserPage.screenshot({
				element: mounted.canvas,
				path: '../../../../../test-results/text-outline-translucent.png'
			});
			await browserPage.screenshot({
				element: plain.canvas,
				path: '../../../../../test-results/text-plain-translucent.png'
			});
			let darkest = 255;
			for (let i = 0; i < withoutOutline.length; i += 4)
				darkest = Math.min(darkest, withoutOutline[i]);
			let glyphPixels = 0;
			const interiorOffsets = Array.from({ length: 7 }, (_, y) =>
				Array.from({ length: 7 }, (_, x) => ((y - 3) * 360 + x - 3) * 4)
			).flat();
			for (let i = 0; i < withoutOutline.length; i += 4) {
				if (interiorOffsets.some((offset) => withoutOutline[i + offset] > darkest + 1)) continue;
				glyphPixels++;
				expect(Array.from(withOutline.slice(i, i + 4))).toEqual(
					Array.from(withoutOutline.slice(i, i + 4))
				);
			}
			expect(glyphPixels).toBeGreaterThan(100);
		} finally {
			mounted.adapter.dispose();
			plain.adapter.dispose();
		}
	});

	it('refreshes the outline while typing and keeps it below later layers', async () => {
		const page = pageFixture([textLayer(), renderLayer('cover', 50, 50, 40, 80)]);
		const mounted = await mountAdapter(documentFixture(page), page);
		try {
			const { canvas, objectByLayerID } = adapterInternals<{
				canvas: Canvas;
				objectByLayerID: Map<string, IText>;
			}>(mounted.adapter);
			const target = objectByLayerID.get('text')!;
			canvas.setActiveObject(target);
			target.enterEditing();
			target.set({ text: 'HELLO\nTHERE' });
			target.initDimensions();
			target.selectionStart = 5;
			target.selectionEnd = 5;
			canvas.fire('text:changed', { target });
			expect(target.isEditing).toBe(true);
			expect(target.selectionStart).toBe(5);
			target.exitEditing();
			canvas.discardActiveObject();
			await settleCanvas();
			const updated = structuredClone(page);
			updated.layers[0].text!.text = 'HELLO\nTHERE';
			const fresh = await mountAdapter(documentFixture(updated), updated);
			try {
				await settleCanvas();
				expect(pixelDigest(mounted.canvas)).toBe(pixelDigest(fresh.canvas));
			} finally {
				fresh.adapter.dispose();
			}
		} finally {
			mounted.adapter.dispose();
		}
	});
});

describe('OpenPost Image Editor page gradient rendering', () => {
	it.each(['diamond', 'reflected'] as const)(
		'renders %s from a colored center to matching outer edges',
		async (type: ImageEditorGradientType) => {
			const page = pageFixture();
			page.background = {
				type: 'gradient',
				opacity: 1,
				gradient: {
					type,
					start: { x: 180, y: 120 },
					end: { x: 360, y: 120 },
					reverse: false,
					stops: [
						{ offset: 0, color: '#f97316' },
						{ offset: 1, color: '#7c3aed' }
					]
				}
			};
			const document = documentFixture(page);
			const mounted = await mountAdapter(document, page);
			try {
				await settleCanvas();
				const center = pixelAt(mounted.canvas, 180, 120);
				const left = pixelAt(mounted.canvas, 1, 120);
				const right = pixelAt(mounted.canvas, 358, 120);

				expect(center[0]).toBeGreaterThan(center[2]);
				expect(left[2]).toBeGreaterThan(left[0]);
				expect(right[2]).toBeGreaterThan(right[0]);
				for (let channel = 0; channel < 4; channel++) {
					expect(Math.abs(left[channel] - right[channel])).toBeLessThanOrEqual(3);
				}
			} finally {
				mounted.adapter.dispose();
			}
		}
	);

	it('scales a capped Diamond bitmap across interactive and static preview canvases', async () => {
		const width = 2048;
		const height = 1024;
		const page = pageFixture();
		page.background = {
			type: 'gradient',
			opacity: 1,
			gradient: {
				type: 'diamond',
				start: { x: width / 2, y: height / 2 },
				end: { x: width, y: height / 2 },
				reverse: false,
				stops: [
					{ offset: 0, color: '#f97316' },
					{ offset: 1, color: '#7c3aed' }
				]
			}
		};
		const document = documentFixture(page, width, height);
		const interactive = await mountAdapter(document, page);
		const exported = await mountAdapter(document, page, { staticCanvas: true });
		const staticPreview = await mountAdapter(document, page, {
			staticCanvas: true,
			renderScale: 0.25
		});
		try {
			await settleCanvas();
			expect(interactive.canvas).toMatchObject({ width, height });
			expect(exported.canvas).toMatchObject({ width, height });
			expect(staticPreview.canvas).toMatchObject({ width: 512, height: 256 });

			for (const point of [
				{ x: 0.5, y: 0.5 },
				{ x: 0.9, y: 0.5 },
				{ x: 0.5, y: 0.9 }
			]) {
				const exportPixel = pixelAtRatio(exported.canvas, point.x, point.y);
				const interactivePixel = pixelAtRatio(interactive.canvas, point.x, point.y);
				const previewPixel = pixelAtRatio(staticPreview.canvas, point.x, point.y);
				expect(interactivePixel[3]).toBe(255);
				expect(previewPixel[3]).toBe(255);
				expectPixelsClose(interactivePixel, exportPixel);
				expectPixelsClose(previewPixel, exportPixel);
			}
		} finally {
			interactive.adapter.dispose();
			exported.adapter.dispose();
			staticPreview.adapter.dispose();
		}
	});
});
