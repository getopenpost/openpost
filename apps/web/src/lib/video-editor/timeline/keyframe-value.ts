import type { KeyframeProperty, TimelineItem } from '../project/types';
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '../project/defaults';
import { TEXT_DEFAULTS } from '../typography/text-style';
import { cropPropertyValuePixels, cropSourceDimensions } from '../media/crop-properties';
import { effectPropertyBaseValue, isEffectKeyframeProperty } from '../effects/effect-keyframes';
import { isPathVertexKeyframeProperty, pathVertexPropertyValue } from './path-vertex-keyframes';
import { resolvePreExpressionItemAt } from './animated-properties';

/** Capture the authored value before expressions and additive motion, in the lane's units. */
export function keyframeValueAt(
	item: TimelineItem,
	property: KeyframeProperty,
	absoluteFrame: number,
	canvas = { width: DEFAULT_PROJECT_WIDTH, height: DEFAULT_PROJECT_HEIGHT }
): number {
	const resolved = resolvePreExpressionItemAt(item, absoluteFrame);
	if (isEffectKeyframeProperty(property)) return effectPropertyBaseValue(resolved, property) ?? 0;
	if (isPathVertexKeyframeProperty(property))
		return pathVertexPropertyValue(resolved.pathVertices, property) ?? 0;
	const transform = resolved.transform;
	const width = transform?.width ?? item.sourceWidth ?? canvas.width;
	const height = transform?.height ?? item.sourceHeight ?? canvas.height;
	switch (property) {
		case 'x':
		case 'y':
		case 'rotation':
		case 'cornerRadius':
			return transform?.[property] ?? 0;
		case 'opacity':
		case 'scaleX':
		case 'scaleY':
			return transform?.[property] ?? 1;
		case 'width':
			return width;
		case 'height':
			return height;
		case 'anchorX':
			return transform?.anchorX ?? width / 2;
		case 'anchorY':
			return transform?.anchorY ?? height / 2;
		case 'cropLeft':
		case 'cropRight':
		case 'cropTop':
		case 'cropBottom':
		case 'cropSoftness':
			return cropPropertyValuePixels(resolved.crop, property, cropSourceDimensions(resolved));
		case 'volume':
		case 'textStyleScale':
			return resolved[property] ?? 1;
		case 'fontSize':
		case 'fontWeight':
		case 'lineHeight':
		case 'letterSpacing':
		case 'paddingX':
		case 'paddingY':
			return resolved[property] ?? TEXT_DEFAULTS[property];
		case 'borderRadius':
		case 'strokeWidth':
		case 'trimPathStart':
		case 'trimPathOffset':
		case 'taperStartLength':
		case 'taperEndLength':
			return resolved[property] ?? 0;
		case 'trimPathEnd':
		case 'taperStartWidth':
		case 'taperEndWidth':
			return resolved[property] ?? 100;
		case 'textShadowOffsetX':
			return resolved.textShadow?.offsetX ?? 0;
		case 'textShadowOffsetY':
			return resolved.textShadow?.offsetY ?? 0;
		case 'textShadowBlur':
			return resolved.textShadow?.blur ?? 0;
		case 'backgroundRotation':
			return resolved.background?.rotation ?? 0;
		case 'backgroundScale':
			return resolved.background?.scale ?? 1;
		case 'backgroundOffsetX':
			return resolved.background?.offsetX ?? 0;
		case 'backgroundOffsetY':
			return resolved.background?.offsetY ?? 0;
		case 'backgroundSmoothness':
			return resolved.background?.kind === 'mesh-gradient' ? resolved.background.smoothness : 0.55;
		case 'backgroundDensity':
			return resolved.background?.kind === 'pattern' ? resolved.background.density : 0.5;
		case 'backgroundForegroundOpacity':
			return resolved.background?.kind === 'pattern' ? resolved.background.foregroundOpacity : 1;
	}
}
