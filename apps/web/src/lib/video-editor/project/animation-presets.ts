/** Cloning for project-scoped saved animation recipes. */
import type {
	AnimationPreset,
	AnimationPresetKeyframe,
	AnimationPresetVectorKeyframe,
	EasingConfig,
	MotionAnimationLayer,
	MotionModifier
} from './types';
import type { ItemEffect } from '../effects/types';

export function normalizeAnimationPresets(
	presets: readonly AnimationPreset[] | undefined
): AnimationPreset[] {
	return (presets ?? []).map(cloneAnimationPreset);
}

export function cloneAnimationPreset(preset: AnimationPreset): AnimationPreset {
	return {
		...preset,
		name: preset.name.trim(),
		properties: preset.properties.map((property) => ({
			property: property.property,
			keyframes: property.keyframes.map(clonePresetKeyframe)
		})),
		...(preset.vectorProperties && {
			vectorProperties: preset.vectorProperties.map((property) => ({
				property: property.property,
				keyframes: property.keyframes.map(cloneVectorKeyframe)
			}))
		}),
		effects: preset.effects.map(cloneEffect),
		...(preset.motionModifiers && {
			motionModifiers: preset.motionModifiers.map(cloneMotionModifier)
		}),
		...(preset.motionLayers && {
			motionLayers: preset.motionLayers.map(cloneMotionLayer)
		}),
		...(preset.textMotion && {
			textMotion: cloneTextMotion(preset.textMotion)
		})
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

function clonePresetKeyframe(keyframe: AnimationPresetKeyframe): AnimationPresetKeyframe {
	return {
		...keyframe,
		...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) })
	};
}

function cloneVectorKeyframe(
	keyframe: AnimationPresetVectorKeyframe
): AnimationPresetVectorKeyframe {
	return {
		...keyframe,
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

function cloneMotionModifier(modifier: MotionModifier): MotionModifier {
	return {
		...modifier,
		...(modifier.channelGains && { channelGains: { ...modifier.channelGains } })
	};
}

function cloneMotionLayer(layer: MotionAnimationLayer): MotionAnimationLayer {
	return {
		...layer,
		tracks: layer.tracks.map((track) => ({
			...track,
			keyframes: track.keyframes.map((keyframe) => ({
				...keyframe,
				...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) })
			}))
		}))
	};
}

function cloneEffect(effect: ItemEffect): ItemEffect {
	return effect.type === 'gpu' ? { ...effect, params: { ...effect.params } } : { ...effect };
}
