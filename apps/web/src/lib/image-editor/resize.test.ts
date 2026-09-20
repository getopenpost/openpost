import { describe, expect, it } from 'vitest';
import {
	blankImageEditorDocument,
	defaultTransform,
	validateImageEditorDocument
} from './document';
import { resizeImageEditorDocument } from './resize';
import type { ImageEditorLayer, ImageEditorPreset } from './types';

const preset: ImageEditorPreset = {
	key: 'test-landscape',
	name: 'Test landscape',
	width_px: 100,
	height_px: 50,
	default_format: 'png',
	profiles: []
};

function textLayer(): ImageEditorLayer {
	return {
		id: 'text',
		type: 'text',
		name: 'Text',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(20, 10, 10, 5),
		text: {
			text: 'OpenPost',
			font_family: 'Geist',
			font_weight: 500,
			font_style: 'normal',
			font_size: 12,
			color: '#000000',
			align: 'left',
			line_height: 1.2,
			letter_spacing: 0,
			stroke_width: 1,
			shadow: { color: '#000000', blur: 3, offset_x: 2, offset_y: -1 }
		},
		effects: {
			blend_mode: 'normal',
			drop_shadow: { color: '#000000', opacity: 0.5, blur: 5, angle: 45, distance: 3 },
			inner_shadow: { color: '#000000', opacity: 0.5, blur: 4, angle: 90, distance: 2 },
			stroke: { color: '#ffffff', opacity: 1, width: 2, position: 'inside' }
		},
		mask: { shape: 'rounded_rectangle', inset: 2, radius: 4 }
	};
}

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

function documentFixture() {
	const document = blankImageEditorDocument(preset);
	document.pages[0].layers = [
		textLayer(),
		rectangleLayer(),
		{
			id: 'paint',
			type: 'paint',
			name: 'Paint gradient',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(40, 20, 30, 15),
			paint: {
				kind: 'gradient',
				color: '#f97316',
				size: 1,
				opacity: 1,
				source_width: 40,
				source_height: 20,
				points: [],
				spans: [{ x: 0, y: 0, width: 40 }],
				gradient: {
					type: 'linear',
					start: { x: 0, y: 10 },
					end: { x: 40, y: 10 },
					stops: [
						{ offset: 0, color: '#f97316' },
						{ offset: 1, color: '#7c3aed' }
					],
					reverse: false
				}
			}
		}
	];
	document.pages[0].guides = { horizontal: [10], vertical: [25] };
	document.pages[0].background = {
		type: 'gradient',
		opacity: 1,
		gradient: {
			type: 'linear',
			start: { x: 0, y: 25 },
			end: { x: 100, y: 25 },
			stops: [
				{ offset: 0, color: '#f97316' },
				{ offset: 1, color: '#7c3aed' }
			],
			reverse: false
		}
	};
	return document;
}

describe('OpenPost Image Editor design resize', () => {
	it('fits content uniformly around the canvas center without changing the source document', () => {
		const source = documentFixture();
		const snapshot = structuredClone(source);

		const resized = resizeImageEditorDocument(source, {
			width: 200,
			height: 200,
			mode: 'fit'
		});

		expect(source).toEqual(snapshot);
		expect(resized).not.toBe(source);
		expect(resized).toMatchObject({ width_px: 200, height_px: 200, preset_key: 'custom' });
		expect(resized.pages[0].layers[0].transform).toMatchObject({
			x: 20,
			y: 60,
			width: 40,
			height: 20
		});
		expect(resized.pages[0].guides).toEqual({ horizontal: [70], vertical: [50] });
		expect(resized.pages[0].background?.gradient).toMatchObject({
			start: { x: 0, y: 100 },
			end: { x: 200, y: 100 }
		});
		expect(resized.pages[0].layers[2].paint?.gradient).toMatchObject({
			start: { x: 0, y: 10 },
			end: { x: 40, y: 10 }
		});

		const text = resized.pages[0].layers[0];
		expect(text.text).toMatchObject({
			font_size: 24,
			stroke_width: 2,
			shadow: { blur: 6, offset_x: 4, offset_y: -2 }
		});
		expect(text.effects).toMatchObject({
			drop_shadow: { blur: 10, distance: 6 },
			inner_shadow: { blur: 8, distance: 4 },
			stroke: { width: 4 }
		});
		expect(text.mask).toMatchObject({ inset: 4, radius: 8 });

		const shape = resized.pages[0].layers[1];
		expect(shape.shape).toMatchObject({ stroke_width: 4, radius: 8 });
		expect(validateImageEditorDocument(resized)).toEqual([]);
	});

	it('fills uniformly and allows symmetric overflow instead of stretching layers', () => {
		const resized = resizeImageEditorDocument(documentFixture(), {
			width: 200,
			height: 200,
			mode: 'fill'
		});

		expect(resized.pages[0].layers[0].transform).toMatchObject({
			x: -60,
			y: 20,
			width: 80,
			height: 40
		});
		expect(
			resized.pages[0].layers[0].transform.width / resized.pages[0].layers[0].transform.height
		).toBe(2);
	});

	it('keeps layer sizes while recentering the composition', () => {
		const resized = resizeImageEditorDocument(documentFixture(), {
			width: 200,
			height: 200,
			mode: 'preserve'
		});

		expect(resized.pages[0].layers[0].transform).toMatchObject({
			x: 60,
			y: 80,
			width: 20,
			height: 10
		});
		expect(resized.pages[0].layers[0].text?.font_size).toBe(12);
	});

	it('only distorts layers when stretch is chosen explicitly', () => {
		const resized = resizeImageEditorDocument(documentFixture(), {
			width: 200,
			height: 200,
			mode: 'stretch'
		});

		expect(resized.pages[0].layers[0].transform).toMatchObject({
			x: 20,
			y: 20,
			width: 40,
			height: 40
		});
		expect(resized.pages[0].layers[0].text?.font_size).toBe(24);
	});
});
