import { describe, expect, it } from 'vitest';
import {
	blankImageEditorDocument,
	cloneImageEditorDocument,
	cloneImageEditorPage,
	defaultTransform,
	migrateImageEditorDocument,
	imageEditorPageBackground,
	validateImageEditorDocument
} from './document';
import { IMAGE_EDITOR_LIMITS, type ImageEditorLayer, type ImageEditorPreset } from './types';
import { imageEditorPageDimensions } from './page-dimensions';

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
	it('opens and snapshots reactive template documents without sharing authored state', () => {
		const original = blankImageEditorDocument(preset);
		const reactive = new Proxy(original, {});
		original.pages[0].background = new Proxy(
			{ type: 'solid' as const, color: '#ffffff', opacity: 1 },
			{}
		);
		expect(imageEditorPageBackground(original.pages[0])).toEqual({
			type: 'solid',
			color: '#ffffff',
			opacity: 1
		});
		const copy = cloneImageEditorDocument(reactive);
		copy.pages[0].name = 'Edited copy';
		expect(original.pages[0].name).not.toBe('Edited copy');
		expect(migrateImageEditorDocument(reactive).readOnly).toBe(false);
	});

	it('migrates legacy uniform pages and validates mixed page dimensions independently', () => {
		const legacy = blankImageEditorDocument(preset);
		legacy.schema_version = 1;
		const migrated = migrateImageEditorDocument(legacy).document!;
		expect(migrated.schema_version).toBe(2);
		expect(imageEditorPageDimensions(migrated, migrated.pages[0])).toEqual({
			width: 1080,
			height: 1080
		});

		const second = cloneImageEditorPage(migrated.pages[0], 'Portrait');
		second.width_px = 720;
		second.height_px = 1280;
		second.guides = { horizontal: [1200], vertical: [700] };
		migrated.pages.push(second);
		expect(validateImageEditorDocument(migrated)).toEqual([]);
		expect(imageEditorPageDimensions(migrated, second)).toEqual({
			width: 720,
			height: 1280
		});
		second.width_px = 600;
		expect(validateImageEditorDocument(migrated)).toContain('Portrait has invalid guides.');
		delete second.height_px;
		expect(validateImageEditorDocument(migrated)).toContain('Portrait has invalid dimensions.');
	});

	it('enforces document dimension and page-count limits', () => {
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

	it('opens newer documents read-only without rewriting them', () => {
		const document = blankImageEditorDocument(preset);
		const result = migrateImageEditorDocument({
			...document,
			schema_version: 99
		});
		expect(result.readOnly).toBe(true);
		expect(result.document?.schema_version).toBe(99);
		expect(result.error).toContain('newer OpenPost version');
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
