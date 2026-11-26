import { describe, expect, it } from 'vitest';
import {
	blankImageEditorDocument,
	cloneImageEditorPage,
	defaultTransform,
	validateImageEditorDocument
} from './document';
import { resizeImageEditorPage } from './resize';
import type { ImageEditorLayer, ImageEditorPreset } from './types';

const preset: ImageEditorPreset = {
	key: 'test-landscape',
	name: 'Test landscape',
	width_px: 100,
	height_px: 50,
	default_format: 'png',
	profiles: []
};

function rectangleLayer(): ImageEditorLayer {
	return {
		id: 'shape',
		type: 'shape',
		name: 'Shape',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(40, 20, 30, 15),
		shape: {
			kind: 'rounded_rectangle',
			fill: '#f97316',
			stroke: '#000000',
			stroke_width: 2,
			radius: 4
		}
	};
}

describe('OpenPost Image Editor design resize', () => {
	it('resizes only the selected page and keeps other page formats intact', () => {
		const source = blankImageEditorDocument({
			...preset,
			width_px: 128,
			height_px: 128
		});
		const second = cloneImageEditorPage(source.pages[0], 'Second page');
		second.width_px = 200;
		second.height_px = 100;
		second.layers.push(rectangleLayer());
		source.pages.push(second);
		const resized = resizeImageEditorPage(source, second.id, {
			width: 100,
			height: 200,
			mode: 'fit'
		});
		expect(resized.width_px).toBe(128);
		expect(resized.pages[0]).toBe(source.pages[0]);
		expect(resized.pages[1]).toMatchObject({ width_px: 100, height_px: 200 });
		expect(resized.pages[1].layers[0].transform).toMatchObject({
			x: 15,
			y: 82.5,
			width: 20,
			height: 10
		});
		expect(source.pages[1]).toMatchObject({ width_px: 200, height_px: 100 });
		expect(validateImageEditorDocument(resized)).toEqual([]);
	});
});
