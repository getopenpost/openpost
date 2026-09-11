import { BACKGROUND_PRESETS } from '../../backgrounds/presets';
import type { ProceduralBackground } from '../../backgrounds/types';
import type { EffectTemplate } from '../../timeline/effect-drop';
import { BUILT_IN_EFFECT_PRESETS } from '../effect-presets';
import { GPU_EFFECT_CATALOG } from '../gpu/registry';
import { previewKey } from './preview-key';

export const EFFECT_POSTERS = [
	...GPU_EFFECT_CATALOG.map((effect) => ({
		id: effect.id,
		effects: [{ kind: 'gpu', effectId: effect.id }] satisfies readonly EffectTemplate[]
	})),
	...BUILT_IN_EFFECT_PRESETS.map((preset) => ({
		id: `preset-${preset.id}`,
		effects: preset.effects
	}))
];

export function catalogPosterUrl(id: string): string {
	return `/video-editor-previews/${id}.webp`;
}

const backgrounds = new Map(
	BACKGROUND_PRESETS.map((preset) => [
		JSON.stringify(preset.background),
		catalogPosterUrl(`background-${preset.id}`)
	])
);
const effects = new Map(
	EFFECT_POSTERS.map((entry) => [previewKey(entry.effects), catalogPosterUrl(entry.id)])
);

export function backgroundPosterUrl(background: ProceduralBackground): string | undefined {
	return backgrounds.get(JSON.stringify(background));
}

export function effectPosterUrl(templates: readonly EffectTemplate[]): string | undefined {
	return effects.get(previewKey(templates));
}
