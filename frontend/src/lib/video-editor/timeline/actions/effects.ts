/**
 * Undoable clip effect actions.
 *
 * Effects live on the item (`item.effects`), so undo/redo captures them
 * through the regular snapshot clone, exactly like keyframes and other
 * item fields. Every mutation is one `execute()` step; actions return
 * false (and record nothing) when the target is absent or unchanged.
 *
 * Ported from FreeCut (MIT) — ItemEffect instance model (id + enabled),
 * with OpenPost's snapshot-undo action pattern from keyframes.ts.
 */

import type {
	CssFilterType,
	GpuEffect,
	ItemEffect,
	ItemType
} from '$lib/video-editor/effects/types';
import { EFFECT_DEFINITIONS } from '$lib/video-editor/effects/types';
import type { BlendMode } from '$lib/video-editor/effects/gpu/blend-modes';
import {
	defaultGpuParams,
	normalizeGpuParam,
	type GpuParamValue
} from '$lib/video-editor/effects/gpu/types';
import { getGpuEffect } from '$lib/video-editor/effects/gpu/registry';
import type { EffectTemplate } from '$lib/video-editor/timeline/effect-drop';
import {
	isColorGradeEffect,
	replaceColorGradeInStack,
	type GradeEffectSnapshot
} from '$lib/video-editor/effects/color-grade';
import { removeEffectKeyframes } from '$lib/video-editor/effects/effect-keyframes';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute, executeAtomic } from '../commands/command-store.svelte';
import { addAdjustmentLayer, type AddAdjustmentLayerOptions } from './items';

/** Append a new enabled effect with its default amount. One undoable step. */
export function addEffect(itemId: string, type: CssFilterType): boolean {
	return execute('ADD_EFFECT', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const definition = EFFECT_DEFINITIONS.find((entry) => entry.type === type);
		if (!definition) return false;
		const next: ItemEffect = {
			id: crypto.randomUUID(),
			type,
			amount: definition.defaultAmount,
			enabled: true
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: [...(item.effects ?? []), next] } }
		]);
		return true;
	});
}

/** Patch one CSS-filter effect's amount/enabled flag in place. One undoable step. */
export function updateEffect(
	itemId: string,
	effectId: string,
	patch: { amount?: number; enabled?: boolean }
): boolean {
	return execute('UPDATE_EFFECT', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type === 'gpu') return false;
		const nextEffect: ItemEffect = { ...current, ...patch };
		if (nextEffect.amount === current.amount && nextEffect.enabled === current.enabled) {
			return false;
		}
		timelineStore._updateItems([
			{
				id: itemId,
				patch: { effects: replaceAt(effects, index, nextEffect) }
			}
		]);
		return true;
	});
}

/** Append a new enabled GPU effect with its registry defaults. One undoable step. */
export function addGpuEffect(itemId: string, effectId: string): boolean {
	return execute('ADD_GPU_EFFECT', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		if (!getGpuEffect(effectId)) return false;
		const next: GpuEffect = {
			id: crypto.randomUUID(),
			type: 'gpu',
			effectId,
			params: defaultGpuParams(getGpuEffect(effectId)?.schema ?? []),
			enabled: true
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: [...(item.effects ?? []), next] } }
		]);
		return true;
	});
}

/** Apply one effect template stack to multiple visual clips as one undo step. */
export function addEffectTemplates(
	itemIds: readonly string[],
	templates: readonly EffectTemplate[]
): boolean {
	const uniqueItemIds = Array.from(new Set(itemIds));
	return execute(
		'ADD_EFFECTS',
		() => {
			const updates = uniqueItemIds.flatMap((itemId) => {
				const item = timelineStore.itemById.get(itemId);
				if (!item || item.type === 'audio') return [];
				const additions = templates.flatMap((template) => {
					const effect = createEffectFromTemplate(template);
					return effect ? [effect] : [];
				});
				if (additions.length === 0) return [];
				return [
					{
						id: itemId,
						patch: { effects: [...(item.effects ?? []), ...additions] }
					}
				];
			});
			if (updates.length === 0) return false;
			timelineStore._updateItems(updates);
			return true;
		},
		{ count: uniqueItemIds.length }
	);
}

/** Create an adjustment layer with its initial stack as one undoable action. */
export function addAdjustmentLayerWithEffects(
	label: string,
	templates: readonly EffectTemplate[],
	options: AddAdjustmentLayerOptions = {}
): string {
	return executeAtomic('ADD_ADJUSTMENT_LAYER_WITH_EFFECTS', () => {
		const itemId = addAdjustmentLayer(label, options);
		if (templates.length > 0 && !addEffectTemplates([itemId], templates)) {
			throw new Error('The adjustment effect stack could not be created.');
		}
		return itemId;
	});
}

/** Toggle one GPU effect's enabled flag. One undoable step. */
export function setGpuEffectEnabled(itemId: string, effectId: string, enabled: boolean): boolean {
	return execute('SET_GPU_EFFECT_ENABLED', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type !== 'gpu' || current.enabled === enabled) return false;
		const next: GpuEffect = { ...current, enabled };
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
		]);
		return true;
	});
}

/** Set one GPU effect param, clamped to the registry schema. One undoable step. */
export function setGpuEffectParam(
	itemId: string,
	effectId: string,
	paramName: string,
	value: GpuParamValue
): boolean {
	return execute('SET_GPU_EFFECT_PARAM', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type !== 'gpu') return false;
		const definition = getGpuEffect(current.effectId);
		const schemaParam = definition?.schema.find((entry) => entry.name === paramName);
		if (!definition || !schemaParam) return false;
		const normalized = normalizeGpuParam(schemaParam, value);
		if (current.params[paramName] === normalized) return false;
		const next: GpuEffect = {
			...current,
			params: { ...current.params, [paramName]: normalized }
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
		]);
		return true;
	});
}

/** Update several params, lazily creating the GPU effect when absent, as one undo step. */
export function upsertGpuEffectParams(
	itemId: string,
	effectId: string,
	updates: Record<string, GpuParamValue>
): boolean {
	return execute('UPSERT_GPU_EFFECT_PARAMS', () => {
		const item = timelineStore.itemById.get(itemId);
		const definition = getGpuEffect(effectId);
		if (!item || !definition || Object.keys(updates).length === 0) return false;
		const normalized: Record<string, GpuParamValue> = {};
		for (const [name, value] of Object.entries(updates)) {
			const schemaParam = definition.schema.find((entry) => entry.name === name);
			if (!schemaParam) return false;
			normalized[name] = normalizeGpuParam(schemaParam, value);
		}
		const effects = item.effects ?? [];
		const index = effects.findIndex(
			(effect) => effect.type === 'gpu' && effect.effectId === effectId
		);
		if (index >= 0) {
			const current = effects[index];
			if (!current || current.type !== 'gpu') return false;
			if (Object.entries(normalized).every(([name, value]) => current.params[name] === value))
				return false;
			const next: GpuEffect = {
				...current,
				params: { ...current.params, ...normalized }
			};
			timelineStore._updateItems([
				{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
			]);
			return true;
		}
		const next: GpuEffect = {
			id: crypto.randomUUID(),
			type: 'gpu',
			effectId,
			params: { ...defaultGpuParams(definition.schema), ...normalized },
			enabled: true
		};
		timelineStore._updateItems([{ id: itemId, patch: { effects: [...effects, next] } }]);
		return true;
	});
}

/** Apply one param batch to several selected visual items as one undo step. */
export function upsertGpuEffectParamsOnItems(
	itemIds: readonly string[],
	effectId: string,
	updates: Record<string, GpuParamValue>
): boolean {
	const uniqueItemIds = Array.from(new Set(itemIds));
	return execute('UPSERT_GPU_EFFECT_PARAMS_ON_ITEMS', () => {
		const definition = getGpuEffect(effectId);
		if (!definition || Object.keys(updates).length === 0) return false;
		const normalized: Record<string, GpuParamValue> = {};
		for (const [name, value] of Object.entries(updates)) {
			const schemaParam = definition.schema.find((entry) => entry.name === name);
			if (!schemaParam) return false;
			normalized[name] = normalizeGpuParam(schemaParam, value);
		}
		const itemUpdates = uniqueItemIds.flatMap((itemId) => {
			const item = timelineStore.itemById.get(itemId);
			if (!item || item.type === 'audio') return [];
			const effects = item.effects ?? [];
			const index = effects.findIndex(
				(effect) => effect.type === 'gpu' && effect.effectId === effectId
			);
			if (index >= 0) {
				const current = effects[index];
				if (!current || current.type !== 'gpu') return [];
				if (Object.entries(normalized).every(([name, value]) => current.params[name] === value))
					return [];
				return [
					{
						id: itemId,
						patch: {
							effects: replaceAt(effects, index, {
								...current,
								params: { ...current.params, ...normalized }
							})
						}
					}
				];
			}
			const next: GpuEffect = {
				id: crypto.randomUUID(),
				type: 'gpu',
				effectId,
				params: { ...defaultGpuParams(definition.schema), ...normalized },
				enabled: true
			};
			return [{ id: itemId, patch: { effects: [...effects, next] } }];
		});
		if (itemUpdates.length === 0) return false;
		timelineStore._updateItems(itemUpdates);
		return true;
	});
}

/** Replace color-category GPU effects on visual items and preserve every other effect. */
export function replaceColorGradeEffects(
	itemIds: readonly string[],
	grade: readonly GradeEffectSnapshot[]
): boolean {
	const uniqueItemIds = Array.from(new Set(itemIds));
	return execute('REPLACE_COLOR_GRADE', () => {
		if (
			grade.length === 0 ||
			grade.some(
				(entry) =>
					getGpuEffect(entry.effectId)?.category !== 'color' ||
					Object.values(entry.params).some(
						(value) =>
							value === Number.POSITIVE_INFINITY ||
							value === Number.NEGATIVE_INFINITY ||
							value !== value
					)
			)
		)
			return false;
		const updates = uniqueItemIds.flatMap((itemId) => {
			const item = timelineStore.itemById.get(itemId);
			if (!item || item.type === 'audio') return [];
			return [
				{
					id: itemId,
					patch: { effects: replaceColorGradeInStack(item.effects, grade) }
				}
			];
		});
		if (updates.length === 0) return false;
		timelineStore._updateItems(updates);
		return true;
	});
}

/** Enable or disable every color-grade effect on one clip as one edit. */
export function setColorGradeEnabled(itemId: string, enabled: boolean): boolean {
	return execute('SET_COLOR_GRADE_ENABLED', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item?.effects) return false;
		let changed = false;
		const effects = item.effects.map((effect) => {
			if (!isColorGradeEffect(effect) || effect.enabled === enabled) return effect;
			changed = true;
			return { ...effect, enabled };
		});
		if (!changed) return false;
		timelineStore._updateItems([{ id: itemId, patch: { effects } }]);
		return true;
	});
}

/** Store a non-numeric GPU resource param such as an encoded LUT. */
export function setGpuEffectData(
	itemId: string,
	effectId: string,
	params: Record<string, GpuParamValue>
): boolean {
	return execute('SET_GPU_EFFECT_DATA', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type !== 'gpu') return false;
		const next: GpuEffect = {
			...current,
			params: { ...current.params, ...params }
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
		]);
		return true;
	});
}

/** Set the clip's compositing blend mode for the GPU pipeline. One undoable step. */
export function setItemBlendMode(itemId: string, mode: BlendMode): boolean {
	return execute('SET_ITEM_BLEND_MODE', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		if ((item.blendMode ?? 'normal') === mode) return false;
		timelineStore._updateItems([{ id: itemId, patch: { blendMode: mode } }]);
		return true;
	});
}

/** Remove one effect by id. One undoable step. */
export function removeEffect(itemId: string, effectId: string): boolean {
	return execute('REMOVE_EFFECT', () => {
		const item = timelineStore.itemById.get(itemId);
		const effects = item?.effects;
		if (!effects || !effects.some((effect) => effect.id === effectId)) return false;
		const next = effects.filter((effect) => effect.id !== effectId);
		timelineStore._updateItems([
			{
				id: itemId,
				patch: {
					effects: next.length > 0 ? next : undefined,
					keyframes: removeEffectKeyframes(item?.keyframes, effectId)
				}
			}
		]);
		return true;
	});
}

interface MappedEffectTarget {
	itemId: string;
	effects: ItemEffect[];
	index: number;
	effect: ItemEffect;
}

function effectsAreCompatible(display: ItemEffect, target: ItemEffect): boolean {
	if (display.type !== target.type) return false;
	return display.type !== 'gpu' || (target.type === 'gpu' && display.effectId === target.effectId);
}

function isHiddenGpuEffect(effect: ItemEffect, hiddenGpuEffectIds: ReadonlySet<string>): boolean {
	return effect.type === 'gpu' && hiddenGpuEffectIds.has(effect.effectId);
}

function mappedEffectTargets(
	displayItemId: string,
	itemIds: readonly string[],
	displayEffectId: string,
	hiddenGpuEffectIds: readonly string[] = []
): MappedEffectTarget[] {
	const hidden = new Set(hiddenGpuEffectIds);
	const displayEffects = timelineStore.itemById.get(displayItemId)?.effects;
	const visibleDisplayEffects = displayEffects?.filter(
		(effect) => !isHiddenGpuEffect(effect, hidden)
	);
	const visibleDisplayIndex =
		visibleDisplayEffects?.findIndex((effect) => effect.id === displayEffectId) ?? -1;
	const displayEffect = visibleDisplayEffects?.[visibleDisplayIndex];
	if (!displayEffect || visibleDisplayIndex < 0) return [];

	return [...new Set([displayItemId, ...itemIds])].flatMap((itemId) => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const effect = effects?.filter((candidate) => !isHiddenGpuEffect(candidate, hidden))[
			visibleDisplayIndex
		];
		const index = effect
			? (effects?.findIndex((candidate) => candidate.id === effect.id) ?? -1)
			: -1;
		return effects && effect && index >= 0 && effectsAreCompatible(displayEffect, effect)
			? [{ itemId, effects, index, effect }]
			: [];
	});
}

/** IDs of the compatible effect instances that selection-wide drafts and commits target. */
export function getCompatibleGpuEffectIds(
	displayItemId: string,
	itemIds: readonly string[],
	displayEffectId: string
): string[] {
	return mappedEffectTargets(displayItemId, itemIds, displayEffectId).flatMap((target) =>
		target.effect.type === 'gpu' ? [target.effect.id] : []
	);
}

/** Patch one compatible GPU effect across the current selection as one undo step. */
export function setGpuEffectDataOnItems(
	displayItemId: string,
	itemIds: readonly string[],
	effectId: string,
	params: Record<string, GpuParamValue>
): boolean {
	const targets = mappedEffectTargets(displayItemId, itemIds, effectId).filter(
		(target): target is MappedEffectTarget & { effect: GpuEffect } => {
			const effect = target.effect;
			return (
				effect.type === 'gpu' &&
				Object.entries(params).some(([name, value]) => effect.params[name] !== value)
			);
		}
	);
	if (targets.length === 0) return false;
	return execute(
		'SET_GPU_EFFECT_DATA_ON_ITEMS',
		() => {
			timelineStore._updateItems(
				targets.map((target) => ({
					id: target.itemId,
					patch: {
						effects: replaceAt(target.effects, target.index, {
							...target.effect,
							params: { ...target.effect.params, ...params }
						})
					}
				}))
			);
			return true;
		},
		{ count: targets.length }
	);
}

export function isEffectAtDefaults(effect: ItemEffect): boolean {
	if (effect.type !== 'gpu') {
		return (
			EFFECT_DEFINITIONS.find((definition) => definition.type === effect.type)?.defaultAmount ===
			effect.amount
		);
	}
	const defaults = defaultGpuParams(getGpuEffect(effect.effectId)?.schema ?? []);
	const keys = new Set([...Object.keys(defaults), ...Object.keys(effect.params)]);
	return [...keys].every((key) => Object.is(effect.params[key], defaults[key]));
}

/** Move one displayed effect across every compatible selected stack as one undo step. */
export function moveEffectOnItems(
	displayItemId: string,
	itemIds: readonly string[],
	effectId: string,
	direction: -1 | 1,
	hiddenGpuEffectIds: readonly string[] = []
): boolean {
	const hidden = new Set(hiddenGpuEffectIds);
	const targets = mappedEffectTargets(displayItemId, itemIds, effectId, hiddenGpuEffectIds).flatMap(
		(target) => {
			const visibleEffects = target.effects.filter((effect) => !isHiddenGpuEffect(effect, hidden));
			const visibleIndex = visibleEffects.findIndex((effect) => effect.id === target.effect.id);
			const swapEffect = visibleEffects[visibleIndex + direction];
			const swapIndex = swapEffect
				? target.effects.findIndex((effect) => effect.id === swapEffect.id)
				: -1;
			return visibleIndex >= 0 && swapIndex >= 0 ? [{ ...target, swapIndex }] : [];
		}
	);
	if (targets.length === 0) return false;
	return execute('MOVE_EFFECT', () => {
		timelineStore._updateItems(
			targets.map((target) => {
				const effects = [...target.effects];
				[effects[target.index], effects[target.swapIndex]] = [
					effects[target.swapIndex]!,
					effects[target.index]!
				];
				return { id: target.itemId, patch: { effects } };
			})
		);
		return true;
	});
}

/** Enable or bypass one mapped effect across the current selection. */
export function setEffectEnabledOnItems(
	displayItemId: string,
	itemIds: readonly string[],
	effectId: string,
	enabled: boolean,
	hiddenGpuEffectIds: readonly string[] = []
): boolean {
	const targets = mappedEffectTargets(displayItemId, itemIds, effectId, hiddenGpuEffectIds).filter(
		(target) => target.effect.enabled !== enabled
	);
	if (targets.length === 0) return false;
	return execute('SET_EFFECT_ENABLED', () => {
		timelineStore._updateItems(
			targets.map((target) => ({
				id: target.itemId,
				patch: {
					effects: replaceAt(target.effects, target.index, {
						...target.effect,
						enabled
					})
				}
			}))
		);
		return true;
	});
}

/** Enable or bypass every effect on the selected visual items as one undo step. */
export function setAllEffectsEnabledOnItems(
	itemIds: readonly string[],
	enabled: boolean,
	hiddenGpuEffectIds: readonly string[] = []
): boolean {
	const uniqueItemIds = Array.from(new Set(itemIds));
	const hidden = new Set(hiddenGpuEffectIds);
	const updates = uniqueItemIds.flatMap((itemId) => {
		const item = timelineStore.itemById.get(itemId);
		const effects = item?.effects;
		if (
			!item ||
			item.type === 'audio' ||
			!effects?.some((effect) => !isHiddenGpuEffect(effect, hidden) && effect.enabled !== enabled)
		) {
			return [];
		}
		return [
			{
				id: itemId,
				patch: {
					effects: effects.map((effect) =>
						isHiddenGpuEffect(effect, hidden) ? effect : { ...effect, enabled }
					)
				}
			}
		];
	});
	if (updates.length === 0) return false;
	return execute('SET_ALL_EFFECTS_ENABLED', () => {
		timelineStore._updateItems(updates);
		return true;
	});
}

/** Reset one mapped effect to registry defaults without changing its bypass state. */
export function resetEffectOnItems(
	displayItemId: string,
	itemIds: readonly string[],
	effectId: string,
	hiddenGpuEffectIds: readonly string[] = []
): boolean {
	const targets = mappedEffectTargets(displayItemId, itemIds, effectId, hiddenGpuEffectIds).filter(
		(target) => !isEffectAtDefaults(target.effect)
	);
	if (targets.length === 0) return false;
	return execute('RESET_EFFECT', () => {
		timelineStore._updateItems(
			targets.map((target) => {
				const effect: ItemEffect =
					target.effect.type === 'gpu'
						? {
								...target.effect,
								params: defaultGpuParams(getGpuEffect(target.effect.effectId)?.schema ?? [])
							}
						: {
								...target.effect,
								amount:
									EFFECT_DEFINITIONS.find((definition) => definition.type === target.effect.type)
										?.defaultAmount ?? target.effect.amount
							};
				return {
					id: target.itemId,
					patch: { effects: replaceAt(target.effects, target.index, effect) }
				};
			})
		);
		return true;
	});
}

/** Remove one mapped effect across every compatible selected stack. */
export function removeEffectOnItems(
	displayItemId: string,
	itemIds: readonly string[],
	effectId: string,
	hiddenGpuEffectIds: readonly string[] = []
): boolean {
	const targets = mappedEffectTargets(displayItemId, itemIds, effectId, hiddenGpuEffectIds);
	if (targets.length === 0) return false;
	return execute('REMOVE_EFFECTS', () => {
		timelineStore._updateItems(
			targets.map((target) => {
				const effects = target.effects.filter((_, index) => index !== target.index);
				const item = timelineStore.itemById.get(target.itemId);
				return {
					id: target.itemId,
					patch: {
						effects: effects.length > 0 ? effects : undefined,
						keyframes: removeEffectKeyframes(item?.keyframes, target.effect.id)
					}
				};
			})
		);
		return true;
	});
}

function replaceAt(effects: ItemEffect[], index: number, next: ItemEffect): ItemEffect[] {
	return [...effects.slice(0, index), next, ...effects.slice(index + 1)];
}

function createEffectFromTemplate(template: EffectTemplate): ItemEffect | null {
	if (template.kind === 'css') {
		const definition = EFFECT_DEFINITIONS.find((entry) => entry.type === template.effectType);
		if (!definition) return null;
		const requested = template.amount ?? definition.defaultAmount;
		const amount = Number.isFinite(requested)
			? Math.min(definition.max, Math.max(definition.min, requested))
			: definition.defaultAmount;
		return {
			id: crypto.randomUUID(),
			type: definition.type,
			amount,
			enabled: template.enabled ?? true
		};
	}
	const definition = getGpuEffect(template.effectId);
	if (!definition) return null;
	const params = {
		...defaultGpuParams(definition.schema),
		...(template.params ?? {})
	};
	for (const param of definition.schema) {
		params[param.name] = normalizeGpuParam(param, params[param.name] ?? param.default);
	}
	return {
		id: crypto.randomUUID(),
		type: 'gpu',
		effectId: definition.id,
		params,
		enabled: template.enabled ?? true
	};
}
