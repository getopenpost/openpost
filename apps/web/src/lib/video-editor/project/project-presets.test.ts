import { describe, expect, it } from 'vitest';
import { PROJECT_PRESETS, projectAspectRatio } from './project-presets';

describe('PROJECT_PRESETS', () => {
	it('carries a platform eyebrow and name prefix for every template', () => {
		expect(PROJECT_PRESETS.length).toBeGreaterThan(0);
		for (const preset of PROJECT_PRESETS) {
			expect(preset.platform.trim().length).toBeGreaterThan(0);
			expect(preset.namePrefix.trim().length).toBeGreaterThan(0);
		}
	});

	it('keeps preset ids unique with positive dimensions', () => {
		const ids = PROJECT_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const preset of PROJECT_PRESETS) {
			expect(preset.width).toBeGreaterThan(0);
			expect(preset.height).toBeGreaterThan(0);
		}
	});

	it('formats aspect ratios for the picker cards', () => {
		expect(projectAspectRatio(1920, 1080)).toBe('16:9');
		expect(projectAspectRatio(1080, 1920)).toBe('9:16');
		expect(projectAspectRatio(1080, 1080)).toBe('1:1');
	});
});
