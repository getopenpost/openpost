/** User easing presets persisted per browser, matching FreeCut's global catalog behavior. */

import type {
	BezierControlPoints,
	EasingConfig,
	SpringParameters
} from '$lib/video-editor/project/types';

export type CustomEasingPreset =
	| { name: string; type: 'Easing'; bezier: BezierControlPoints }
	| { name: string; type: 'Spring'; spring: SpringParameters };

export const CUSTOM_EASING_PRESETS_STORAGE_KEY = 'openpost-video-editor-easing-presets';

export function parseCustomEasingPresets(raw: string | null): CustomEasingPreset[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isValidPreset) : [];
	} catch {
		return [];
	}
}

export function loadCustomEasingPresets(storage?: Pick<Storage, 'getItem'>) {
	const store = storage ?? browserStorage();
	if (!store) return [];
	try {
		return parseCustomEasingPresets(store.getItem(CUSTOM_EASING_PRESETS_STORAGE_KEY));
	} catch {
		return [];
	}
}

export function saveCustomEasingPresets(
	presets: readonly CustomEasingPreset[],
	storage?: Pick<Storage, 'setItem'>
): boolean {
	const store = storage ?? browserStorage();
	if (!store) return false;
	try {
		store.setItem(CUSTOM_EASING_PRESETS_STORAGE_KEY, JSON.stringify(presets));
		return true;
	} catch {
		return false;
	}
}

function browserStorage(): Storage | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

export function presetFromEasing(
	name: string,
	config: EasingConfig | undefined
): CustomEasingPreset | null {
	const normalizedName = name.trim();
	if (!normalizedName) return null;
	if (config?.type === 'cubic-bezier' && config.bezier) {
		const preset = { name: normalizedName, type: 'Easing' as const, bezier: { ...config.bezier } };
		return isValidPreset(preset) ? preset : null;
	}
	if (config?.type === 'spring' && config.spring) {
		const preset = { name: normalizedName, type: 'Spring' as const, spring: { ...config.spring } };
		return isValidPreset(preset) ? preset : null;
	}
	return null;
}

export function upsertCustomEasingPreset(
	presets: readonly CustomEasingPreset[],
	preset: CustomEasingPreset
): CustomEasingPreset[] {
	return [...presets.filter((candidate) => candidate.name !== preset.name), preset];
}

export function easingConfigFromPreset(preset: CustomEasingPreset): EasingConfig {
	return preset.type === 'Easing'
		? { type: 'cubic-bezier', bezier: { ...preset.bezier } }
		: { type: 'spring', spring: { ...preset.spring } };
}

export function suggestedCustomPresetName(presets: readonly CustomEasingPreset[]): string {
	const taken = new Set(presets.map((preset) => preset.name));
	let index = presets.length + 1;
	while (taken.has(`Custom ${index}`)) index++;
	return `Custom ${index}`;
}

function isValidPreset(value: unknown): value is CustomEasingPreset {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: the object shape is validated field by field before this guard returns true.
	const preset = value as {
		name?: string;
		type?: 'Easing' | 'Spring';
		bezier?: Partial<BezierControlPoints>;
		spring?: Partial<SpringParameters>;
	};
	if (!preset.name?.trim()) return false;
	if (preset.type === 'Easing') {
		return (
			inRange(preset.bezier?.x1, 0, 1) &&
			inRange(preset.bezier?.y1, -2, 3) &&
			inRange(preset.bezier?.x2, 0, 1) &&
			inRange(preset.bezier?.y2, -2, 3)
		);
	}
	if (preset.type === 'Spring') {
		return (
			inRange(preset.spring?.tension, 1, 1000) &&
			inRange(preset.spring?.friction, 1, 100) &&
			inRange(preset.spring?.mass, 0.1, 10)
		);
	}
	return false;
}

function isFiniteNumber(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value);
}

function inRange(value: number | undefined, min: number, max: number): value is number {
	return isFiniteNumber(value) && value >= min && value <= max;
}
