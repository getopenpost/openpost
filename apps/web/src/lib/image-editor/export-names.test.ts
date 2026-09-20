import { describe, expect, it } from 'vitest';
import { imageEditorPageFilename } from './export-names';

describe('imageEditorPageFilename', () => {
	it('includes a custom page name and stable page number', () => {
		expect(imageEditorPageFilename('Launch assets', 'Mountain photo', 1, 'png')).toBe(
			'launch-assets-02-mountain-photo.png'
		);
	});

	it('keeps generic page names concise', () => {
		expect(imageEditorPageFilename('Launch assets', 'Page 2', 1, 'jpg')).toBe(
			'launch-assets-page-02.jpg'
		);
	});
});
