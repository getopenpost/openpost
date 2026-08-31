/** Named caption recipes and canvas-relative layout from FreeCut (MIT). */

import type { ItemTransform, TextStyleFields, TimelineItem } from '../project/types';

export type CaptionStylePresetId =
	| 'netflix'
	| 'youtube'
	| 'bold-yellow'
	| 'minimal-stroke'
	| 'tiktok';

export interface CaptionStylePatch extends TextStyleFields {
	transform?: ItemTransform;
}

export interface CaptionStylePreset {
	id: CaptionStylePresetId;
	label: string;
	style: TextStyleFields;
	layout: {
		fontSizeRatio: number;
		yRatio: number;
		widthRatio: number;
		heightRatio: number;
	};
}

export const CAPTION_STYLE_PRESETS = [
	{
		id: 'netflix',
		label: 'Netflix',
		style: {
			fontFamily: 'Inter',
			fontWeight: 600,
			fontStyle: 'normal',
			underline: false,
			color: '#ffffff',
			backgroundColor: 'rgba(0, 0, 0, 0.55)',
			backgroundFit: 'content',
			borderRadius: 4,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.15,
			letterSpacing: 0,
			paddingX: 12,
			paddingY: 12,
			textShadow: {
				offsetX: 0,
				offsetY: 2,
				blur: 6,
				color: 'rgba(0, 0, 0, 0.6)'
			},
			strokeWidth: 0,
			strokeColor: '#000000'
		},
		layout: {
			fontSizeRatio: 0.04,
			yRatio: 0.36,
			widthRatio: 0.7,
			heightRatio: 0.16
		}
	},
	{
		id: 'youtube',
		label: 'YouTube',
		style: {
			fontFamily: 'Roboto',
			fontWeight: 500,
			fontStyle: 'normal',
			underline: false,
			color: '#ffffff',
			backgroundColor: undefined,
			backgroundFit: 'content',
			borderRadius: 0,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.2,
			letterSpacing: 0,
			paddingX: 0,
			paddingY: 0,
			textShadow: {
				offsetX: 0,
				offsetY: 4,
				blur: 14,
				color: 'rgba(0, 0, 0, 0.85)'
			},
			strokeWidth: 0,
			strokeColor: '#000000'
		},
		layout: {
			fontSizeRatio: 0.045,
			yRatio: 0.34,
			widthRatio: 0.85,
			heightRatio: 0.18
		}
	},
	{
		id: 'bold-yellow',
		label: 'Bold Yellow',
		style: {
			fontFamily: 'Roboto Slab',
			fontWeight: 700,
			fontStyle: 'normal',
			underline: false,
			color: '#FFD400',
			backgroundColor: undefined,
			backgroundFit: 'content',
			borderRadius: 0,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.1,
			letterSpacing: 0,
			paddingX: 0,
			paddingY: 0,
			textShadow: {
				offsetX: 0,
				offsetY: 3,
				blur: 5,
				color: 'rgba(0, 0, 0, 1)'
			},
			strokeWidth: 1.5,
			strokeColor: '#000000'
		},
		layout: {
			fontSizeRatio: 0.05,
			yRatio: 0.38,
			widthRatio: 0.85,
			heightRatio: 0.18
		}
	},
	{
		id: 'minimal-stroke',
		label: 'Outlined',
		style: {
			fontFamily: 'Manrope',
			fontWeight: 500,
			fontStyle: 'normal',
			underline: false,
			color: '#ffffff',
			backgroundColor: undefined,
			backgroundFit: 'content',
			borderRadius: 0,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.2,
			letterSpacing: 0,
			paddingX: 0,
			paddingY: 0,
			textShadow: undefined,
			strokeWidth: 1,
			strokeColor: '#000000'
		},
		layout: {
			fontSizeRatio: 0.04,
			yRatio: 0.34,
			widthRatio: 0.85,
			heightRatio: 0.16
		}
	},
	{
		id: 'tiktok',
		label: 'TikTok',
		style: {
			fontFamily: 'Anton',
			fontWeight: 400,
			fontStyle: 'normal',
			underline: false,
			color: '#ffffff',
			backgroundColor: undefined,
			backgroundFit: 'content',
			borderRadius: 0,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.05,
			letterSpacing: 1,
			paddingX: 0,
			paddingY: 0,
			textShadow: {
				offsetX: 0,
				offsetY: 4,
				blur: 8,
				color: 'rgba(0, 0, 0, 0.9)'
			},
			strokeWidth: 2,
			strokeColor: '#000000'
		},
		layout: {
			fontSizeRatio: 0.075,
			yRatio: 0,
			widthRatio: 0.9,
			heightRatio: 0.22
		}
	}
] as const satisfies readonly CaptionStylePreset[];

export const DEFAULT_CAPTION_STYLE_PRESET_ID: CaptionStylePresetId = 'netflix';

export function captionStylePresetById(id: CaptionStylePresetId): CaptionStylePreset {
	return (
		CAPTION_STYLE_PRESETS.find((preset) => preset.id === id) ??
		CAPTION_STYLE_PRESETS.find((preset) => preset.id === DEFAULT_CAPTION_STYLE_PRESET_ID)!
	);
}

export function resolveCaptionStylePatch(
	preset: CaptionStylePreset,
	canvasWidth: number,
	canvasHeight: number,
	baseTransform?: ItemTransform
): CaptionStylePatch {
	return {
		...preset.style,
		fontSize: Math.max(8, Math.round(canvasHeight * preset.layout.fontSizeRatio)),
		transform: {
			...baseTransform,
			x: baseTransform?.x ?? 0,
			y: Math.round(canvasHeight * preset.layout.yRatio),
			width: Math.round(canvasWidth * preset.layout.widthRatio),
			height: Math.round(canvasHeight * preset.layout.heightRatio),
			rotation: baseTransform?.rotation ?? 0,
			opacity: baseTransform?.opacity ?? 1
		}
	};
}

function shadowsMatch(
	left: TimelineItem['textShadow'],
	right: TimelineItem['textShadow']
): boolean {
	if (left === right) return true;
	return (
		left !== undefined &&
		right !== undefined &&
		left.offsetX === right.offsetX &&
		left.offsetY === right.offsetY &&
		left.blur === right.blur &&
		left.color === right.color
	);
}

function stylesMatch(item: TimelineItem, expected: CaptionStylePatch): boolean {
	return (
		item.fontFamily === expected.fontFamily &&
		item.fontSize === expected.fontSize &&
		item.fontWeight === expected.fontWeight &&
		item.fontStyle === expected.fontStyle &&
		item.underline === expected.underline &&
		item.color === expected.color &&
		item.backgroundColor === expected.backgroundColor &&
		item.backgroundFit === expected.backgroundFit &&
		item.borderRadius === expected.borderRadius &&
		item.textAlign === expected.textAlign &&
		item.verticalAlign === expected.verticalAlign &&
		item.lineHeight === expected.lineHeight &&
		item.letterSpacing === expected.letterSpacing &&
		item.paddingX === expected.paddingX &&
		item.paddingY === expected.paddingY &&
		item.strokeWidth === expected.strokeWidth &&
		item.strokeColor === expected.strokeColor &&
		shadowsMatch(item.textShadow, expected.textShadow) &&
		item.transform?.y === expected.transform?.y &&
		item.transform?.width === expected.transform?.width &&
		item.transform?.height === expected.transform?.height
	);
}

export function detectActiveCaptionPreset(
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number
): CaptionStylePreset | null {
	for (const preset of CAPTION_STYLE_PRESETS) {
		const expected = resolveCaptionStylePatch(preset, canvasWidth, canvasHeight, item.transform);
		if (stylesMatch(item, expected)) return preset;
	}
	return null;
}
