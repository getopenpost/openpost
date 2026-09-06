/** Text span compatibility helpers ported from FreeCut (MIT). */

import type { TextSpan, TimelineItem } from '../project/types';

type TextSource = Pick<TimelineItem, 'text' | 'textSpans'>;

export function getTextItemSpans(item: TextSource): TextSpan[] {
	if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
		const spans = item.textSpans.map((span) => ({ ...span }));
		if (spans.length > 0) return spans;
	}

	return [{ text: item.text ?? '' }];
}

export function getTextItemPlainText(item: TextSource): string {
	return getTextItemSpans(item)
		.map((span) => span.text)
		.join('\n');
}

export function getTextItemPrimaryText(item: TextSource): string {
	if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
		return item.textSpans[0]?.text ?? '';
	}

	return (item.text ?? '').split('\n')[0] ?? '';
}

export function buildTextItemLabelFromText(text: string): string {
	const firstLine = text.split('\n')[0]?.trim() ?? '';
	return firstLine || 'Text';
}

/** Replace only span copy while keeping each span's style and order. */
export function replaceTextSpanCopy(spans: readonly TextSpan[], text: string): TextSpan[] {
	const lines = text.split('\n');
	return spans.map((span, index) => ({
		...span,
		text: index === spans.length - 1 ? lines.slice(index).join('\n') : (lines[index] ?? '')
	}));
}
