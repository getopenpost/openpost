import { describe, expect, it, vi } from 'vitest';
import {
	defaultImageAdjustments,
	defaultImageEditorPageBackground,
	defaultTransform
} from '$lib/image-editor/document';
import { renderImageEditorPage, renderImageEditorPreview } from '$lib/image-editor/static-renderer';
import type { ImageEditorDocument } from '$lib/image-editor/types';
import { CanvasStackCompositor } from '$lib/video-editor/media/canvas-stack-compositor';
import { createGpuCompositor } from '$lib/video-editor/effects/gpu/compositor';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	applyImageGradePixels,
	editorColorGradeAdjustmentsToEffects,
	ImageGradeRenderer
} from './image-grade';
import { defaultEditorColorGradeAdjustments } from './model';

const grade = {
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

async function blobCenterPixel(blob: Blob): Promise<number[]> {
	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas has no 2D context.');
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return [
		...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
	];
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed.'))));
	});
}

describe('shared still and video color rendering', () => {
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
		const cpuPixels = new Uint8ClampedArray(input);
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

	it('keeps a versioned image-layer grade through document reload, preview, and export', async () => {
		const source = document.createElement('canvas');
		source.width = 16;
		source.height = 16;
		const sourceContext = source.getContext('2d');
		if (!sourceContext) throw new Error('Canvas has no 2D context.');
		sourceContext.fillStyle = '#204060';
		sourceContext.fillRect(0, 0, 16, 16);
		const sourceBlob = await canvasBlob(source);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(() => Promise.resolve(new Response(sourceBlob, { status: 200 })));

		try {
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
						transform: defaultTransform(16, 16),
						image: {
							media_id: 'media',
							source_width: 16,
							source_height: 16,
							fit: 'stretch' as const,
							crop: { x: 0, y: 0, width: 1, height: 1 },
							adjustments: { ...defaultImageAdjustments(), ...grade },
							color_grade_version: 1 as const
						}
					}
				]
			};
			const imageDocument: ImageEditorDocument = {
				schema_version: 1,
				title: 'Graded layer',
				preset_key: 'square',
				width_px: 16,
				height_px: 16,
				brand_kit_revision: 0,
				export_defaults: { format: 'png', quality: 1, matte_color: '#ffffff' },
				pages: [page]
			};
			const reloaded = structuredClone(imageDocument);
			const exported = await renderImageEditorPage(reloaded, reloaded.pages[0], 0);
			const preview = await renderImageEditorPreview(reloaded, reloaded.pages[0]);
			const exportedPixel = await blobCenterPixel(exported.blob);
			const previewPixel = await blobCenterPixel(preview);

			expect(reloaded.pages[0].layers[0]?.image?.color_grade_version).toBe(1);
			expect(exportedPixel).not.toEqual([32, 64, 96, 255]);
			for (let channel = 0; channel < 4; channel += 1) {
				expect(
					Math.abs((exportedPixel[channel] ?? 0) - (previewPixel[channel] ?? 0))
				).toBeLessThanOrEqual(4);
			}
		} finally {
			fetchMock.mockRestore();
		}
	});
});
