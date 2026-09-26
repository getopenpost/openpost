import { describe, expect, it } from 'vitest';
import {
	editTextWithRuns,
	styleTextRange,
	textGraphemeOffset,
	textGraphemes,
	validTextRuns
} from './text-runs';
import type { ImageEditorTextValue } from './types';

function textValue(text: string): ImageEditorTextValue {
	return {
		text,
		font_family: 'Geist Variable',
		font_weight: 400,
		font_style: 'normal',
		font_size: 48,
		color: '#000000',
		align: 'left',
		line_height: 1,
		letter_spacing: 0,
		stroke_width: 0,
		shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
	};
}

describe('Image Editor text emphasis', () => {
	it('keeps emoji and combining marks as single editable positions', () => {
		const source = textValue('A👩🏽‍🚀e\u0301Z');
		const styled = styleTextRange(source, 1, 3, {
			font_weight: 700,
			color: '#ff0000'
		});
		expect(textGraphemes(source.text)).toEqual(['A', '👩🏽‍🚀', 'e\u0301', 'Z']);
		expect(textGraphemeOffset(source.text, 'A👩🏽‍🚀'.length)).toBe(2);
		expect(styled.runs).toEqual([{ start: 1, end: 3, font_weight: 700, color: '#ff0000' }]);
		expect(validTextRuns(styled)).toBe(true);
	});

	it('moves emphasis with inserted and deleted text', () => {
		const styled = styleTextRange(textValue('Go now'), 3, 6, {
			font_style: 'italic'
		});
		expect(editTextWithRuns(styled, 'Go 👋 now').runs).toEqual([
			{ start: 5, end: 8, font_style: 'italic' }
		]);
		expect(editTextWithRuns(styled, 'Go ow').runs).toEqual([
			{ start: 3, end: 5, font_style: 'italic' }
		]);
	});

	it('keeps the last repeated character styled when deleting the first', () => {
		const styled = styleTextRange(textValue('aaaa'), 3, 4, { font_weight: 700 });
		expect(
			editTextWithRuns(styled, 'aaa', {
				start: 0,
				end: 0,
				inputType: 'deleteContentForward'
			}).runs
		).toEqual([{ start: 2, end: 3, font_weight: 700 }]);
		expect(
			editTextWithRuns(styled, 'aaaaa', {
				start: 0,
				end: 0,
				inputType: 'insertText'
			}).runs
		).toEqual([{ start: 4, end: 5, font_weight: 700 }]);
		const firstBold = styleTextRange(textValue('aaaa'), 0, 1, { font_weight: 700 });
		expect(
			editTextWithRuns(firstBold, 'aaa', {
				start: 1,
				end: 1,
				inputType: 'deleteContentBackward'
			}).runs
		).toBeUndefined();
	});

	it('replaces an IME composition range without dropping its emphasis', () => {
		const styled = styleTextRange(textValue('a漢b'), 1, 2, { color: '#ff0000' });
		expect(
			editTextWithRuns(styled, 'a仮b', {
				start: 1,
				end: 2,
				inputType: 'insertCompositionText'
			}).runs
		).toEqual([{ start: 1, end: 2, color: '#ff0000' }]);
	});

	it('rejects ranges beyond the text and keeps whole-layer defaults untouched', () => {
		const source = textValue('abc');
		expect(styleTextRange(source, 1, 2, { underline: true }).underline).toBeUndefined();
		expect(
			validTextRuns({
				...source,
				runs: [{ start: 1, end: 4, underline: true }]
			})
		).toBe(false);
	});
});
