import { describe, expect, it } from 'vitest';
import { blankImageEditorDocument } from './document';
import { imageEditorPageExportFingerprint, reusableImageEditorExports } from './export-resume';

describe('OpenPost Image Editor resumable export ledger', () => {
	it('reuses only pages whose render-affecting content still matches', () => {
		const document = blankImageEditorDocument({
			key: 'custom',
			name: 'Custom',
			width_px: 1080,
			height_px: 1080,
			default_format: 'png',
			profiles: []
		});
		const page = document.pages[0];
		const fingerprint = imageEditorPageExportFingerprint(document, page);
		page.latest_export_media_id = 'metadata-only-change';
		expect(
			reusableImageEditorExports(document, { [page.id]: { mediaID: 'media', fingerprint } })
		).toEqual({ [page.id]: 'media' });

		page.background_color = '#000000';
		expect(
			reusableImageEditorExports(document, { [page.id]: { mediaID: 'media', fingerprint } })
		).toEqual({});
	});
});
