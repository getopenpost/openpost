import { describe, expect, it } from 'vitest';
import { blankImageEditorDocument, defaultImageAdjustments, defaultTransform } from './document';
import { guestImageEditorMediaIDs, replaceGuestImageEditorMediaIDs } from './local-persistence';
import type { ImageEditorPreset } from './types';

const preset: ImageEditorPreset = {
	key: 'instagram-square',
	name: 'Instagram square',
	width_px: 1080,
	height_px: 1080,
	default_format: 'png',
	profiles: ['instagram']
};

describe('guest OpenPost Image Editor document migration', () => {
	it('collects local media from layers and page backgrounds without duplicates', () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].background = {
			type: 'image',
			opacity: 1,
			image: { media_id: 'local_media_background', fit: 'cover' }
		};
		document.pages[0].layers = [
			{
				id: 'image',
				type: 'image',
				name: 'Image',
				visible: true,
				locked: false,
				opacity: 1,
				transform: defaultTransform(1080, 1080),
				image: {
					media_id: 'local_media_background',
					source_width: 1080,
					source_height: 1080,
					fit: 'cover',
					crop: { x: 0, y: 0, width: 1, height: 1 },
					adjustments: defaultImageAdjustments()
				}
			}
		];

		expect(guestImageEditorMediaIDs(document)).toEqual(['local_media_background']);
	});

	it('replaces local media IDs and clears workspace-generated previews', () => {
		const document = blankImageEditorDocument(preset);
		document.pages[0].preview_media_id = 'old-preview';
		document.pages[0].latest_export_media_id = 'old-export';
		document.pages[0].background = {
			type: 'image',
			opacity: 1,
			image: { media_id: 'local_media_background', fit: 'cover' }
		};

		const migrated = replaceGuestImageEditorMediaIDs(
			document,
			new Map([['local_media_background', 'workspace-media']])
		);

		expect(migrated.pages[0].background?.image?.media_id).toBe('workspace-media');
		expect(migrated.pages[0].preview_media_id).toBeUndefined();
		expect(migrated.pages[0].latest_export_media_id).toBeUndefined();
		expect(document.pages[0].background?.image?.media_id).toBe('local_media_background');
	});
});
