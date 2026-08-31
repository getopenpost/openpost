import { describe, expect, test } from 'vitest';
import {
	clearGeneratedItemDragData,
	GENERATED_ITEM_DRAG_MIME,
	getGeneratedItemDragData,
	parseGeneratedItemDragData,
	shapeGeneratedItemDragData,
	textGeneratedItemDragData,
	writeGeneratedItemDragData
} from './generated-item-drag';

describe('generated item drag data', () => {
	test('round-trips text and shape payloads through the versioned MIME type', () => {
		const values = new Map<string, string>();
		// SAFETY: this test double implements every DataTransfer field used by the drag helpers.
		const dataTransfer = {
			effectAllowed: 'none',
			setData(type: string, value: string) {
				values.set(type, value);
			},
			getData(type: string) {
				return values.get(type) ?? '';
			}
		} as DataTransfer;
		const text = textGeneratedItemDragData('Breaking', 'breaking-update');
		writeGeneratedItemDragData(dataTransfer, text);
		expect(dataTransfer.effectAllowed).toBe('copy');
		expect(getGeneratedItemDragData(dataTransfer)).toEqual(text);

		const shape = shapeGeneratedItemDragData('Gradient', 'rectangle', {
			fillType: 'linear',
			gradientStartColor: '#f97316',
			gradientEndColor: '#6366f1',
			gradientAngle: 135
		});
		writeGeneratedItemDragData(dataTransfer, shape);
		expect(JSON.parse(values.get(GENERATED_ITEM_DRAG_MIME) ?? '')).toEqual(shape);
		expect(getGeneratedItemDragData(dataTransfer)).toEqual(shape);
		clearGeneratedItemDragData();
	});

	test('rejects malformed or unsupported payloads', () => {
		expect(parseGeneratedItemDragData('{')).toBeNull();
		expect(parseGeneratedItemDragData('{"version":2,"kind":"text","label":"Text"}')).toBeNull();
		expect(
			parseGeneratedItemDragData(
				'{"version":1,"kind":"text","label":"Unknown","presetId":"not-a-preset"}'
			)
		).toBeNull();
		expect(
			parseGeneratedItemDragData('{"version":1,"kind":"shape","label":"Blob","shapeType":"blob"}')
		).toBeNull();
	});
});
