/** Shared text style resolution ported from FreeCut (MIT). */

import type { TextSpan, TimelineItem } from '../project/types';
import { getTextItemSpans } from './text-item-spans';
import { editorFontAssetFamily } from '$lib/editor-font-identity';

export const TEXT_DEFAULTS = {
	fontSize: 60,
	fontFamily: 'Inter',
	fontWeight: 400,
	fontStyle: 'normal',
	lineHeight: 1.2,
	letterSpacing: 0,
	textAlign: 'center',
	verticalAlign: 'middle',
	paddingX: 16,
	paddingY: 16,
	color: '#ffffff',
	underline: false
} as const;

export interface ResolvedTextStyle {
	lineHeight: number;
	textAlign: 'left' | 'center' | 'right';
	verticalAlign: 'top' | 'middle' | 'bottom';
	paddingX: number;
	paddingY: number;
	color: string;
	backgroundColor?: string;
	backgroundFit: 'box' | 'content';
	borderRadius: number;
	textShadow?: TimelineItem['textShadow'];
	strokeWidth: number;
	strokeColor: string;
}

export interface ResolvedSpanStyle {
	text: string;
	fontSize: number;
	fontFamily: string;
	fontStyle: 'normal' | 'italic';
	fontWeight: number;
	letterSpacing: number;
	color: string;
	underline: boolean;
	cssFont: string;
}

export type TextStyleInput = Pick<
	TimelineItem,
	| 'text'
	| 'textSpans'
	| 'spanLayout'
	| 'fontSize'
	| 'fontFamily'
	| 'fontAssetId'
	| 'fontWeight'
	| 'fontStyle'
	| 'underline'
	| 'color'
	| 'backgroundColor'
	| 'backgroundFit'
	| 'textAlign'
	| 'verticalAlign'
	| 'lineHeight'
	| 'letterSpacing'
	| 'paddingX'
	| 'paddingY'
	| 'borderRadius'
	| 'textShadow'
	| 'strokeWidth'
	| 'strokeColor'
>;

export function loadedTextFontFamily(family: string): string {
	switch (family) {
		case 'Inter':
			return 'Inter Variable';
		case 'Inter Tight':
			return 'Inter Tight Variable';
		case 'Manrope':
			return 'Manrope Variable';
		case 'Orbitron':
			return 'Orbitron Variable';
		case 'Playfair Display':
			return 'Playfair Display Variable';
		case 'Space Grotesk':
			return 'Space Grotesk Variable';
		case 'Geist':
			return 'Geist Variable';
		default:
			return family;
	}
}

function cssFont(style: string, weight: number, size: number, family: string): string {
	return `${style} ${weight} ${size}px "${loadedTextFontFamily(family)}", sans-serif`;
}

export function resolveTextStyle(item: TextStyleInput): ResolvedTextStyle {
	return {
		lineHeight: item.lineHeight ?? TEXT_DEFAULTS.lineHeight,
		textAlign: item.textAlign ?? TEXT_DEFAULTS.textAlign,
		verticalAlign: item.verticalAlign ?? TEXT_DEFAULTS.verticalAlign,
		paddingX: Math.max(0, item.paddingX ?? TEXT_DEFAULTS.paddingX),
		paddingY: Math.max(0, item.paddingY ?? TEXT_DEFAULTS.paddingY),
		color: item.color ?? TEXT_DEFAULTS.color,
		backgroundColor: item.backgroundColor,
		backgroundFit: item.backgroundFit ?? 'box',
		borderRadius: Math.max(0, item.borderRadius ?? 0),
		textShadow: item.textShadow,
		strokeWidth: Math.max(0, item.strokeWidth ?? 0),
		strokeColor: item.strokeColor ?? '#000000'
	};
}

export function resolveSpanStyles(item: TextStyleInput): ResolvedSpanStyle[] {
	const itemFontSize = item.fontSize ?? TEXT_DEFAULTS.fontSize;
	const itemFontFamily = item.fontFamily ?? TEXT_DEFAULTS.fontFamily;
	const itemFontStyle = item.fontStyle ?? TEXT_DEFAULTS.fontStyle;
	const itemFontWeight = item.fontWeight ?? TEXT_DEFAULTS.fontWeight;
	const itemLetterSpacing = item.letterSpacing ?? TEXT_DEFAULTS.letterSpacing;
	const itemColor = item.color ?? TEXT_DEFAULTS.color;
	const itemUnderline = item.underline ?? TEXT_DEFAULTS.underline;

	return getTextItemSpans(item).map((span: TextSpan) => {
		const fontSize = span.fontSize ?? itemFontSize;
		const displayFontFamily = span.fontFamily ?? itemFontFamily;
		const fontAssetId = span.fontAssetId ?? (span.fontFamily ? undefined : item.fontAssetId);
		const fontFamily = fontAssetId
			? editorFontAssetFamily(displayFontFamily, fontAssetId)
			: displayFontFamily;
		const fontStyle = span.fontStyle ?? itemFontStyle;
		const fontWeight = span.fontWeight ?? itemFontWeight;
		return {
			text: span.text ?? '',
			fontSize,
			fontFamily,
			fontStyle,
			fontWeight,
			letterSpacing: span.letterSpacing ?? itemLetterSpacing,
			color: span.color ?? itemColor,
			underline: span.underline ?? itemUnderline,
			cssFont: cssFont(fontStyle, fontWeight, fontSize, fontFamily)
		};
	});
}
