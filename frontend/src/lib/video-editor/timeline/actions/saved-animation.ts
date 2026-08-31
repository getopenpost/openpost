import type {
	AnimationKeyframeSource,
	AnimationPreset,
	AnimationPresetKeyframe,
	AnimationPresetVectorKeyframe,
	EasingConfig,
	ItemKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	MotionModifier,
	TimelineItem,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import type { GpuEffect, ItemEffect } from '$lib/video-editor/effects/types';
import {
	buildEffectKeyframeProperty,
	parseEffectKeyframeProperty
} from '$lib/video-editor/effects/effect-keyframes';
import { execute } from '../commands/command-store.svelte';
import { isFrameInTransitionRegion } from '../edit-constraints';
import {
	getAnimationPresetCompatibility,
	type AnimationPresetIncompatibility
} from '../saved-animation';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { VECTOR_COMPONENTS } from '../vector-keyframes';

export interface ApplySavedAnimationOptions {
	itemIds: string[];
	preset: AnimationPreset;
	mode: 'replace' | 'add';
	retime: boolean;
	anchorAbsoluteFrame?: number;
}

export type ApplySavedAnimationResult =
	| { ok: true; appliedItems: number; writtenKeyframes: number; addedEffects: number }
	| {
			ok: false;
			reason:
				| 'empty-selection'
				| 'no-change'
				| 'transition-blocked'
				| AnimationPresetIncompatibility;
	  };

interface PreparedSavedAnimation {
	item: TimelineItem;
	patch: Partial<TimelineItem>;
	writtenKeyframes: number;
	addedEffects: number;
	frames: number[];
}

interface EffectMapping {
	effects: ItemEffect[];
	idBySourceId: ReadonlyMap<string, string>;
	addedEffects: number;
}

interface MergedTrack {
	track: KeyframeTrack;
	applied: number;
	writtenFrames: number[];
}

interface MergedVector {
	keyframes: VectorKeyframe[];
	applied: number;
	writtenFrames: number[];
}

interface KeyframeEntry extends AnimationPresetKeyframe {
	source: AnimationKeyframeSource | null;
}

export function applySavedAnimation(
	options: ApplySavedAnimationOptions
): ApplySavedAnimationResult {
	const items = uniqueItems(options.itemIds);
	if (items.length === 0) return { ok: false, reason: 'empty-selection' };
	const prepared: PreparedSavedAnimation[] = [];
	for (const item of items) {
		const compatibility = getAnimationPresetCompatibility(options.preset, item);
		if (!compatibility.compatible) {
			return { ok: false, reason: compatibility.reason ?? 'missing-property' };
		}
		prepared.push(prepareSavedAnimation(item, options));
	}
	if (
		prepared.some((entry) =>
			entry.frames.some((frame) =>
				isFrameInTransitionRegion(frame, entry.item, transitionsStore.list)
			)
		)
	) {
		return { ok: false, reason: 'transition-blocked' };
	}
	const changed = prepared.filter(
		(entry) =>
			entry.writtenKeyframes > 0 ||
			entry.addedEffects > 0 ||
			entry.patch.motionModifiers ||
			entry.patch.textMotion
	);
	if (changed.length === 0) return { ok: false, reason: 'no-change' };

	execute(
		'APPLY_SAVED_ANIMATION',
		() => {
			timelineStore._updateItems(
				changed.map((entry) => ({ id: entry.item.id, patch: entry.patch }))
			);
		},
		{ count: changed.length, presetId: options.preset.id }
	);
	return {
		ok: true,
		appliedItems: changed.length,
		writtenKeyframes: changed.reduce((sum, entry) => sum + entry.writtenKeyframes, 0),
		addedEffects: changed.reduce((sum, entry) => sum + entry.addedEffects, 0)
	};
}

function prepareSavedAnimation(
	item: TimelineItem,
	options: ApplySavedAnimationOptions
): PreparedSavedAnimation {
	const source: AnimationKeyframeSource = {
		applicationId: crypto.randomUUID(),
		kind: 'saved-preset',
		presetId: options.preset.id,
		presetName: options.preset.name
	};
	const effectMapping = mapEffects(item.effects ?? [], options.preset);
	const keyframes: ItemKeyframes = { ...item.keyframes };
	let writtenKeyframes = 0;
	const writtenFrames: number[] = [];
	const anchorFrame = relativeAnchor(item, options.anchorAbsoluteFrame);
	const maxFrame = Math.max(0, item.durationInFrames - 1);
	const sourceLastFrame = Math.max(1, options.preset.sourceDurationInFrames - 1);
	const timeScale = options.retime ? Math.max(0, maxFrame - anchorFrame) / sourceLastFrame : 1;
	const retime = (frame: number): number =>
		Math.max(0, Math.min(maxFrame, anchorFrame + Math.round(frame * timeScale)));
	const vectorRecipeProperties = new Set(
		(options.preset.vectorProperties ?? []).map((entry) => entry.property)
	);

	for (const property of options.preset.properties) {
		if (
			[...vectorRecipeProperties].some((vectorProperty) => {
				const [xProperty, yProperty] = VECTOR_COMPONENTS[vectorProperty];
				return property.property === xProperty || property.property === yProperty;
			})
		) {
			continue;
		}
		const targetProperty = remapProperty(property.property, effectMapping.idBySourceId);
		if (!targetProperty) continue;
		const incoming = retimedScalarKeys(property.keyframes, retime, source);
		if (incoming.length === 0) continue;
		const result = mergeTrack(keyframes[targetProperty], incoming, options.mode);
		if (result.applied === 0) continue;
		keyframes[targetProperty] = result.track;
		writtenKeyframes += result.applied;
		writtenFrames.push(...result.writtenFrames);
	}

	let vectorKeyframes = item.vectorKeyframes;
	for (const recipe of options.preset.vectorProperties ?? []) {
		const incoming = retimedVectorKeys(recipe.keyframes, retime, source);
		const result = mergeVector(
			item.vectorKeyframes?.[recipe.property] ?? [],
			incoming,
			options.mode
		);
		if (result.applied > 0) {
			vectorKeyframes = { ...vectorKeyframes, [recipe.property]: result.keyframes };
			const [xProperty, yProperty] = VECTOR_COMPONENTS[recipe.property];
			delete keyframes[xProperty];
			delete keyframes[yProperty];
			writtenKeyframes += result.applied;
			writtenFrames.push(...result.writtenFrames);
		}
	}

	const incomingModifiers = (options.preset.motionModifiers ?? []).map(freshModifier);
	const motionModifiers =
		incomingModifiers.length > 0
			? options.mode === 'replace'
				? incomingModifiers
				: mergeModifiers(item.motionModifiers, incomingModifiers)
			: item.motionModifiers;
	const textMotion = options.preset.textMotion
		? options.mode === 'replace'
			? cloneTextMotion(options.preset.textMotion)
			: mergeTextMotion(item.textMotion, options.preset.textMotion)
		: item.textMotion;
	return {
		item,
		patch: {
			keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined,
			vectorKeyframes,
			...(vectorRecipeProperties.size > 0 && { animationVersion: 2 as const }),
			...(vectorRecipeProperties.size > 0 && {
				separatedVectorProperties: item.separatedVectorProperties?.filter(
					(property) => !vectorRecipeProperties.has(property)
				)
			}),
			...(effectMapping.effects.length !== (item.effects ?? []).length && {
				effects: effectMapping.effects
			}),
			...(incomingModifiers.length > 0 && { motionModifiers }),
			...(options.preset.textMotion && { textMotion })
		},
		writtenKeyframes,
		addedEffects: effectMapping.addedEffects,
		frames: [...new Set(writtenFrames)]
	};
}

function mergeTextMotion(
	existing: TimelineItem['textMotion'],
	incoming: NonNullable<AnimationPreset['textMotion']>
): NonNullable<AnimationPreset['textMotion']> {
	return {
		...(existing?.in && { in: { ...existing.in } }),
		...(existing?.out && { out: { ...existing.out } }),
		...(existing?.loop && { loop: { ...existing.loop } }),
		...(incoming.in && { in: { ...incoming.in } }),
		...(incoming.out && { out: { ...incoming.out } }),
		...(incoming.loop && { loop: { ...incoming.loop } })
	};
}

function cloneTextMotion(
	spec: NonNullable<AnimationPreset['textMotion']>
): NonNullable<AnimationPreset['textMotion']> {
	return mergeTextMotion(undefined, spec);
}

function mapEffects(existing: readonly ItemEffect[], preset: AnimationPreset): EffectMapping {
	const effects = existing.map(cloneEffect);
	const idBySourceId = new Map<string, string>();
	const usedTargetIds = new Set<string>();
	for (const source of preset.effects) {
		if (source.type !== 'gpu') continue;
		const target = effects.find(
			(effect) =>
				effect.type === 'gpu' &&
				effect.effectId === source.effectId &&
				!usedTargetIds.has(effect.id)
		);
		if (target) {
			idBySourceId.set(source.id, target.id);
			usedTargetIds.add(target.id);
			continue;
		}
		const clone: GpuEffect = { ...source, id: crypto.randomUUID(), params: { ...source.params } };
		effects.push(clone);
		idBySourceId.set(source.id, clone.id);
		usedTargetIds.add(clone.id);
	}
	return { effects, idBySourceId, addedEffects: effects.length - existing.length };
}

function remapProperty(
	property: KeyframeProperty,
	idBySourceId: ReadonlyMap<string, string>
): KeyframeProperty | null {
	const parsed = parseEffectKeyframeProperty(property);
	if (!parsed) return property;
	const targetId = idBySourceId.get(parsed.effectId);
	return targetId
		? buildEffectKeyframeProperty(parsed.effectType, targetId, parsed.paramName)
		: null;
}

function retimedScalarKeys(
	keyframes: readonly AnimationPresetKeyframe[],
	retime: (frame: number) => number,
	source: AnimationKeyframeSource
): KeyframeEntry[] {
	const byFrame = new Map<number, KeyframeEntry>();
	for (const keyframe of keyframes) {
		const frame = retime(keyframe.frame);
		byFrame.set(frame, {
			...keyframe,
			id: crypto.randomUUID(),
			frame,
			source,
			...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) })
		});
	}
	return [...byFrame.values()].toSorted((left, right) => left.frame - right.frame);
}

function retimedVectorKeys(
	keyframes: readonly AnimationPresetVectorKeyframe[],
	retime: (frame: number) => number,
	source: AnimationKeyframeSource
): VectorKeyframe[] {
	const byFrame = new Map<number, VectorKeyframe>();
	for (const keyframe of keyframes) {
		const frame = retime(keyframe.frame);
		byFrame.set(frame, {
			...cloneVectorKeyframe(keyframe),
			id: crypto.randomUUID(),
			frame,
			source
		});
	}
	return [...byFrame.values()].toSorted((left, right) => left.frame - right.frame);
}

function mergeTrack(
	existing: KeyframeTrack | undefined,
	incoming: readonly KeyframeEntry[],
	mode: 'replace' | 'add'
): MergedTrack {
	const entries = trackEntries(existing);
	const from = Math.min(...incoming.map((entry) => entry.frame));
	const to = Math.max(...incoming.map((entry) => entry.frame));
	const byFrame = new Map(
		entries
			.filter((entry) => mode !== 'replace' || entry.frame < from || entry.frame > to)
			.map((entry) => [entry.frame, entry])
	);
	let applied = 0;
	const writtenFrames: number[] = [];
	for (const entry of incoming) {
		if (mode === 'add' && byFrame.has(entry.frame)) continue;
		byFrame.set(entry.frame, entry);
		applied += 1;
		writtenFrames.push(entry.frame);
	}
	const next = [...byFrame.values()].toSorted((left, right) => left.frame - right.frame);
	return {
		track: {
			frames: next.map((entry) => entry.frame),
			values: next.map((entry) => entry.value),
			ids: next.map((entry) => entry.id),
			easings: next.map((entry) => entry.easing),
			easingConfigs: next.map((entry) => entry.easingConfig ?? null),
			sources: next.map((entry) => entry.source)
		},
		applied,
		writtenFrames
	};
}

function mergeVector(
	existing: readonly VectorKeyframe[],
	incoming: readonly VectorKeyframe[],
	mode: 'replace' | 'add'
): MergedVector {
	const from = Math.min(...incoming.map((entry) => entry.frame));
	const to = Math.max(...incoming.map((entry) => entry.frame));
	const byFrame = new Map(
		existing
			.filter((entry) => mode !== 'replace' || entry.frame < from || entry.frame > to)
			.map((entry) => [entry.frame, cloneVectorKeyframe(entry)])
	);
	let applied = 0;
	const writtenFrames: number[] = [];
	for (const entry of incoming) {
		if (mode === 'add' && byFrame.has(entry.frame)) continue;
		byFrame.set(entry.frame, cloneVectorKeyframe(entry));
		applied += 1;
		writtenFrames.push(entry.frame);
	}
	return {
		keyframes: [...byFrame.values()].toSorted((left, right) => left.frame - right.frame),
		applied,
		writtenFrames
	};
}

function trackEntries(track: KeyframeTrack | undefined): KeyframeEntry[] {
	if (!track) return [];
	return track.frames.map((frame, index) => ({
		id: track.ids?.[index] ?? crypto.randomUUID(),
		frame,
		value: track.values[index] ?? 0,
		easing: track.easings?.[index] ?? 'linear',
		source: track.sources?.[index] ?? null,
		...(track.easingConfigs?.[index] && {
			easingConfig: cloneEasingConfig(track.easingConfigs[index]!)
		})
	}));
}

function relativeAnchor(item: TimelineItem, absoluteFrame: number | undefined): number {
	if (absoluteFrame === undefined) return 0;
	return Math.max(0, Math.min(item.durationInFrames - 1, absoluteFrame - item.from));
}

function uniqueItems(itemIds: readonly string[]): TimelineItem[] {
	return [...new Set(itemIds)].flatMap((id) => {
		const item = timelineStore.itemById.get(id);
		return item ? [item] : [];
	});
}

function mergeModifiers(
	existing: readonly MotionModifier[] | undefined,
	incoming: readonly MotionModifier[]
): MotionModifier[] {
	const incomingTypes = new Set(incoming.map((modifier) => modifier.type));
	return [...(existing ?? []).filter((modifier) => !incomingTypes.has(modifier.type)), ...incoming];
}

function freshModifier(modifier: MotionModifier): MotionModifier {
	return {
		...modifier,
		id: crypto.randomUUID(),
		...(modifier.channelGains && { channelGains: { ...modifier.channelGains } })
	};
}

function cloneVectorKeyframe(keyframe: VectorKeyframe): VectorKeyframe {
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

function cloneEffect(effect: ItemEffect): ItemEffect {
	return effect.type === 'gpu' ? { ...effect, params: { ...effect.params } } : { ...effect };
}
