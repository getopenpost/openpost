import { describe, expect, it } from 'vitest';
import { isValidProjectCreationSettings, projectAspectRatio } from './project-presets';

describe('project creation presets', () => {
	it('validates exact dimensions and supported frame rates', () => {
		expect(isValidProjectCreationSettings({ width: 320, height: 240, fps: 24 })).toBe(true);
		expect(isValidProjectCreationSettings({ width: 7680, height: 4320, fps: 60 })).toBe(true);
		expect(isValidProjectCreationSettings({ width: 319, height: 240, fps: 24 })).toBe(false);
		expect(isValidProjectCreationSettings({ width: 1920, height: 1080, fps: 29 })).toBe(false);
		expect(projectAspectRatio(1080, 1350)).toBe('4:5');
	});
});
