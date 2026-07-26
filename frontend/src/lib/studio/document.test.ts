import { describe, expect, it } from 'vitest';
import {
	blankStudioDocument,
	cloneStudioPage,
	defaultTransform,
	migrateStudioDocument,
	validateStudioDocument
} from './document';
import { STUDIO_LIMITS, type StudioLayer, type StudioPreset } from './types';

const preset: StudioPreset = {
	key: 'instagram-square',
	name: 'Instagram square',
	width_px: 1080,
	height_px: 1080,
	default_format: 'png',
	profiles: ['instagram']
};

function group(id: string, parentID?: string): StudioLayer {
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

describe('Studio document contracts', () => {
	it('creates a valid document for a preset', () => {
		const document = blankStudioDocument(preset);
		expect(validateStudioDocument(document)).toEqual([]);
		expect(document.pages).toHaveLength(1);
		expect(document.width_px).toBe(1080);
	});

	it('enforces page, pixel, and layer limits', () => {
		const document = blankStudioDocument(preset);
		document.width_px = STUDIO_LIMITS.maxDimension + 1;
		document.height_px = 4096;
		document.pages = Array.from({ length: STUDIO_LIMITS.maxPages + 1 }, (_, index) => ({
			...document.pages[0],
			id: `page-${index}`,
			name: `Page ${index + 1}`,
			layers: []
		}));
		const errors = validateStudioDocument(document);
		expect(errors).toContain('The design dimensions are outside the supported range.');
		expect(errors).toContain(`A design must have between 1 and ${STUDIO_LIMITS.maxPages} pages.`);
	});

	it('rejects cyclic nested groups', () => {
		const document = blankStudioDocument(preset);
		document.pages[0].layers = [group('a', 'b'), group('b', 'a')];
		expect(validateStudioDocument(document)).toContain('a belongs to a cyclic group.');
		expect(validateStudioDocument(document)).toContain('b belongs to a cyclic group.');
	});

	it('remaps page, layer, and parent IDs when cloning', () => {
		const document = blankStudioDocument(preset);
		document.pages[0].layers = [group('parent'), group('child', 'parent')];
		const clone = cloneStudioPage(document.pages[0], 'Page 1 copy');
		expect(clone.id).not.toBe(document.pages[0].id);
		expect(clone.layers[0].id).not.toBe('parent');
		expect(clone.layers[1].parent_id).toBe(clone.layers[0].id);
	});

	it('opens newer documents read-only without rewriting them', () => {
		const document = blankStudioDocument(preset);
		const result = migrateStudioDocument({ ...document, schema_version: 99 });
		expect(result.readOnly).toBe(true);
		expect(result.document?.schema_version).toBe(99);
		expect(result.error).toContain('newer OpenPost version');
	});

	it('validates masks, curved text, blend modes, and layer shadows', () => {
		const document = blankStudioDocument(preset);
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

		expect(validateStudioDocument(document)).toEqual([]);
		document.pages[0].layers[0].effects!.drop_shadow!.opacity = 2;
		expect(validateStudioDocument(document)).toContain(
			'Curved headline has an invalid shadow effect.'
		);
	});
});
