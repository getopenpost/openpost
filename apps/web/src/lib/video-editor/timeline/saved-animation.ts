/** Capture and compatibility rules for project-scoped animation recipes. */
import type {
	AnimationPreset,
	AnimationPresetKeyframe,
	AnimationPresetProperty,
	AnimationPresetVectorProperty,
	AnimationPresetVectorKeyframe,
	EasingConfig,
	KeyframeProperty,
	KeyframeTrack,
	MotionModifier,
	TimelineItem,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import type { ItemEffect } from '$lib/video-editor/effects/types';
import { parseEffectKeyframeProperty } from '$lib/video-editor/effects/effect-keyframes';
import { getAnimatablePropertiesForItem } from './animated-properties';
import { activeVectorKeyframes, VECTOR_COMPONENTS } from './vector-keyframes';
import { cloneMotionAnimationLayer } from './motion-layer-eval';

export type AnimationPresetIncompatibility =
	| 'type-mismatch'
	| 'missing-property'
	| 'missing-effect';

export interface AnimationPresetCompatibility {
	compatible: boolean;
	reason?: AnimationPresetIncompatibility;
}

export function captureAnimationFromItem(
	item: TimelineItem,
	name: string,
	createdAt = Date.now()
): AnimationPreset | null {
	const scalarProperties = capturedScalarProperties(item);
	const vectorProperties: AnimationPresetVectorProperty[] = (
		['position', 'scale', 'anchor'] as const
	).flatMap((property) => {
		const keyframes = activeVectorKeyframes(item, property);
		return keyframes ? [{ property, keyframes: keyframes.map(cloneVectorKeyframe) }] : [];
	});
	const motionModifiers = (item.motionModifiers ?? [])
		.filter((modifier) => modifier.enabled && modifier.amplitude > 0)
		.map(cloneMotionModifier);
	const motionLayers = (item.motionLayers ?? [])
		.filter((layer) => layer.enabled && layer.tracks.some((track) => track.keyframes.length > 0))
		.map((layer) => cloneMotionAnimationLayer(layer));
	const textMotion =
		item.type === 'text' && item.textMotion ? cloneTextMotion(item.textMotion) : undefined;
	if (
		scalarProperties.length === 0 &&
		vectorProperties.length === 0 &&
		motionModifiers.length === 0 &&
		motionLayers.length === 0 &&
		!textMotion
	) {
		return null;
	}

	const animatedFrames = [
		...scalarProperties.flatMap((property) => property.keyframes.map((keyframe) => keyframe.frame)),
		...vectorProperties.flatMap((property) => property.keyframes.map((keyframe) => keyframe.frame))
	];
	const firstFrame = animatedFrames.length > 0 ? Math.min(...animatedFrames) : 0;
	const properties = scalarProperties.map((property) => ({
		...property,
		keyframes: property.keyframes.map((keyframe) => ({
			...keyframe,
			frame: keyframe.frame - firstFrame
		}))
	}));
	const normalizedVectors = vectorProperties.map((property) => ({
		...property,
		keyframes: property.keyframes.map((keyframe) => ({
			...cloneVectorKeyframe(keyframe),
			frame: keyframe.frame - firstFrame
		}))
	}));
	return {
		id: crypto.randomUUID(),
		name: name.trim(),
		sourceItemType: item.type,
		properties,
		...(normalizedVectors.length > 0 && { vectorProperties: normalizedVectors }),
		effects: carriedEffects(item, properties),
		...(motionModifiers.length > 0 && { motionModifiers }),
		...(motionLayers.length > 0 && { motionLayers }),
		...(textMotion && { textMotion }),
		sourceDurationInFrames: item.durationInFrames,
		createdAt
	};
}

function cloneTextMotion(
	spec: NonNullable<AnimationPreset['textMotion']>
): NonNullable<AnimationPreset['textMotion']> {
	return {
		...(spec.in && { in: { ...spec.in } }),
		...(spec.out && { out: { ...spec.out } }),
		...(spec.loop && { loop: { ...spec.loop } })
	};
}

export function getAnimationPresetCompatibility(
	preset: AnimationPreset,
	item: TimelineItem
): AnimationPresetCompatibility {
	if (preset.sourceItemType !== item.type) {
		return { compatible: false, reason: 'type-mismatch' };
	}
	const available = new Set(getAnimatablePropertiesForItem(item));
	for (const entry of preset.properties) {
		const parsed = parseEffectKeyframeProperty(entry.property);
		if (parsed) {
			const carried = preset.effects.some(
				(effect) =>
					effect.type === 'gpu' &&
					effect.id === parsed.effectId &&
					effect.effectId === parsed.effectType
			);
			if (!carried) return { compatible: false, reason: 'missing-effect' };
			continue;
		}
		if (!available.has(entry.property)) {
			return { compatible: false, reason: 'missing-property' };
		}
	}
	for (const property of preset.vectorProperties ?? []) {
		const [xProperty, yProperty] = VECTOR_COMPONENTS[property.property];
		if (!available.has(xProperty) || !available.has(yProperty)) {
			return { compatible: false, reason: 'missing-property' };
		}
	}
	return { compatible: true };
}

function capturedScalarProperties(item: TimelineItem): AnimationPresetProperty[] {
	const properties: AnimationPresetProperty[] = [];
	for (const [rawProperty, track] of Object.entries(item.keyframes ?? {})) {
		if (!track || track.frames.length === 0) continue;
		// SAFETY: ItemKeyframes only permits KeyframeProperty keys.
		const property = rawProperty as KeyframeProperty;
		properties.push({ property, keyframes: trackKeyframes(track, property) });
	}
	return properties;
}

function trackKeyframes(
	track: KeyframeTrack,
	property: KeyframeProperty
): AnimationPresetKeyframe[] {
	return track.frames
		.map((frame, index) => ({
			id: track.ids?.[index] ?? `legacy:${property}:${frame}:${index}`,
			frame,
			value: track.values[index] ?? 0,
			easing: track.easings?.[index] ?? 'linear',
			...(track.easingConfigs?.[index] && {
				easingConfig: cloneEasingConfig(track.easingConfigs[index]!)
			})
		}))
		.toSorted((left, right) => left.frame - right.frame);
}

function carriedEffects(
	item: TimelineItem,
	properties: readonly AnimationPresetProperty[]
): ItemEffect[] {
	const ids = new Set(
		properties.flatMap((property) => {
			const parsed = parseEffectKeyframeProperty(property.property);
			return parsed ? [parsed.effectId] : [];
		})
	);
	return (item.effects ?? [])
		.filter((effect) => ids.has(effect.id))
		.map((effect) =>
			effect.type === 'gpu' ? { ...effect, params: { ...effect.params } } : { ...effect }
		);
}

function cloneMotionModifier(modifier: MotionModifier): MotionModifier {
	return {
		...modifier,
		...(modifier.channelGains && { channelGains: { ...modifier.channelGains } })
	};
}

function cloneVectorKeyframe(keyframe: VectorKeyframe): AnimationPresetVectorKeyframe {
	const { source: _source, ...portableKeyframe } = keyframe;
	return {
		...portableKeyframe,
		value: { ...keyframe.value },
		...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) }),
		...(keyframe.spatial && {
			spatial: {
				...keyframe.spatial,
				inTangent: { ...keyframe.spatial.inTangent },
				outTangent: { ...keyframe.spatial.outTangent }
			}
		})
	};
}

function cloneEasingConfig(config: EasingConfig): EasingConfig {
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}
