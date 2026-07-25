import { describe, expect, it } from 'vitest';
import { computeImageGeometry } from './fabric-adapter';
import type { StudioLayer } from './types';

function imageLayer(
	width: number,
	height: number,
	fit: NonNullable<StudioLayer['image']>['fit'] = 'cover'
): StudioLayer {
	return {
		id: 'layer-image',
		type: 'image',
		name: 'Image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: {
			x: 40,
			y: 80,
			width,
			height,
			rotation: 0,
			flip_x: false,
			flip_y: false
		},
		image: {
			media_id: 'media-image',
			source_width: 1920,
			source_height: 1080,
			fit,
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: {
				brightness: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				exposure: 0,
				highlights: 0,
				shadows: 0,
				blur: 0
			}
		}
	};
}

describe('Studio image geometry', () => {
	it('keeps cover pixels flush with a resized frame', () => {
		const geometry = computeImageGeometry(imageLayer(1200, 1200), 1920, 1080);

		expect(geometry.left).toBe(40);
		expect(geometry.top).toBe(80);
		expect(geometry.width * geometry.scaleX).toBeCloseTo(1200);
		expect(geometry.height * geometry.scaleY).toBeCloseTo(1200);
		expect(geometry.cropX).toBeCloseTo(420);
		expect(geometry.cropY).toBe(0);
	});

	it('recomputes stretch scale from source pixels after repeated resizes', () => {
		const first = computeImageGeometry(imageLayer(960, 540, 'stretch'), 1920, 1080);
		const second = computeImageGeometry(imageLayer(1440, 810, 'stretch'), 1920, 1080);

		expect(first.width).toBe(1920);
		expect(first.scaleX).toBe(0.5);
		expect(second.width).toBe(1920);
		expect(second.scaleX).toBe(0.75);
		expect(second.width * second.scaleX).toBe(1440);
		expect(second.height * second.scaleY).toBe(810);
	});
});
