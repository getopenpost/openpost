import type { EffectTemplate } from '../../timeline/effect-drop';

export function previewKey(effects: readonly EffectTemplate[]): string {
	return JSON.stringify(
		effects.map((effect) =>
			effect.kind === 'gpu'
				? ['gpu', effect.effectId, effect.enabled !== false, effect.params ?? null]
				: ['css', effect.effectType, effect.enabled !== false, effect.amount ?? null]
		)
	);
}
