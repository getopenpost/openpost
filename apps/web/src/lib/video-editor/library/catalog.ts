import type { LibraryEntry } from './types';
import { TEXT_STYLE_PRESETS } from '../typography/text-style-presets';
import { BUILT_IN_EFFECT_PRESETS } from '../effects/effect-presets';
import { videoTimerPresets } from '../timers/presets';
import { getGpuCategoriesWithEffects } from '../effects/gpu/registry';
import { gpuEffectLabel } from '../effects/gpu/i18n';
import type { AnimationPreset } from '../project/types';
import { transitionRegistry } from '../transitions';
export function videoLibraryCatalog(
	scope: string,
	animationPresets: AnimationPreset[] = []
): LibraryEntry[] {
	return [
		...TEXT_STYLE_PRESETS.map(
			(preset): LibraryEntry => ({
				id: `${scope}:text:${preset.id}`,
				scope,
				name: preset.label,
				collection: 'Text',
				favorite: false,
				position: 0,
				recipe: { kind: 'text', presetId: preset.id }
			})
		),
		...BUILT_IN_EFFECT_PRESETS.map(
			(preset): LibraryEntry => ({
				id: `${scope}:effects:preset:${preset.id}`,
				scope,
				name: preset.name,
				collection: 'Effects',
				favorite: false,
				position: 0,
				recipe: { kind: 'effects', effects: structuredClone(preset.effects) }
			})
		),
		...getGpuCategoriesWithEffects().flatMap((group) =>
			group.effects.map(
				(effect): LibraryEntry => ({
					id: `${scope}:effects:${effect.id}`,
					scope,
					name: gpuEffectLabel(effect),
					collection: group.category,
					favorite: false,
					position: 0,
					recipe: { kind: 'effects', effects: [{ kind: 'gpu', effectId: effect.id }] }
				})
			)
		),
		...videoTimerPresets().map(
			(preset): LibraryEntry => ({
				id: `${scope}:timer:${preset.timer.style}:${preset.timer.direction}`,
				scope,
				name: preset.name,
				collection: 'Timers',
				favorite: false,
				position: 0,
				recipe: { kind: 'timer', timer: preset.timer }
			})
		),
		...animationPresets.map(
			(preset): LibraryEntry => ({
				id: `${scope}:animation:${preset.id}`,
				scope,
				name: preset.name,
				collection: 'Animations',
				favorite: false,
				position: 0,
				recipe: { kind: 'animation', preset }
			})
		),
		...transitionRegistry.getDefinitions().map(
			(definition): LibraryEntry => ({
				id: `${scope}:transition:${definition.id}`,
				scope,
				name: definition.label,
				collection: 'Transitions',
				favorite: false,
				position: 0,
				recipe: { kind: 'transition', presentation: definition.id }
			})
		)
	];
}
