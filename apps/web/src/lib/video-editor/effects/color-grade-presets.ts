/** Browser-wide named color grades. Project clips keep independent copies when a preset is applied. */

import { getGpuEffect } from './gpu/registry';
import type { GradeEffectSnapshot } from './color-grade';

export const COLOR_GRADE_PRESETS_STORAGE_KEY = 'openpost-video-editor-grade-presets';

export interface ColorGradePreset {
	id: string;
	name: string;
	effects: GradeEffectSnapshot[];
	createdAt: number;
	updatedAt: number;
}

export function loadColorGradePresets(
	storage: Pick<Storage, 'getItem'> = localStorage
): ColorGradePreset[] {
	try {
		return parseColorGradePresets(storage.getItem(COLOR_GRADE_PRESETS_STORAGE_KEY));
	} catch {
		return [];
	}
}

export function persistColorGradePresets(
	presets: readonly ColorGradePreset[],
	storage: Pick<Storage, 'setItem'> = localStorage
): boolean {
	try {
		storage.setItem(COLOR_GRADE_PRESETS_STORAGE_KEY, JSON.stringify(presets));
		return true;
	} catch {
		return false;
	}
}

export function parseColorGradePresets(raw: string | null): ColorGradePreset[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isColorGradePreset).slice(0, 64).map(clonePreset);
	} catch {
		return [];
	}
}

export function saveColorGradePreset(
	presets: readonly ColorGradePreset[],
	name: string,
	effects: readonly GradeEffectSnapshot[],
	createId: () => string = () => crypto.randomUUID(),
	now: () => number = () => Date.now()
): ColorGradePreset[] {
	const normalizedName = name.trim().slice(0, 80);
	const validEffects = effects.filter(isGradeEffectSnapshot).map(cloneEffect);
	if (!normalizedName || validEffects.length === 0) return presets.map(clonePreset);
	const timestamp = now();
	const existing = presets.find(
		(preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
	);
	const saved: ColorGradePreset = existing
		? { ...existing, name: normalizedName, effects: validEffects, updatedAt: timestamp }
		: {
				id: createId(),
				name: normalizedName,
				effects: validEffects,
				createdAt: timestamp,
				updatedAt: timestamp
			};
	return existing
		? presets.map((preset) => (preset.id === existing.id ? saved : clonePreset(preset)))
		: [...presets.map(clonePreset), saved].slice(-64);
}

export function removeColorGradePreset(
	presets: readonly ColorGradePreset[],
	presetId: string
): ColorGradePreset[] {
	return presets.filter((preset) => preset.id !== presetId).map(clonePreset);
}

function isColorGradePreset(value: unknown): value is ColorGradePreset {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: The object shape below checks every field before this value leaves the JSON boundary.
	const candidate = value as Partial<ColorGradePreset>;
	return (
		typeof candidate.id === 'string' &&
		candidate.id.length > 0 &&
		typeof candidate.name === 'string' &&
		candidate.name.trim().length > 0 &&
		candidate.name.length <= 80 &&
		Number.isFinite(candidate.createdAt) &&
		Number.isFinite(candidate.updatedAt) &&
		Array.isArray(candidate.effects) &&
		candidate.effects.length > 0 &&
		candidate.effects.length <= 64 &&
		candidate.effects.every(isGradeEffectSnapshot)
	);
}

function isGradeEffectSnapshot(value: unknown): value is GradeEffectSnapshot {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: The object shape and each param primitive are checked before the snapshot is accepted.
	const candidate = value as Partial<GradeEffectSnapshot>;
	if (
		typeof candidate.effectId !== 'string' ||
		getGpuEffect(candidate.effectId)?.category !== 'color' ||
		typeof candidate.enabled !== 'boolean' ||
		!candidate.params ||
		typeof candidate.params !== 'object' ||
		Array.isArray(candidate.params)
	)
		return false;
	return Object.values(candidate.params).every(isStoredParam);
}

function isStoredParam(value: unknown): value is number | string | boolean {
	// eslint-disable-next-line anti-slop/no-runtime-typeof -- JSON values are untyped at this storage boundary.
	if (typeof value === 'number') return Number.isFinite(value);
	// eslint-disable-next-line anti-slop/no-runtime-typeof -- JSON values are untyped at this storage boundary.
	if (typeof value === 'string') return true;
	// eslint-disable-next-line anti-slop/no-runtime-typeof -- JSON values are untyped at this storage boundary.
	return typeof value === 'boolean';
}

function cloneEffect(effect: GradeEffectSnapshot): GradeEffectSnapshot {
	return { ...effect, params: { ...effect.params } };
}

function clonePreset(preset: ColorGradePreset): ColorGradePreset {
	return { ...preset, effects: preset.effects.map(cloneEffect) };
}
