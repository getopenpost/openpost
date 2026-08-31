/** GPU effect-parameter keyframe plumbing. Ported from FreeCut (MIT). */

import type {
	EffectKeyframeProperty,
	ItemKeyframes,
	KeyframeProperty,
	TimelineItem
} from '$lib/video-editor/project/types';
import type { GpuEffect } from './types';
import type { GpuParamSchema, GpuParamValue } from './gpu/types';
import { getGpuEffect } from './gpu/registry';
import { gpuEffectLabel, gpuParamLabel } from './gpu/i18n';
import { activeValueAt } from '../timeline/keyframe-interpolation';
import {
	colorStringToKeyframeValue,
	interpolateColorTrackToHex,
	keyframeValueToHexColor
} from '../timeline/color-keyframes';

export interface ParsedEffectKeyframeProperty {
	effectType: string;
	effectId: string;
	paramName: string;
}

export function buildEffectKeyframeProperty(
	effectType: string,
	effectId: string,
	paramName: string
): EffectKeyframeProperty {
	return `effect:${effectType}:${effectId}:${paramName}`;
}

export function parseEffectKeyframeProperty(
	property: KeyframeProperty | string
): ParsedEffectKeyframeProperty | null {
	if (!property.startsWith('effect:')) return null;
	const [, effectType = '', effectId = '', paramName = ''] = property.split(':');
	return effectType && effectId && paramName ? { effectType, effectId, paramName } : null;
}

export function isEffectKeyframeProperty(
	property: KeyframeProperty | string
): property is EffectKeyframeProperty {
	return parseEffectKeyframeProperty(property) !== null;
}

function effectParamSchema(effect: GpuEffect, paramName: string): GpuParamSchema | undefined {
	return getGpuEffect(effect.effectId)?.schema.find((param) => param.name === paramName);
}

export function isAnimatableEffectParam(effect: GpuEffect, paramName: string): boolean {
	const schema = effectParamSchema(effect, paramName);
	if (!schema || schema.visibleWhen?.(effect.params) === false) return false;
	if (!schema.type || schema.type === 'number') {
		return schema.animatable !== false;
	}
	return (
		schema.type === 'color' &&
		schema.animatable !== false &&
		colorStringToKeyframeValue(String(effect.params[paramName])) !== null
	);
}

export function getGpuEffectKeyframeProperty(
	effect: GpuEffect,
	paramName: string
): EffectKeyframeProperty | null {
	return isAnimatableEffectParam(effect, paramName)
		? buildEffectKeyframeProperty(effect.effectId, effect.id, paramName)
		: null;
}

export function getAnimatableEffectPropertiesForItem(item: TimelineItem): EffectKeyframeProperty[] {
	return (item.effects ?? []).flatMap((effect) => {
		if (effect.type !== 'gpu') return [];
		const definition = getGpuEffect(effect.effectId);
		if (!definition) return [];
		return definition.schema.flatMap((param) => {
			const property = getGpuEffectKeyframeProperty(effect, param.name);
			return property ? [property] : [];
		});
	});
}

export function effectKeyframeValue(
	effect: GpuEffect,
	paramName: string,
	value: GpuParamValue
): number | null {
	const schema = effectParamSchema(effect, paramName);
	if (!schema || !isAnimatableEffectParam(effect, paramName)) return null;
	if (!schema.type || schema.type === 'number') {
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	}
	return schema.type === 'color' ? colorStringToKeyframeValue(String(value)) : null;
}

export function effectPropertyBaseValue(
	item: TimelineItem,
	property: KeyframeProperty
): number | null {
	const parsed = parseEffectKeyframeProperty(property);
	if (!parsed) return null;
	const effect = item.effects?.find(
		(entry) =>
			entry.type === 'gpu' && entry.id === parsed.effectId && entry.effectId === parsed.effectType
	);
	if (!effect || effect.type !== 'gpu') return null;
	return effectKeyframeValue(effect, parsed.paramName, effect.params[parsed.paramName] ?? 0);
}

export function effectPropertyLabel(item: TimelineItem, property: KeyframeProperty): string | null {
	const parsed = parseEffectKeyframeProperty(property);
	if (!parsed) return null;
	const effect = item.effects?.find(
		(entry) => entry.type === 'gpu' && entry.id === parsed.effectId
	);
	if (!effect || effect.type !== 'gpu') return parsed.paramName;
	const definition = getGpuEffect(effect.effectId);
	const param = definition?.schema.find((entry) => entry.name === parsed.paramName);
	return `${definition ? gpuEffectLabel(definition) : effect.effectId}: ${param ? gpuParamLabel(param) : parsed.paramName}`;
}

export function isColorEffectKeyframeProperty(property: KeyframeProperty): boolean {
	const parsed = parseEffectKeyframeProperty(property);
	if (!parsed) return false;
	return (
		getGpuEffect(parsed.effectType)?.schema.find((param) => param.name === parsed.paramName)
			?.type === 'color'
	);
}

/** Drop every lane owned by one effect instance while preserving unrelated animation. */
export function removeEffectKeyframes(
	keyframes: ItemKeyframes | undefined,
	effectId: string
): ItemKeyframes | undefined {
	if (!keyframes) return undefined;
	const next: ItemKeyframes = {};
	for (const [rawProperty, track] of Object.entries(keyframes)) {
		// SAFETY: ItemKeyframes owns every enumerable key read by Object.entries.
		const property = rawProperty as KeyframeProperty;
		if (parseEffectKeyframeProperty(property)?.effectId === effectId) continue;
		next[property] = track;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

/** Update an effect's unkeyed base value from the numeric keyframe representation. */
export function effectPropertyPatch(
	item: TimelineItem,
	property: KeyframeProperty,
	value: number
): Pick<TimelineItem, 'effects'> | null {
	const parsed = parseEffectKeyframeProperty(property);
	if (!parsed || !item.effects) return null;
	const index = item.effects.findIndex(
		(effect) =>
			effect.type === 'gpu' &&
			effect.id === parsed.effectId &&
			effect.effectId === parsed.effectType
	);
	const current = item.effects[index];
	if (index < 0 || !current || current.type !== 'gpu') return null;
	const schema = effectParamSchema(current, parsed.paramName);
	if (!schema || !isAnimatableEffectParam(current, parsed.paramName)) return null;
	const nextValue = schema.type === 'color' ? keyframeValueToHexColor(value) : value;
	const next: GpuEffect = {
		...current,
		params: { ...current.params, [parsed.paramName]: nextValue }
	};
	return {
		effects: [...item.effects.slice(0, index), next, ...item.effects.slice(index + 1)]
	};
}

/** Resolve every active effect lane for preview and export. */
export function resolveAnimatedEffectsAt(
	item: TimelineItem,
	absoluteFrame: number
): TimelineItem['effects'] {
	if (!item.effects || !item.keyframes) return item.effects;
	const relativeFrame = absoluteFrame - item.from;
	let changed = false;
	const effects = item.effects.map((effect) => {
		if (effect.type !== 'gpu') return effect;
		const definition = getGpuEffect(effect.effectId);
		if (!definition) return effect;
		let params = effect.params;
		for (const schema of definition.schema) {
			const property = getGpuEffectKeyframeProperty(effect, schema.name);
			if (!property) continue;
			const track = item.keyframes?.[property];
			if (!track?.frames.length) continue;
			const base = effect.params[schema.name] ?? schema.default;
			const resolved =
				schema.type === 'color'
					? interpolateColorTrackToHex(track, relativeFrame, String(base))
					: activeValueAt(item, property, absoluteFrame);
			if (resolved === null || resolved === base) continue;
			if (params === effect.params) params = { ...effect.params };
			params[schema.name] = resolved;
			changed = true;
		}
		return params === effect.params ? effect : { ...effect, params };
	});
	return changed ? effects : item.effects;
}
