import { describe, expect, it } from 'vitest';
import { OpenPostFabricAdapter } from './fabric-adapter';
import type {
	ImageEditorDocument,
	ImageEditorGradientType,
	ImageEditorLayer,
	ImageEditorPage
} from './types';

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

function documentFixture(page: ImageEditorPage): ImageEditorDocument {
	return {
		schema_version: 1,
		title: 'Fabric regression',
		preset_key: 'custom',
		width_px: 360,
		height_px: 240,
		brand_kit_revision: 0,
		export_defaults: { format: 'png', quality: 0.92, matte_color: '#ffffff' },
		pages: [page]
	};
}

async function mountAdapter(document: ImageEditorDocument, page: ImageEditorPage) {
	const canvas = window.document.createElement('canvas');
	window.document.body.append(canvas);
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document,
		page,
		readOnly: false,
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
});
