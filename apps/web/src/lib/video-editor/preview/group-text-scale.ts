/** Typography updates that keep text content proportional during a group scale. */
import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
import { TEXT_DEFAULTS } from '$lib/video-editor/typography/text-style';

export const GROUP_TEXT_ANIMATED_PROPERTIES = [
	'fontSize',
	'letterSpacing',
	'paddingX',
	'paddingY',
	'borderRadius',
	'textShadowOffsetX',
	'textShadowOffsetY',
	'textShadowBlur',
	'strokeWidth'
] as const satisfies readonly KeyframeProperty[];
export const GROUP_TEXT_ANIMATED_PROPERTY_SET: ReadonlySet<KeyframeProperty> = new Set(
	GROUP_TEXT_ANIMATED_PROPERTIES
);

export interface GroupTextAnimatedValues {
	fontSize: number;
	letterSpacing: number;
	paddingX: number;
	paddingY: number;
	borderRadius?: number;
	textShadowOffsetX?: number;
	textShadowOffsetY?: number;
	textShadowBlur?: number;
	strokeWidth?: number;
}

export interface GroupTextScalePlan {
	animated: GroupTextAnimatedValues;
	itemPatch: Pick<TimelineItem, 'textSpans'>;
}

export function planGroupTextScale(item: TimelineItem, scale: number): GroupTextScalePlan | null {
	if (item.type !== 'text' || !Number.isFinite(scale) || scale <= 0 || scale === 1) return null;
	const animated: GroupTextAnimatedValues = {
		fontSize: (item.fontSize ?? TEXT_DEFAULTS.fontSize) * scale,
		letterSpacing: (item.letterSpacing ?? TEXT_DEFAULTS.letterSpacing) * scale,
		paddingX: (item.paddingX ?? TEXT_DEFAULTS.paddingX) * scale,
		paddingY: (item.paddingY ?? TEXT_DEFAULTS.paddingY) * scale
	};
	if (item.borderRadius !== undefined) animated.borderRadius = item.borderRadius * scale;
	if (item.strokeWidth !== undefined) animated.strokeWidth = item.strokeWidth * scale;
	if (item.textShadow) {
		animated.textShadowOffsetX = item.textShadow.offsetX * scale;
		animated.textShadowOffsetY = item.textShadow.offsetY * scale;
		animated.textShadowBlur = item.textShadow.blur * scale;
	}
	return {
		animated,
		itemPatch: {
			textSpans: item.textSpans?.map((span) => ({
				...span,
				fontSize: span.fontSize === undefined ? undefined : span.fontSize * scale,
				letterSpacing: span.letterSpacing === undefined ? undefined : span.letterSpacing * scale
			}))
		}
	};
}
