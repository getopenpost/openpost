import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankImageEditorDocument, defaultTransform } from './document';
import { renderImageEditorPage } from './static-renderer';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Image Editor full-resolution rendering', () => {
	it.each(['background', 'layer'] as const)(
		'rejects an export with missing %s media',
		async (target) => {
			const document = blankImageEditorDocument({
				key: 'missing-media-test',
				name: 'Missing media test',
				default_format: 'png',
				profiles: [],
				width_px: 64,
				height_px: 64
			});
			const page = document.pages[0];
			if (target === 'background') {
				page.background = {
					type: 'image',
					color: '#ffffff',
					opacity: 1,
					image: { media_id: 'missing-background', fit: 'cover' }
				};
			} else {
				page.layers = [
					{
						id: 'missing-layer',
						type: 'image',
						name: 'Missing layer',
						visible: true,
						locked: false,
						opacity: 1,
						transform: defaultTransform(64, 64),
						image: {
							media_id: 'missing-layer-media',
							source_width: 64,
							source_height: 64,
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
					}
				];
			}
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

			await expect(renderImageEditorPage(document, page, 0)).rejects.toThrow(
				'Export stopped because media is missing or unreadable.'
			);
		}
	);
});
