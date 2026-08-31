import type {
	MotionAnimationLayer,
	MotionLayerBlendMode,
	MotionLayerKeyframe,
	MotionLayerTrack,
	TransformAnimatableProperty
} from '$lib/video-editor/project/types';
import { TRANSFORM_ANIMATABLE_PROPERTIES } from '$lib/video-editor/project/types';
import type { ResolvedMotionTransform } from './motion-presets';

const TRANSFORM_PROPERTIES = new Set(TRANSFORM_ANIMATABLE_PROPERTIES);
function isTransformAnimatableProperty(property: string): property is TransformAnimatableProperty {
	// SAFETY: Set holds the closed union of TransformAnimatableProperty values.
	return TRANSFORM_PROPERTIES.has(property as TransformAnimatableProperty);
}

export interface MotionLayerPayload {
	property: TransformAnimatableProperty;
	frame: number;
	value: number;
	easing: import('$lib/video-editor/project/types').EasingType;
	easingConfig?: import('$lib/video-editor/project/types').EasingConfig;
}

function blendForProperty(property: TransformAnimatableProperty): MotionLayerBlendMode {
	return ['width', 'height', 'scaleX', 'scaleY'].includes(property) ? 'multiply' : 'add';
}

function identityForBlend(blend: MotionLayerBlendMode): number {
	return blend === 'multiply' ? 1 : 0;
}

function contributionValue(
	property: TransformAnimatableProperty,
	value: number,
	anchor: ResolvedMotionTransform
): number {
	if (['width', 'height', 'scaleX', 'scaleY'].includes(property)) {
		return anchor[property] === 0 ? 1 : value / anchor[property];
	}
	return value - anchor[property];
}

export function createMotionAnimationLayer(params: {
	id?: string;
	name: string;
	source: MotionAnimationLayer['source'];
	sourcePresetId: string;
	anchor: ResolvedMotionTransform;
	payloads: readonly MotionLayerPayload[];
}): MotionAnimationLayer {
	const tracksByProperty = new Map<TransformAnimatableProperty, MotionLayerTrack>();
	for (const payload of params.payloads) {
		if (!isTransformAnimatableProperty(payload.property)) continue;
		// SAFETY: Guard above guarantees payload.property is a TransformAnimatableProperty.
		const property = payload.property as TransformAnimatableProperty;
		const blend = blendForProperty(property);
		const keyframe: MotionLayerKeyframe = {
			id: crypto.randomUUID(),
			frame: payload.frame,
			value: contributionValue(property, payload.value, params.anchor),
			easing: payload.easing,
			easingConfig: payload.easingConfig
		};
		const existing = tracksByProperty.get(property);
		if (existing) existing.keyframes.push(keyframe);
		else tracksByProperty.set(property, { property, blend, keyframes: [keyframe] });
	}
	return {
		id: params.id ?? crypto.randomUUID(),
		name: params.name,
		enabled: true,
		source: params.source,
		sourcePresetId: params.sourcePresetId,
		tracks: [...tracksByProperty.values()].map((track) => ({
			...track,
			keyframes: track.keyframes.toSorted((left, right) => left.frame - right.frame)
		}))
	};
}

export function cloneMotionAnimationLayer(
	layer: MotionAnimationLayer,
	options: { freshIds?: boolean } = {}
): MotionAnimationLayer {
	return {
		...layer,
		id: options.freshIds ? crypto.randomUUID() : layer.id,
		tracks: layer.tracks.map((track) => ({
			...track,
			keyframes: track.keyframes.map((keyframe) => ({
				...keyframe,
				id: options.freshIds ? crypto.randomUUID() : keyframe.id,
				...(keyframe.easingConfig && {
					easingConfig: {
						...keyframe.easingConfig,
						...(keyframe.easingConfig.bezier && { bezier: { ...keyframe.easingConfig.bezier } }),
						...(keyframe.easingConfig.spring && { spring: { ...keyframe.easingConfig.spring } })
					}
				})
			}))
		}))
	};
}

export function getActiveMotionLayerChannels(
	layers: readonly MotionAnimationLayer[] | undefined
): TransformAnimatableProperty[] {
	const channels = new Set<TransformAnimatableProperty>();
	for (const layer of layers ?? []) {
		if (!layer.enabled) continue;
		for (const track of layer.tracks) {
			if (track.keyframes.length > 0) channels.add(track.property);
		}
	}
	return [...channels];
}

import { applyEasing, applyEasingConfig } from './easing';

function interpolateLayerValue(
	keyframes: readonly MotionLayerKeyframe[],
	frame: number,
	fallback: number
): number {
	if (keyframes.length === 0) return fallback;
	if (keyframes.length === 1) return keyframes[0].value;
	if (frame <= keyframes[0].frame) return keyframes[0].value;
	const last = keyframes.length - 1;
	if (frame >= keyframes[last].frame) return keyframes[last].value;
	for (let index = 1; index <= last; index += 1) {
		if (frame > keyframes[index].frame) continue;
		const left = keyframes[index - 1];
		const right = keyframes[index];
		const span = right.frame - left.frame;
		if (span <= 0) return right.value;
		const progress = (frame - left.frame) / span;
		const eased = left.easingConfig
			? applyEasingConfig(progress, left.easingConfig)
			: applyEasing(progress, left.easing);
		return left.value + eased * (right.value - left.value);
	}
	return keyframes[last].value;
}

export interface MotionContribution {
	dx: number;
	dy: number;
	dRotation: number;
	dOpacity: number;
	scaleWidth: number;
	scaleHeight: number;
	scaleX: number;
	scaleY: number;
}

const IDENTITY_CONTRIBUTION: MotionContribution = {
	dx: 0,
	dy: 0,
	dRotation: 0,
	dOpacity: 0,
	scaleWidth: 1,
	scaleHeight: 1,
	scaleX: 1,
	scaleY: 1
};

function evaluateMotionAnimationLayers(
	layers: readonly MotionAnimationLayer[] | undefined,
	frame: number
): MotionContribution {
	if (!layers || layers.length === 0) return IDENTITY_CONTRIBUTION;
	const out: MotionContribution = { ...IDENTITY_CONTRIBUTION };
	for (const layer of layers) {
		if (!layer.enabled) continue;
		for (const track of layer.tracks) {
			if (track.keyframes.length === 0) continue;
			const value = interpolateLayerValue(track.keyframes, frame, identityForBlend(track.blend));
			switch (track.property) {
				case 'x':
					out.dx += value;
					break;
				case 'y':
					out.dy += value;
					break;
				case 'rotation':
					out.dRotation += value;
					break;
				case 'opacity':
					out.dOpacity += value;
					break;
				case 'width':
					out.scaleWidth *= value;
					break;
				case 'height':
					out.scaleHeight *= value;
					break;
				case 'scaleX':
					out.scaleX *= value;
					break;
				case 'scaleY':
					out.scaleY *= value;
					break;
				case 'anchorX':
				case 'anchorY':
				case 'cornerRadius':
					break;
			}
		}
	}
	return out;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function applyMotionAnimationLayers(
	resolved: ResolvedMotionTransform,
	layers: readonly MotionAnimationLayer[] | undefined,
	frame: number
): ResolvedMotionTransform {
	if (!layers || layers.length === 0) return resolved;
	const contribution = evaluateMotionAnimationLayers(layers, frame);
	return {
		...resolved,
		x: resolved.x + contribution.dx,
		y: resolved.y + contribution.dy,
		rotation: resolved.rotation + contribution.dRotation,
		width: Math.max(1, resolved.width * contribution.scaleWidth),
		height: Math.max(1, resolved.height * contribution.scaleHeight),
		scaleX: (resolved.scaleX ?? 1) * contribution.scaleX,
		scaleY: (resolved.scaleY ?? 1) * contribution.scaleY,
		opacity: clamp(resolved.opacity + contribution.dOpacity, 0, 1)
	};
}

export function removeMotionAnimationLayers(
	resolved: ResolvedMotionTransform,
	layers: readonly MotionAnimationLayer[] | undefined,
	frame: number
): ResolvedMotionTransform {
	if (!layers || layers.length === 0) return resolved;
	const contribution = evaluateMotionAnimationLayers(layers, frame);
	return {
		...resolved,
		x: resolved.x - contribution.dx,
		y: resolved.y - contribution.dy,
		rotation: resolved.rotation - contribution.dRotation,
		width:
			contribution.scaleWidth === 0 ? resolved.width : resolved.width / contribution.scaleWidth,
		height:
			contribution.scaleHeight === 0 ? resolved.height : resolved.height / contribution.scaleHeight,
		scaleX:
			contribution.scaleX === 0
				? (resolved.scaleX ?? 1)
				: (resolved.scaleX ?? 1) / contribution.scaleX,
		scaleY:
			contribution.scaleY === 0
				? (resolved.scaleY ?? 1)
				: (resolved.scaleY ?? 1) / contribution.scaleY,
		opacity: clamp(resolved.opacity - contribution.dOpacity, 0, 1)
	};
}
