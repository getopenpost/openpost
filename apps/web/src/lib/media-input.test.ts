import { describe, expect, it } from 'vitest';
import {
	MEDIA_IMAGE_MAX_BYTES,
	MEDIA_VIDEO_MAX_BYTES,
	isMediaMimeAllowed,
	isVideoMediaFile,
	mediaFileSignature,
	mediaInputRejection,
	selectMediaInputFiles,
	type MediaInputRules
} from './media-input';

const panelRules: MediaInputRules = {
	accept: ['image/*', 'video/*', 'audio/*'],
	maxBytes: MEDIA_IMAGE_MAX_BYTES,
	maxVideoBytes: MEDIA_VIDEO_MAX_BYTES,
	maxFiles: 10
};

// Metadata is all these rules read. Reporting the size without allocating it
// keeps the 16 GiB video-limit case from exhausting the test runtime.
function fakeFile(name: string, type: string, size = 128, lastModified = 1): File {
	const file = new File([], name, { type, lastModified });
	Object.defineProperty(file, 'size', { value: size });
	return file;
}

describe('mediaFileSignature', () => {
	it('identifies a file by name, size, and modification time', () => {
		expect(mediaFileSignature(fakeFile('photo.png', 'image/png', 10, 1))).toBe(
			'photo.png\u000010\u00001'
		);
		expect(mediaFileSignature(fakeFile('photo.png', 'image/png', 10, 2))).not.toBe(
			mediaFileSignature(fakeFile('photo.png', 'image/png', 10, 1))
		);
	});
});

describe('mediaInputRejection', () => {
	it('infers MIME from the filename extension when the browser provides no type', () => {
		expect(isMediaMimeAllowed(fakeFile('photo.png', '', 10), panelRules.accept)).toBe(true);
		expect(mediaInputRejection(fakeFile('photo.png', '', 10), panelRules)).toBeNull();
		expect(mediaInputRejection(fakeFile('notes.pdf', '', 10), panelRules)).toEqual({
			reason: 'unsupported'
		});
	});

	it('applies the video limit to video files and the default limit otherwise', () => {
		expect(
			mediaInputRejection(fakeFile('clip.mp4', 'video/mp4', MEDIA_IMAGE_MAX_BYTES + 1), panelRules)
		).toBeNull();
		expect(
			mediaInputRejection(fakeFile('clip.mp4', 'video/mp4', MEDIA_VIDEO_MAX_BYTES + 1), panelRules)
		).toEqual({ reason: 'video_too_large' });
		expect(
			mediaInputRejection(fakeFile('photo.png', 'image/png', MEDIA_IMAGE_MAX_BYTES + 1), panelRules)
		).toEqual({ reason: 'file_too_large' });
	});

	it('detects video files by extension as well as MIME type', () => {
		expect(isVideoMediaFile(fakeFile('clip.mp4', '', 10))).toBe(true);
		expect(isVideoMediaFile(fakeFile('photo.png', 'image/png', 10))).toBe(false);
	});
});

describe('selectMediaInputFiles', () => {
	it('drops duplicates against existing signatures and within the batch', () => {
		const first = fakeFile('first.png', 'image/png', 10, 1);
		const duplicate = fakeFile('first.png', 'image/png', 10, 1);
		const second = fakeFile('second.png', 'image/png', 10, 2);
		const selection = selectMediaInputFiles([first, duplicate, second], panelRules, [
			mediaFileSignature(second)
		]);

		expect(selection.accepted).toEqual([first]);
		expect(selection.rejected).toEqual([
			{ file: duplicate, reason: 'duplicate' },
			{ file: second, reason: 'duplicate' }
		]);
	});

	it('enforces total capacity without letting invalid files consume slots', () => {
		const rules: MediaInputRules = { ...panelRules, maxFiles: 2 };
		const first = fakeFile('first.png', 'image/png', 10, 1);
		const second = fakeFile('second.png', 'image/png', 10, 2);
		const overflow = fakeFile('overflow.png', 'image/png', 10, 3);
		const selection = selectMediaInputFiles(
			[fakeFile('empty.png', 'image/png', 0), first, second, overflow],
			rules,
			[mediaFileSignature(fakeFile('queued.png', 'image/png', 10, 9))]
		);

		expect(selection.accepted).toEqual([first]);
		expect(selection.rejected).toEqual([
			{ file: expect.objectContaining({ name: 'empty.png' }), reason: 'empty' },
			{ file: second, reason: 'capacity' },
			{ file: overflow, reason: 'capacity' }
		]);
	});
});
