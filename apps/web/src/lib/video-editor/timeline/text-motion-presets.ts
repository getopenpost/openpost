import type { TextMotionChannelContext, TextMotionPreset } from './text-motion-types';
import {
	TEXT_MOTION_IN_PRESET_IDS,
	TEXT_MOTION_LOOP_PRESET_IDS,
	TEXT_MOTION_OUT_PRESET_IDS,
	type TextMotionEffect,
	type TextMotionEffectBase,
	type TextMotionInEffect,
	type TextMotionInPresetId,
	type TextMotionLoopEffect,
	type TextMotionLoopPresetId,
	type TextMotionOutEffect,
	type TextMotionOutPresetId,
	type TextMotionPresetId,
	type TextMotionSlot,
	type TextMotionUnit
} from '../project/types';

const TWO_PI = Math.PI * 2;
const BASE_DEFAULTS: TextMotionEffectBase = {
	durationFrames: 12,
	staggerFrames: 3,
	intensity: 1,
	order: 'forward',
	easing: 'ease-out',
	seed: 0
};

interface PresetInput {
	id: TextMotionPresetId;
	slot: TextMotionSlot;
	unit: TextMotionUnit;
	defaults?: Partial<TextMotionEffectBase>;
	channels: TextMotionPreset['channels'];
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function hash01(seed: number): number {
	const wrapped = ((seed % 4096) + 4096) % 4096;
	const value = Math.sin(wrapped * 12.9898 + 78.233) * 43758.5453;
	return value - Math.floor(value);
}

function definePreset(input: PresetInput): TextMotionPreset {
	return {
		id: input.id,
		slot: input.slot,
		unit: input.unit,
		defaults: { ...BASE_DEFAULTS, ...input.defaults },
		channels: input.channels
	};
}

const PRESETS = {
	typewriter: definePreset({
		id: 'typewriter',
		slot: 'in',
		unit: 'character',
		defaults: { durationFrames: 1, staggerFrames: 2, easing: 'linear' },
		channels: (progress) => ({ alpha: progress >= 1 ? 1 : 0 })
	}),
	'fade-up': definePreset({
		id: 'fade-up',
		slot: 'in',
		unit: 'word',
		channels: (progress, context) => ({
			alpha: clamp01(progress),
			dy: (1 - progress) * 0.25 * context.fontSize * context.intensity
		})
	}),
	rise: definePreset({
		id: 'rise',
		slot: 'in',
		unit: 'word',
		defaults: { durationFrames: 14, staggerFrames: 4 },
		channels: (progress, context) => ({
			alpha: clamp01(progress * 1.5),
			dy: (1 - progress) * 0.6 * context.fontSize * context.intensity
		})
	}),
	cascade: definePreset({
		id: 'cascade',
		slot: 'in',
		unit: 'character',
		defaults: { durationFrames: 10, staggerFrames: 1 },
		channels: (progress, context) => ({
			alpha: clamp01(progress),
			dy: -(1 - progress) * 0.8 * context.fontSize * context.intensity
		})
	}),
	pop: definePreset({
		id: 'pop',
		slot: 'in',
		unit: 'word',
		defaults: { durationFrames: 10, easing: 'overshoot' },
		channels: (progress, context) => ({
			alpha: clamp01(progress * 2),
			scale: Math.max(0, 1 + (progress - 1) * context.intensity)
		})
	}),
	'blur-in': definePreset({
		id: 'blur-in',
		slot: 'in',
		unit: 'word',
		defaults: { durationFrames: 14 },
		channels: (progress, context) => ({
			alpha: clamp01(progress),
			soften: Math.max(0, (1 - progress) * 0.4 * context.fontSize * context.intensity)
		})
	}),
	'slide-mask': definePreset({
		id: 'slide-mask',
		slot: 'in',
		unit: 'line',
		defaults: { staggerFrames: 5 },
		channels: (progress, context) => ({
			dx: -(1 - progress) * context.boxWidth * context.intensity
		})
	}),
	'wave-in': definePreset({
		id: 'wave-in',
		slot: 'in',
		unit: 'character',
		defaults: { staggerFrames: 1 },
		channels: (progress, context) => ({
			alpha: clamp01(progress),
			dy:
				(1 - progress) *
				Math.sin(context.unitIndex * 0.9) *
				0.5 *
				context.fontSize *
				context.intensity
		})
	}),
	'fade-down': definePreset({
		id: 'fade-down',
		slot: 'out',
		unit: 'word',
		defaults: { easing: 'ease-in' },
		channels: (progress, context) => ({
			alpha: clamp01(1 - progress),
			dy: progress * 0.25 * context.fontSize * context.intensity
		})
	}),
	sink: definePreset({
		id: 'sink',
		slot: 'out',
		unit: 'word',
		defaults: { durationFrames: 14, staggerFrames: 4, easing: 'ease-in' },
		channels: (progress, context) => ({
			alpha: clamp01(1 - progress),
			dy: progress * 0.6 * context.fontSize * context.intensity
		})
	}),
	'pop-out': definePreset({
		id: 'pop-out',
		slot: 'out',
		unit: 'word',
		defaults: { durationFrames: 10, easing: 'ease-in' },
		channels: (progress, context) => ({
			alpha: clamp01(1 - progress),
			scale: Math.max(0, 1 - progress * context.intensity)
		})
	}),
	'blur-out': definePreset({
		id: 'blur-out',
		slot: 'out',
		unit: 'word',
		defaults: { durationFrames: 14, easing: 'ease-in' },
		channels: (progress, context) => ({
			alpha: clamp01(1 - progress),
			soften: Math.max(0, progress * 0.4 * context.fontSize * context.intensity)
		})
	}),
	'typewriter-erase': definePreset({
		id: 'typewriter-erase',
		slot: 'out',
		unit: 'character',
		defaults: { durationFrames: 1, staggerFrames: 2, easing: 'linear', order: 'backward' },
		channels: (progress) => ({ alpha: progress >= 1 ? 0 : 1 })
	}),
	pulse: definePreset({
		id: 'pulse',
		slot: 'loop',
		unit: 'word',
		defaults: { durationFrames: 36, staggerFrames: 0, easing: 'linear' },
		channels: (progress, context) => ({
			scale: 1 + 0.06 * context.intensity * Math.sin(TWO_PI * progress)
		})
	}),
	wave: definePreset({
		id: 'wave',
		slot: 'loop',
		unit: 'character',
		defaults: { durationFrames: 30, staggerFrames: 3, easing: 'linear' },
		channels: (progress, context) => ({
			dy: 0.18 * context.fontSize * context.intensity * Math.sin(TWO_PI * progress)
		})
	}),
	shimmer: definePreset({
		id: 'shimmer',
		slot: 'loop',
		unit: 'word',
		defaults: { durationFrames: 24, staggerFrames: 0, easing: 'linear' },
		channels: (progress, context) => ({
			alpha: clamp01(
				1 -
					0.35 *
						context.intensity *
						(0.5 +
							0.5 * Math.sin(TWO_PI * (progress + hash01(context.seed * 31 + context.unitIndex))))
			)
		})
	}),
	swing: definePreset({
		id: 'swing',
		slot: 'loop',
		unit: 'character',
		defaults: { durationFrames: 32, staggerFrames: 2, easing: 'linear' },
		channels: (progress, context) => ({
			rotation: 0.09 * context.intensity * Math.sin(TWO_PI * progress)
		})
	})
} satisfies Record<TextMotionPresetId, TextMotionPreset>;

export function getTextMotionPreset(presetId: TextMotionPresetId): TextMotionPreset {
	return PRESETS[presetId];
}

export function createTextMotionEffect(
	presetId: TextMotionInPresetId,
	seed?: number
): TextMotionInEffect;
export function createTextMotionEffect(
	presetId: TextMotionOutPresetId,
	seed?: number
): TextMotionOutEffect;
export function createTextMotionEffect(
	presetId: TextMotionLoopPresetId,
	seed?: number
): TextMotionLoopEffect;
export function createTextMotionEffect(
	presetId: TextMotionPresetId,
	seed?: number
): TextMotionEffect;
export function createTextMotionEffect(presetId: TextMotionPresetId, seed = 0): TextMotionEffect {
	const preset = getTextMotionPreset(presetId);
	// SAFETY: each preset id belongs to the slot encoded by its effect union.
	return { ...preset.defaults, presetId, seed } as TextMotionEffect;
}

export const TEXT_MOTION_IN_PRESETS = TEXT_MOTION_IN_PRESET_IDS.map((id) => PRESETS[id]);
export const TEXT_MOTION_OUT_PRESETS = TEXT_MOTION_OUT_PRESET_IDS.map((id) => PRESETS[id]);
export const TEXT_MOTION_LOOP_PRESETS = TEXT_MOTION_LOOP_PRESET_IDS.map((id) => PRESETS[id]);
