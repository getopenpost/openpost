import { describe, expect, it, vi } from 'vitest';
import { FabricImage } from 'fabric';
import {
	defaultImageAdjustments,
	defaultImageEditorPageBackground,
	defaultTransform
} from '$lib/image-editor/document';
import { renderImageEditorPage, renderImageEditorPreview } from '$lib/image-editor/static-renderer';
import { OpenPostFabricAdapter } from '$lib/image-editor/fabric-adapter';
import type { ImageEditorDocument } from '$lib/image-editor/types';
import { CanvasStackCompositor } from '$lib/video-editor/media/canvas-stack-compositor';
import { createGpuCompositor } from '$lib/video-editor/effects/gpu/compositor';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	applyImageGradePixels,
	editorColorGradeAdjustmentsToEffects,
	ImageGradeRenderer
} from './image-grade';
import { renderColorEffectsWithCanvas2D } from './cpu-renderer';
import { defaultEditorColorGradeAdjustments, defaultEditorColorWheels } from './model';

const grade = {
	wheels: {
		...defaultEditorColorWheels(),
		shadowsHue: 40,
		shadowsAmount: 0.2,
		midtonesHue: 180,
		midtonesAmount: 0.15,
		offset: 0.03,
		gamma: 1.1,
		gain: 0.9
	},
	curves: { masterPoints: '[[0,0],[0.5,0.6],[1,1]]' },
	brightness: 0.08,
	contrast: 0.12,
	saturation: -0.18,
	temperature: 0.14,
	tint: -0.05,
	vibrance: 0.2,
	hue: 0.08,
	exposure: 0.06,
	highlights: -0.09,
	shadows: 0.11
};

function pixels(source: HTMLCanvasElement): Uint8ClampedArray {
	const canvas = document.createElement('canvas');
	canvas.width = source.width;
	canvas.height = source.height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas has no 2D context.');
	context.drawImage(source, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

async function blobCenterPixel(blob: Blob, x = 0.5): Promise<number[]> {
	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas has no 2D context.');
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return [
		...context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height / 2), 1, 1).data
	];
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed.'))));
	});
}

function gradedLayerDocument(sourceSize: number): ImageEditorDocument {
	const page = {
		id: 'page',
		name: 'Page 1',
		background_color: '#ffffff',
		background: defaultImageEditorPageBackground('#ffffff'),
		layers: [
			{
				id: 'image',
				type: 'image' as const,
				name: 'Image',
				visible: true,
				locked: false,
				opacity: 1,
				transform: defaultTransform(sourceSize / 2, sourceSize / 2),
				image: {
					media_id: 'media',
					source_width: sourceSize,
					source_height: sourceSize,
					fit: 'stretch' as const,
					crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
					adjustments: { ...defaultImageAdjustments(), ...grade },
					color_grade_version: 1 as const
				}
			}
		]
	};
	return {
		schema_version: 1,
		title: 'Graded layer',
		preset_key: 'square',
		width_px: sourceSize / 2,
		height_px: sourceSize / 2,
		brand_kit_revision: 0,
		export_defaults: { format: 'png', quality: 1, matte_color: '#ffffff' },
		pages: [page]
	};
}

describe('shared still and video color rendering', () => {
	it('renders ImageData through the Canvas2D fallback', () => {
		const source = new ImageData(new Uint8ClampedArray([24, 96, 180, 255]), 1, 1);
		const target = document.createElement('canvas');
		expect(renderColorEffectsWithCanvas2D(target, source, 1, 1, [])).toBe(true);
		expect([...target.getContext('2d')!.getImageData(0, 0, 1, 1).data]).toEqual([24, 96, 180, 255]);
	});

	it('keeps the Canvas2D fallback within two channel values of the GPU path', () => {
		const source = document.createElement('canvas');
		source.width = 2;
		source.height = 1;
		const context = source.getContext('2d');
		if (!context) throw new Error('Canvas has no 2D context.');
		const input = new Uint8ClampedArray([24, 96, 180, 73, 230, 140, 32, 211]);
		context.putImageData(new ImageData(input, 2, 1), 0, 0);

		const renderer = new ImageGradeRenderer(createGpuCompositor);
		const rendered = renderer.render(source, 2, 1, grade);
		expect(rendered?.backend).toBe('gpu');
		if (!rendered) throw new Error('GPU color grade did not render.');
		const gpuPixels = pixels(rendered.canvas);
		// Both paths start from the canvas after its alpha premultiplication round trip.
		const cpuPixels = pixels(source);
		applyImageGradePixels(cpuPixels, grade);
		renderer.dispose();

		for (let index = 0; index < gpuPixels.length; index += 1) {
			expect(Math.abs((gpuPixels[index] ?? 0) - (cpuPixels[index] ?? 0))).toBeLessThanOrEqual(2);
		}
	});

	it('renders the same source frame through image and video adapters within tolerance', () => {
		const source = document.createElement('canvas');
		source.width = 2;
		source.height = 1;
		const context = source.getContext('2d');
		if (!context) throw new Error('Canvas has no 2D context.');
		context.putImageData(
			new ImageData(new Uint8ClampedArray([18, 92, 176, 255, 224, 138, 37, 123]), 2, 1),
			0,
			0
		);
		const stillRenderer = new ImageGradeRenderer(createGpuCompositor);
		const still = stillRenderer.render(source, 2, 1, grade);
		if (!still) throw new Error('Image adapter did not render.');

		const videoCanvas = document.createElement('canvas');
		const stack = new CanvasStackCompositor(videoCanvas);
		stack.beginFrame(2, 1, null);
		stack.compositeLayer(
			{ source, width: 2, height: 1 },
			{
				id: 'source',
				trackId: 'video',
				from: 0,
				durationInFrames: 1,
				label: 'Source',
				type: 'image',
				transform: { width: 2, height: 1 }
			},
			1,
			0
		);
		stack.applyOutputEffects(
			editorColorGradeAdjustmentsToEffects(grade).map((effect, index) => ({
				...effect,
				id: `shared-grade-${index}`,
				type: 'gpu' as const,
				enabled: true
			})),
			0
		);
		const stillPixels = pixels(still.canvas);
		const videoPixels = pixels(videoCanvas);
		for (let index = 0; index < stillPixels.length; index += 1) {
			expect(Math.abs((stillPixels[index] ?? 0) - (videoPixels[index] ?? 0))).toBeLessThanOrEqual(
				2
			);
		}
		stillRenderer.dispose();
		stack.dispose();
	});

	it('grades the fully composited sequence frame', () => {
		const output = document.createElement('canvas');
		const base = document.createElement('canvas');
		const overlay = document.createElement('canvas');
		for (const canvas of [base, overlay]) {
			canvas.width = 2;
			canvas.height = 2;
		}
		const baseContext = base.getContext('2d');
		const overlayContext = overlay.getContext('2d');
		if (!baseContext || !overlayContext) throw new Error('Canvas has no 2D context.');
		baseContext.fillStyle = '#204060';
		baseContext.fillRect(0, 0, 2, 2);
		overlayContext.fillStyle = '#d08020';
		overlayContext.fillRect(0, 0, 2, 2);
		const item = (id: string): TimelineItem => ({
			id,
			trackId: id,
			from: 0,
			durationInFrames: 1,
			label: id,
			type: 'image',
			transform: { width: 2, height: 2 }
		});
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(2, 2, null);
		stack.compositeLayer({ source: base, width: 2, height: 2 }, item('base'), 1, 0);
		stack.compositeLayer({ source: overlay, width: 2, height: 2 }, item('overlay'), 0.5, 0);
		const expected = pixels(output);
		applyImageGradePixels(expected, {
			...defaultEditorColorGradeAdjustments(),
			vibrance: 0.6,
			hue: 0.12
		});

		stack.applyOutputEffects(
			[
				{
					id: 'sequence-grade',
					type: 'gpu',
					effectId: 'gpu-vibrance',
					enabled: true,
					params: { amount: 0.6 }
				},
				{
					id: 'sequence-hue',
					type: 'gpu',
					effectId: 'gpu-hue-shift',
					enabled: true,
					params: { shift: 0.12, span: 1, flow: 0 }
				}
			],
			0
		);
		const actual = pixels(output);
		stack.dispose();

		for (let index = 0; index < actual.length; index += 1) {
			expect(Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))).toBeLessThanOrEqual(2);
		}
	});

	it('renders a persisted page output grade consistently in preview and PNG export', async () => {
		const page = {
			id: 'page',
			name: 'Page 1',
			background_color: '#204060',
			background: defaultImageEditorPageBackground('#204060'),
			color_grade_version: 1 as const,
			color_grade: grade,
			layers: []
		};
		const imageDocument: ImageEditorDocument = {
			schema_version: 1,
			title: 'Graded page',
			preset_key: 'square',
			width_px: 16,
			height_px: 16,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 1, matte_color: '#ffffff' },
			pages: [page]
		};

		const exported = await renderImageEditorPage(imageDocument, page, 0);
		const preview = await renderImageEditorPreview(imageDocument, page);
		const exportedPixel = await blobCenterPixel(exported.blob);
		const previewPixel = await blobCenterPixel(preview);

		expect(exportedPixel).not.toEqual([32, 64, 96, 255]);
		for (let channel = 0; channel < 4; channel += 1) {
			expect(
				Math.abs((exportedPixel[channel] ?? 0) - (previewPixel[channel] ?? 0))
			).toBeLessThanOrEqual(4);
		}
	});

	it.each<{
		sourceSize: number;
		cropSize: number;
		fit?: 'cover' | 'contain';
		blur?: number;
		masked?: boolean;
	}>([
		{ sourceSize: 64, cropSize: 0.5 },
		{ sourceSize: 2048, cropSize: 0.5 },
		{ sourceSize: 2048, cropSize: 0.01 },
		{ sourceSize: 2048, cropSize: 0.5, fit: 'cover' },
		{ sourceSize: 2048, cropSize: 0.5, fit: 'contain', masked: true },
		{ sourceSize: 2048, cropSize: 0.5, blur: 0.2 }
	])(
		'keeps a $sourceSize px source with crop $cropSize and fit $fit through reload, bounded preview, and full export',
		async ({ sourceSize, cropSize, fit, blur = 0, masked = false }) => {
			const source = document.createElement('canvas');
			source.width = sourceSize;
			source.height = sourceSize;
			const sourceContext = source.getContext('2d');
			if (!sourceContext) throw new Error('Canvas has no 2D context.');
			sourceContext.fillStyle = '#204060';
			sourceContext.fillRect(0, 0, sourceSize, sourceSize);
			sourceContext.fillStyle = '#a04020';
			sourceContext.fillRect(sourceSize / 2, 0, sourceSize / 2, sourceSize);
			sourceContext.fillStyle = '#00ff00';
			sourceContext.fillRect(0, 0, sourceSize / 4, sourceSize);
			sourceContext.fillRect((sourceSize * 3) / 4, 0, sourceSize / 4, sourceSize);
			if (masked)
				sourceContext.clearRect(
					sourceSize / 4,
					(sourceSize * 3) / 8,
					sourceSize / 4,
					sourceSize / 4
				);
			const sourceBlob = await canvasBlob(source);
			const fetchMock = vi
				.spyOn(globalThis, 'fetch')
				.mockImplementation(() => Promise.resolve(new Response(sourceBlob, { status: 200 })));

			const uploadedWidths: number[] = [];
			const renderGrade = ImageGradeRenderer.prototype.render;
			const renderSpy = vi
				.spyOn(ImageGradeRenderer.prototype, 'render')
				.mockImplementation(function (this: ImageGradeRenderer, input, width, height, adjustments) {
					if (!('width' in input))
						throw new Error('Expected an image grade input with pixel dimensions.');
					uploadedWidths.push(input.width);
					return renderGrade.call(this, input, width, height, adjustments);
				});
			try {
				const imageDocument = gradedLayerDocument(sourceSize);
				const imageLayer = imageDocument.pages[0].layers[0];
				const cropHeight = fit ? cropSize / 2 : cropSize;
				imageLayer.image!.crop = {
					x: (1 - cropSize) / 2,
					y: (1 - cropHeight) / 2,
					width: cropSize,
					height: cropHeight
				};
				imageLayer.image!.fit = fit ?? 'stretch';
				imageLayer.image!.adjustments.blur = blur;
				if (masked) imageLayer.mask = { shape: 'ellipse', inset: 0, radius: 0 };
				const reloaded = structuredClone(imageDocument);
				const exported = await renderImageEditorPage(reloaded, reloaded.pages[0], 0);
				expect(renderSpy.mock.calls.at(-1)?.slice(1, 3)).toEqual([sourceSize, sourceSize]);
				renderSpy.mockClear();
				uploadedWidths.length = 0;
				const preview = await renderImageEditorPreview(reloaded, reloaded.pages[0]);
				const previewLimit = sourceSize <= 512 ? sourceSize : blur ? 1024 : 512;
				for (const [, width, height] of renderSpy.mock.calls) {
					expect(width).toBeLessThanOrEqual(previewLimit);
					expect(height).toBeLessThanOrEqual(previewLimit);
				}

				expect(renderSpy).toHaveBeenCalled();
				for (const width of uploadedWidths) expect(width).toBeLessThanOrEqual(previewLimit);
				const exportedSamples = await Promise.all(
					[0.25, 0.75].map((x) => blobCenterPixel(exported.blob, x))
				);
				const previewSamples = await Promise.all(
					[0.25, 0.75].map((x) => blobCenterPixel(preview, x))
				);
				expect(exportedSamples[0]).not.toEqual(exportedSamples[1]);
				if (masked) expect(exportedSamples[0]).toEqual([255, 255, 255, 255]);
				for (let sample = 0; sample < 2; sample++) {
					for (let channel = 0; channel < 4; channel++) {
						expect(
							Math.abs(exportedSamples[sample][channel] - previewSamples[sample][channel])
						).toBeLessThanOrEqual(4);
					}
				}
			} finally {
				fetchMock.mockRestore();
				renderSpy.mockRestore();
			}
		}
	);
	it('reuses grading for geometry edits and restores canceled color previews', async () => {
		const source = document.createElement('canvas');
		source.width = source.height = 32;
		const context = source.getContext('2d')!;
		context.fillStyle = '#204060';
		context.fillRect(0, 0, 32, 32);
		const sourceBlob = await canvasBlob(source);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(() => Promise.resolve(new Response(sourceBlob)));
		const renderSpy = vi.spyOn(ImageGradeRenderer.prototype, 'render');
		const filterSpy = vi.spyOn(FabricImage.prototype, 'applyFilters');
		const canvas = document.createElement('canvas');
		const imageDocument = gradedLayerDocument(32);
		const page = imageDocument.pages[0];
		page.layers[0].image!.adjustments.blur = 0.2;
		const adapter = new OpenPostFabricAdapter({
			canvas,
			document: imageDocument,
			page,
			readOnly: false,
			onSelection() {},
			onTransform() {},
			onTextChange() {}
		});
		try {
			await adapter.mount();
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			const initialPixel = Array.from(adapter.samplePagePixel({ x: 8, y: 8 })!);
			renderSpy.mockClear();
			filterSpy.mockClear();
			const moved = structuredClone(imageDocument);
			moved.pages[0].layers[0].transform.x = 2;
			moved.pages[0].layers[0].opacity = 0.5;
			await adapter.sync(moved, moved.pages[0]);
			expect(renderSpy).not.toHaveBeenCalled();
			expect(filterSpy).not.toHaveBeenCalled();
			const draft = structuredClone(moved.pages[0].layers[0]);
			draft.image!.adjustments.brightness = 0.8;
			adapter.previewImageLayer('image', draft);
			expect(renderSpy).toHaveBeenCalledTimes(1);
			adapter.previewImageLayer('image');
			expect(renderSpy).toHaveBeenCalledTimes(2);
			await adapter.sync(imageDocument, page);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			expect(Array.from(adapter.samplePagePixel({ x: 8, y: 8 })!)).toEqual(initialPixel);
		} finally {
			adapter.dispose();
			fetchMock.mockRestore();
			renderSpy.mockRestore();
			filterSpy.mockRestore();
		}
	});
});
