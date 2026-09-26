import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	localImageEditorMediaURL,
	registerLocalImageEditorMedia,
	releaseLocalImageEditorMediaForDesign,
	releaseUnretainedLocalImageEditorMediaForDesign,
	retainLocalImageEditorMediaForDesign
} from './local-media-url';

afterEach(() => vi.restoreAllMocks());

describe('guest Image Editor media URLs', () => {
	it('keeps a design URL until its last mounted consumer leaves', () => {
		const revoked = vi.spyOn(URL, 'revokeObjectURL');
		const mediaID = 'local_media_shared-consumers';
		registerLocalImageEditorMedia(mediaID, new Blob(['image']), 'design-shared');
		retainLocalImageEditorMediaForDesign('design-shared');
		retainLocalImageEditorMediaForDesign('design-shared');
		const url = localImageEditorMediaURL(mediaID);
		releaseLocalImageEditorMediaForDesign('design-shared');
		expect(localImageEditorMediaURL(mediaID)).toBe(url);
		expect(revoked).not.toHaveBeenCalledWith(url);
		releaseLocalImageEditorMediaForDesign('design-shared');
		expect(localImageEditorMediaURL(mediaID)).toBeUndefined();
		expect(revoked).toHaveBeenCalledWith(url);
	});

	it('drops media that finished warming after the owning view closed', () => {
		const mediaID = 'local_media_late-warm';
		registerLocalImageEditorMedia(mediaID, new Blob(['image']), 'design-closed');
		releaseUnretainedLocalImageEditorMediaForDesign('design-closed');
		expect(localImageEditorMediaURL(mediaID)).toBeUndefined();
	});
});
