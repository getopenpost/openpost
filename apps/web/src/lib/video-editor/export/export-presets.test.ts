import { describe, expect, it } from 'vitest';
import {
	applyExportPreset,
	EXPORT_PRESETS,
	matchExportPreset,
	type ExportPresetId
} from './export-presets';

describe('export presets', () => {
	it('bundles four presets that each set all four fields atomically', () => {
		expect(EXPORT_PRESETS.map((preset) => preset.id)).toEqual(['master', 'web', 'social', 'draft']);
		for (const preset of EXPORT_PRESETS) {
			const applied = applyExportPreset(preset.id);
			expect(applied).toEqual({
				format: preset.format,
				codec: preset.codec,
				quality: preset.quality,
				resolution: preset.resolution
			});
		}
	});

	it('keeps master at source resolution and draft at the smallest ladder rung', () => {
		expect(applyExportPreset('master')).toMatchObject({ quality: 'high', resolution: 'source' });
		expect(applyExportPreset('draft')).toMatchObject({ quality: 'draft', resolution: '854x480' });
	});

	it('matches current settings back to a preset id, or null when customized', () => {
		expect(matchExportPreset(applyExportPreset('web'))).toBe('web');
		expect(
			matchExportPreset({ format: 'mp4', codec: 'avc', quality: 'high', resolution: 'source' })
		).toBe('master');
		expect(
			matchExportPreset({ format: 'mkv', codec: 'avc', quality: 'standard', resolution: 'source' })
		).toBe(null);
	});

	it('rejects unknown preset ids', () => {
		// SAFETY: 'cinema' is intentionally not a member of ExportPresetId; the test
		// proves applyExportPreset throws instead of returning a partial selection.
		const unknownId = 'cinema' as ExportPresetId;
		expect(() => applyExportPreset(unknownId)).toThrowError(/Unknown export preset/);
	});
});
