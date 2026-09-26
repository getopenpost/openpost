import { describe, expect, it } from 'vitest';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
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
	it('reopens selected-range text emphasis without changing whole-layer defaults', async () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].layers.push({
			id: 'headline',
			type: 'text',
			name: 'Headline',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(300, 80),
			text: {
				text: 'Launch 👩🏽‍🚀',
				runs: [{ start: 7, end: 8, font_weight: 700, color: '#ff0000' }],
				font_family: 'Geist Variable',
				font_weight: 400,
				font_style: 'normal',
				font_size: 48,
				color: '#000000',
				align: 'left',
				line_height: 1,
				letter_spacing: 0,
				stroke_width: 0,
				shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
			}
		});
		const archive = await createImageEditorProjectArchive(document, async () => {
			throw new Error('No media is needed');
		});
		const reopened = await parseImageEditorProjectArchive(
			new File([archive], 'launch.openpost-image')
		);
		expect(reopened.document.pages[0].layers[0].text).toMatchObject({
			font_weight: 400,
			color: '#000000',
			runs: [{ start: 7, end: 8, font_weight: 700, color: '#ff0000' }]
		});
	});

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
			new File([archive], safeImageEditorProjectFilename(document.title), {
				type: archive.type
			})
		);

		expect(parsed.document.title).toBe('Launch / card');
		expect(parsed.document.brand_kit_id).toBeUndefined();
		expect(parsed.media).toHaveLength(1);
		expect(parsed.media[0].id).toBe('media-source');
		expect([...new Uint8Array(await parsed.media[0].file.arrayBuffer())]).toEqual([1, 2, 3]);
		expect(safeImageEditorProjectFilename(document.title)).toBe('Launch-card.openpost-image');
	});

	it('stores encoded source media without a second compression pass', async () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].background = {
			type: 'image',
			opacity: 1,
			image: { media_id: 'encoded-photo', fit: 'cover' }
		};
		const archive = await createImageEditorProjectArchive(document, async () => ({
			name: 'photo.jpg',
			mimeType: 'image/jpeg',
			blob: new Blob([new Uint8Array([255, 216, 255, 217])], {
				type: 'image/jpeg'
			})
		}));
		const methods = new Map<string, number>();
		const unzip = new Unzip((entry) => {
			methods.set(entry.name, entry.compression);
			entry.ondata = () => undefined;
			entry.start();
		});
		unzip.register(UnzipInflate);
		unzip.register(UnzipPassThrough);
		unzip.push(new Uint8Array(await archive.arrayBuffer()), true);
		expect(methods.get('media/001-photo.jpg')).toBe(0);
		expect(methods.get('project.json')).toBe(8);
	});

	it('rejects files that are not project archives', async () => {
		await expect(
			parseImageEditorProjectArchive(
				new File(['not a zip'], 'broken.openpost-image', {
					type: 'application/octet-stream'
				})
			)
		).rejects.toThrow('damaged');
	});
});
