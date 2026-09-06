/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This module validates untyped localStorage JSON at its I/O boundary. */
/** Built-in and browser-wide user effect stacks. Built-ins are ported from FreeCut (MIT). */

import { getGpuEffect } from './gpu/registry';
import { defaultGpuParams, normalizeGpuParam, type GpuParamValues } from './gpu/types';
import { EFFECT_DEFINITIONS, type ItemEffect } from './types';
import type { EffectTemplate } from '../timeline/effect-drop';

export const EFFECT_PRESETS_STORAGE_KEY = 'openpost-video-editor-effect-presets';
const MAX_PRESETS = 64;
const MAX_PRESET_BYTES = 8 * 1024 * 1024;

export interface EffectPreset {
	id: string;
	name: string;
	effects: EffectTemplate[];
	createdAt?: number;
	updatedAt?: number;
}

export const BUILT_IN_EFFECT_PRESETS: readonly EffectPreset[] = [
	{
		id: 'trigger-wave-layer',
		name: 'Trigger Wave Layer',
		effects: [
			{
				kind: 'gpu',
				effectId: 'gpu-trigger-wave',
				params: {
					strength: 0.045,
					radius: 0.95,
					frequency: 22,
					decay: 0.07,
					phase: 0,
					speed: 0.9,
					centerX: 0.5,
					centerY: 0.5,
					chroma: 0.009,
					scanlineMix: 0.24,
					glowColor: '#2e6b8c'
				}
			},
			{ kind: 'gpu', effectId: 'gpu-rgb-split', params: { amount: 0.006, angle: 0 } },
			{
				kind: 'gpu',
				effectId: 'gpu-scanlines',
				params: { density: 8, opacity: 0.16, speed: 0.6 }
			},
			{
				kind: 'gpu',
				effectId: 'gpu-grain',
				params: { amount: 0.05, size: 1.2, speed: 0.8 }
			}
		]
	},
	{
		id: 'crt',
		name: 'CRT',
		effects: [
			{
				kind: 'gpu',
				effectId: 'gpu-crt',
				params: { curvature: 0.35, scanlines: 0.35, vignette: 0.35, chroma: 0.5 }
			},
			{
				kind: 'gpu',
				effectId: 'gpu-grain',
				params: { amount: 0.06, size: 1.2, speed: 1 }
			},
			{ kind: 'gpu', effectId: 'gpu-saturation', params: { amount: 1.1 } }
		]
	},
	{
		id: 'retro-tv',
		name: 'Retro TV',
		effects: [
			{
				kind: 'gpu',
				effectId: 'gpu-vhs',
				params: { bleed: 0.5, waviness: 0.4, noise: 0.2, scanline: 0.2, speed: 1 }
			},
			{
				kind: 'gpu',
				effectId: 'gpu-crt',
				params: { curvature: 0.3, scanlines: 0.3, vignette: 0.35, chroma: 0.4 }
			},
			{
				kind: 'gpu',
				effectId: 'gpu-grain',
				params: { amount: 0.05, size: 1.2, speed: 1 }
			}
		]
	},
	{
		id: 'vintage',
		name: 'Vintage',
		effects: [
			{ kind: 'gpu', effectId: 'gpu-sepia', params: { amount: 0.4 } },
			{ kind: 'gpu', effectId: 'gpu-contrast', params: { amount: 1.1 } },
			{ kind: 'gpu', effectId: 'gpu-brightness', params: { amount: -0.1 } }
		]
	},
	{
		id: 'noir',
		name: 'Noir',
		effects: [
			{ kind: 'gpu', effectId: 'gpu-grayscale', params: { amount: 1 } },
			{ kind: 'gpu', effectId: 'gpu-contrast', params: { amount: 1.3 } }
		]
	},
	{
		id: 'cold',
		name: 'Cold',
		effects: [
			{ kind: 'gpu', effectId: 'gpu-hue-shift', params: { shift: 0.5 } },
			{ kind: 'gpu', effectId: 'gpu-saturation', params: { amount: 0.8 } }
		]
	},
	{
		id: 'warm',
		name: 'Warm',
		effects: [
			{ kind: 'gpu', effectId: 'gpu-sepia', params: { amount: 0.2 } },
			{ kind: 'gpu', effectId: 'gpu-saturation', params: { amount: 1.2 } }
		]
	},
	{
		id: 'dramatic',
		name: 'Dramatic',
		effects: [
			{ kind: 'gpu', effectId: 'gpu-contrast', params: { amount: 1.5 } },
			{ kind: 'gpu', effectId: 'gpu-saturation', params: { amount: 1.3 } }
		]
	},
	{
		id: 'faded',
		name: 'Faded',
		effects: [
			{ kind: 'gpu', effectId: 'gpu-contrast', params: { amount: 0.8 } },
			{ kind: 'gpu', effectId: 'gpu-brightness', params: { amount: 0.1 } },
			{ kind: 'gpu', effectId: 'gpu-saturation', params: { amount: 0.7 } }
		]
	}
];

export function effectTemplatesFromItems(effects: readonly ItemEffect[]): EffectTemplate[] {
	return effects.map((effect): EffectTemplate => {
		if (effect.type === 'gpu') {
			return {
				kind: 'gpu',
				effectId: effect.effectId,
				params: { ...effect.params },
				enabled: effect.enabled
			};
		}
		return {
			kind: 'css',
			effectType: effect.type,
			amount: effect.amount,
			enabled: effect.enabled
		};
	});
}

export function loadEffectPresets(
	storage: Pick<Storage, 'getItem'> = localStorage
): EffectPreset[] {
	try {
		return parseEffectPresets(storage.getItem(EFFECT_PRESETS_STORAGE_KEY));
	} catch {
		return [];
	}
}

export function persistEffectPresets(
	presets: readonly EffectPreset[],
	storage: Pick<Storage, 'setItem'> = localStorage
): boolean {
	try {
		storage.setItem(EFFECT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
		return true;
	} catch {
		return false;
	}
}

export function parseEffectPresets(raw: string | null): EffectPreset[] {
	if (!raw || raw.length > MAX_PRESET_BYTES) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap(normalizePreset).slice(-MAX_PRESETS);
	} catch {
		return [];
	}
}

export function saveEffectPreset(
	presets: readonly EffectPreset[],
	name: string,
	effects: readonly EffectTemplate[],
	createId: () => string = () => crypto.randomUUID(),
	now: () => number = () => Date.now()
): EffectPreset[] {
	const normalizedName = name.trim().slice(0, 80);
	const normalizedEffects = effects.flatMap(normalizeTemplate).slice(0, 64);
	if (!normalizedName || normalizedEffects.length === 0) return presets.map(clonePreset);
	const timestamp = now();
	const existing = presets.find(
		(preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
	);
	const saved: EffectPreset = existing
		? { ...existing, name: normalizedName, effects: normalizedEffects, updatedAt: timestamp }
		: {
				id: createId(),
				name: normalizedName,
				effects: normalizedEffects,
				createdAt: timestamp,
				updatedAt: timestamp
			};
	return existing
		? presets.map((preset) => (preset.id === existing.id ? saved : clonePreset(preset)))
		: [...presets.map(clonePreset), saved].slice(-MAX_PRESETS);
}

export function removeEffectPreset(
	presets: readonly EffectPreset[],
	presetId: string
): EffectPreset[] {
	return presets.filter((preset) => preset.id !== presetId).map(clonePreset);
}

function normalizePreset(value: unknown): EffectPreset[] {
	if (!value || typeof value !== 'object') return [];
	// SAFETY: This adapter validates every stored field before returning the preset.
	const candidate = value as Partial<EffectPreset>;
	if (
		typeof candidate.id !== 'string' ||
		!candidate.id ||
		typeof candidate.name !== 'string' ||
		!candidate.name.trim() ||
		candidate.name.length > 80 ||
		!Array.isArray(candidate.effects) ||
		candidate.effects.length === 0 ||
		candidate.effects.length > 64 ||
		!Number.isFinite(candidate.createdAt) ||
		!Number.isFinite(candidate.updatedAt)
	)
		return [];
	const effects = candidate.effects.flatMap(normalizeTemplate);
	if (effects.length !== candidate.effects.length) return [];
	return [
		{
			id: candidate.id,
			name: candidate.name.trim(),
			effects,
			createdAt: candidate.createdAt,
			updatedAt: candidate.updatedAt
		}
	];
}

function normalizeTemplate(value: unknown): EffectTemplate[] {
	if (!value || typeof value !== 'object') return [];
	// SAFETY: The discriminant is checked before any optional template fields are read.
	const candidate = value as Partial<EffectTemplate>;
	if (candidate.kind === 'css') {
		const definition = EFFECT_DEFINITIONS.find((entry) => entry.type === candidate.effectType);
		if (!definition) return [];
		const amount = Number(candidate.amount ?? definition.defaultAmount);
		if (!Number.isFinite(amount)) return [];
		return [
			{
				kind: 'css',
				effectType: definition.type,
				amount: Math.min(definition.max, Math.max(definition.min, amount)),
				enabled: candidate.enabled !== false
			}
		];
	}
	if (candidate.kind !== 'gpu' || typeof candidate.effectId !== 'string') return [];
	const definition = getGpuEffect(candidate.effectId);
	const storedParams = candidate.params ?? {};
	if (!definition || !isParamRecord(storedParams)) return [];
	const params: GpuParamValues = { ...defaultGpuParams(definition.schema), ...storedParams };
	for (const param of definition.schema) {
		params[param.name] = normalizeGpuParam(param, params[param.name] ?? param.default);
	}
	return [
		{
			kind: 'gpu',
			effectId: definition.id,
			params,
			enabled: candidate.enabled !== false
		}
	];
}

function isParamRecord(value: unknown): value is GpuParamValues {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.values(value).every((entry) => {
		if (typeof entry === 'number') return Number.isFinite(entry);
		return typeof entry === 'string' || typeof entry === 'boolean';
	});
}

function cloneTemplate(template: EffectTemplate): EffectTemplate {
	return template.kind === 'gpu'
		? { ...template, params: template.params ? { ...template.params } : undefined }
		: { ...template };
}

function clonePreset(preset: EffectPreset): EffectPreset {
	return { ...preset, effects: preset.effects.map(cloneTemplate) };
}
