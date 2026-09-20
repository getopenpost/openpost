import { describe, expect, it } from 'vitest';
import { ImageEditorController } from './editor.svelte';
import { defaultTransform } from './document';
import { defaultEditorColorGradeAdjustments } from '$lib/editor-color-grade/model';
import { prepareRasterOperation, rasterRenderDocument } from './raster-operations';
import { renderImageEditorPage } from './static-renderer';
import { registerLocalImageEditorMedia, releaseLocalImageEditorMedia } from './local-media-url';
import type { ImageEditorDocument, ImageEditorLayer } from './types';

function fixture(): ImageEditorDocument {
	const shape = (id: string, fill: string, x: number): ImageEditorLayer => ({
		id,
		name: id,
		type: 'shape',
		visible: true,
		locked: false,
		opacity: 0.7,
		transform: { ...defaultTransform(50, 40, x, 20), rotation: 10 },
		shape: { kind: 'rectangle', fill, stroke: '#000000', stroke_width: 2, radius: 0 },
		mask: { shape: 'ellipse', inset: 1, radius: 0 }
	});
	return {
		schema_version: 1,
		title: 'Pixels',
		preset_key: 'custom',
		width_px: 120,
		height_px: 100,
		brand_kit_revision: 0,
		export_defaults: { format: 'png', quality: 1, matte_color: '#ffffff' },
		pages: [
			{
				id: 'page',
				name: 'Page',
				background_color: '#ccddee',
				color_grade_version: 1,
				color_grade: { ...defaultEditorColorGradeAdjustments(), exposure: 0.4, saturation: -0.2 },
				layers: [shape('red', '#ff0000', 15), shape('blue', '#0000ff', 35)]
			}
		]
	};
}
async function pixels(document: ImageEditorDocument): Promise<Uint8ClampedArray> {
	const rendered = await renderImageEditorPage(document, document.pages[0], 0);
	const bitmap = await createImageBitmap(rendered.blob);
	const canvas = window.document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d')!;
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
describe('raster operations through the real renderer', () => {
	it.each(['merge_selected', 'flatten_page'] as const)(
		'preserves masked, rotated, overlapping pixels through %s and undo',
		async (kind) => {
			const editor = new ImageEditorController();
			editor.load({
				id: 'pixel-design',
				workspace_id: '',
				created_by_id: '',
				revision: 1,
				can_edit: true,
				created_at: '',
				updated_at: '',
				document: fixture()
			});
			const original = await pixels(editor.document!);
			const plan = prepareRasterOperation(editor.document!, 'page', ['red', 'blue'], kind)!;
			const snapshot = rasterRenderDocument(plan);
			const rendered = await renderImageEditorPage(snapshot, snapshot.pages[0], 0);
			const mediaID = `local_media_${crypto.randomUUID()}`;
			registerLocalImageEditorMedia(mediaID, rendered.blob);
			try {
				expect(editor.commitRasterOperation(plan, mediaID, 'Bake')).toBe(true);
				const baked = await pixels(editor.document!);
				expect(baked.length).toBe(original.length);
				let maximumDifference = 0;
				for (let index = 0; index < baked.length; index++)
					maximumDifference = Math.max(maximumDifference, Math.abs(baked[index] - original[index]));
				// Transparent PNG round-trips add one premultiplied-alpha rounding step before grading.
				expect(maximumDifference).toBeLessThanOrEqual(3);
				editor.undo();
				expect(await pixels(editor.document!)).toEqual(original);
			} finally {
				releaseLocalImageEditorMedia(mediaID);
			}
		}
	);
});
