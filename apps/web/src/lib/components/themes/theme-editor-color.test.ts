import { describe, expect, it } from 'vitest';
import { convert } from '@asamuzakjp/css-color';
import { themePickerColor } from './theme-editor-color';

describe('theme color picker', () => {
	it('keeps token opacity when changing the RGB color', () => {
		const updated = themePickerColor('oklch(0.4 0.13 255 / 0.12)', '#ff0000');
		expect(convert.colorToRgb(updated)).toEqual([255, 0, 0, 0.12]);
		expect(themePickerColor('#ffffff', '#ff0000')).toBe('#ff0000');
	});
});
