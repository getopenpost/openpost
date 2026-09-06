/** Reversible text layout switching ported from FreeCut (MIT). */

import type {
	TextLayoutDrafts,
	TextSingleLayoutDraft,
	TextSpan,
	TimelineItem
} from '../project/types';
import { getTextItemPrimaryText } from './text-item-spans';

export type TextLayoutMode = 'single' | 'two' | 'three';

type SingleDraftSource = Pick<
	TimelineItem,
	| 'text'
	| 'textSpans'
	| 'fontSize'
	| 'fontFamily'
	| 'fontAssetId'
	| 'fontWeight'
	| 'fontStyle'
	| 'underline'
	| 'color'
	| 'letterSpacing'
	| 'textLayoutDrafts'
>;

function cloneSpans(spans?: TextSpan[]): TextSpan[] | undefined {
	return spans?.map((span) => ({ ...span }));
}

function getPrimarySpan(spans: TextSpan[]): TextSpan {
	if (spans.length >= 3) return spans[1] ?? spans[0] ?? { text: '' };
	return spans[0] ?? { text: '' };
}

export function getTextItemLayoutMode(item: Pick<TimelineItem, 'textSpans'>): TextLayoutMode {
	const spanCount = item.textSpans?.length ?? 0;
	if (spanCount >= 3) return 'three';
	if (spanCount === 2) return 'two';
	return 'single';
}

export function cloneTextLayoutDrafts(drafts?: TextLayoutDrafts): TextLayoutDrafts | undefined {
	if (!drafts) return undefined;
	return {
		single: drafts.single ? { ...drafts.single } : undefined,
		twoSpans: cloneSpans(drafts.twoSpans),
		threeSpans: cloneSpans(drafts.threeSpans)
	};
}

export function buildEditableBaseSpans(item: SingleDraftSource): TextSpan[] {
	if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
		return item.textSpans.map((span) => ({ ...span }));
	}

	return [
		{
			text: item.text ?? '',
			fontSize: item.fontSize,
			fontFamily: item.fontFamily,
			fontAssetId: item.fontAssetId,
			fontWeight: item.fontWeight,
			fontStyle: item.fontStyle,
			underline: item.underline,
			color: item.color,
			letterSpacing: item.letterSpacing
		}
	];
}

export function buildTextSingleLayoutDraft(item: SingleDraftSource): TextSingleLayoutDraft {
	if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
		const primarySpan = getPrimarySpan(item.textSpans);
		return {
			text: primarySpan.text ?? '',
			fontSize: primarySpan.fontSize ?? item.fontSize,
			fontFamily: primarySpan.fontFamily ?? item.fontFamily,
			fontAssetId: primarySpan.fontAssetId ?? item.fontAssetId,
			fontWeight: primarySpan.fontWeight ?? item.fontWeight,
			fontStyle: primarySpan.fontStyle ?? item.fontStyle,
			underline: primarySpan.underline ?? item.underline,
			color: primarySpan.color ?? item.color,
			letterSpacing: primarySpan.letterSpacing ?? item.letterSpacing
		};
	}

	return {
		text: item.text ?? '',
		fontSize: item.fontSize,
		fontFamily: item.fontFamily,
		fontAssetId: item.fontAssetId,
		fontWeight: item.fontWeight,
		fontStyle: item.fontStyle,
		underline: item.underline,
		color: item.color,
		letterSpacing: item.letterSpacing
	};
}

/**
 * Expand a text item into FreeCut's two-line or three-line layout. A single
 * source becomes the title in a three-line layout instead of overwriting the
 * new eyebrow, which fixes an edge case in FreeCut's current implementation.
 */
export function buildSpanLayout(
	baseSpans: TextSpan[],
	item: TimelineItem,
	count: 2 | 3
): TextSpan[] {
	const existing = baseSpans.map((span) => ({ ...span }));
	const hasStructuredSpans = Array.isArray(item.textSpans) && item.textSpans.length > 0;
	const primaryText = getTextItemPrimaryText(item);
	const baseSize = item.fontSize ?? 60;

	if (count === 2) {
		const defaults: TextSpan[] = [
			{ text: primaryText || 'Headline' },
			{
				text: 'Subtitle',
				fontSize: Math.max(24, Math.round(baseSize * 0.48)),
				fontWeight: 500,
				color: '#cbd5e1',
				letterSpacing: 1
			}
		];
		return defaults.map((span, index) => ({ ...span, ...(existing[index] ?? {}) }));
	}

	const defaults: TextSpan[] = [
		{
			text: 'Tag',
			fontSize: Math.max(18, Math.round(baseSize * 0.3)),
			fontWeight: 600,
			color: '#cbd5e1',
			letterSpacing: 2
		},
		{ text: primaryText || 'Headline' },
		{
			text: 'Subtitle',
			fontSize: Math.max(22, Math.round(baseSize * 0.42)),
			fontWeight: 500,
			color: '#cbd5e1',
			letterSpacing: 1
		}
	];
	if (!hasStructuredSpans && existing.length === 1) {
		return [defaults[0]!, { ...defaults[1]!, ...existing[0] }, defaults[2]!];
	}
	return defaults.map((span, index) => ({ ...span, ...(existing[index] ?? {}) }));
}
