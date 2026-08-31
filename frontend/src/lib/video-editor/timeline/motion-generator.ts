import type {
	MotionPreset,
	MotionPresetBuildContext,
	MotionPresetKeyframePayload,
	ResolvedMotionTransform
} from './motion-presets';

export interface MotionGeneratorSettings {
	durationScale: number;
	intensityScale: number;
	staggerFrames: number;
	triggerWaveColor?: string;
}

export const DEFAULT_MOTION_GENERATOR_SETTINGS: MotionGeneratorSettings = {
	durationScale: 1,
	intensityScale: 1,
	staggerFrames: 0,
	triggerWaveColor: '#2e6b8c'
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function scaleValueAroundAnchor(
	payload: MotionPresetKeyframePayload,
	anchor: ResolvedMotionTransform,
	intensityScale: number
): MotionPresetKeyframePayload {
	const anchorValue = anchor[payload.property];
	const value = anchorValue + (payload.value - anchorValue) * intensityScale;
	return {
		...payload,
		value: clamp(value, propertyMinimum(payload.property), propertyMaximum(payload.property))
	};
}

function propertyMinimum(property: MotionPresetKeyframePayload['property']): number {
	return property === 'scaleX' || property === 'scaleY'
		? 0.01
		: property === 'opacity'
			? 0
			: -Infinity;
}

function propertyMaximum(property: MotionPresetKeyframePayload['property']): number {
	return property === 'opacity' ? 1 : Infinity;
}

function retimeFrame(
	frame: number,
	preset: MotionPreset,
	context: MotionPresetBuildContext,
	durationScale: number,
	staggerFrames: number
): number {
	const maxFrame = Math.max(0, context.durationInFrames - 1);
	const scale = clamp(durationScale, 0.25, 3);
	const stagger = Math.max(0, Math.round(staggerFrames));
	if (preset.category === 'exit') {
		const distanceFromEnd = maxFrame - frame;
		return clamp(Math.round(maxFrame - distanceFromEnd * scale - stagger), 0, maxFrame);
	}
	return clamp(Math.round(frame * scale + stagger), 0, maxFrame);
}

function dedupeByPropertyFrame(
	payloads: MotionPresetKeyframePayload[]
): MotionPresetKeyframePayload[] {
	const byKey = new Map<string, MotionPresetKeyframePayload>();
	for (const payload of payloads) byKey.set(`${payload.property}:${payload.frame}`, payload);
	return [...byKey.values()].sort((left, right) =>
		left.property === right.property
			? left.frame - right.frame
			: left.property.localeCompare(right.property)
	);
}

export function applyMotionGeneratorSettings(
	preset: MotionPreset,
	payloads: MotionPresetKeyframePayload[],
	context: MotionPresetBuildContext,
	settings: MotionGeneratorSettings = DEFAULT_MOTION_GENERATOR_SETTINGS,
	itemIndex = 0
): MotionPresetKeyframePayload[] {
	const durationScale = clamp(settings.durationScale, 0.25, 3);
	const intensityScale = clamp(settings.intensityScale, 0, 2);
	const staggerFrames = Math.max(0, settings.staggerFrames) * Math.max(0, itemIndex);
	return dedupeByPropertyFrame(
		payloads.map((payload) => {
			const scaled = scaleValueAroundAnchor(payload, context.anchor, intensityScale);
			return {
				...scaled,
				frame: retimeFrame(scaled.frame, preset, context, durationScale, staggerFrames)
			};
		})
	);
}
