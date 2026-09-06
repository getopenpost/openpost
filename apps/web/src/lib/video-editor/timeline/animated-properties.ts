/**
 * Resolve keyframed item properties for preview and export.
 *
 * Ported from FreeCut (MIT) - features/keyframes/utils/animatable-properties.ts,
 * animated-transform-resolver.ts, animated-crop-resolver.ts, and
 * animated-text-item.ts. Adapted to OpenPost's item model.
 */
import type {
	KeyframeProperty,
	TimelineItem,
	VectorKeyframeProperty
} from '$lib/video-editor/project/types';
import { activeValueAt } from './keyframe-interpolation';
import {
	activeVectorKeyframes,
	interpolateVector,
	VECTOR_COMPONENTS,
	vectorPropertyForComponent,
	vectorToScalarComponent
} from './vector-keyframes';
import {
	getAnimatableEffectPropertiesForItem,
	isEffectKeyframeProperty,
	resolveAnimatedEffectsAt
} from '$lib/video-editor/effects/effect-keyframes';
import { applyMotionModifiers } from './motion-modifier-eval';
import { applyMotionAnimationLayers } from './motion-layer-eval';
import { resolveItemPropertyRuntime } from './property-runtime';
import {
	clonePathVertices,
	isPathVertexKeyframeProperty,
	pathVertexKeyframeProperties,
	setPathVertexPropertyValue
} from './path-vertex-keyframes';
import { resolveTransformHierarchy, type ResolvedTransform } from './transform-parenting';
import {
	cropSourceDimensions,
	cropWithPropertyPixels,
	type CropKeyframeProperty
} from '$lib/video-editor/media/crop-properties';

export interface AnimatedItemMotionContext {
	fps: number;
	frameWidth: number;
	frameHeight: number;
	/** Items in the active sequence, used by links and expression references. */
	items?: readonly TimelineItem[];
}

const VISUAL_PROPERTIES: KeyframeProperty[] = [
	'x',
	'y',
	'width',
	'height',
	'scaleX',
	'scaleY',
	'anchorX',
	'anchorY',
	'rotation',
	'opacity',
	'cornerRadius'
];

const VIDEO_PROPERTIES: KeyframeProperty[] = [
	'cropLeft',
	'cropRight',
	'cropTop',
	'cropBottom',
	'cropSoftness',
	'volume'
];

const CROP_PROPERTIES: CropKeyframeProperty[] = VIDEO_PROPERTIES.filter(
	(property): property is CropKeyframeProperty => property !== 'volume'
);

function isCropKeyframeProperty(property: KeyframeProperty): property is CropKeyframeProperty {
	return CROP_PROPERTIES.some((candidate) => candidate === property);
}

const TEXT_PROPERTIES: KeyframeProperty[] = [
	'textStyleScale',
	'fontSize',
	'fontWeight',
	'lineHeight',
	'letterSpacing',
	'paddingX',
	'paddingY',
	'borderRadius',
	'textShadowOffsetX',
	'textShadowOffsetY',
	'textShadowBlur',
	'strokeWidth'
];

const SHAPE_STROKE_PROPERTIES: KeyframeProperty[] = [
	'strokeWidth',
	'trimPathStart',
	'trimPathEnd',
	'trimPathOffset',
	'taperStartWidth',
	'taperEndWidth',
	'taperStartLength',
	'taperEndLength'
];

const BACKGROUND_PROPERTIES: KeyframeProperty[] = [
	'backgroundRotation',
	'backgroundScale',
	'backgroundOffsetX',
	'backgroundOffsetY',
	'backgroundSmoothness',
	'backgroundDensity',
	'backgroundForegroundOpacity'
];

export function getAnimatablePropertiesForItem(item: TimelineItem): KeyframeProperty[] {
	let builtIn: KeyframeProperty[];
	switch (item.type) {
		case 'audio':
			return ['volume'];
		case 'video':
			builtIn = [...VISUAL_PROPERTIES, ...VIDEO_PROPERTIES];
			break;
		case 'text':
			builtIn = [...VISUAL_PROPERTIES, ...TEXT_PROPERTIES];
			break;
		case 'image':
		case 'lottie':
			builtIn = [...VISUAL_PROPERTIES, ...CROP_PROPERTIES];
			break;
		case 'subtitle':
		case 'controller':
			builtIn = [...VISUAL_PROPERTIES];
			break;
		case 'composition':
			builtIn = [...VISUAL_PROPERTIES, ...CROP_PROPERTIES];
			break;
		case 'shape':
			builtIn = [
				...VISUAL_PROPERTIES,
				...SHAPE_STROKE_PROPERTIES,
				...(item.shapeType === 'path' ? pathVertexKeyframeProperties(item.pathVertices) : [])
			];
			break;
		case 'adjustment':
			builtIn = [];
			break;
		case 'background':
			builtIn = [...VISUAL_PROPERTIES, ...BACKGROUND_PROPERTIES];
			break;
	}
	return [...builtIn, ...getAnimatableEffectPropertiesForItem(item)];
}

export function resolveAnimatedItemAt(
	item: TimelineItem,
	absoluteFrame: number,
	motionContext?: AnimatedItemMotionContext
): TimelineItem {
	const resolved = resolveAnimatedItemLocalAt(item, absoluteFrame, motionContext);
	if (!motionContext?.items || !item.transformParent) return resolved;
	const itemsById = new Map(motionContext.items.map((candidate) => [candidate.id, candidate]));
	const world = resolveTransformHierarchy(item, {
		getItem: (itemId) => itemsById.get(itemId),
		resolveLocal: (candidate) =>
			resolvedTransformForItem(
				resolveAnimatedItemLocalAt(candidate, absoluteFrame, motionContext),
				motionContext.frameWidth,
				motionContext.frameHeight
			)
	});
	return {
		...resolved,
		transform: {
			...resolved.transform,
			x: world.x,
			y: world.y,
			width: world.width,
			height: world.height,
			anchorX: world.anchorX,
			anchorY: world.anchorY,
			rotation: world.rotation,
			opacity: world.opacity,
			cornerRadius: world.cornerRadius
		}
	};
}

export function resolveAnimatedItemLocalAt(
	item: TimelineItem,
	absoluteFrame: number,
	motionContext?: AnimatedItemMotionContext
): TimelineItem {
	let resolved = resolvePreExpressionItemAt(item, absoluteFrame);
	if (motionContext?.items) {
		resolved = resolveItemPropertyRuntime(item, resolved, {
			absoluteFrame,
			fps: motionContext.fps,
			items: motionContext.items,
			resolvePreExpressionItem: resolvePreExpressionItemAt
		});
	}
	if (motionContext && (item.motionLayers?.length || item.motionModifiers?.length)) {
		const transform = resolved.transform ?? {};
		const base: import('./motion-presets').ResolvedMotionTransform = {
			x: transform.x ?? 0,
			y: transform.y ?? 0,
			width: Math.max(1, transform.width ?? resolved.sourceWidth ?? motionContext.frameWidth),
			height: Math.max(1, transform.height ?? resolved.sourceHeight ?? motionContext.frameHeight),
			scaleX: transform.scaleX ?? 1,
			scaleY: transform.scaleY ?? 1,
			rotation: transform.rotation ?? 0,
			opacity: transform.opacity ?? 1
		};
		const layered = applyMotionAnimationLayers(base, item.motionLayers, absoluteFrame - item.from);
		const animated = applyMotionModifiers(layered, item.motionModifiers, {
			frame: absoluteFrame - item.from,
			fps: motionContext.fps,
			frameWidth: motionContext.frameWidth,
			frameHeight: motionContext.frameHeight
		});
		resolved = { ...resolved, transform: { ...transform, ...animated } };
	}
	return resolved;
}

export function resolvedTransformForItem(
	item: TimelineItem,
	frameWidth: number,
	frameHeight: number
): ResolvedTransform {
	const transform = item.transform ?? {};
	const width = Math.max(1, transform.width ?? item.sourceWidth ?? frameWidth);
	const height = Math.max(1, transform.height ?? item.sourceHeight ?? frameHeight);
	return {
		x: transform.x ?? 0,
		y: transform.y ?? 0,
		width,
		height,
		scaleX: transform.scaleX ?? 1,
		scaleY: transform.scaleY ?? 1,
		anchorX: transform.anchorX ?? width / 2,
		anchorY: transform.anchorY ?? height / 2,
		rotation: transform.rotation ?? 0,
		opacity: transform.opacity ?? 1,
		cornerRadius: transform.cornerRadius ?? 0
	};
}

export function resolvePreExpressionItemAt(
	item: TimelineItem,
	absoluteFrame: number
): TimelineItem {
	let resolved: TimelineItem = {
		...item,
		transform: item.transform ? { ...item.transform } : undefined,
		crop: item.crop ? { ...item.crop } : undefined,
		textShadow: item.textShadow ? { ...item.textShadow } : undefined,
		background: item.background ? { ...item.background } : undefined,
		effects: resolveAnimatedEffectsAt(item, absoluteFrame)
	};
	const activeVectors = new Set<VectorKeyframeProperty>();
	for (const property of ['position', 'scale', 'anchor'] as const) {
		const track = activeVectorKeyframes(item, property);
		if (!track) continue;
		const value = interpolateVector(track, absoluteFrame - item.from);
		if (!value) continue;
		activeVectors.add(property);
		const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
		resolved = {
			...resolved,
			transform: {
				...resolved.transform,
				[xProperty]: vectorToScalarComponent(item, property, 'x', value.x),
				[yProperty]: vectorToScalarComponent(item, property, 'y', value.y)
			}
		};
	}

	for (const property of getAnimatablePropertiesForItem(item)) {
		if (isEffectKeyframeProperty(property)) continue;
		const vector = vectorPropertyForComponent(property);
		if (vector && activeVectors.has(vector.property)) continue;
		const value = activeValueAt(item, property, absoluteFrame);
		if (value === null) continue;
		resolved = applyResolvedValue(resolved, property, value);
	}
	return resolved;
}

function applyResolvedValue(
	item: TimelineItem,
	property: KeyframeProperty,
	value: number
): TimelineItem {
	if (isPathVertexKeyframeProperty(property)) {
		const pathVertices = clonePathVertices(item.pathVertices ?? []);
		return setPathVertexPropertyValue(pathVertices, property, value)
			? { ...item, pathVertices }
			: item;
	}
	if (isTransformProperty(property)) {
		return { ...item, transform: { ...item.transform, [property]: value } };
	}
	if (isCropKeyframeProperty(property)) {
		return {
			...item,
			crop: cropWithPropertyPixels(item.crop, property, value, cropSourceDimensions(item))
		};
	}

	switch (property) {
		case 'volume':
		case 'textStyleScale':
		case 'fontSize':
		case 'fontWeight':
		case 'lineHeight':
		case 'letterSpacing':
		case 'paddingX':
		case 'paddingY':
		case 'borderRadius':
		case 'strokeWidth':
		case 'trimPathStart':
		case 'trimPathEnd':
		case 'trimPathOffset':
		case 'taperStartWidth':
		case 'taperEndWidth':
		case 'taperStartLength':
		case 'taperEndLength':
			return { ...item, [property]: value };
		case 'textShadowOffsetX':
			return {
				...item,
				textShadow: { ...shadowOrDefault(item), offsetX: value }
			};
		case 'textShadowOffsetY':
			return {
				...item,
				textShadow: { ...shadowOrDefault(item), offsetY: value }
			};
		case 'textShadowBlur':
			return {
				...item,
				textShadow: { ...shadowOrDefault(item), blur: Math.max(0, value) }
			};
		case 'backgroundRotation': {
			if (!item.background) return item;
			return { ...item, background: { ...item.background, rotation: value } };
		}
		case 'backgroundScale': {
			if (!item.background) return item;
			return { ...item, background: { ...item.background, scale: value } };
		}
		case 'backgroundOffsetX': {
			if (!item.background) return item;
			return { ...item, background: { ...item.background, offsetX: value } };
		}
		case 'backgroundOffsetY': {
			if (!item.background) return item;
			return { ...item, background: { ...item.background, offsetY: value } };
		}
		case 'backgroundSmoothness':
			return item.background?.kind === 'mesh-gradient'
				? { ...item, background: { ...item.background, smoothness: value } }
				: item;
		case 'backgroundDensity':
			return item.background?.kind === 'pattern'
				? { ...item, background: { ...item.background, density: value } }
				: item;
		case 'backgroundForegroundOpacity':
			return item.background?.kind === 'pattern'
				? { ...item, background: { ...item.background, foregroundOpacity: value } }
				: item;
	}
	return item;
}

function isTransformProperty(
	property: KeyframeProperty
): property is keyof NonNullable<TimelineItem['transform']> & KeyframeProperty {
	return VISUAL_PROPERTIES.includes(property);
}

function shadowOrDefault(item: TimelineItem): NonNullable<TimelineItem['textShadow']> {
	return (
		item.textShadow ?? {
			blur: 0,
			color: '#000000',
			offsetX: 0,
			offsetY: 0
		}
	);
}
