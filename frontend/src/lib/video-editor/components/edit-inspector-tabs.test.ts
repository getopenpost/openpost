import { describe, expect, it } from 'vitest';
import { resolveEditInspectorTabs } from './edit-inspector-tabs';

describe('resolveEditInspectorTabs', () => {
	it('exposes only the tabs that apply to the current selection', () => {
		expect(
			resolveEditInspectorTabs({
				hasSelection: false,
				supportsMotion: false,
				supportsEffects: false,
				isMedia: false
			})
		).toEqual([]);

		expect(
			resolveEditInspectorTabs({
				hasSelection: true,
				supportsMotion: true,
				supportsEffects: true,
				isMedia: true
			})
		).toEqual(['properties', 'motion', 'effects', 'transcript']);

		expect(
			resolveEditInspectorTabs({
				hasSelection: true,
				supportsMotion: false,
				supportsEffects: false,
				isMedia: true
			})
		).toEqual(['properties', 'transcript']);
	});
});
