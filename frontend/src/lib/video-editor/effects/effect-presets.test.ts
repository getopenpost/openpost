import { describe, expect, it } from 'vitest';
import { getGpuEffect } from './gpu/registry';
import type { ItemEffect } from './types';
import {
	BUILT_IN_EFFECT_PRESETS,
	effectTemplatesFromItems,
	parseEffectPresets,
	removeEffectPreset,
	saveEffectPreset
} from './effect-presets';

describe('effect presets', () => {
	it('keeps built-in presets non-empty and linked to registered effects', () => {
		expect(BUILT_IN_EFFECT_PRESETS.every((preset) => preset.effects.length > 0)).toBe(true);
		expect(
			BUILT_IN_EFFECT_PRESETS.flatMap((preset) => preset.effects).every(
				(effect) => effect.kind !== 'gpu' || getGpuEffect(effect.effectId) !== undefined
			)
		).toBe(true);
	});

	it('snapshots CSS and GPU stacks without sharing params', () => {
		const effects: ItemEffect[] = [
			{ id: 'css', type: 'blur', amount: 5, enabled: false },
			{
				id: 'gpu',
				type: 'gpu',
				effectId: 'gpu-contrast',
				params: { amount: 1.6 },
				enabled: true
			}
		];
		const templates = effectTemplatesFromItems(effects);
		if (templates[1]?.kind === 'gpu' && templates[1].params) templates[1].params.amount = 2;
		expect(effects[1]?.type === 'gpu' ? effects[1].params.amount : undefined).toBe(1.6);
		expect(templates[0]).toEqual({
			kind: 'css',
			effectType: 'blur',
			amount: 5,
			enabled: false
		});
	});

	it('saves same-name updates, validates imported params, and removes presets', () => {
		const created = saveEffectPreset(
			[],
			'  My Look  ',
			[{ kind: 'gpu', effectId: 'gpu-contrast', params: { amount: 1.5 } }],
			() => 'preset',
			() => 10
		);
		const updated = saveEffectPreset(
			created,
			'my look',
			[{ kind: 'css', effectType: 'blur', amount: 200, enabled: false }],
			() => 'other',
			() => 20
		);
		expect(updated).toEqual([
			{
				id: 'preset',
				name: 'my look',
				effects: [{ kind: 'css', effectType: 'blur', amount: 20, enabled: false }],
				createdAt: 10,
				updatedAt: 20
			}
		]);
		expect(parseEffectPresets(JSON.stringify(updated))).toEqual(updated);
		expect(parseEffectPresets(JSON.stringify([{ ...updated[0], effects: [] }]))).toEqual([]);
		expect(removeEffectPreset(updated, 'preset')).toEqual([]);
	});
});
