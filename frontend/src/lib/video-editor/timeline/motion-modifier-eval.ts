import type {
	MotionModifier,
	MotionModifierChannel,
	MotionModifierChannelGains,
	MotionModifierType
} from '$lib/video-editor/project/types';
import type { MotionGeneratorSettings } from './motion-generator';
import type { ResolvedMotionTransform } from './motion-presets';

const TWO_PI = Math.PI * 2;

const BASE_FREQUENCY_HZ = {
	'float-drift': 0.625,
	'breath-pulse': 0.55,
	'micro-shake': 8,
	sway: 0.5,
	spin: 0.3
} satisfies Record<MotionModifierType, number>;

const MODIFIER_CHANNELS = {
	'float-drift': ['x', 'y', 'rotation'],
	'breath-pulse': ['width', 'height', 'opacity'],
	'micro-shake': ['x', 'y', 'rotation'],
	sway: ['rotation'],
	spin: ['rotation']
} satisfies Record<MotionModifierType, readonly MotionModifierChannel[]>;

export interface MotionModifierEvalContext {
	frame: number;
	fps: number;
	frameWidth: number;
	frameHeight: number;
}

export interface MotionContribution {
	dx: number;
	dy: number;
	dRotation: number;
	dOpacity: number;
	scaleWidth: number;
	scaleHeight: number;
}

export interface MotionModifierSettingsUpdate {
	intensityScale?: number;
	durationScale?: number;
	channelGains?: MotionModifierChannelGains;
}

export interface ResolvedMotionModifierSettings {
	intensityScale: number;
	durationScale: number;
	channelGains: MotionModifierChannelGains;
}

const ZERO_CONTRIBUTION: MotionContribution = {
	dx: 0,
	dy: 0,
	dRotation: 0,
	dOpacity: 0,
	scaleWidth: 1,
	scaleHeight: 1
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function channelGain(modifier: MotionModifier, channel: MotionModifierChannel): number {
	if (!MODIFIER_CHANNELS[modifier.type].some((candidate) => candidate === channel)) return 0;
	const value = modifier.channelGains?.[channel];
	return value !== undefined && Number.isFinite(value) ? clamp(value, 0, 2) : 1;
}

export function getActiveMotionModifierChannels(modifier: MotionModifier): MotionModifierChannel[] {
	return MODIFIER_CHANNELS[modifier.type].filter((channel) => channelGain(modifier, channel) > 0);
}

function defaultChannelGains(type: MotionModifierType): MotionModifierChannelGains {
	return Object.fromEntries(MODIFIER_CHANNELS[type].map((channel) => [channel, 1]));
}

function hashNoise(seed: number): number {
	const value = Math.sin(seed * 12.9898) * 43758.5453;
	return (value - Math.floor(value)) * 2 - 1;
}

function smoothstep(value: number): number {
	return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, sample: number): number {
	const index = Math.floor(sample);
	const fraction = sample - index;
	const start = hashNoise(seed + index);
	const end = hashNoise(seed + index + 1);
	return start + (end - start) * smoothstep(fraction);
}

function evaluateFloatDrift(
	modifier: MotionModifier,
	context: MotionModifierEvalContext,
	output: MotionContribution
): void {
	const time = context.frame / Math.max(1, context.fps);
	const phase = (modifier.phaseFrames / Math.max(1, context.fps)) * modifier.frequency * TWO_PI;
	const xAmplitude = clamp(context.frameWidth * 0.008, 4, 18) * modifier.amplitude;
	const yAmplitude = clamp(context.frameHeight * 0.014, 6, 28) * modifier.amplitude;
	const rotationAmplitude = 1.2 * modifier.amplitude;
	output.dx +=
		channelGain(modifier, 'x') *
		xAmplitude *
		Math.sin(TWO_PI * modifier.frequency * time + phase + Math.PI / 2);
	output.dy +=
		channelGain(modifier, 'y') * yAmplitude * Math.sin(TWO_PI * modifier.frequency * time + phase);
	output.dRotation +=
		channelGain(modifier, 'rotation') *
		rotationAmplitude *
		Math.sin(Math.PI * modifier.frequency * time + phase + Math.PI);
}

function evaluateBreathPulse(
	modifier: MotionModifier,
	context: MotionModifierEvalContext,
	output: MotionContribution
): void {
	const time = context.frame / Math.max(1, context.fps);
	const phase = (modifier.phaseFrames / Math.max(1, context.fps)) * modifier.frequency * TWO_PI;
	const scaleAmount = 0.035 * modifier.amplitude;
	const opacityAmount = Math.min(0.08, 0.04 * modifier.amplitude);
	const wave = Math.sin(TWO_PI * modifier.frequency * time + phase);
	output.scaleWidth *= 1 + channelGain(modifier, 'width') * scaleAmount * wave;
	output.scaleHeight *= 1 + channelGain(modifier, 'height') * scaleAmount * wave;
	output.dOpacity += channelGain(modifier, 'opacity') * opacityAmount * wave;
}

function evaluateMicroShake(
	modifier: MotionModifier,
	context: MotionModifierEvalContext,
	output: MotionContribution
): void {
	const sample = (context.frame / Math.max(1, context.fps)) * modifier.frequency;
	const xAmplitude = clamp(context.frameWidth * 0.004, 2, 10) * modifier.amplitude;
	const yAmplitude = clamp(context.frameHeight * 0.004, 2, 10) * modifier.amplitude;
	const rotationAmplitude = 0.55 * modifier.amplitude;
	const seed = modifier.seed * 97;
	output.dx += channelGain(modifier, 'x') * valueNoise(seed + 11, sample) * xAmplitude;
	output.dy += channelGain(modifier, 'y') * valueNoise(seed + 23, sample) * yAmplitude;
	output.dRotation +=
		channelGain(modifier, 'rotation') * valueNoise(seed + 37, sample) * rotationAmplitude;
}

function evaluateSway(
	modifier: MotionModifier,
	context: MotionModifierEvalContext,
	output: MotionContribution
): void {
	const time = context.frame / Math.max(1, context.fps);
	const phase = (modifier.phaseFrames / Math.max(1, context.fps)) * modifier.frequency * TWO_PI;
	output.dRotation +=
		channelGain(modifier, 'rotation') *
		4 *
		modifier.amplitude *
		Math.sin(TWO_PI * modifier.frequency * time + phase);
}

function evaluateSpin(
	modifier: MotionModifier,
	context: MotionModifierEvalContext,
	output: MotionContribution
): void {
	const time = context.frame / Math.max(1, context.fps);
	output.dRotation +=
		channelGain(modifier, 'rotation') * 360 * modifier.frequency * modifier.amplitude * time;
}

function evaluateOne(
	modifier: MotionModifier,
	context: MotionModifierEvalContext,
	output: MotionContribution
): void {
	if (!modifier.enabled || modifier.amplitude <= 0) return;
	switch (modifier.type) {
		case 'float-drift':
			return evaluateFloatDrift(modifier, context, output);
		case 'breath-pulse':
			return evaluateBreathPulse(modifier, context, output);
		case 'micro-shake':
			return evaluateMicroShake(modifier, context, output);
		case 'sway':
			return evaluateSway(modifier, context, output);
		case 'spin':
			return evaluateSpin(modifier, context, output);
	}
}

export function evaluateMotionModifiers(
	modifiers: readonly MotionModifier[] | undefined,
	context: MotionModifierEvalContext
): MotionContribution {
	if (!modifiers || modifiers.length === 0) return ZERO_CONTRIBUTION;
	const output = { ...ZERO_CONTRIBUTION };
	for (const modifier of modifiers) evaluateOne(modifier, context, output);
	return output;
}

export function applyMotionModifiers(
	resolved: ResolvedMotionTransform,
	modifiers: readonly MotionModifier[] | undefined,
	context: MotionModifierEvalContext
): ResolvedMotionTransform {
	if (!modifiers || modifiers.length === 0) return resolved;
	const contribution = evaluateMotionModifiers(modifiers, context);
	if (
		contribution.dx === 0 &&
		contribution.dy === 0 &&
		contribution.dRotation === 0 &&
		contribution.dOpacity === 0 &&
		contribution.scaleWidth === 1 &&
		contribution.scaleHeight === 1
	) {
		return resolved;
	}
	return {
		...resolved,
		x: resolved.x + contribution.dx,
		y: resolved.y + contribution.dy,
		rotation: resolved.rotation + contribution.dRotation,
		width: Math.max(1, resolved.width * contribution.scaleWidth),
		height: Math.max(1, resolved.height * contribution.scaleHeight),
		opacity: clamp(resolved.opacity + contribution.dOpacity, 0, 1)
	};
}

export function createMotionModifier(
	type: MotionModifierType,
	settings: MotionGeneratorSettings,
	itemIndex = 0
): MotionModifier {
	const durationScale = clamp(settings.durationScale, 0.25, 3);
	return {
		version: 2,
		id: crypto.randomUUID(),
		type,
		enabled: true,
		amplitude: clamp(settings.intensityScale, 0, 2),
		frequency: BASE_FREQUENCY_HZ[type] / durationScale,
		phaseFrames: Math.max(0, settings.staggerFrames) * Math.max(0, itemIndex),
		seed: itemIndex + 1,
		channelGains: defaultChannelGains(type)
	};
}

export function getMotionModifierSettings(
	modifier: MotionModifier
): ResolvedMotionModifierSettings {
	const base = BASE_FREQUENCY_HZ[modifier.type];
	const durationScale =
		base > 0 && modifier.frequency > 0 ? clamp(base / modifier.frequency, 0.25, 3) : 1;
	return {
		intensityScale: clamp(modifier.amplitude, 0, 2),
		durationScale,
		channelGains: Object.fromEntries(
			MODIFIER_CHANNELS[modifier.type].map((channel) => [channel, channelGain(modifier, channel)])
		)
	};
}

export function updateMotionModifierSettings(
	modifier: MotionModifier,
	settings: MotionModifierSettingsUpdate
): MotionModifier {
	const next: MotionModifier = { ...modifier, version: 2 };
	if (settings.intensityScale !== undefined) {
		next.amplitude = clamp(settings.intensityScale, 0, 2);
	}
	if (settings.durationScale !== undefined) {
		next.frequency = BASE_FREQUENCY_HZ[modifier.type] / clamp(settings.durationScale, 0.25, 3);
	}
	if (settings.channelGains) {
		next.channelGains = {
			...defaultChannelGains(modifier.type),
			...modifier.channelGains,
			...settings.channelGains
		};
	}
	return next;
}

export function removeMotionModifiers(
	resolved: ResolvedMotionTransform,
	modifiers: readonly MotionModifier[] | undefined,
	context: MotionModifierEvalContext
): ResolvedMotionTransform {
	if (!modifiers || modifiers.length === 0) return resolved;
	const contribution = evaluateMotionModifiers(modifiers, context);
	return {
		...resolved,
		x: resolved.x - contribution.dx,
		y: resolved.y - contribution.dy,
		rotation: resolved.rotation - contribution.dRotation,
		width:
			contribution.scaleWidth === 0 ? resolved.width : resolved.width / contribution.scaleWidth,
		height:
			contribution.scaleHeight === 0 ? resolved.height : resolved.height / contribution.scaleHeight,
		opacity: clamp(resolved.opacity - contribution.dOpacity, 0, 1)
	};
}
