import { describe, expect, it } from 'vitest';
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
	it('uses the same member geometry for numeric and pointer selection rotation', async () => {
		interface ActiveSelectionFixture {
			angle: number;
			set(updates: { angle: number }): void;
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
			renderLayer('one', 10, 10, 80, 80),
			renderLayer('two', 210, 10, 80, 80)
		]);
		const document = documentFixture(page);
		const mounted = await mountAdapter(document, page);
		try {
			mounted.adapter.setSelection(['one', 'two']);
			await settleCanvas();
			const internals = adapterInternals<CollectiveTransformAdapterInternals>(mounted.adapter);
			const activeSelection = internals.canvas.getActiveObject();
			activeSelection.set({ angle: 90 });
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
					'rotation',
					90
				);
				const pointer = pointerTransforms.get(layer.id)!;
				expect(numeric.x).toBeCloseTo(pointer.x);
				expect(numeric.y).toBeCloseTo(pointer.y);
				expect(numeric.rotation).toBeCloseTo(pointer.rotation);
			}
		} finally {
			mounted.adapter.dispose();
		}
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
