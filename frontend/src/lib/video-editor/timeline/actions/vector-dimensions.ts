import type {
	EasingConfig,
	DirectLinkableProperty,
	ItemKeyframes,
	ItemVectorKeyframes,
	KeyframeTrack,
	TimelineItem,
	VectorKeyframe,
	VectorKeyframeProperty
} from '../../project/types';
import {
	activeVectorKeyframes,
	baseVectorValue,
	interpolateVector,
	promoteVectorKeyframes,
	scalarToVectorComponent,
	VECTOR_COMPONENTS,
	vectorPropertyKeyframesPatch,
	vectorToScalarComponent
} from '../vector-keyframes';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { resolvePreExpressionItemAt } from '../animated-properties';

const MAX_DIMENSION_BAKE_FRAMES = 10_000;

export function vectorDimensionsNeedBake(
	item: TimelineItem,
	property: VectorKeyframeProperty
): boolean {
	const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
	const xTrack = item.keyframes?.[xProperty];
	const yTrack = item.keyframes?.[yProperty];
	if (!xTrack || !yTrack) return false;
	if (xTrack.frames.length !== yTrack.frames.length) return true;
	return xTrack.frames.some(
		(frame, index) =>
			frame !== yTrack.frames[index] ||
			(xTrack.easings?.[index] ?? 'linear') !== (yTrack.easings?.[index] ?? 'linear') ||
			!easingConfigsMatch(xTrack.easingConfigs?.[index], yTrack.easingConfigs?.[index])
	);
}

export function vectorSeparationNeedsBake(
	item: TimelineItem,
	property: VectorKeyframeProperty
): boolean {
	return Boolean(activeVectorKeyframes(item, property)?.some((keyframe) => keyframe.spatial));
}

export function hasVectorDimensionAuthoringConflict(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	separating: boolean
): boolean {
	const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
	const blocked = new Set<DirectLinkableProperty>(separating ? [property] : [xProperty, yProperty]);
	return Boolean(
		item.propertyLinks?.some((link) => blocked.has(link.targetProperty)) ||
		item.expressions?.some((expression) => blocked.has(expression.targetProperty))
	);
}

export function separateVectorDimensions(
	itemId: string,
	property: VectorKeyframeProperty,
	bake = false
): boolean {
	return execute('SEPARATE_VECTOR_DIMENSIONS', () => {
		const item = timelineStore.itemById.get(itemId);
		const source = item ? activeVectorKeyframes(item, property) : undefined;
		if (
			!item ||
			!source ||
			hasVectorDimensionAuthoringConflict(item, property, true) ||
			(vectorSeparationNeedsBake(item, property) && !bake) ||
			(bake && item.durationInFrames > MAX_DIMENSION_BAKE_FRAMES)
		) {
			return false;
		}
		const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
		const sampled = bake
			? Array.from({ length: item.durationInFrames }, (_, frame) => ({
					id: crypto.randomUUID(),
					frame,
					value: interpolateVector(source, frame) ?? baseVectorValue(item, property),
					easing: 'linear' as const
				}))
			: source;
		const keyframes: ItemKeyframes = {
			...item.keyframes,
			[xProperty]: vectorComponentTrack(item, property, 'x', sampled),
			[yProperty]: vectorComponentTrack(item, property, 'y', sampled)
		};
		const vectorKeyframes: ItemVectorKeyframes = { ...item.vectorKeyframes };
		delete vectorKeyframes[property];
		const separatedVectorProperties = [
			...new Set([...(item.separatedVectorProperties ?? []), property])
		];
		timelineStore._updateItems([
			{
				id: itemId,
				patch: {
					keyframes,
					vectorKeyframes: Object.keys(vectorKeyframes).length > 0 ? vectorKeyframes : undefined,
					separatedVectorProperties,
					animationVersion: 2
				}
			}
		]);
		return true;
	});
}

export function coupleVectorDimensions(
	itemId: string,
	property: VectorKeyframeProperty,
	includeFrame?: number,
	bake = false
): boolean {
	return execute('COUPLE_VECTOR_DIMENSIONS', () => {
		const item = timelineStore.itemById.get(itemId);
		if (
			!item ||
			hasVectorDimensionAuthoringConflict(item, property, false) ||
			(vectorDimensionsNeedBake(item, property) && !bake) ||
			(bake && item.durationInFrames > MAX_DIMENSION_BAKE_FRAMES)
		) {
			return false;
		}
		const promoted = bake
			? {
					keyframes: Array.from({ length: item.durationInFrames }, (_, frame) => ({
						id: crypto.randomUUID(),
						frame,
						value: resolvedVectorAt(item, property, frame),
						easing: 'linear' as const
					}))
				}
			: promoteVectorKeyframes(item, property, includeFrame);
		if (!promoted) return false;
		timelineStore._updateItems([
			{
				id: itemId,
				patch: vectorPropertyKeyframesPatch(item, property, promoted.keyframes)
			}
		]);
		return true;
	});
}

function resolvedVectorAt(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	frame: number
): VectorKeyframe['value'] {
	const resolved = resolvePreExpressionItemAt(item, item.from + frame);
	const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
	const base = baseVectorValue(item, property);
	const xValue =
		resolved.transform?.[xProperty] ?? vectorToScalarComponent(item, property, 'x', base.x);
	const yValue =
		resolved.transform?.[yProperty] ?? vectorToScalarComponent(item, property, 'y', base.y);
	return {
		x: scalarToVectorComponent(item, property, 'x', xValue),
		y: scalarToVectorComponent(item, property, 'y', yValue)
	};
}

function vectorComponentTrack(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	axis: 'x' | 'y',
	keyframes: readonly VectorKeyframe[]
): KeyframeTrack {
	return {
		frames: keyframes.map((keyframe) => keyframe.frame),
		values: keyframes.map((keyframe) =>
			vectorToScalarComponent(item, property, axis, keyframe.value[axis])
		),
		ids: keyframes.map(() => crypto.randomUUID()),
		easings: keyframes.map((keyframe) => keyframe.easing),
		easingConfigs: keyframes.map((keyframe) =>
			keyframe.easingConfig ? cloneEasingConfig(keyframe.easingConfig) : null
		),
		sources: keyframes.map((keyframe) => keyframe.source ?? null)
	};
}

function easingConfigsMatch(
	left: EasingConfig | null | undefined,
	right: EasingConfig | null | undefined
): boolean {
	if (!left || !right) return left === right;
	return (
		left.type === right.type &&
		left.bezier?.x1 === right.bezier?.x1 &&
		left.bezier?.y1 === right.bezier?.y1 &&
		left.bezier?.x2 === right.bezier?.x2 &&
		left.bezier?.y2 === right.bezier?.y2 &&
		left.spring?.tension === right.spring?.tension &&
		left.spring?.friction === right.spring?.friction &&
		left.spring?.mass === right.spring?.mass
	);
}

function cloneEasingConfig(config: EasingConfig): EasingConfig {
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}
