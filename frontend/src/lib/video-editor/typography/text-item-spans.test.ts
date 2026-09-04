import { describe, expect, it } from 'vitest';
import {
	buildTextItemLabelFromText,
	getTextItemPlainText,
	getTextItemPrimaryText,
	getTextItemSpans
} from './text-item-spans';

describe('text item spans', () => {
	it('keeps legacy text items readable and gives structured spans priority', () => {
		expect(getTextItemSpans({ text: 'Hello world' })).toEqual([{ text: 'Hello world' }]);
		expect(
			getTextItemPlainText({
				text: 'Ignored',
				textSpans: [{ text: 'Headline' }, { text: 'Subtitle' }]
			})
		).toBe('Headline\nSubtitle');
	});
});
