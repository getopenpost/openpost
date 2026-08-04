import { describe, expect, it } from 'vitest';
import {
	blankImageEditorDocument,
	cloneImageEditorPage,
	defaultTransform,
	migrateImageEditorDocument,
	imageEditorPageHasTransparency,
	validateImageEditorDocument
} from './document';
import { IMAGE_EDITOR_LIMITS, type ImageEditorLayer, type ImageEditorPreset } from './types';

const preset: ImageEditorPreset = {
	key: 'instagram-square',
	name: 'Instagram square',
	width_px: 1080,
	height_px: 1080,
	default_format: 'png',
	profiles: ['instagram']
};

function group(id: string, parentID?: string): ImageEditorLayer {
	return {
		id,
		type: 'group',
		name: id,
		parent_id: parentID,
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(100, 100)
	};
}

describe('OpenPost Image Editor document contracts', () => {
	it('creates a valid document for a preset', () => {
		const document = blankImageEditorDocument(preset);
		expect(validateImageEditorDocument(document)).toEqual([]);
		expect(document.pages).toHaveLength(1);
		expect(document.width_px).toBe(1080);
		expect(document.export_defaults.matte_color).toBe('#ffffff');
	});

	it('supports transparent, gradient, and image page backgrounds', () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].background = { type: 'transparent', opacity: 0 };
		expect(validateImageEditorDocument(document)).toEqual([]);
		expect(imageEditorPageHasTransparency(document.pages[0])).toBe(true);

		document.pages[0].background = {
			type: 'gradient',
			opacity: 1,
			gradient: {
				type: 'linear',
				start: { x: 0, y: 540 },
				end: { x: 1080, y: 540 },
				reverse: false,
				stops: [
					{ offset: 0, color: '#f97316' },
					{ offset: 0.5, color: '#ec4899' },
					{ offset: 1, color: '#7c3aed' }
				]
			}
		};
		expect(validateImageEditorDocument(document)).toEqual([]);
		expect(imageEditorPageHasTransparency(document.pages[0])).toBe(false);

		document.pages[0].background = {
			type: 'image',
			opacity: 1,
			image: { media_id: 'media-background', fit: 'cover' }
		};
		expect(validateImageEditorDocument(document)).toEqual([]);
		expect(imageEditorPageHasTransparency(document.pages[0])).toBe(true);
	});

	it('enforces page, pixel, and layer limits', () => {
		const document = blankImageEditorDocument(preset);
		document.width_px = IMAGE_EDITOR_LIMITS.maxDimension + 1;
		document.height_px = 4096;
		document.pages = Array.from({ length: IMAGE_EDITOR_LIMITS.maxPages + 1 }, (_, index) => ({
			...document.pages[0],
			id: `page-${index}`,
			name: `Page ${index + 1}`,
			layers: []
		}));
		const errors = validateImageEditorDocument(document);
		expect(errors).toContain('The design dimensions are outside the supported range.');
		expect(errors).toContain(
			`A design must have between 1 and ${IMAGE_EDITOR_LIMITS.maxPages} pages.`
		);
	});

	it('rejects cyclic nested groups', () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].layers = [group('a', 'b'), group('b', 'a')];
		expect(validateImageEditorDocument(document)).toContain('a belongs to a cyclic group.');
		expect(validateImageEditorDocument(document)).toContain('b belongs to a cyclic group.');
	});

	it('remaps page, layer, and parent IDs when cloning', () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].layers = [group('parent'), group('child', 'parent')];
		const clone = cloneImageEditorPage(document.pages[0], 'Page 1 copy');
		expect(clone.id).not.toBe(document.pages[0].id);
		expect(clone.layers[0].id).not.toBe('parent');
		expect(clone.layers[1].parent_id).toBe(clone.layers[0].id);
	});

	it('opens newer documents read-only without rewriting them', () => {
		const document = blankImageEditorDocument(preset);
		const result = migrateImageEditorDocument({ ...document, schema_version: 99 });
		expect(result.readOnly).toBe(true);
		expect(result.document?.schema_version).toBe(99);
		expect(result.error).toContain('newer OpenPost version');
	});

	it('fills new image-adjustment defaults when opening an existing document', () => {
		const document = blankImageEditorDocument(preset);
		delete document.pages[0].background;
		delete (document.export_defaults as Partial<typeof document.export_defaults>).matte_color;
		document.pages[0].layers = [
			{
				id: 'existing-image',
				type: 'image',
				name: 'Existing image',
				visible: true,
				locked: false,
				opacity: 1,
				transform: defaultTransform(400, 300),
				image: {
					media_id: 'media',
					source_width: 400,
					source_height: 300,
					fit: 'stretch',
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
					} as never
				}
			}
		];

		const result = migrateImageEditorDocument(document);

		expect(result.readOnly).toBe(false);
		expect(result.document?.pages[0].layers[0].image?.adjustments).toMatchObject({
			tint: 0,
			vibrance: 0,
			hue: 0
		});
		expect(result.document?.pages[0].background).toEqual({
			type: 'solid',
			color: '#ffffff',
			opacity: 1
		});
		expect(result.document?.export_defaults.matte_color).toBe('#ffffff');
	});

	it('validates masks, curved text, blend modes, and layer shadows', () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].layers = [
			{
				id: 'effect-layer',
				type: 'text',
				name: 'Curved headline',
				visible: true,
				locked: false,
				opacity: 1,
				transform: defaultTransform(600, 180),
				text: {
					text: 'OpenPost',
					font_family: 'Geist Variable',
					font_weight: 700,
					font_style: 'normal',
					font_size: 72,
					color: '#1c1917',
					align: 'center',
					line_height: 1.1,
					letter_spacing: 0,
					stroke_width: 0,
					shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 },
					curve: { type: 'wave', strength: 0.7, offset: 0, reverse: false }
				},
				effects: {
					blend_mode: 'overlay',
					stroke: {
						color: '#f97316',
						opacity: 1,
						width: 8,
						position: 'outside'
					},
					drop_shadow: {
						color: '#000000',
						opacity: 0.3,
						blur: 24,
						angle: 45,
						distance: 12
					}
				},
				mask: { shape: 'ellipse', inset: 4, radius: 0 }
			}
		];

		expect(validateImageEditorDocument(document)).toEqual([]);
		document.pages[0].layers[0].effects!.drop_shadow!.opacity = 2;
		expect(validateImageEditorDocument(document)).toContain(
			'Curved headline has an invalid shadow effect.'
		);
	});
});
