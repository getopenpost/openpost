import { describe, expect, it } from 'vitest';
import { EDITOR_COLOR_GRADE_PRESETS } from './presets';

describe('shared editor color presets', () => {
	it('keeps stable preset identifiers and neutral Original values', () => {
		expect(EDITOR_COLOR_GRADE_PRESETS.map((preset) => preset.id)).toEqual([
			'original',
			'crisp',
			'warm',
			'cool',
			'mono'
		]);
		expect(EDITOR_COLOR_GRADE_PRESETS[0]?.adjustments).toEqual({});
	});
});
