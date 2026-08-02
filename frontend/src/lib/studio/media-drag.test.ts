import { describe, expect, it } from 'vitest';
import {
	containsStudioMediaDrag,
	readStudioMediaDrag,
	STUDIO_MEDIA_DRAG_TYPE,
	writeStudioMediaDrag
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

describe('Studio media drag payload', () => {
	it('round-trips a bounded media placement payload', () => {
		const dataTransfer = dataTransferFixture();
		writeStudioMediaDrag(dataTransfer, {
			id: 'media-1',
			name: 'Launch image',
			width: 1600,
			height: 900
		});

		expect(dataTransfer.effectAllowed).toBe('copy');
		expect(containsStudioMediaDrag(dataTransfer)).toBe(true);
		expect(dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE)).toContain('media-1');
		expect(readStudioMediaDrag(dataTransfer)).toEqual({
			id: 'media-1',
			name: 'Launch image',
			width: 1600,
			height: 900
		});
	});

	it('rejects malformed and empty payloads', () => {
		const dataTransfer = dataTransferFixture();
		dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, '{"name":"missing id"}');

		expect(readStudioMediaDrag(dataTransfer)).toBeNull();
	});
});
