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

const CROP_PROPERTIES: KeyframeProperty[] = VIDEO_PROPERTIES.filter(
	(property) => property !== 'volume'
);

const TEXT_PROPERTIES: KeyframeProperty[] = [
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
		case 'composition':
		case 'controller':
			builtIn = [...VISUAL_PROPERTIES];
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

	switch (property) {
		case 'cropLeft':
			return { ...item, crop: { ...cropOrDefault(item), left: value } };
		case 'cropRight':
			return { ...item, crop: { ...cropOrDefault(item), right: value } };
		case 'cropTop':
			return { ...item, crop: { ...cropOrDefault(item), top: value } };
		case 'cropBottom':
			return { ...item, crop: { ...cropOrDefault(item), bottom: value } };
		case 'cropSoftness':
			return { ...item, crop: { ...cropOrDefault(item), softness: value } };
		case 'volume':
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
	}
	return item;
}

function isTransformProperty(
	property: KeyframeProperty
): property is keyof NonNullable<TimelineItem['transform']> & KeyframeProperty {
	return VISUAL_PROPERTIES.includes(property);
}

function cropOrDefault(item: TimelineItem): NonNullable<TimelineItem['crop']> {
	return item.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
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
