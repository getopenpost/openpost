import { describe, expect, it } from 'vitest';
import {
	containsExternalImageDrag,
	containsImageEditorMediaDrag,
	externalFiles,
	externalImageFiles,
	isImageEditorImageFile,
	readImageEditorMediaDrag,
	IMAGE_EDITOR_MEDIA_DRAG_TYPE,
	writeImageEditorMediaDrag
} from './media-drag';

function file(name: string, type: string): File {
	return { name, type } as File;
}

function dataTransferFixture(files: File[] = []): DataTransfer {
	const values = new Map<string, string>();
	return {
		effectAllowed: 'uninitialized',
		get types() {
			return [...values.keys(), ...(files.length > 0 ? ['Files'] : [])];
		},
		files,
		setData(type: string, value: string) {
			values.set(type, value);
		},
		getData(type: string) {
			return values.get(type) ?? '';
		}
	} as unknown as DataTransfer;
}

describe('OpenPost Image Editor media drag payload', () => {
	it('round-trips a bounded media placement payload', () => {
		const dataTransfer = dataTransferFixture();
		writeImageEditorMediaDrag(dataTransfer, {
			id: 'media-1',
			name: 'Launch image',
			width: 1600,
			height: 900
		});

		expect(dataTransfer.effectAllowed).toBe('copy');
		expect(containsImageEditorMediaDrag(dataTransfer)).toBe(true);
		expect(dataTransfer.getData(IMAGE_EDITOR_MEDIA_DRAG_TYPE)).toContain('media-1');
		expect(readImageEditorMediaDrag(dataTransfer)).toEqual({
			id: 'media-1',
			name: 'Launch image',
			width: 1600,
			height: 900
		});
	});

	it('rejects malformed and empty payloads', () => {
		const dataTransfer = dataTransferFixture();
		dataTransfer.setData(IMAGE_EDITOR_MEDIA_DRAG_TYPE, '{"name":"missing id"}');

		expect(readImageEditorMediaDrag(dataTransfer)).toBeNull();
	});

	it('recognizes external image files without confusing internal media drags', () => {
		const image = file('launch.png', 'image/png');
		const svg = file('mark.svg', '');
		const text = file('notes.txt', 'text/plain');
		const dataTransfer = dataTransferFixture([image, svg, text]);

		expect(containsExternalImageDrag(dataTransfer)).toBe(true);
		expect(externalFiles(dataTransfer)).toEqual([image, svg, text]);
		expect(externalImageFiles(dataTransfer)).toEqual([image, svg]);
		expect(isImageEditorImageFile(text)).toBe(false);

		writeImageEditorMediaDrag(dataTransfer, { id: 'media-1' });
		expect(containsExternalImageDrag(dataTransfer)).toBe(false);
	});
});
