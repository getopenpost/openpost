import { describe, expect, it } from 'vitest';
import {
	containsImageEditorMediaDrag,
	readImageEditorMediaDrag,
	IMAGE_EDITOR_MEDIA_DRAG_TYPE,
	writeImageEditorMediaDrag
} from './media-drag';

function dataTransferFixture(): DataTransfer {
	const values = new Map<string, string>();
	return {
		effectAllowed: 'uninitialized',
		get types() {
			return [...values.keys()];
		},
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
});
