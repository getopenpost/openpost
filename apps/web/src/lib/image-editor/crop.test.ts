import { describe, expect, it } from 'vitest';
import {
	applyImageEditorCropWindow,
	imageEditorCropWindowForAspect,
	normalizeImageEditorCropWindow,
	resetImageEditorCrop
} from './crop';
import type { ImageEditorLayer } from './types';

function layer(overrides: Partial<ImageEditorLayer['transform']> = {}): ImageEditorLayer {
	return {
		id: 'image',
		type: 'image',
		name: 'Image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: {
			x: 100,
			y: 200,
			width: 400,
			height: 200,
			rotation: 0,
			flip_x: false,
			flip_y: false,
			...overrides
		},
		image: {
			media_id: 'media',
			source_width: 800,
			source_height: 400,
			fit: 'stretch',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: {
				brightness: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				tint: 0,
				vibrance: 0,
				hue: 0,
				exposure: 0,
				highlights: 0,
				shadows: 0,
				blur: 0
			}
		}
	};
}

describe('OpenPost Image Editor interactive crop geometry', () => {
	it('clamps interactive crop windows to a non-empty source region', () => {
		expect(normalizeImageEditorCropWindow({ x: -1, y: 0.9, width: 2, height: 0 })).toEqual({
			x: 0,
			y: 0.9,
			width: 1,
			height: 0.005
		});
	});

	it('crops the source and outer transform in one coordinate-preserving operation', () => {
		const result = applyImageEditorCropWindow(layer(), {
			x: 0.25,
			y: 0.25,
			width: 0.5,
			height: 0.5
		});

		expect(result.crop).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
		expect(result.transform).toMatchObject({ x: 200, y: 250, width: 200, height: 100 });
	});

	it('repositions source pixels without moving the outer crop frame', () => {
		const result = applyImageEditorCropWindow(
			layer(),
			{ x: 0.25, y: 0, width: 0.5, height: 1 },
			{ x: 0.4, y: 0, width: 0.5, height: 1 }
		);

		expect(result.crop).toEqual({ x: 0.4, y: 0, width: 0.5, height: 1 });
		expect(result.transform).toMatchObject({ x: 200, y: 200, width: 200, height: 200 });
	});

	it('rotates the crop offset with the image and maps flipped source coordinates', () => {
		const result = applyImageEditorCropWindow(layer({ rotation: 90, flip_x: true }), {
			x: 0.1,
			y: 0.25,
			width: 0.5,
			height: 0.5
		});

		expect(result.crop).toMatchObject({ x: 0.4, y: 0.25, width: 0.5, height: 0.5 });
		expect(result.transform.x).toBeCloseTo(50);
		expect(result.transform.y).toBeCloseTo(240);
	});

	it('creates centered crop windows for common aspect ratios', () => {
		expect(imageEditorCropWindowForAspect(layer().transform, 1)).toEqual({
			x: 0.25,
			y: 0,
			width: 0.5,
			height: 1
		});
	});

	it('restores the full source and expands the transform after an earlier crop', () => {
		const cropped = layer();
		cropped.transform = { ...cropped.transform, x: 200, y: 250, width: 200, height: 100 };
		cropped.image!.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

		const result = resetImageEditorCrop(cropped);

		expect(result.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(result.transform).toMatchObject({ x: 100, y: 200, width: 400, height: 200 });
	});
});
