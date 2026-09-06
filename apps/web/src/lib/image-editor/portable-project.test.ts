import { describe, expect, it } from 'vitest';
import { blankImageEditorDocument, defaultImageAdjustments, defaultTransform } from './document';
import {
	createImageEditorProjectArchive,
	imageEditorPortableMediaIDs,
	parseImageEditorProjectArchive,
	safeImageEditorProjectFilename
} from './portable-project';
import type { ImageEditorPreset } from './types';

const preset: ImageEditorPreset = {
	key: 'custom',
	name: 'Custom',
	width_px: 640,
	height_px: 480,
	default_format: 'png',
	profiles: []
};

describe('OpenPost Image Editor portable projects', () => {
	it('round-trips the document and every referenced source media file', async () => {
		const document = blankImageEditorDocument(preset);
		document.title = 'Launch / card';
		document.pages[0].layers.push({
			id: 'image',
			type: 'image',
			name: 'Photo',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(320, 240),
			image: {
				media_id: 'media-source',
				source_width: 2,
				source_height: 2,
				fit: 'cover',
				crop: { x: 0, y: 0, width: 1, height: 1 },
				adjustments: defaultImageAdjustments()
			}
		});
		expect(imageEditorPortableMediaIDs(document)).toEqual(['media-source']);
		const archive = await createImageEditorProjectArchive(document, async () => ({
			name: 'source.png',
			mimeType: 'image/png',
			blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
		}));
		const parsed = await parseImageEditorProjectArchive(
			new File([archive], safeImageEditorProjectFilename(document.title), { type: archive.type })
		);

		expect(parsed.document.title).toBe('Launch / card');
		expect(parsed.document.brand_kit_id).toBeUndefined();
		expect(parsed.media).toHaveLength(1);
		expect(parsed.media[0].id).toBe('media-source');
		expect([...new Uint8Array(await parsed.media[0].file.arrayBuffer())]).toEqual([1, 2, 3]);
		expect(safeImageEditorProjectFilename(document.title)).toBe('Launch-card.openpost-image');
	});

	it('rejects files that are not project archives', async () => {
		await expect(
			parseImageEditorProjectArchive(
				new File(['not a zip'], 'broken.openpost-image', { type: 'application/octet-stream' })
			)
		).rejects.toThrow('damaged');
	});
});
