import type {
	AnimationKeyframeSource,
	EasingConfig,
	ItemKeyframes,
	KeyframeTrack,
	TimelineItem,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import { resolveAnimatedItemAt } from '../animated-properties';
import { isFrameInTransitionRegion } from '../edit-constraints';
import { activePositionKeyframes } from '../vector-keyframes';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import {
	getMotionPresetAnchorFrame,
	MOTION_PRESETS,
	motionPresetById,
	type MotionPreset,
	type MotionPresetId,
	type MotionPresetKeyframePayload,
	type MotionPresetProperty,
	type ResolvedMotionTransform
} from '../motion-presets';
import {
	applyMotionGeneratorSettings,
	DEFAULT_MOTION_GENERATOR_SETTINGS,
	type MotionGeneratorSettings
} from '../motion-generator';

export type MotionPresetApplyMode = 'replace' | 'add';

export interface ApplyMotionPresetOptions {
	itemIds: string[];
	presetId: MotionPresetId;
	mode: MotionPresetApplyMode;
	frameWidth: number;
	frameHeight: number;
	fps?: number;
	settings?: MotionGeneratorSettings;
	presetName?: string;
}

export type ApplyMotionPresetResult =
	| { ok: true; appliedKeyframes: number }
	| {
			ok: false;
			reason: 'empty-selection' | 'incompatible' | 'transition-blocked' | 'no-change';
	  };

interface PreparedMotionApply {
	item: TimelineItem;
	payloads: MotionPresetKeyframePayload[];
	anchorItem: TimelineItem;
	fromFrame: number;
	toFrame: number;
	source: AnimationKeyframeSource;
}

interface MotionApplyMutation {
	patch: Partial<TimelineItem>;
	appliedKeyframes: number;
	changed: boolean;
}

interface MotionKeyframeUpsert {
	keyframes: ItemKeyframes;
	applied: boolean;
}

const MOTION_PRESET_PROPERTIES = [
	...new Set(MOTION_PRESETS.flatMap((preset) => preset.properties))
];
const VISUAL_ITEM_TYPES = new Set<TimelineItem['type']>([
	'video',
	'image',
	'lottie',
	'text',
	'subtitle',
	'shape',
	'composition'
]);

export function canApplyMotionPreset(item: TimelineItem, preset: MotionPreset): boolean {
	return VISUAL_ITEM_TYPES.has(item.type);
}

export function applyMotionPreset(options: ApplyMotionPresetOptions): ApplyMotionPresetResult {
	const preset = motionPresetById(options.presetId);
	const items = uniqueExistingItems(options.itemIds);
	if (items.length === 0) return { ok: false, reason: 'empty-selection' };
	if (items.some((item) => !canApplyMotionPreset(item, preset))) {
		return { ok: false, reason: 'incompatible' };
	}

	const fps = options.fps ?? timelineStore.fps;
	const settings = options.settings ?? DEFAULT_MOTION_GENERATOR_SETTINGS;
	const prepared = items.flatMap((item, index) => {
		const source: AnimationKeyframeSource = {
			applicationId: crypto.randomUUID(),
			kind: 'built-in-preset',
			presetId: preset.id,
			presetName: options.presetName ?? preset.id
		};
		const anchorItem = options.mode === 'replace' ? withoutMotionAnimation(item) : item;
		const anchorFrame = getMotionPresetAnchorFrame(preset.category, item.durationInFrames, fps);
		const anchor = resolvedMotionTransform(
			resolveAnimatedItemAt(anchorItem, item.from + anchorFrame),
			options.frameWidth,
			options.frameHeight
		);
		const context = {
			anchor,
			durationInFrames: item.durationInFrames,
			fps,
			frameWidth: options.frameWidth,
			frameHeight: options.frameHeight
		};
		const payloads = applyMotionGeneratorSettings(
			preset,
			preset.build(context),
			context,
			settings,
			index
		);
		if (payloads.length === 0) return [];
		const frames = payloads.map((payload) => payload.frame);
		return [
			{
				item,
				payloads,
				anchorItem,
				fromFrame: Math.min(...frames),
				toFrame: Math.max(...frames),
				source
			}
		];
	});
	if (prepared.length === 0) return { ok: false, reason: 'no-change' };
	if (prepared.some((apply) => hasBlockedFrame(apply))) {
		return { ok: false, reason: 'transition-blocked' };
	}

	let appliedKeyframes = 0;
	execute('APPLY_MOTION_PRESET', () => {
		const updates = prepared.flatMap((apply) => {
			const result = applyPreparedMotion(apply, options.mode);
			appliedKeyframes += result.appliedKeyframes;
			return result.changed ? [{ id: apply.item.id, patch: result.patch }] : [];
		});
		if (updates.length > 0) timelineStore._updateItems(updates);
	});

	return appliedKeyframes > 0 ? { ok: true, appliedKeyframes } : { ok: false, reason: 'no-change' };
}

function uniqueExistingItems(itemIds: string[]): TimelineItem[] {
	const seen = new Set<string>();
	const items: TimelineItem[] = [];
	for (const id of itemIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		const item = timelineStore.itemById.get(id);
		if (item) items.push(item);
	}
	return items;
}

function withoutMotionAnimation(item: TimelineItem): TimelineItem {
	const keyframes = { ...item.keyframes };
	for (const property of MOTION_PRESET_PROPERTIES) delete keyframes[property];
	const vectorKeyframes = { ...item.vectorKeyframes };
	delete vectorKeyframes.position;
	return {
		...item,
		keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined,
		vectorKeyframes: Object.keys(vectorKeyframes).length > 0 ? vectorKeyframes : undefined
	};
}

function resolvedMotionTransform(
	item: TimelineItem,
	frameWidth: number,
	frameHeight: number
): ResolvedMotionTransform {
	return {
		x: item.transform?.x ?? 0,
		y: item.transform?.y ?? 0,
		width: Math.max(1, item.transform?.width ?? item.sourceWidth ?? frameWidth),
		height: Math.max(1, item.transform?.height ?? item.sourceHeight ?? frameHeight),
		scaleX: item.transform?.scaleX ?? 1,
		scaleY: item.transform?.scaleY ?? 1,
		rotation: item.transform?.rotation ?? 0,
		opacity: item.transform?.opacity ?? 1
	};
}

function hasBlockedFrame(apply: PreparedMotionApply): boolean {
	return apply.payloads.some(
		(payload) =>
			payload.frame < 0 ||
			payload.frame >= apply.item.durationInFrames ||
			isFrameInTransitionRegion(payload.frame, apply.item, transitionsStore.list)
	);
}

function applyPreparedMotion(
	apply: PreparedMotionApply,
	mode: MotionPresetApplyMode
): MotionApplyMutation {
	let keyframes = cloneItemKeyframes(apply.item.keyframes);
	let position = activePositionKeyframes(apply.item)?.map(cloneVectorKeyframe);
	const usesPosition =
		position !== undefined &&
		apply.payloads.some((payload) => payload.property === 'x' || payload.property === 'y');

	if (mode === 'replace') {
		for (const property of MOTION_PRESET_PROPERTIES) {
			keyframes = removeTrackRange(keyframes, property, apply.fromFrame, apply.toFrame);
		}
		if (usesPosition) {
			position = position?.filter(
				(keyframe) => keyframe.frame < apply.fromFrame || keyframe.frame > apply.toFrame
			);
		}
	}

	let appliedKeyframes = 0;
	if (usesPosition && position) {
		const positionPayloads = apply.payloads.filter(
			(payload) => payload.property === 'x' || payload.property === 'y'
		);
		for (const frame of [...new Set(positionPayloads.map((payload) => payload.frame))]) {
			if (mode === 'add' && position.some((keyframe) => keyframe.frame === frame)) continue;
			const pose = resolvedMotionTransform(
				resolveAnimatedItemAt(apply.anchorItem, apply.item.from + frame),
				1,
				1
			);
			const x = positionPayloads.find(
				(payload) => payload.frame === frame && payload.property === 'x'
			);
			const y = positionPayloads.find(
				(payload) => payload.frame === frame && payload.property === 'y'
			);
			const style = x ?? y;
			if (!style) continue;
			position.push({
				id: crypto.randomUUID(),
				frame,
				value: { x: x?.value ?? pose.x, y: y?.value ?? pose.y },
				easing: style.easing,
				source: apply.source,
				...(style.easingConfig && {
					easingConfig: cloneEasingConfig(style.easingConfig)
				})
			});
			appliedKeyframes += 1;
		}
		position = position.toSorted((left, right) => left.frame - right.frame);
		delete keyframes.x;
		delete keyframes.y;
	}

	for (const payload of apply.payloads) {
		if (usesPosition && (payload.property === 'x' || payload.property === 'y')) continue;
		const result = upsertMotionKeyframe(keyframes, payload, mode, apply.source);
		keyframes = result.keyframes;
		if (result.applied) appliedKeyframes += 1;
	}

	const nextKeyframes = Object.keys(keyframes).length > 0 ? keyframes : undefined;
	const vectorKeyframes = { ...apply.item.vectorKeyframes };
	if (usesPosition) {
		if (position && position.length > 0) vectorKeyframes.position = position;
		else delete vectorKeyframes.position;
	}
	const nextVectorKeyframes = Object.keys(vectorKeyframes).length > 0 ? vectorKeyframes : undefined;
	return {
		patch: {
			keyframes: nextKeyframes,
			vectorKeyframes: nextVectorKeyframes,
			...(appliedKeyframes > 0 && { animationVersion: 2 as const })
		},
		appliedKeyframes,
		changed: appliedKeyframes > 0
	};
}

function cloneItemKeyframes(source: ItemKeyframes | undefined): ItemKeyframes {
	const result: ItemKeyframes = {};
	for (const [property, track] of Object.entries(source ?? {})) {
		if (track) Object.assign(result, { [property]: cloneTrack(track) });
	}
	return result;
}

function cloneTrack(track: KeyframeTrack): KeyframeTrack {
	return {
		frames: [...track.frames],
		values: [...track.values],
		...(track.ids && { ids: [...track.ids] }),
		...(track.easings && { easings: [...track.easings] }),
		...(track.easingConfigs && {
			easingConfigs: track.easingConfigs.map((config) =>
				config ? cloneEasingConfig(config) : null
			)
		}),
		...(track.sources && { sources: [...track.sources] })
	};
}

function removeTrackRange(
	keyframes: ItemKeyframes,
	property: MotionPresetProperty,
	fromFrame: number,
	toFrame: number
): ItemKeyframes {
	const track = keyframes[property];
	if (!track) return keyframes;
	const keep = track.frames.map((frame) => frame < fromFrame || frame > toFrame);
	const next: KeyframeTrack = {
		frames: track.frames.filter((_, index) => keep[index]),
		values: track.values.filter((_, index) => keep[index]),
		...(track.ids && { ids: track.ids.filter((_, index) => keep[index]) }),
		...(track.easings && {
			easings: track.easings.filter((_, index) => keep[index])
		}),
		...(track.easingConfigs && {
			easingConfigs: track.easingConfigs.filter((_, index) => keep[index])
		}),
		...(track.sources && { sources: track.sources.filter((_, index) => keep[index]) })
	};
	if (next.frames.length > 0) return { ...keyframes, [property]: next };
	const result = { ...keyframes };
	delete result[property];
	return result;
}

function upsertMotionKeyframe(
	keyframes: ItemKeyframes,
	payload: MotionPresetKeyframePayload,
	mode: MotionPresetApplyMode,
	source: AnimationKeyframeSource
): MotionKeyframeUpsert {
	const existingTrack = keyframes[payload.property];
	const track = completeTrack(existingTrack, payload.property);
	const collision = track.frames.indexOf(payload.frame);
	if (mode === 'add' && collision >= 0) return { keyframes, applied: false };
	if (collision >= 0) {
		track.values[collision] = payload.value;
		track.easings[collision] = payload.easing;
		track.easingConfigs[collision] = payload.easingConfig
			? cloneEasingConfig(payload.easingConfig)
			: null;
		track.sources[collision] = source;
	} else {
		let index = track.frames.findIndex((frame) => frame > payload.frame);
		if (index < 0) index = track.frames.length;
		track.frames.splice(index, 0, payload.frame);
		track.values.splice(index, 0, payload.value);
		track.ids.splice(index, 0, crypto.randomUUID());
		track.easings.splice(index, 0, payload.easing);
		track.easingConfigs.splice(
			index,
			0,
			payload.easingConfig ? cloneEasingConfig(payload.easingConfig) : null
		);
		track.sources.splice(index, 0, source);
	}
	return {
		keyframes: { ...keyframes, [payload.property]: track },
		applied: true
	};
}

function completeTrack(
	track: KeyframeTrack | undefined,
	property: MotionPresetProperty
): Required<KeyframeTrack> {
	const source = track ?? { frames: [], values: [] };
	return {
		frames: [...source.frames],
		values: [...source.values],
		ids: source.frames.map(
			(frame, index) => source.ids?.[index] ?? `legacy:${property}:${frame}:${index}`
		),
		easings: source.frames.map((_, index) => source.easings?.[index] ?? 'linear'),
		easingConfigs: source.frames.map((_, index) =>
			source.easingConfigs?.[index] ? cloneEasingConfig(source.easingConfigs[index]!) : null
		),
		sources: source.frames.map((_, index) => source.sources?.[index] ?? null)
	};
}

function cloneVectorKeyframe(keyframe: VectorKeyframe): VectorKeyframe {
	return {
		...keyframe,
		value: { ...keyframe.value },
		...(keyframe.easingConfig && {
			easingConfig: cloneEasingConfig(keyframe.easingConfig)
		}),
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
		type: config.type,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}
