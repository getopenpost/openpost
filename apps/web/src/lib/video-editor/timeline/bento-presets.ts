import { z } from 'zod';
import type { BentoLayoutConfig, BentoLayoutPreset } from './bento-layout';

export const BENTO_PRESETS_STORAGE_KEY = 'openpost-video-editor-bento-presets-v1';

export interface CustomBentoPreset extends BentoLayoutConfig {
	id: string;
	name: string;
}

const BENTO_PRESET_VALUES = [
	'auto',
	'row',
	'column',
	'pip',
	'focus-sidebar',
	'grid'
] as const satisfies readonly BentoLayoutPreset[];

function boundedNumberSchema(fallback: number, min: number, max: number) {
	return z
		.number()
		.finite()
		.catch(fallback)
		.transform((value) => Math.max(min, Math.min(max, Math.round(value))));
}

const customBentoPresetSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().trim().min(1).max(80),
	preset: z.enum(BENTO_PRESET_VALUES),
	cols: boundedNumberSchema(2, 1, 12),
	rows: boundedNumberSchema(2, 1, 12),
	gap: boundedNumberSchema(0, 0, 500),
	padding: boundedNumberSchema(0, 0, 500)
});

const savedPresetListSchema = z.array(z.json());

function browserStorage(): Storage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

export function loadBentoPresets(
	storage: Pick<Storage, 'getItem'> | null = browserStorage()
): CustomBentoPreset[] {
	try {
		const savedJson: unknown = JSON.parse(storage?.getItem(BENTO_PRESETS_STORAGE_KEY) ?? '[]');
		const parsed = savedPresetListSchema.safeParse(savedJson);
		if (!parsed.success) return [];
		const seen = new Set<string>();
		const presets: CustomBentoPreset[] = [];
		for (const candidate of parsed.data.slice(0, 50)) {
			const result = customBentoPresetSchema.safeParse(candidate);
			if (!result.success || seen.has(result.data.id)) continue;
			seen.add(result.data.id);
			presets.push(result.data);
		}
		return presets;
	} catch {
		return [];
	}
}

export function saveBentoPresets(
	presets: readonly CustomBentoPreset[],
	storage: Pick<Storage, 'setItem'> | null = browserStorage()
): void {
	try {
		storage?.setItem(BENTO_PRESETS_STORAGE_KEY, JSON.stringify(presets.slice(0, 50)));
	} catch {
		// Full or unavailable browser storage must not block layout work.
	}
}
