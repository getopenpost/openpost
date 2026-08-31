import { describe, expect, it } from 'vitest';
import {
	easingConfigFromPreset,
	loadCustomEasingPresets,
	parseCustomEasingPresets,
	presetFromEasing,
	saveCustomEasingPresets,
	suggestedCustomPresetName,
	upsertCustomEasingPreset
} from './custom-easing-presets';

describe('custom easing presets', () => {
	it('is safe without browser storage and reports failed writes', () => {
		expect(loadCustomEasingPresets()).toEqual([]);
		expect(saveCustomEasingPresets([])).toBe(false);
		expect(
			saveCustomEasingPresets([], {
				setItem() {
					throw new DOMException('Quota exceeded', 'QuotaExceededError');
				}
			})
		).toBe(false);
	});

	it('keeps only finite, named easing and spring presets', () => {
		expect(
			parseCustomEasingPresets(
				JSON.stringify([
					{ name: 'Soft', type: 'Easing', bezier: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 } },
					{ name: 'Bounce', type: 'Spring', spring: { tension: 200, friction: 16, mass: 1 } },
					{ name: '', type: 'Easing', bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } },
					{ name: 'Broken', type: 'Spring', spring: { tension: 'fast' } },
					{ name: 'Unsafe', type: 'Spring', spring: { tension: 170, friction: 26, mass: 0 } },
					{ name: 'Bad X', type: 'Easing', bezier: { x1: -1, y1: 0, x2: 1, y2: 1 } }
				])
			)
		).toHaveLength(2);
		expect(parseCustomEasingPresets('{')).toEqual([]);
	});

	it('rejects runtime-unsafe values before saving them', () => {
		expect(
			presetFromEasing('Unsafe spring', {
				type: 'spring',
				spring: { tension: 170, friction: 26, mass: 0 }
			})
		).toBeNull();
		expect(
			presetFromEasing('Unsafe curve', {
				type: 'cubic-bezier',
				bezier: { x1: 1.5, y1: 0, x2: 0.5, y2: 1 }
			})
		).toBeNull();
	});

	it('creates, replaces, and rehydrates a cubic preset without sharing objects', () => {
		const preset = presetFromEasing('  My curve  ', {
			type: 'cubic-bezier',
			bezier: { x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.9 }
		});
		expect(preset).toMatchObject({ name: 'My curve', type: 'Easing' });
		if (!preset) return;
		const next = upsertCustomEasingPreset(
			[{ name: 'My curve', type: 'Spring', spring: { tension: 170, friction: 26, mass: 1 } }],
			preset
		);
		expect(next).toEqual([preset]);
		expect(easingConfigFromPreset(preset)).toEqual({
			type: 'cubic-bezier',
			bezier: { x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.9 }
		});
	});

	it('finds the next unused FreeCut-style custom name', () => {
		expect(
			suggestedCustomPresetName([
				{ name: 'Custom 3', type: 'Spring', spring: { tension: 1, friction: 1, mass: 1 } },
				{ name: 'Other', type: 'Easing', bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } }
			])
		).toBe('Custom 4');
	});
});
